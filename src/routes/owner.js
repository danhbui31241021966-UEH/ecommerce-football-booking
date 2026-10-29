const express = require('express');
const { pool, withTransaction } = require('../db');
const v = require('../utils/validate');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const slots = require('../services/slots');
const bookings = require('../services/bookings');
const { getDaySchedule, HOLDING_SQL } = require('../services/schedule');

const router = express.Router();
router.use(requireRole('owner'));

const STATUSES = Object.keys(bookings.STATUS_LABEL);

// Chủ sân chỉ thao tác trên sân của mình; sân của người khác coi như không tồn tại.
async function ownVenue(ownerId, venueId) {
  const [rows] = await pool.query('SELECT * FROM venues WHERE id = ? AND owner_id = ?', [venueId, ownerId]);
  if (!rows.length) throw notFound('Không tìm thấy sân');
  return rows[0];
}

async function ownCourt(ownerId, courtId) {
  const [rows] = await pool.query(
    `SELECT c.*, v.owner_id FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ? AND v.owner_id = ?`,
    [courtId, ownerId],
  );
  if (!rows.length) throw notFound('Không tìm thấy sân con');
  return rows[0];
}

function parseVenue(body) {
  const openTime = v.time(body.openTime, 'Giờ mở cửa');
  const closeTime = v.time(body.closeTime, 'Giờ đóng cửa');
  const slotMinutes = v.int(body.slotMinutes, 'Độ dài slot (phút)', { min: 30, max: 180 });
  if (slotMinutes % 15 !== 0) throw badRequest('Độ dài slot phải là bội số của 15 phút');
  if (slots.timeToMinutes(closeTime) - slots.timeToMinutes(openTime) < slotMinutes) {
    throw badRequest('Giờ đóng cửa phải sau giờ mở cửa ít nhất một slot');
  }
  const peakStart = v.time(body.peakStart, 'Giờ vàng bắt đầu', { optional: true });
  const peakEnd = v.time(body.peakEnd, 'Giờ vàng kết thúc', { optional: true });
  if (Boolean(peakStart) !== Boolean(peakEnd)) throw badRequest('Cần nhập đủ giờ bắt đầu và kết thúc khung giờ vàng');
  if (peakStart && peakEnd <= peakStart) throw badRequest('Giờ vàng kết thúc phải sau giờ bắt đầu');

  return {
    name: v.str(body.name, 'Tên sân', { min: 3, max: 150 }),
    district: v.str(body.district, 'Quận/Huyện', { max: 50 }),
    address: v.str(body.address, 'Địa chỉ', { min: 5, max: 255 }),
    phone: v.phone(body.phone, 'Số điện thoại sân'),
    description: v.str(body.description, 'Mô tả', { max: 2000, optional: true }),
    amenities: v.str(body.amenities, 'Tiện ích', { max: 500, optional: true }) || '',
    open_time: openTime,
    close_time: closeTime,
    slot_minutes: slotMinutes,
    peak_start: peakStart,
    peak_end: peakEnd,
    requires_approval: v.bool(body.requiresApproval) ? 1 : 0,
    rules: v.str(body.rules, 'Điều kiện sử dụng', { max: 2000, optional: true }),
    payment_info: v.str(body.paymentInfo, 'Hướng dẫn thanh toán', { max: 1000, optional: true }),
    image_url: v.imageUrl(body.imageUrl),
  };
}

function parseCourt(body) {
  const price = v.int(body.price, 'Giá thường', { min: 10_000, max: 10_000_000 });
  const peakPrice = v.int(body.peakPrice ?? body.price, 'Giá giờ vàng', { min: 10_000, max: 10_000_000 });
  if (!['5', '7'].includes(String(body.fieldType))) throw badRequest('Loại sân phải là 5 hoặc 7 người');
  return {
    name: v.str(body.name, 'Tên sân con', { max: 50 }),
    field_type: String(body.fieldType),
    price,
    peak_price: peakPrice,
  };
}

// ----- F08, F09: sân, sân con, slot, giá -----

router.get('/venues', async (req, res) => {
  const [venues] = await pool.query('SELECT * FROM venues WHERE owner_id = ? ORDER BY id', [req.user.id]);
  const [courts] = venues.length
    ? await pool.query('SELECT * FROM courts WHERE venue_id IN (?) ORDER BY name', [venues.map((x) => x.id)])
    : [[]];
  res.json(venues.map((x) => ({ ...x, courts: courts.filter((c) => c.venue_id === x.id) })));
});

router.post('/venues', async (req, res) => {
  const data = parseVenue(req.body);
  const [r] = await pool.query('INSERT INTO venues SET ?', [{ ...data, owner_id: req.user.id }]);
  res.status(201).json({ id: r.insertId });
});

router.put('/venues/:id', async (req, res) => {
  const venue = await ownVenue(req.user.id, v.id(req.params.id));
  const data = { ...parseVenue(req.body), is_active: v.bool(req.body.isActive) ? 1 : 0 };
  await pool.query('UPDATE venues SET ? WHERE id = ?', [data, venue.id]);
  res.json({ ok: true });
});

