// Hai transport: smtp (nodemailer, Gmail) và capture (ghi JSON ra thư mục, cho test/máy cá nhân).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createCapture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    async send(msg) {
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
      fs.writeFileSync(path.join(dir, name), JSON.stringify({ ...msg, at: new Date().toISOString() }, null, 2));
    },
  };
}

function createSmtp({ host, port, user, pass }) {
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 15000 });
  return { send: (msg) => t.sendMail(msg) };
}

function createTransport(cfg) {
  if (cfg.transport === 'capture') {
    if (cfg.production) throw new Error('capture bị từ chối ở production');
    return createCapture(cfg.captureDir);
  }
  return createSmtp(cfg.smtp);
}

module.exports = { createTransport, createCapture };
