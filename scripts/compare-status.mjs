#!/usr/bin/env node
// So mã phản hồi và đích chuyển hướng của một bản tĩnh với bản đang chạy trên VPS (mặc định) hoặc bản khác qua --ref.
//   node scripts/compare-status.mjs <base-url> [--ref https://ggo.srv1741374.hstgr.cloud]
//   Exit 0 khi mọi đường dẫn khớp; in từng dòng "OK/DIFF đường-dẫn  base | ref".
const args = process.argv.slice(2);
const refAt = args.indexOf('--ref');
const ref = (refAt >= 0 ? args.splice(refAt, 2)[1] : 'https://ggo.srv1741374.hstgr.cloud').replace(/\/+$/, '');
const base = (args[0] || '').replace(/\/+$/, '');
if (!base) { console.error('compare-status: thiếu <base-url>'); process.exit(1); }

const PATHS = ['/', '/index.html', '/index', '/products', '/products.html', '/products.html?date=2026-11-25', '/products/',
  '/product-detail', '/product-detail.html?id=1', '/login', '/login.html', '/login?next=%2Fcart', '/cart', '/my-bookings', '/owner', '/admin',
  '/venues.html?id=1', '/venues', '/venue.html', '/venue?id=2', '/img/logo.png', '/images/', '/mock/', '/js/', '/js/api.js', '/js/mode.js',
  '/css/app.css', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/404', '/404.html',
  '/.env', '/.git/config', '/src/app.js', '/package.json', '/functions/api/x', '/_redirects', '/nope', '/nope.html', '/js/nope.js', '/api/meta'];

async function probe(origin, p) {
  const r = await fetch(origin + p, { redirect: 'manual' });
  const loc = r.headers.get('location');
  const to = loc ? (({ pathname, search }) => pathname + search)(new URL(loc, origin + p)) : '';
  return { text: `${r.status}${to ? ' ' + to : ''}`, headers: r.headers };
}

let diff = 0;
for (const p of PATHS) {
  const [a, b] = await Promise.all([probe(base, p), probe(ref, p)]);
  const same = a.text === b.text;
  if (!same) diff++;
  console.log(`${same ? 'OK  ' : 'DIFF'} ${p.padEnd(34)} ${a.text.padEnd(28)} | ${b.text}`);
}
const h = (await probe(base, '/products')).headers;
for (const k of ['x-content-type-options', 'referrer-policy', 'cache-control', 'content-type']) console.log(`header ${k}: ${h.get(k)}`);
// Các header bảo mật là chính sách mong muốn của repo, không lấy Pages làm baseline so sánh.
const requiredHeaders = {
  'content-security-policy': "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};
for (const [name, expected] of Object.entries(requiredHeaders)) {
  const actual = h.get(name);
  const ok = actual === expected;
  if (!ok) diff++;
  console.log(`header ${name}: ${ok ? 'OK' : 'DIFF'} actual=${actual} | expected=${expected}`);
}
const mode = await (await fetch(base + '/js/mode.js')).text();
const mock = /SERVED_BY_API\s*=\s*false/.test(mode);
console.log(`mode.js: ${mock ? 'mock (SERVED_BY_API=false)' : 'KHÔNG phải mock'}`);
console.log(`${diff} khác biệt / ${PATHS.length} đường dẫn`);
process.exit(diff || !mock ? 1 : 0);
