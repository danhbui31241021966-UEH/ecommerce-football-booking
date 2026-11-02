const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { isDate, isHm, addDays } = require('../lib/time');
const { loadVenue } = require('../services/venueStore');
const { toVenueDetail } = require('../services/venueDto');
const { scheduleOf } = require('../services/schedule');
const clock = require('../clock');

const router = express.Router();
router.use(requireRole('owner'));

function hmOrNull(value) {
  if (value == null || value === '') return null;
  if (!isHm(value)) throw badRequest('Giờ không hợp lệ');
  return value;
}

function number(value, name, max = 10000000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw badRequest(`${name} không hợp lệ`);
  return n;
}

async function owned(id, ownerId) {
  if (!/^\d+$/.test(String(id))) throw notFound('Không tìm thấy sân');
  const venue = await loadVenue(Number(id), { activeOnly: false });
  if (!venue) throw notFound('Không tìm thấy sân');
  if (venue.ownerId !== ownerId) throw forbidden('Sân này không thuộc tài khoản của bạn');
  return venue;
}

async function detail(id) {
  const venue = await loadVenue(id, { activeOnly: false });
  return {
    ...toVenueDetail(venue),
    isActive: venue.isActive,
    bankBin: venue.bank.bin,
    bankAccount: venue.bank.account,
    bankAccountName: venue.bank.accountName,
    courts: venue.courts.map((court) => ({
      id: court.id,
      name: court.name,
      fieldType: court.fieldType,
      price: court.price,
      peakPrice: court.peakPrice,
      teamMode: court.teamModeEnabled ? { from: court.teamModeFrom, to: court.teamModeTo } : null,
      isActive: court.isActive,
    })),
  };
}

router.get('/venues', async (req, res) => {
  const rows = await db.query('SELECT id FROM venues WHERE owner_id = ? ORDER BY id', [req.user.id]);
  res.json(await Promise.all(rows.map((row) => detail(row.id))));
});

