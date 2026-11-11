import assert from 'node:assert/strict';
import { start, step, save, api, U, W, logs, anchor, dayPlus } from './lib.mjs';
const { b, p } = await start();
const shotDir = process.env.B3_SHOT_DIR || '/tmp/b3-shots/cart';
await (await import('node:fs/promises')).mkdir(shotDir, { recursive: true });
await step(p, 'b3-cart', 'reset', async () => { await anchor(p, '08:00'); await p.evaluate(() => localStorage.removeItem('ggo.cart')); await p.goto(U + '/'); return 'demo reset'; });
const meta = await api(p, 'a=>a.meta()');
const date = meta.now.slice(0, 10);
const venues = (await api(p, 'a=>a.venues({})')).venues;
let chosen;
for (const v of venues) {
  const sc = await api(p, `a=>a.schedule(${v.id}, '${date}')`);
  for (const c of sc.courts) {
    const s = c.slots.find((x) => x.status === 'available');
    if (s) { chosen = { v, c, s }; break; }
  }
  if (chosen) break;
}
assert.ok(chosen, 'need an available slot');
const cartItem = { venueId: chosen.v.id, courtId: chosen.c.id, date, start: chosen.s.start };
await step(p, 'b3-cart', 'save-from-detail', async () => {
  await p.goto(`${U}/product-detail?id=${cartItem.venueId}&date=${date}&slot=${cartItem.start}&court=${cartItem.courtId}`);
  await p.locator('#bar-save:not([disabled])').waitFor();
  await p.screenshot({ path: `${shotDir}/detail-${W}.png`, fullPage: true });
  await p.click('#bar-save'); await p.locator('.toast').waitFor();
  assert.equal(await p.locator('[data-cart-count]').first().innerText(), '1');
  return await p.locator('.toast').innerText();
});
await step(p, 'b3-cart', 'duplicate', async () => { await p.click('#bar-save'); const text = await p.locator('.toast').last().innerText(); assert.match(text, /đã có trong giỏ/i); assert.equal(await p.evaluate(() => GgoCart.countCart()), 1); return text; });
await step(p, 'b3-cart', 'sync-between-tabs', async () => {
  const other = await p.context().newPage(); await other.goto(U + '/'); await other.waitForSelector('.site-header'); await other.waitForTimeout(300);
  const extra = { venueId: cartItem.venueId, courtId: cartItem.courtId, date, start: '23:59' };
  await other.evaluate((x) => localStorage.setItem('ggo.cart', JSON.stringify([GgoCart.loadCart()[0], x])), extra);
  await p.waitForFunction(() => [...document.querySelectorAll('[data-cart-count]')].some((x) => x.textContent === '2'));
  await other.evaluate(() => localStorage.setItem('ggo.cart', JSON.stringify([GgoCart.loadCart()[0]])));
  await p.waitForFunction(() => [...document.querySelectorAll('[data-cart-count]')].some((x) => x.textContent === '1'));
  await other.close(); return 'storage event updates badge in the other tab';
});
// Insert a real, currently booked slot so the cart UI must mark it unusable and exclude its price.
let occupied;
for (let d = 0; d < 2 && !occupied; d++) for (const v of venues) {
  const dt = dayPlus(date, d);
  const sc = await api(p, `a=>a.schedule(${v.id}, '${dt}')`);
  for (const c of sc.courts) { const s = c.slots.find((x) => ['booked', 'held'].includes(x.status)); if (s) { occupied = { venueId: v.id, courtId: c.id, date: dt, start: s.start }; break; } }
  if (occupied) break;
}
assert.ok(occupied, 'demo should have an occupied slot');
await p.evaluate((item) => GgoCart.addCart(item), occupied);
await step(p, 'b3-cart', 'render-and-total', async () => {
  await p.goto(U + '/cart'); await p.locator('.cart-item').first().waitFor();
  assert.equal(await p.locator('.cart-item').count(), 2);
  assert.match(await p.locator('.cart-invalid').innerText(), /đặt|giữ/i);
  const expected = chosen.s.price;
  assert.match(await p.locator('.cart-total').innerText(), new RegExp(expected.toLocaleString('vi-VN')));
  await p.screenshot({ path: `${shotDir}/cart-${W}.png`, fullPage: true });
  await p.reload(); await p.locator('.cart-item').first().waitFor(); assert.equal(await p.locator('.cart-item').count(), 2);
  return `fresh price=${expected}, occupied excluded`;
});
await step(p, 'b3-cart', 'book-link', async () => {
  await p.locator('.cart-item').filter({ hasText: chosen.v.name }).getByRole('link', { name: 'Đặt giờ này' }).click();
  await p.waitForURL(/product-detail/);
  const u = new URL(p.url()); assert.equal(u.searchParams.get('id'), String(cartItem.venueId)); assert.equal(u.searchParams.get('date'), date); assert.equal(u.searchParams.get('slot'), cartItem.start); assert.equal(u.searchParams.get('court'), String(cartItem.courtId));
  return u.pathname + u.search;
});
await step(p, 'b3-cart', 'remove-and-empty', async () => {
  await p.goto(U + '/cart'); await p.locator('.cart-item').first().waitFor();
  while (await p.locator('.cart-item').count()) { await p.locator('.cart-item [data-remove]').first().click(); await p.waitForTimeout(100); }
  assert.match(await p.locator('#cart-root').innerText(), /giỏ sân đang trống/i);
  assert.equal(await p.evaluate(() => GgoCart.countCart()), 0);
  await p.screenshot({ path: `${shotDir}/empty-${W}.png`, fullPage: true });
  return 'empty cart and zero badge';
});
if (logs.length) throw new Error('console/page errors: ' + logs.join('\n'));
save(); console.log('LOGS', logs.join('\n')); await b.close();
