const express = require('express');
const { requireRole } = require('../middleware/auth');
const { db, withTransaction, isDuplicate } = require('../db');
const clock = require('../clock');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { isDate, isHm, vnToMs, msToVn } = require('../lib/time');
const { loadCourt } = require('../services/venueStore');
const { slotGrid } = require('../services/slotGrid');
const { loadOccupancy, slotInfo } = require('../services/schedule');
const { offerSlot } = require('../services/waitlist');

const router = express.Router();
router.use(requireRole('customer'));

// R9: chỉ đăng ký chờ được giờ đang có người đặt.
router.post('/', async (req, res) => {
  const courtId = Number(req.body?.courtId);
  const { date, start } = req.body || {};
  if (!Number.isInteger(courtId) || courtId < 1) throw badRequest('Thiếu sân cần chờ');
  const found = await loadCourt(courtId);
  if (!found) throw notFound('Không tìm thấy sân');
  if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
  if (!isHm(start) || !slotGrid(found.venue).includes(start)) throw badRequest('Giờ bắt đầu không khớp lịch của sân');
  const { venue, court } = found;
  const slot = slotInfo(venue, court, date, start, await loadOccupancy([court.id], date), req.user);
  if (!['booked', 'held', 'offered'].includes(slot.status)) {
    throw badRequest(slot.status === 'available' ? 'Giờ này đang trống, bạn đặt luôn nhé' : 'Chỉ đăng ký chờ được giờ đang có người đặt');
  }
  if (slot.mine) throw conflict('Bạn đang giữ giờ này');
  const startAt = `${date} ${start}:00`;
  const out = await withTransaction(async (tx) => {
    let r;
    try {
      r = await tx.query("INSERT INTO waitlist (user_id, court_id, start_at, status, created_at) VALUES (?, ?, ?, 'waiting', ?)", [req.user.id, court.id, startAt, clock.now()]);
    } catch (err) {
      if (isDuplicate(err)) throw conflict('Bạn đã trong hàng chờ của giờ này');
      throw err;
    }
    await offerSlot(tx, court.id, startAt); // ô vừa được nhả giữa lúc kiểm và lúc ghi thì mời ngay
    const n = await tx.one('SELECT COUNT(*) AS n FROM waitlist WHERE court_id = ? AND start_at = ?', [court.id, startAt]);
    return { id: r.insertId, position: Number(n.n) };
  });
  res.status(201).json(out);
});

router.get('/mine', async (req, res) => {
  const rows = await db.query(
    `SELECT w.id, w.status, w.start_at, w.offer_expires_at, v.id AS venue_id, v.name AS venue_name, v.slot_minutes,
            c.id AS court_id, c.name AS court_name, c.field_type
       FROM waitlist w JOIN courts c ON c.id = w.court_id JOIN venues v ON v.id = c.venue_id
      WHERE w.user_id = ? ORDER BY w.start_at, w.id`,
    [req.user.id],
  );
  const nowMs = clock.nowMs();
  res.json(rows.map((w) => ({
    id: w.id, venueId: w.venueId, venueName: w.venueName, courtId: w.courtId, courtName: w.courtName, fieldType: w.fieldType,
    startAt: w.startAt, endAt: msToVn(vnToMs(w.startAt) + w.slotMinutes * 60000), status: w.status, offerExpiresAt: w.offerExpiresAt,
    offerActive: w.status === 'offered' && !!w.offerExpiresAt && vnToMs(w.offerExpiresAt) > nowMs,
  })));
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  await withTransaction(async (tx) => {
    const w = Number.isInteger(id) ? await tx.one('SELECT * FROM waitlist WHERE id = ? AND user_id = ? FOR UPDATE', [id, req.user.id]) : null;
    if (!w) throw notFound('Không tìm thấy lượt chờ');
    await tx.query('DELETE FROM waitlist WHERE id = ?', [id]);
    if (w.status === 'offered') await offerSlot(tx, w.courtId, w.startAt);
  });
  res.json({ ok: true });
});

module.exports = router;
