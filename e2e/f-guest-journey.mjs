// Người lạ trên bản demo (dữ liệu mẫu): tìm sân → Giỏ sân → đăng ký → đặt → chuyển khoản mô phỏng → Lịch đặt của tôi,
// dữ liệu còn sau khi tải lại và sau khi sang ngày mới; giờ đã đặt không đặt lại được; chủ sân/admin thấy đơn.
import { start, step, save, api, anchor, U, W, logs } from './lib.mjs';
const { b, p } = await start();
let picked, code, bookingId;

await step(p, 'journey', '00-reset-logged-out', async () => { const now = await anchor(p, '08:00'); await api(p, 'a=>a.logout()'); return 'now=' + now; }, { shot: false });
await step(p, 'journey', '01-search', async () => {
  const day = (await api(p, 'a=>a.meta()')).now.slice(0, 10);
  await p.goto(`${U}/products.html?date=${day}`); await p.waitForSelector('.venue-card .slot-pill');
  return await p.locator('#summary').innerText();
});
await step(p, 'journey', '02-detail', async () => {
  await p.locator('.venue-card .slot-pill:not(.more)').first().click(); await p.waitForURL(/product-detail/);
  await p.locator('[data-pick][aria-pressed=true]:visible').first().waitFor();
  picked = Object.fromEntries(new URL(p.url()).searchParams); return p.url().replace(U, '');
});
await step(p, 'journey', '03-add-to-cart', async () => {
  await p.click('#bar-save'); await p.waitForFunction(() => document.querySelector('[data-cart-count]')?.textContent === '1');
});
await step(p, 'journey', '04-cart', async () => {
  await p.goto(`${U}/cart.html`); await p.waitForSelector('.cart-item');
  return (await p.locator('.cart-total').innerText()).replace(/\n/g, ' ');
});
await step(p, 'journey', '05-book-asks-login', async () => {
  await p.locator('.cart-item a.btn-lime').first().click(); await p.waitForURL(/product-detail/);
  await p.locator('[data-pick][aria-pressed=true]:visible').first().waitFor(); await p.click('#bar-book'); await p.waitForURL(/login/);
});
await step(p, 'journey', '06-register-returns-to-confirm', async () => {
  await p.click('#alt-link'); await p.waitForURL(/register/);
  await p.fill('#fullName', 'Khách Mới'); await p.fill('#phone', W < 600 ? '0911000390' : '0911001366'); await p.fill('#password', 'Matkhau@123');
  await p.click('form button[type=submit]'); await p.waitForSelector('#confirm-dialog[open]');
});
await step(p, 'journey', '07-booked-with-qr', async () => {
  await p.click('#do-book'); await p.waitForURL(/booking/); await p.waitForSelector('.qr-card [data-sim-go=ok]');
  code = (await p.locator('.booking-code').innerText()).trim(); bookingId = new URL(p.url()).searchParams.get('id');
  return code + ' ' + (await p.locator('.badge').allInnerTexts()).join(',');
}, { full: true });
await step(p, 'journey', '08-simulated-payment-paid', async () => {
  await p.click('[data-sim-go=ok]');
  await p.waitForFunction(() => [...document.querySelectorAll('.badge')].some((x) => /Đã chuyển khoản/.test(x.textContent)), null, { timeout: 20000 });
  if (await p.locator('.qr-card').count()) throw new Error('QR vẫn hiện sau khi đã trả tiền');
  return (await p.locator('.badge').allInnerTexts()).join(',');
}, { full: true });
await step(p, 'journey', '09-my-bookings-after-reload', async () => {
  await p.goto(`${U}/my-bookings.html`); await p.reload(); await p.waitForSelector(`text=Mã ${code}`);
  const inCart = await p.locator('[data-cart-count]').first().innerText();
  if (inCart !== '0') throw new Error('giờ đã đặt vẫn nằm trong Giỏ sân: ' + inCart);
});
await step(p, 'journey', '10-kept-after-new-day', async () => {
  // Giả lập trình duyệt mở lại vào ngày hôm sau: dữ liệu demo lưu từ hôm trước.
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sannhanh.mock')) { const s = JSON.parse(localStorage.getItem(k)); s.seedDay = '2000-01-01'; localStorage.setItem(k, JSON.stringify(s)); } });
  await p.goto(`${U}/my-bookings.html`); await p.waitForSelector(`text=Mã ${code}`);
  const me = await api(p, 'a=>a.me()'); if (me.user?.fullName !== 'Khách Mới') throw new Error('mất tài khoản: ' + JSON.stringify(me));
});
await step(p, 'journey', '11-same-slot-not-bookable', async () => {
  const s = await p.evaluate(async ([v, d, c, st]) => { const { api } = await import('/js/api.js'); const sc = await api.schedule(v, d); return sc.courts.find((x) => x.id === Number(c)).slots.find((x) => x.start === st).status; }, [picked.id, picked.date, picked.court, picked.slot]);
  if (s === 'available') throw new Error('giờ đã đặt vẫn hiện còn trống');
  const again = await p.evaluate(async ([c, d, st]) => { const { api } = await import('/js/api.js'); try { await api.createBooking({ courtId: Number(c), date: d, start: st }); return 'booked again'; } catch (e) { return 'blocked: ' + e.message; } }, [picked.court, picked.date, picked.slot]);
  if (!again.startsWith('blocked')) throw new Error(again);
  return 'status=' + s + ' ' + again;
}, { shot: false });
await step(p, 'journey', '12-admin-sees-paid-booking', async () => {
  await api(p, 'a=>a.logout()'); await api(p, 'a=>a.login({identifier:"admin@datsan.local",password:"Matkhau@123"})');
  const r = await api(p, `a=>a.admin.bookings({ q: '${code}' })`); const row = (r.bookings || r).find((x) => x.code === code);
  if (!row || row.paymentStatus !== 'paid') throw new Error('admin: ' + JSON.stringify(row));
}, { shot: false });
await step(p, 'journey', '13-demo-note-in-footer', async () => { await p.goto(`${U}/`); return await p.locator('.footer-demo').innerText(); }, { shot: false });
if (logs.length) console.log('LOGS', logs.join(' | '));
save(); await b.close();
