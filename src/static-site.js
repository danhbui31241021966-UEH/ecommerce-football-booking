// Cái gì ở thư mục gốc của repo được phép ra web. Gốc repo còn chứa src/, db/, tests/, .env, package.json...,
// nên KHÔNG bao giờ phục vụ cả thư mục gốc: Express, bản deploy tĩnh và image Docker tĩnh đều chỉ lấy đúng danh sách dưới đây.
// Không nạp express ở đầu file: bước build bản tĩnh (scripts/static-build.mjs, cả trong Docker) chạy không cần node_modules.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Thư mục tĩnh (cả cây) và file lẻ ở gốc. Trang .html ở gốc được quét lúc chạy, nên thêm trang mới không cần sửa ở đây.
const STATIC_DIRS = ['css', 'fonts', 'images', 'js', 'mock'];
const STATIC_FILES = ['robots.txt', 'sitemap.xml', 'favicon.ico'];
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://img.vietqr.io; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

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

function headersFile() {
  return `/*\n${Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`;
}

// Bản tĩnh đúng như Pages nhận: trang .html, file lẻ, thư mục tĩnh, _redirects và 404.html. out phải chưa có hoặc rỗng.
function writeDist(out, root = ROOT) {
  fs.mkdirSync(out, { recursive: true });
  if (fs.readdirSync(out).length) throw new Error(`thư mục đích không rỗng: ${out}`);
  for (const name of staticEntries(root)) fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
  fs.writeFileSync(path.join(out, '_redirects'), redirectsFile());
  fs.writeFileSync(path.join(out, '_headers'), headersFile());
  fs.writeFileSync(path.join(out, '404.html'), notFoundPage);
}

// Cùng bảng REDIRECTS cho nginx (image Docker): 301, giữ nguyên query như Pages.
function nginxRedirects() {
  return `${REDIRECTS.map((r) => (r.from.endsWith('/*')
    ? `location ^~ ${r.from.slice(0, -1)} { rewrite ^${r.from.slice(0, -1)}(.*)$ ${r.to.replace(/:splat$/, '')}$1 permanent; }`
    : `location = ${r.from} { return 301 ${r.to}$is_args$args; }`)).join('\n')}\n`;
}

// Cùng SECURITY_HEADERS cho nginx (image Docker), để Pages, Express và nginx không giữ ba bản chuỗi CSP riêng.
function nginxHeaders() {
  return `${Object.entries(SECURITY_HEADERS).map(([name, value]) => `add_header ${name} "${value}" always;`).join('\n')}\n`;
}

function mountStatic(app, root = ROOT) {
  const express = require('express');
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

// Bản Pages chỉ còn chuyển hướng: mỗi đường dẫn (kể cả "/") sang cùng đường dẫn trên VPS, 301, Pages giữ nguyên query.
// target phải là https, chỉ gồm origin (không path/query). Trả về { tên-file: nội-dung }; không có trang, _headers hay functions.
function redirectOnlyFiles(target) {
  let u;
  try { u = new URL(target); } catch { throw new Error(`đích chuyển hướng không phải URL: ${target}`); }
  if (u.protocol !== 'https:') throw new Error('đích chuyển hướng phải là https');
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password || target.replace(/\/+$/, '') !== u.origin) throw new Error('đích chuyển hướng chỉ gồm origin, không có đường dẫn');
  return { '_redirects': `/* ${u.origin}/:splat 301\n` };
}

function writeRedirectDist(out, target) {
  const files = redirectOnlyFiles(target);
  fs.mkdirSync(out, { recursive: true });
  if (fs.readdirSync(out).length) throw new Error(`thư mục đích không rỗng: ${out}`);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(out, name), body);
}

// Trang 404 cho bản Pages. Không có file này Pages trả trang chủ với mã 200 cho mọi đường dẫn lạ (kể cả /.env), che mất lỗi thật.
const notFoundPage = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Không tìm thấy trang · GGO</title><link rel="stylesheet" href="/css/app.css"></head>
<body><main class="container"><h1 class="h1">Không tìm thấy trang</h1><p><a href="/">Về trang chủ GGO</a></p></main></body></html>
`;

module.exports = { ROOT, STATIC_DIRS, STATIC_FILES, REDIRECTS, SECURITY_HEADERS, staticEntries, redirectsFile, headersFile, nginxRedirects, nginxHeaders, notFoundPage, writeDist, redirectOnlyFiles, writeRedirectDist, mountStatic };
