const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, isDuplicate } = require('../db');
const clock = require('../clock');
const v = require('../utils/validate');
const { badRequest, conflict, unauthorized, forbidden } = require('../utils/errors');
const { issueToken, ensureToken } = require('../middleware/csrf');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10000 : 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Thử quá nhiều lần, vui lòng đợi 15 phút' },
});

const publicUser = (u) => u && { id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role };

// Đổi session id khi đăng nhập để chống session fixation.
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      issueToken(req);
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

router.get('/csrf', (req, res) => {
  res.json({ csrfToken: ensureToken(req) });
});

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/register', authLimiter, async (req, res) => {
  const fullName = v.str(req.body.fullName, 'Họ tên', { min: 2, max: 100 });
  const email = v.email(req.body.email);
  const phone = v.phone(req.body.phone);
  const password = v.password(req.body.password);
  const hash = await bcrypt.hash(password, 10);
  let id;
  try {
    const r = await db.query(
      "INSERT INTO users (full_name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'customer', ?)",
      [fullName, email, phone, hash, clock.now()],
    );
    id = r.insertId;
  } catch (err) {
    if (isDuplicate(err)) throw conflict('Email này đã được đăng ký');
    throw err;
  }
  await startSession(req, id);
  res.status(201).json({ user: { id, fullName, email, phone, role: 'customer' } });
});

router.post('/login', authLimiter, async (req, res) => {
  const password = String(req.body.password || '');
  if (!req.body.email || !password) throw badRequest('Vui lòng nhập email và mật khẩu');
  const email = v.email(req.body.email);
  const user = await db.one('SELECT * FROM users WHERE email = ?', [email]);
  // Cùng một thông báo cho sai email và sai mật khẩu để không lộ email nào đã đăng ký.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('Email hoặc mật khẩu không đúng');
  if (!user.isActive) throw forbidden('Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên');
  await startSession(req, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('fb.sid');
    res.json({ ok: true });
  });
});

module.exports = { router, publicUser, startSession };
