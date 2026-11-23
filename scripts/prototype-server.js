// Chạy prototype giao diện không cần MySQL: chỉ phục vụ các file tĩnh của trang (danh sách ở src/static-site.js) trên cổng cố định (mặc định 4100; mỗi worktree đặt PROTO_PORT riêng để chạy song song).
const express = require('express');
const { mountStatic } = require('../src/static-site');

const PORT = Number(process.env.PROTO_PORT) || 4100;
const app = express();
// PROTO_ROOT: phục vụ một thư mục khác gốc repo, vd dist/ dựng bởi scripts/static-build.mjs để thử bản tĩnh.
mountStatic(app, process.env.PROTO_ROOT ? require('path').resolve(process.env.PROTO_ROOT) : undefined);
app.listen(PORT, '127.0.0.1', () => console.log(`Prototype: http://127.0.0.1:${PORT}/styleguide.html`));
