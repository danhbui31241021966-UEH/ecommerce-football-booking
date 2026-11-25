const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const origin = 'https://ggo.srv1741374.hstgr.cloud';
// Nạp đúng file trình duyệt dùng, dưới dạng ES module.
const source = fs.readFileSync(require.resolve('../js/safe-next.js'), 'utf8');
const load = () => import(`data:text/javascript,${encodeURIComponent(source)}`);

test('next trỏ ra trang ngoài thì bị bỏ', async () => {
  const { safeNext } = await load();
  for (const next of ['/\\example.com', '/\\/example.com', '//example.com', '/\t/example.com', '/.//example.com',
    'https://example.com', 'javascript:alert(1)', 'data:text/html,x', null, '']) {
    assert.equal(safeNext(next, origin), null, JSON.stringify(next));
  }
});

test('đường dẫn cùng nguồn giữ nguyên trang, tham số và neo', async () => {
  const { safeNext } = await load();
  const p = '/product-detail.html?id=1&date=2026-11-24&court=2&slot=18:00&book=1';
  assert.equal(safeNext(p, origin), p);
  assert.equal(safeNext('/my-bookings.html#sap-toi', origin), '/my-bookings.html#sap-toi');
  assert.equal(safeNext(`${origin}/cart.html`, origin), '/cart.html');
});
