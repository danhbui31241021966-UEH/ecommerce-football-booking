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
  const rawEmail = String(req.body.email ?? '').trim();
  const email = rawEmail ? v.email(rawEmail) : null;
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
    if (isDuplicate(err, 'uq_user_phone')) throw conflict('Số điện thoại này đã được đăng ký');
    if (isDuplicate(err, 'uq_user_email')) throw conflict('Email này đã được đăng ký');
    if (isDuplicate(err)) throw conflict('Thông tin tài khoản đã được sử dụng');
    throw err;
  }
  await startSession(req, id);
  res.status(201).json({ user: { id, fullName, email, phone, role: 'customer' } });
});

router.post('/login', authLimiter, async (req, res) => {
  const password = String(req.body.password || '');
  const identifier = String(req.body.identifier ?? req.body.email ?? '').trim();
  if (!identifier || !password) throw badRequest('Vui lòng nhập số điện thoại hoặc email và mật khẩu');
  const user = identifier.includes('@')
    ? await db.one('SELECT * FROM users WHERE email = ?', [v.email(identifier)])
    : await db.one('SELECT * FROM users WHERE phone = ?', [v.phone(identifier)]);
  // Cùng một thông báo cho sai thông tin đăng nhập để không lộ tài khoản nào đã đăng ký.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('Số điện thoại/email hoặc mật khẩu không đúng');
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
