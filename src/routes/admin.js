const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const v = require('../utils/validate');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const bookings = require('../services/bookings');

const router = express.Router();
router.use(requireRole('admin'));

// ----- F14: tài khoản -----

router.get('/users', async (req, res) => {
  const role = ['customer', 'owner', 'admin'].includes(req.query.role) ? req.query.role : null;
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, role, is_active, created_at FROM users
     ${role ? 'WHERE role = ?' : ''} ORDER BY id DESC LIMIT 500`,
    role ? [role] : [],
  );
  res.json(rows);
});

// Chủ sân không tự đăng ký; Admin tạo và giao mật khẩu ban đầu.
router.post('/owners', async (req, res) => {
  const fullName = v.str(req.body.fullName, 'Họ tên', { min: 2, max: 100 });
  const email = v.email(req.body.email);
  const phone = v.phone(req.body.phone);
  const hash = await bcrypt.hash(v.password(req.body.password), 10);
  try {
    const [r] = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'owner')`,
      [fullName, email, phone, hash],
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('Email này đã được sử dụng');
    throw err;
  }
});

router.post('/users/:id/active', async (req, res) => {
  const id = v.id(req.params.id);
  if (id === req.user.id) throw badRequest('Không thể tự khóa tài khoản của mình');
  const [r] = await pool.query(`UPDATE users SET is_active = ? WHERE id = ? AND role <> 'admin'`, [
    v.bool(req.body.active) ? 1 : 0,
    id,
  ]);
  if (!r.affectedRows) throw notFound('Không tìm thấy tài khoản (không áp dụng cho Admin)');
  res.json({ ok: true });
});

// ----- F15: can thiệp booking khi tranh chấp/sự cố, luôn kèm lý do và lưu lịch sử -----

router.get('/bookings', async (req, res) => {
  const status = Object.keys(bookings.STATUS_LABEL).includes(req.query.status) ? req.query.status : null;
  res.json(await bookings.list({ status, q: v.str(req.query.q, 'Từ khóa', { max: 50, optional: true }) }));
});

router.post('/bookings/:id/cancel', async (req, res) => {
  await bookings.cancelByStaff(req.user, v.id(req.params.id), v.str(req.body.reason, 'Lý do hủy', { max: 255 }));
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

// Nhật ký thay đổi booking toàn hệ thống
router.get('/logs', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT h.id, h.action, h.from_status, h.to_status, h.note, h.created_at, b.id AS booking_id, b.code,
            u.full_name AS actor_name, u.role AS actor_role
     FROM booking_history h JOIN bookings b ON b.id = h.booking_id LEFT JOIN users u ON u.id = h.actor_id
     ORDER BY h.id DESC LIMIT 200`,
  );
  res.json(rows);
});

module.exports = router;
