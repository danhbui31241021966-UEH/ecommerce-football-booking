// Chạy prototype giao diện không cần MySQL: chỉ phục vụ các file tĩnh của trang (danh sách ở src/static-site.js) trên cổng cố định (mặc định 4100; mỗi worktree đặt PROTO_PORT riêng để chạy song song).
const express = require('express');
const fs = require('fs');
const path = require('path');
const { mountStatic, SECURITY_HEADERS } = require('../src/static-site');

const PORT = Number(process.env.PROTO_PORT) || 4100;
const app = express();
// PROTO_ROOT: phục vụ thư mục bản tĩnh. Nếu có _headers (Pages), mô phỏng các header đó để E2E có thể bắt CSP.
const root = process.env.PROTO_ROOT ? path.resolve(process.env.PROTO_ROOT) : undefined;
if (root && fs.existsSync(path.join(root, '_headers'))) app.use((req, res, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  next();
});
mountStatic(app, root);
app.listen(PORT, '127.0.0.1', () => console.log(`Prototype: http://127.0.0.1:${PORT}/styleguide.html`));
