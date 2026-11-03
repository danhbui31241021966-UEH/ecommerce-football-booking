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
const bank = require('../services/bankOps');

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

// Mô phỏng ngân hàng báo có tiền (R17): cùng hàm xử lý với webhook SePay thật (services/bankOps.report), chỉ bỏ bước xác thực khóa.
// Body giống webhook rút gọn: { txId, content, amount, account }.
const BANK_DELAY_MS = 4000;
const bankQueue = new Set(); // khoản "khách bấm giả lập chuyển khoản", chờ vài giây rồi mới báo về

router.post('/bank-report', async (req, res) => {
  const { event, duplicate } = await bank.report(req.body || {});
  res.json({ ...event, duplicate });
});

router.post('/simulate-transfer', async (req, res) => {
  const { content, amount, account, immediate } = req.body || {};
  const q = { txId: `SIM${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase(), content, amount, account };
  const fire = () => {
    if (!bankQueue.delete(q)) return;
    bank.report(q).catch((err) => console.error('Giả lập ngân hàng báo lỗi:', err.message));
  };
  if (immediate) await bank.report(q);
  else {
    bankQueue.add(q);
    setTimeout(fire, BANK_DELAY_MS).unref();
  }
  res.json({ txId: q.txId, delayMs: immediate ? 0 : BANK_DELAY_MS });
});

// Ngân hàng báo ngay mọi khoản đang chờ.
router.post('/flush-bank', async (req, res) => {
  const due = [...bankQueue];
  bankQueue.clear();
  for (const q of due) await bank.report(q).catch((err) => console.error('Giả lập ngân hàng báo lỗi:', err.message));
  res.json({ reported: due.length });
});

module.exports = router;