router.post('/venues', async (req, res) => {
  const p = req.body || {};
  const now = clock.now();
  const openTime = hmOrNull(p.openTime) || '06:00';
  const closeTime = hmOrNull(p.closeTime) || '22:00';
  if (!p.name || !p.district || !p.address || openTime >= closeTime) {
    throw badRequest('Thông tin sân không hợp lệ');
  }

  const result = await db.query(
    `INSERT INTO venues (
       owner_id, name, district, address, phone, description, rules, amenities,
       open_time, close_time, slot_minutes, peak_start, peak_end, requires_approval,
       last_minute_percent, maps_url, bank_bin, bank_account, bank_account_name,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      String(p.name).trim(),
      String(p.district).trim(),
      String(p.address).trim(),
      String(p.phone || ''),
      String(p.description || ''),
      String(p.rules || ''),
      JSON.stringify(Array.isArray(p.amenities) ? p.amenities : []),
      openTime,
      closeTime,
      number(p.slotMinutes ?? 60, 'slotMinutes', 180),
      hmOrNull(p.peakStart),
      hmOrNull(p.peakEnd),
      p.requiresApproval ? 1 : 0,
      number(p.lastMinutePercent ?? 0, 'lastMinutePercent', 100),
      String(p.mapsUrl || ''),
      String(p.bankBin || ''),
      String(p.bankAccount || ''),
      String(p.bankAccountName || ''),
      now,
      now,
    ],
  );
  res.status(201).json(await detail(result.insertId));
});

router.put('/venues/:id', async (req, res) => {
  const venue = await owned(req.params.id, req.user.id);
  const p = req.body || {};
  const fields = {
    name: ['name', p.name],
    district: ['district', p.district],
    address: ['address', p.address],
    phone: ['phone', p.phone],
    description: ['description', p.description],
    rules: ['rules', p.rules],
    amenities: ['amenities', p.amenities === undefined ? undefined : JSON.stringify(p.amenities)],
    openTime: ['open_time', p.openTime],
    closeTime: ['close_time', p.closeTime],
    slotMinutes: ['slot_minutes', p.slotMinutes],
    peakStart: ['peak_start', p.peakStart],
    peakEnd: ['peak_end', p.peakEnd],
    requiresApproval: ['requires_approval', p.requiresApproval],
    lastMinutePercent: ['last_minute_percent', p.lastMinutePercent],
    mapsUrl: ['maps_url', p.mapsUrl],
    bankBin: ['bank_bin', p.bankBin],
    bankAccount: ['bank_account', p.bankAccount],
    bankAccountName: ['bank_account_name', p.bankAccountName],
    isActive: ['is_active', p.isActive],
  };
  const sets = [];
  const values = [];

  for (const [key, [column, value]] of Object.entries(fields)) {
    if (value === undefined) continue;
    let normalized = value;
    if (['openTime', 'closeTime', 'peakStart', 'peakEnd'].includes(key)) normalized = hmOrNull(value);
    if (key === 'slotMinutes') normalized = number(value, key, 180);
    if (key === 'lastMinutePercent') normalized = number(value, key, 100);
    if (['requiresApproval', 'isActive'].includes(key)) normalized = value ? 1 : 0;
    sets.push(`${column} = ?`);
    values.push(normalized);
  }

  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(clock.now(), venue.id);
    await db.query(`UPDATE venues SET ${sets.join(', ')} WHERE id = ?`, values);
  }
  // Pricing and peak-window edits affect generated slot prices; stored booking prices remain snapshots.
  res.json(await detail(venue.id));
});

router.post('/venues/:id/courts', async (req, res) => {
  const venue = await owned(req.params.id, req.user.id);
  const p = req.body || {};
  if (!p.name || !['5', '7'].includes(String(p.fieldType))) throw badRequest('Thông tin sân con không hợp lệ');

  const result = await db.query(
    'INSERT INTO courts (venue_id, name, field_type, price, peak_price) VALUES (?, ?, ?, ?, ?)',
    [venue.id, String(p.name).trim(), String(p.fieldType), number(p.price, 'price'), number(p.peakPrice ?? p.price, 'peakPrice')],
  );
  const created = (await detail(venue.id)).courts.find((court) => court.id === result.insertId);
  res.status(201).json(created);
});

router.put('/courts/:id', async (req, res) => {
  const court = await db.one('SELECT venue_id FROM courts WHERE id = ?', [req.params.id]);
  if (!court) throw notFound('Không tìm thấy sân con');
  const venue = await owned(court.venueId, req.user.id);
  const p = req.body || {};
  const sets = [];
  const values = [];

  if (p.name !== undefined) {
    sets.push('name = ?');
    values.push(String(p.name).trim());
  }
  if (p.fieldType !== undefined) {
    if (!['5', '7'].includes(String(p.fieldType))) throw badRequest('Loại sân không hợp lệ');
    sets.push('field_type = ?');
    values.push(String(p.fieldType));
  }
  for (const [key, column] of [['price', 'price'], ['peakPrice', 'peak_price']]) {
    if (p[key] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(number(p[key], key));
    }
  }
  if (p.isActive !== undefined) {
    sets.push('is_active = ?');
    values.push(p.isActive ? 1 : 0);
  }
  if (p.teamMode !== undefined) {
    const teamMode = p.teamMode;
    if (teamMode !== null && (!teamMode || hmOrNull(teamMode.from) === null || hmOrNull(teamMode.to) === null || teamMode.from >= teamMode.to)) {
      throw badRequest('Khung ghép kèo không hợp lệ');
    }
    sets.push('team_mode_enabled = ?', 'team_mode_from = ?', 'team_mode_to = ?');
    values.push(teamMode ? 1 : 0, teamMode ? teamMode.from : null, teamMode ? teamMode.to : null);
  }

  if (sets.length) {
    values.push(req.params.id);
    await db.query(`UPDATE courts SET ${sets.join(', ')} WHERE id = ?`, values);
  }
  res.json((await detail(venue.id)).courts.find((item) => item.id === Number(req.params.id)));
});

router.get('/venues/:id/schedule', async (req, res) => {
  const venue = await owned(req.params.id, req.user.id);
  const date = req.query.date;
  if (!isDate(date)) throw badRequest('Ngày không hợp lệ');

  const schedule = await scheduleOf(venue, date, req.user);
  const courtIds = venue.courts.map((court) => court.id);
  if (!courtIds.length) return res.json(schedule);

  const from = `${date} 00:00:00`;
  const to = `${addDays(date, 1)} 00:00:00`;
  const [bookings, waiters, blocks] = await Promise.all([
    db.query(
      `SELECT b.id, b.code, b.status, b.user_id, b.court_id, b.start_at, b.end_at, b.payment_status, b.source,
              b.walk_in_name, b.walk_in_phone, u.full_name, u.phone
         FROM bookings b
         LEFT JOIN users u ON u.id = b.user_id
        WHERE b.court_id IN (?) AND b.start_at >= ? AND b.start_at < ?
          AND b.status IN ('pending', 'confirmed', 'matching')`,
      [courtIds, from, to],
    ),
    db.query(
      `SELECT court_id, start_at, COUNT(*) AS n
         FROM waitlist
        WHERE court_id IN (?) AND start_at >= ? AND start_at < ?
          AND status IN ('waiting', 'offered')
        GROUP BY court_id, start_at`,
      [courtIds, from, to],
    ),
    db.query(
      `SELECT id, court_id, start_at, end_at, reason, league_id
         FROM blocks
        WHERE court_id IN (?) AND start_at < ? AND end_at > ?`,
      [courtIds, to, from],
    ),
  ]);

  for (const court of schedule.courts) {
    for (const slot of court.slots) {
      const slotStart = `${date} ${slot.start}:00`;
      const slotEnd = `${date} ${slot.end}:00`;
      const booking = bookings.find((row) => row.courtId === court.id && row.startAt === slotStart);
      if (booking) {
        slot.booking = {
          id: booking.id,
          code: booking.code,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          customerName: booking.source === 'phone' ? booking.walkInName : booking.fullName,
          customerPhone: booking.source === 'phone' ? booking.walkInPhone : booking.phone,
          source: booking.source,
        };
      }
      const block = blocks.find((row) => row.courtId === court.id && row.startAt < slotEnd && row.endAt > slotStart);
      if (block) slot.block = { id: block.id, reason: block.reason, ...(block.leagueId ? { leagueId: block.leagueId } : {}) };
      const waitlist = waiters.find((row) => row.courtId === court.id && row.startAt === slotStart);
      if (waitlist?.n) slot.waitlistCount = waitlist.n;
    }
  }
  res.json(schedule);
});

module.exports = router;