router.post('/venues/:id/courts', async (req, res) => {
  const venue = await ownVenue(req.user.id, v.id(req.params.id));
  const [r] = await pool.query('INSERT INTO courts SET ?', [{ ...parseCourt(req.body), venue_id: venue.id }]);
  res.status(201).json({ id: r.insertId });
});

// Sân con chỉ ngừng hoạt động, không xóa cứng, để giữ lịch sử booking.
router.put('/courts/:id', async (req, res) => {
  const court = await ownCourt(req.user.id, v.id(req.params.id));
  const data = { ...parseCourt(req.body), is_active: v.bool(req.body.isActive) ? 1 : 0 };
  await pool.query('UPDATE courts SET ? WHERE id = ?', [data, court.id]);
  res.json({ ok: true });
});

// ----- Lịch theo ngày + F10 chặn slot -----

router.get('/venues/:id/schedule', async (req, res) => {
  const venue = await ownVenue(req.user.id, v.id(req.params.id));
  res.json(await getDaySchedule(venue, v.date(req.query.date), { withDetails: true }));
});

router.post('/blocks', async (req, res) => {
  const courtId = v.id(req.body.courtId, 'Sân con');
  const date = v.date(req.body.date);
  const start = v.time(req.body.start, 'Khung giờ');
  const reason = v.str(req.body.reason, 'Lý do chặn', { max: 255 });
  const court = await ownCourt(req.user.id, courtId);
  const venue = await ownVenue(req.user.id, court.venue_id);

  const slot = slots.generateSlots(venue).find((s) => s.start === start);
  if (!slot) throw badRequest('Khung giờ không hợp lệ');
  const startAt = `${date} ${slot.start}:00`;
  const endAt = `${date} ${slot.end}:00`;
  if (startAt <= slots.toSqlDateTime(new Date())) throw badRequest('Không thể chặn khung giờ đã qua');

  const id = await withTransaction(async (conn) => {
    // Khóa sân con giống lúc tạo booking để không chặn trùng với booking đang được tạo.
    await conn.query('SELECT id FROM courts WHERE id = ? FOR UPDATE', [courtId]);
    const [taken] = await conn.query(
      `SELECT b.code FROM bookings b WHERE b.court_id = ? AND b.start_at < ? AND b.end_at > ? AND ${HOLDING_SQL}`,
      [courtId, endAt, startAt],
    );
    if (taken.length) throw conflict(`Khung giờ đang có booking ${taken[0].code}; cần hủy booking trước khi chặn`);
    const [dup] = await conn.query('SELECT id FROM slot_blocks WHERE court_id = ? AND start_at < ? AND end_at > ?', [
      courtId,
      endAt,
      startAt,
    ]);
    if (dup.length) throw conflict('Khung giờ này đã được chặn');
    const [r] = await conn.query(
      'INSERT INTO slot_blocks (court_id, start_at, end_at, reason, created_by) VALUES (?, ?, ?, ?, ?)',
      [courtId, startAt, endAt, reason, req.user.id],
    );
    return r.insertId;
  });
  res.status(201).json({ id });
});

router.delete('/blocks/:id', async (req, res) => {
  const [r] = await pool.query(
    `DELETE sb FROM slot_blocks sb JOIN courts c ON c.id = sb.court_id JOIN venues v ON v.id = c.venue_id
     WHERE sb.id = ? AND v.owner_id = ?`,
    [v.id(req.params.id), req.user.id],
  );
  if (!r.affectedRows) throw notFound('Không tìm thấy lịch chặn');
  res.json({ ok: true });
});

// ----- F11, F12, F13: booking của sân mình -----

router.get('/bookings', async (req, res) => {
  res.json(
    await bookings.list({
      ownerId: req.user.id,
      status: STATUSES.includes(req.query.status) ? req.query.status : null,
      date: req.query.date ? v.date(req.query.date) : null,
      venueId: req.query.venueId ? v.id(req.query.venueId) : null,
      q: v.str(req.query.q, 'Từ khóa', { max: 50, optional: true }),
    }),
  );
});

router.post('/bookings/:id/approve', async (req, res) => {
  await bookings.approve(req.user, v.id(req.params.id));
  res.json({ ok: true });
});

router.post('/bookings/:id/reject', async (req, res) => {
  const reason = v.str(req.body.reason, 'Lý do', { max: 255, optional: true });
  await bookings.reject(req.user, v.id(req.params.id), reason);
  res.json({ ok: true });
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const reason = v.str(req.body.reason, 'Lý do hủy', { max: 255 });
  await bookings.cancelByStaff(req.user, v.id(req.params.id), reason);
  res.json({ ok: true });
});

router.post('/bookings/:id/paid', async (req, res) => {
  await bookings.markPaid(req.user, v.id(req.params.id));
  res.json({ ok: true });
});

router.post('/bookings/:id/refund', async (req, res) => {
  const note = v.str(req.body.note, 'Ghi chú hoàn tiền', { max: 255, optional: true });
  await bookings.markRefunded(req.user, v.id(req.params.id), note);
  res.json({ ok: true });
});

module.exports = router;
