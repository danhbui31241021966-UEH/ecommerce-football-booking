const express = require('express');
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireRole());

router.get('/', async (req, res) => {
  const [items] = await pool.query(
    'SELECT id, booking_id, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    [req.user.id],
  );
  const [[{ unread }]] = await pool.query(
    'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0',
    [req.user.id],
  );
  res.json({ unread, items });
});

router.post('/read-all', async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
