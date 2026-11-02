const express = require('express');
const bcrypt = require('bcryptjs');
const { db, isDuplicate } = require('../db');
const { requireRole } = require('../middleware/auth');
const { badRequest, conflict, notFound } = require('../utils/errors');
const clock = require('../clock');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/users', async (req, res) => {
  const role = req.query.role;
  const allowed = ['customer', 'owner', 'admin'];
  if (role && !allowed.includes(role)) throw badRequest('Vai trò không hợp lệ');

  const rows = await db.query(
    `SELECT id, full_name, email, phone, role, is_active, created_at
       FROM users ${role ? 'WHERE role = ?' : ''}
      ORDER BY id`,
    role ? [role] : [],
  );
  res.json(rows);
});

router.post('/owners', async (req, res) => {
  const p = req.body || {};
  const name = String(p.fullName || '').trim();
  const email = String(p.email || '').trim();
  const phone = String(p.phone || '').replace(/\s/g, '');
  const password = String(p.password || '');

  if (name.length < 2) throw badRequest('Vui lòng nhập họ tên');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Email không hợp lệ');
  if (!/^0\d{9}$/.test(phone)) throw badRequest('Số điện thoại gồm 10 chữ số, bắt đầu bằng 0');
  if (password.length < 8) throw badRequest('Mật khẩu cần ít nhất 8 ký tự');

  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await db.query(
      "INSERT INTO users (full_name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)",
      [name, email, phone, hash, clock.now()],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (isDuplicate(err)) throw conflict('Email này đã được đăng ký');
    throw err;
  }
});

router.post('/users/:id/active', async (req, res) => {
  const user = await db.one('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
  if (!user) throw notFound('Không tìm thấy người dùng');
  if (user.id === req.user.id || user.role === 'admin') throw badRequest('Không thể khóa tài khoản admin');

  await db.query('UPDATE users SET is_active = ? WHERE id = ?', [req.body?.active ? 1 : 0, user.id]);
  res.json({ ok: true });
});

router.get('/logs', async (req, res) => {
  const rows = await db.query(
    `SELECT h.id, h.booking_id, b.code, h.action, h.from_status, h.to_status, h.note,
            COALESCE(u.full_name, 'Hệ thống') AS actor_name, h.actor_role, h.created_at
       FROM booking_history h
       JOIN bookings b ON b.id = h.booking_id
       LEFT JOIN users u ON u.id = h.actor_id
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT 300`,
  );
  res.json(rows);
});

module.exports = router;
