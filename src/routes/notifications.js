const express = require('express');
const { requireRole } = require('../middleware/auth');
const { db } = require('../db');

const router = express.Router();
router.use(requireRole());

router.get('/', async (req, res) => {
  const rows = await db.query('SELECT id, booking_id, message, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 200', [req.user.id]);
  const unread = await db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({
    unread: Number(unread.n),
    items: rows.map((n) => ({ id: n.id, bookingId: n.bookingId, message: n.message, link: n.link, isRead: !!n.isRead, createdAt: n.createdAt })),
  });
});

router.post('/read-all', async (req, res) => {
  await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
