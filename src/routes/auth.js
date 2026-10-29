const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const v = require('../utils/validate');
const { conflict, unauthorized } = require('../utils/errors');
const { issueToken, ensureToken } = require('../middleware/csrf');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Thử quá nhiều lần, vui lòng đợi 15 phút' },
});

const publicUser = (u) => u && { id: u.id, fullName: u.full_name, email: u.email, phone: u.phone, role: u.role };

// Đổi session id sau khi đăng nhập để chống session fixation.
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      resolve(issueToken(req));
    });
  });
}

router.get('/csrf', (req, res) => {
  res.json({ csrfToken: ensureToken(req) });
});

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user), csrfToken: ensureToken(req) });
});

router.post('/register', authLimiter, async (req, res) => {
  const fullName = v.str(req.body.fullName, 'Họ tên', { min: 2, max: 100 });
  const email = v.email(req.body.email);
  const phone = v.phone(req.body.phone);
  const password = v.password(req.body.password);

  const hash = await bcrypt.hash(password, 10);
  let id;
  try {
    const [r] = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'customer')`,
      [fullName, email, phone, hash],
    );
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('Email này đã được đăng ký');
    throw err;
  }
  const csrfToken = await startSession(req, id);
  res.status(201).json({ user: { id, fullName, email, phone, role: 'customer' }, csrfToken });
});

router.post('/login', authLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const password = String(req.body.password || '');
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  // Cùng một thông báo cho sai email/sai mật khẩu để không lộ email nào đã đăng ký.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw unauthorized('Email hoặc mật khẩu không đúng');
  }
  if (!user.is_active) throw unauthorized('Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên');
  const csrfToken = await startSession(req, user.id);
  res.json({ user: publicUser(user), csrfToken });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('fb.sid');
    res.json({ ok: true });
  });
});

module.exports = { router, publicUser };
