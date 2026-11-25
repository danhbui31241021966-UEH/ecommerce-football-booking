// Hai transport: smtp (nodemailer, Gmail) và capture (ghi JSON ra thư mục, cho test/máy cá nhân).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createCapture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let seq = 0; // số thứ tự trong tên file: đọc theo tên file ra đúng thứ tự gửi dù cùng một mili giây
  return {
    async send(msg) {
      const name = `${Date.now()}-${String(++seq).padStart(6, '0')}-${crypto.randomBytes(4).toString('hex')}.json`;
      fs.writeFileSync(path.join(dir, name), JSON.stringify({ ...msg, at: new Date().toISOString() }, null, 2));
    },
  };
}

// 587: STARTTLS bắt buộc (không có TLS thì không gửi, không hạ cấp); 465: TLS ngay từ đầu.
function smtpOptions({ host, port, user, pass }) {
  const implicit = port === 465;
  return { host, port, secure: implicit, requireTLS: !implicit, auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 15000 };
}

function createSmtp(smtp) {
  const t = require('nodemailer').createTransport(smtpOptions(smtp));
  return { send: (msg) => t.sendMail(msg) };
}

function createTransport(cfg) {
  if (cfg.transport === 'capture') {
    if (cfg.production) throw new Error('capture bị từ chối ở production');
    return createCapture(cfg.captureDir);
  }
  return createSmtp(cfg.smtp);
}

module.exports = { createTransport, createCapture, smtpOptions };
