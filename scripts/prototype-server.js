// Chạy prototype giao diện không cần MySQL: chỉ phục vụ các file tĩnh của trang (danh sách ở src/static-site.js) trên cổng cố định (mặc định 4100; mỗi worktree đặt PROTO_PORT riêng để chạy song song).
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { mountStatic, SECURITY_HEADERS } = require('../src/static-site');

const PORT = Number(process.env.PROTO_PORT) || 4100;
const app = express();
// PROTO_ROOT: phục vụ thư mục bản tĩnh. Nếu có _headers (Pages), mô phỏng các header đó để E2E có thể bắt CSP.
const root = process.env.PROTO_ROOT ? path.resolve(process.env.PROTO_ROOT) : undefined;
if (root && fs.existsSync(path.join(root, '_headers'))) app.use((req, res, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  next();
});
// MAIL_UPSTREAM (vd http://127.0.0.1:4126): chuyển tiếp /mail-api tới service mail ở máy, để chạy giống VPS (cùng origin, không cần mở CSP cho localhost).
// Giữ nguyên header Origin của trình duyệt vì service dùng nó để ghép link trong mail. Không đặt biến này thì /mail-api là 404 và phần mail báo "tạm thời không gửi được".
if (process.env.MAIL_UPSTREAM) {
  const up = new URL(process.env.MAIL_UPSTREAM);
  app.use('/mail-api', (req, res) => {
    const out = http.request({ host: up.hostname, port: up.port, method: req.method, path: '/mail-api' + req.url, headers: { ...req.headers, host: up.host } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    out.on('error', () => { if (!res.headersSent) res.status(503).json({ error: 'unavailable' }); else res.end(); });
    req.pipe(out);
  });
}
mountStatic(app, root);
app.listen(PORT, '127.0.0.1', () => console.log(`Prototype: http://127.0.0.1:${PORT}/styleguide.html`));
