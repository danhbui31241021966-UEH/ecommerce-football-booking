// Cái gì ở thư mục gốc của repo được phép ra web. Gốc repo còn chứa src/, db/, tests/, .env, package.json...,
// nên KHÔNG bao giờ phục vụ cả thư mục gốc: Express và bản deploy Cloudflare Pages đều chỉ lấy đúng danh sách dưới đây.
const fs = require('fs');
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, '..');

// Thư mục tĩnh (cả cây) và file lẻ ở gốc. Trang .html ở gốc được quét lúc chạy, nên thêm trang mới không cần sửa ở đây.
const STATIC_DIRS = ['css', 'fonts', 'images', 'js', 'mock'];
const STATIC_FILES = ['robots.txt', 'sitemap.xml', 'favicon.ico'];

// Link cũ -> link mới (301), giữ nguyên query; "/img/*" giữ nguyên phần đuôi. Express dùng trực tiếp; pages-deploy.mjs ghi cùng danh sách này thành _redirects.
// Đích dùng dạng không đuôi .html vì Cloudflare Pages tự chuyển /x.html sang /x (308); trỏ thẳng vào đó để link cũ chỉ qua một lần chuyển hướng.
const REDIRECTS = [
  { from: '/venues.html', to: '/products' },
  { from: '/venues', to: '/products' },
  { from: '/venue.html', to: '/product-detail' },
  { from: '/venue', to: '/product-detail' },
  { from: '/img/*', to: '/images/:splat' },
];

const pagesOf = (root) => fs.readdirSync(root).filter((f) => f.endsWith('.html'));

// Danh sách file/thư mục tĩnh thật có mặt trong root, tính theo tên tương đối so với root.
function staticEntries(root = ROOT) {
  const present = (n) => fs.existsSync(path.join(root, n));
  return [...pagesOf(root), ...STATIC_FILES.filter(present), ...STATIC_DIRS.filter(present)];
}

function redirectsFile() {
  return `${REDIRECTS.map((r) => `${r.from} ${r.to} 301`).join('\n')}\n`;
}

function mountStatic(app, root = ROOT) {
  for (const r of REDIRECTS) {
    if (r.from.endsWith('/*')) {
      const base = r.from.slice(0, -2);
      const target = r.to.replace(/:splat$/, '');
      app.use(base, (req, res) => res.redirect(301, target.replace(/\/$/, '') + req.url));
    } else {
      app.get(r.from, (req, res) => {
        const q = req.originalUrl.indexOf('?');
        res.redirect(301, r.to + (q >= 0 ? req.originalUrl.slice(q) : ''));
      });
    }
  }
  const send = (file) => (req, res, next) => res.sendFile(file, { root, dotfiles: 'deny' }, (e) => e && next());
  for (const f of pagesOf(root)) {
    const name = f.slice(0, -5);
    app.get(name === 'index' ? ['/', '/index', '/index.html'] : [`/${name}`, `/${f}`], send(f));
  }
  for (const f of STATIC_FILES) if (fs.existsSync(path.join(root, f))) app.get(`/${f}`, send(f));
  for (const d of STATIC_DIRS) if (fs.existsSync(path.join(root, d))) app.use(`/${d}`, express.static(path.join(root, d)));
}

// Trang 404 cho bản Pages. Không có file này Pages trả trang chủ với mã 200 cho mọi đường dẫn lạ (kể cả /.env), che mất lỗi thật.
const notFoundPage = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Không tìm thấy trang · GGO</title><link rel="stylesheet" href="/css/app.css"></head>
<body><main class="container"><h1 class="h1">Không tìm thấy trang</h1><p><a href="/">Về trang chủ GGO</a></p></main></body></html>
`;

module.exports = { ROOT, STATIC_DIRS, STATIC_FILES, REDIRECTS, staticEntries, redirectsFile, notFoundPage, mountStatic };
