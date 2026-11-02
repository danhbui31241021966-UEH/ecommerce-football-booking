// Công cụ chỉ cho phát triển/demo trên máy local: đặt lại dữ liệu demo, tua đồng hồ, đăng nhập nhanh theo vai trò.
// Router này CHỈ được gắn vào app khi NODE_ENV khác production (xem app.js); ở production không có route nào,
// nên các đường dẫn /api/dev/* rơi xuống 404 chung của API. tests/dev.test.js kiểm điều này.
const express = require('express');
const clock = require('../clock');
const { db } = require('../db');
const { badRequest } = require('../utils/errors');
const { resetDemo } = require('../seed');
const { demoLogins } = require('../seed/core');
const { startSession, publicUser } = require('./auth');

const router = express.Router();

const state = (user) => ({ now: clock.now(), clockOffsetMin: clock.getOffsetMinutes(), user: publicUser(user) || null });

router.get('/state', (req, res) => res.json(state(req.user)));

// Dữ liệu và đồng hồ về mốc ban đầu; phiên đăng nhập hiện tại giữ nguyên (user demo có cùng id sau khi nạp lại).
router.post('/reset-demo', async (req, res) => {
  clock.setOffsetMinutes(0);
  const seeded = await resetDemo();
  res.json({ ok: true, seeded, now: clock.now() });
});

// Tua đồng hồ của server tới trước `minutes` phút (cộng dồn), hoặc đặt lại độ lệch bằng `offsetMinutes`.
router.post('/clock', (req, res) => {
  const { minutes, offsetMinutes } = req.body || {};
  if (offsetMinutes !== undefined) {
    if (!Number.isFinite(Number(offsetMinutes))) throw badRequest('offsetMinutes phải là số');
    clock.setOffsetMinutes(Number(offsetMinutes));
  } else {
    if (!Number.isFinite(Number(minutes))) throw badRequest('Cần minutes hoặc offsetMinutes là số');
    clock.setOffsetMinutes(clock.getOffsetMinutes() + Number(minutes));
  }
  res.json({ now: clock.now(), clockOffsetMin: clock.getOffsetMinutes() });
});

// role: 'customer' | 'owner' | 'admin' (tài khoản demo của mock) hoặc 'guest' (đăng xuất).
router.post('/login', async (req, res) => {
  const role = String(req.body?.role || '');
  if (role === 'guest') {
    await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    return res.json({ user: null });
  }
  const id = demoLogins()[role];
  if (!id) throw badRequest('Vai trò demo không tồn tại');
  const user = await db.one('SELECT id, full_name, email, phone, role FROM users WHERE id = ?', [id]);
  if (!user) throw badRequest('Chưa có dữ liệu demo, hãy gọi /api/dev/reset-demo hoặc chạy npm run db:seed');
  await startSession(req, user.id);
  res.json({ user: publicUser({ id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, role: user.role }) });
});

module.exports = router;
