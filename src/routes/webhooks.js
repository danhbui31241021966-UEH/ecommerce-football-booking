// Webhook của bên ngoài (không dùng phiên đăng nhập, không CSRF): SePay báo có tiền vào tài khoản (R17).
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { unauthorized } = require('../utils/errors');
const bank = require('../services/bankOps');

const router = express.Router();

// So sánh hằng thời gian qua băm SHA-256 (hai chuỗi cùng độ dài, không lộ độ dài khóa).
function keyOk(header) {
  const expected = config.sepayApiKey;
  const m = /^Apikey\s+(.+)$/i.exec(String(header || '').trim());
  if (!expected || !m) return false;
  const h = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(m[1].trim()), h(expected));
}

router.post('/sepay', async (req, res) => {
  if (!keyOk(req.get('Authorization'))) throw unauthorized('Khóa API không hợp lệ');
  const p = req.body || {};
  // Chỉ nhận tiền vào; khoản tiền ra không liên quan đơn đặt sân nên bỏ qua (vẫn 200 để SePay không gửi lại).
  if (p.transferType === 'in') {
    await bank.report({ txId: p.id, content: p.content, amount: p.transferAmount, account: p.accountNumber });
  }
  res.json({ success: true });
});

module.exports = router;
