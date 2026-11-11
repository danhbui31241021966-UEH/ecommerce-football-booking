const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/cart.js'), 'utf8');
function fixture(raw = null) {
  const data = new Map(raw === null ? [] : [['ggo.cart', raw]]);
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
  const ctx = { localStorage: storage, Event: class Event {}, dispatchEvent() {}, console };
  ctx.globalThis = ctx;
  vm.runInNewContext(source, ctx);
  return { cart: ctx.GgoCart, storage };
}
const a = { venueId: 3, courtId: 7, date: '2026-11-08', start: '18:00' };

test('cart saves and loads one slot row; adding duplicate reports existing without adding', () => {
  const { cart } = fixture();
  assert.equal(cart.addCart(a), true);
  assert.equal(cart.addCart(a), false);
  assert.equal(cart.countCart(), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(cart.loadCart())), [a]);
});
test('cart removes by slot identity and handles totals', () => {
  const { cart } = fixture();
  cart.addCart(a); cart.addCart({ ...a, start: '19:00' });
  const prices = new Map([[JSON.stringify([3, 7, a.date, '18:00']), 120000], [JSON.stringify([3, 7, a.date, '19:00']), 95000]]);
  assert.equal(cart.totalCart(cart.loadCart(), prices), 215000);
  cart.removeCart(a);
  assert.equal(cart.countCart(), 1);
  assert.equal(cart.loadCart()[0].start, '19:00');
});
test('empty, malformed, and invalid rows are safe', () => {
  const { cart } = fixture('{broken');
  assert.deepEqual(JSON.parse(JSON.stringify(cart.loadCart())), []);
  assert.equal(cart.countCart(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture('null').cart.loadCart())), []);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture('[null,{}, {"venueId":2,"courtId":3,"date":"2026-01-01","start":"09:00"}]').cart.loadCart())), [{ venueId: 2, courtId: 3, date: '2026-01-01', start: '09:00' }]);
});
