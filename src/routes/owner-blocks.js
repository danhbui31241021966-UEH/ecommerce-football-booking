const express = require('express');
const { db, withTransaction } = require('../db');
const { requireRole } = require('../middleware/auth');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { isDate, isHm } = require('../lib/time');
const { loadVenue } = require('../services/venueStore');
const { claimBlockSlots } = require('../services/slotClaims');
const { offerSlot } = require('../services/waitlist');
const clock = require('../clock');

const router = express.Router();
router.use(requireRole('owner'));

router.post('/blocks', async (req, res) => {
  const { courtId, date, start, end, reason = '' } = req.body || {};
  if (!/^\d+$/.test(String(courtId)) || !isDate(date) || !isHm(start) || !isHm(end) || start >= end) {
    throw badRequest('Thời gian chặn không hợp lệ');
  }

  const court = await db.one('SELECT venue_id FROM courts WHERE id = ?', [courtId]);
  if (!court) throw notFound('Không tìm thấy sân con');
  const venue = await loadVenue(court.venueId, { activeOnly: false });
  if (venue.ownerId !== req.user.id) throw forbidden('Sân này không thuộc tài khoản của bạn');

  const startAt = `${date} ${start}:00`;
  const endAt = `${date} ${end}:00`;
  const blockId = await withTransaction(async (tx) => {
    const result = await tx.query(
      `INSERT INTO blocks (court_id, start_at, end_at, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [courtId, startAt, endAt, String(reason).slice(0, 200), req.user.id, clock.now()],
    );
    await claimBlockSlots(tx, {
      blockId: result.insertId,
      courtId: Number(courtId),
      venue,
      startAt,
      endAt,
    });
    return result.insertId;
  });

  res.status(201).json({
    id: Number(blockId),
    courtId: Number(courtId),
    date,
    start,
    end,
    reason: String(reason).slice(0, 200),
  });
});

router.delete('/blocks/:id', async (req, res) => {
  const block = await db.one(
    `SELECT b.id, b.league_id, v.owner_id AS owner_id
       FROM blocks b
       JOIN courts c ON c.id = b.court_id
       JOIN venues v ON v.id = c.venue_id
      WHERE b.id = ?`,
    [req.params.id],
  );
  if (!block) throw notFound('Không tìm thấy lịch chặn');
  if (block.ownerId !== req.user.id) throw forbidden('Lịch chặn này không thuộc sân của bạn');

  // Khi làm giải đấu (R18): trả 409 nếu block giữ giờ giải.
  await withTransaction(async (tx) => {
    const freed = await tx.query('SELECT court_id, start_at FROM slot_claims WHERE block_id = ? ORDER BY start_at', [block.id]);
    await tx.query('DELETE FROM blocks WHERE id = ?', [block.id]);
    // Ô vừa được nhả thì mời người chờ sớm nhất, như khi một lịch đặt bị hủy (R9).
    for (const slot of freed) await offerSlot(tx, slot.courtId, slot.startAt);
  });
  res.status(204).end();
});

module.exports = router;
