const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mountStatic, staticEntries, redirectsFile, REDIRECTS } = require('../src/static-site');

async function withServer(fn) {
  const app = express();
  mountStatic(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}
const get = (base, p) => fetch(base + p, { redirect: 'manual' });

test('gốc repo chỉ phục vụ file tĩnh của trang, không lộ mã nguồn, cấu hình hay tài liệu', async () => {
  await withServer(async (base) => {
    for (const p of ['/src/app.js', '/.env', '/.env.example', '/package.json', '/package-lock.json', '/db/schema.sql', '/tests/static-site.test.js', '/e2e/seo.mjs', '/scripts/pages-deploy.mjs', '/docs/PRD.md', '/README.md', '/node_modules/express/package.json', '/functions/api/[[path]].js', '/data/venues-hcm.json', '/.git/config', '/css/../.env', '/images/..%2F.env']) {
      const r = await get(base, p);
      assert.equal(r.status, 404, `${p} phải là 404`);
    }
  });
});

test('trang chính và tài nguyên tĩnh trả 200', async () => {
  await withServer(async (base) => {
    for (const p of ['/', '/index.html', '/products', '/products.html', '/product-detail', '/product-detail.html?id=1', '/cart', '/cart.html', '/about', '/css/app.css', '/js/api.js', '/images/favicon.svg', '/fonts/fonts.css', '/mock/venues.json', '/robots.txt', '/sitemap.xml', '/favicon.ico']) {
      assert.equal((await get(base, p)).status, 200, `${p} phải là 200`);
    }
  });
});

test('link cũ chuyển hướng 301 sang link mới và giữ query', async () => {
  await withServer(async (base) => {
    const cases = [['/venues.html', '/products'], ['/venues?date=2026-11-05&fieldType=7', '/products?date=2026-11-05&fieldType=7'], ['/venue.html?id=12&date=2026-11-05', '/product-detail?id=12&date=2026-11-05'], ['/venue?id=3', '/product-detail?id=3'], ['/img/pitch-1.svg', '/images/pitch-1.svg'], ['/img/photos/hero-1920.jpg', '/images/photos/hero-1920.jpg']];
    for (const [from, to] of cases) {
      const r = await get(base, from);
      assert.equal(r.status, 301, from);
      assert.equal(r.headers.get('location'), to, from);
    }
  });
});

test('danh sách tĩnh không chứa thư mục không phải trang, và _redirects khớp bảng chuyển hướng', () => {
  const names = staticEntries();
  for (const bad of ['src', 'db', 'tests', 'e2e', 'docs', 'scripts', 'node_modules', 'functions', 'data', '.env', 'package.json', 'README.md']) assert.ok(!names.includes(bad), bad);
  for (const must of ['index.html', 'products.html', 'product-detail.html', 'cart.html', 'about.html', 'css', 'images']) assert.ok(names.includes(must), must);
  assert.equal(redirectsFile().trim().split('\n').length, REDIRECTS.length);
});
