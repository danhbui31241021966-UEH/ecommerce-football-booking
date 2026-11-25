// Email thật: đăng ký có email → mail xác nhận (đọc từ capture) → mở link → "Email đã xác nhận" → đặt sân → mail booking_held.
// Cần service mail thật (npm run mail, MAIL_TRANSPORT=capture) ở cổng 4126 và prototype chuyển tiếp /mail-api tới đó (MAIL_UPSTREAM). Service ghi mỗi mail thành một file JSON trong MAIL_CAPTURE_DIR (mặc định /tmp/ggo-mail-e2e).
// Service giới hạn 10 mail xác nhận/giờ cho mỗi IP: một lượt chạy ở một khổ dùng 3 mail trong flow này, nên khởi động lại service giữa hai khổ (hoặc đợi hết giờ) khi chạy cả bộ.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, step, save, api, anchor, pickAny, U, W, logs } from './lib.mjs';
const CAPTURE = process.env.MAIL_CAPTURE_DIR || '/tmp/ggo-mail-e2e';
// Loại thư theo tiêu đề thư cố định của service, chỉ đủ để phân biệt ba loại mail đặt sân; mail xác nhận nhận ra bằng link trong nội dung.
const SUBJECT = { booking_held: /giữ chỗ/i, booking_paid: /thanh toán/i, booking_cancelled: /hủy/i };
const LINK_RE = /https?:\/\/\S*verify-email\.html\?t=\S+/;
const all = () => (fs.existsSync(CAPTURE) ? fs.readdirSync(CAPTURE).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(CAPTURE, f), 'utf8'))) : []);
// type: 'verify' | 'booking_*'; code (tùy chọn): mã đơn có trong tiêu đề hoặc nội dung. Trả { to, subject, link } theo thứ tự gửi.
const mails = (to, type, code) => all().filter((m) => [].concat(m.to).join(',').toLowerCase().includes(to)).map((m) => ({ ...m, link: (m.text.match(LINK_RE) || [])[0] }))
  .filter((m) => (!type ? true : type === 'verify' ? !!m.link : !m.link && SUBJECT[type].test(m.subject)) && (!code || `${m.subject}\n${m.text}`.includes(code)));
const waitMail = async (to, type, code) => { for (let i = 0; i < 60; i++) { const m = mails(to, type, code); if (m.length) return m; await new Promise((r) => setTimeout(r, 250)); } throw new Error(`không có mail ${type} ${code || ''} cho ${to}`); };
const { b, p, c } = await start();
const sfx = `${W}${String(Date.now()).slice(-5)}`;
const emailA = `an.${sfx}@example.test`, emailB = `binh.${sfx}@example.test`, emailC = `chi.${sfx}@example.test`;
const phone = (n) => `09${String(W).padStart(4, '0').slice(-3)}${n}${sfx.slice(-4)}`;
const register = async (name, ph, email) => {
  await p.goto(U + '/register'); await p.fill('#fullName', name); await p.fill('#phone', ph); if (email) await p.fill('#email', email); await p.fill('#password', 'Matkhau@123'); await p.click('#auth-form button[type=submit]');
};
let day;
// Đặt thử lần lượt các sân từ giờ `after`; bỏ qua giờ chỉ nhận ghép kèo. confirmed=true: lấy đơn không cần chủ sân đồng ý (để ghi nhận tiền được).
const book = async (after, confirmed = false) => {
  for (let v = 1; v <= 8; v++) {
    const pick = await pickAny(p, v, day, after); if (!pick) continue;
    try { const bk = await api(p, `a=>a.createBooking({courtId:${pick.court},date:"${day}",start:"${pick.start}"})`); if (!confirmed || bk.status === 'confirmed') return bk; await api(p, `a=>a.cancelBooking(${bk.id},"thử")`); } catch { /* giờ ghép kèo hoặc vừa hết: thử sân khác */ }
  }
  throw new Error('không đặt được sân nào');
};

await step(p, 'email', '00-reset', async () => { const now = await anchor(p, '08:00'); await api(p, 'a=>a.logout()'); day = now.slice(0, 10); return now; }, { shot: false });
await step(p, 'email', '01-register-form-390', async () => {
  await p.goto(U + '/register'); await p.waitForSelector('#email');
  assert.equal(await p.locator('#email').getAttribute('required'), '');
  await p.fill('#fullName', 'An Email'); await p.fill('#phone', phone(1)); await p.fill('#password', 'Matkhau@123'); await p.click('#auth-form button[type=submit]');
  await p.waitForSelector('#email-msg'); assert.equal(await p.evaluate(() => document.activeElement?.name), 'email');
  return await p.locator('#email-msg').innerText();
}, { full: true });
await step(p, 'email', '02-register-sends-verify-mail', async () => {
  await p.fill('#email', emailA); await Promise.all([p.waitForURL((u) => u.pathname === '/'), p.click('#auth-form button[type=submit]')]);
  const [m] = await waitMail(emailA, 'verify'); assert.match(m.link, /\/verify-email\.html\?t=/); return m.link.replace(/t=.*/, 't=…');
});
await step(p, 'email', '03-account-shows-unverified', async () => {
  await p.goto(U + '/account.html'); await p.waitForSelector('#email-status');
  assert.match(await p.locator('#email-status').innerText(), /chưa xác nhận/); assert.equal(await p.locator('#resend').count(), 1);
}, { full: true });
await step(p, 'email', '04-no-notice-mail-before-verified', async () => {
  const pick = await pickAny(p, 1, day, '18:00'); assert.ok(pick, 'không có giờ trống');
  const bk = await api(p, `a=>a.createBooking({courtId:${pick.court},date:"${day}",start:"${pick.start}"})`);
  await p.waitForTimeout(1500);
  assert.equal(mails(emailA).filter((m) => !m.link).length, 0, 'chưa xác nhận mà đã có mail thông báo');
  const n = (await api(p, 'a=>a.notifications()')).items.length; assert.ok(n > 0, 'thông báo trong web phải còn');
  return `booking ${bk.code}, thông báo web=${n}`;
}, { shot: false });
await step(p, 'email', '05-open-link-same-browser', async () => {
  const link = (await waitMail(emailA, 'verify')).at(-1).link;
  await p.goto(link); await p.waitForSelector('#verify-title');
  assert.equal(await p.locator('#verify-title').textContent(), 'Email đã được xác nhận');
  assert.ok(!p.url().includes('t='), 'token còn trên thanh địa chỉ');
  await p.screenshot({ path: `e2e/out/email-05b-verify-page-${W}.png` });
  await p.goto(U + '/account.html'); await p.waitForSelector('#email-status');
  assert.equal(await p.locator('#email-status').innerText(), 'Email đã xác nhận');
});
await step(p, 'email', '06-book-sends-held-mail', async () => {
  const bk = await book('19:00', true);
  const [m] = await waitMail(emailA, 'booking_held', bk.code); return `${m.subject}`;
}, { shot: false });
await step(p, 'email', '07-paid-and-cancelled-mails', async () => {
  const mine = await api(p, 'a=>a.myBookings()'); const bk = mine.find((x) => mails(emailA, 'booking_held', x.code).length);
  await p.evaluate(async (id) => { const { api } = await import('/js/api.js'); await api.logout(); await api.login({ identifier: 'admin@datsan.local', password: 'Matkhau@123' }); await api.admin.markPaid(id, ''); await api.logout(); }, bk.id);
  const [paid] = await waitMail(emailA, 'booking_paid', bk.code);
  await p.evaluate(async (email) => { const { api } = await import('/js/api.js'); await api.logout(); await api.login({ identifier: email, password: 'Matkhau@123' }); }, emailA);
  await p.evaluate(async ([id]) => { const { api } = await import('/js/api.js'); await api.cancelBooking(id, 'đổi lịch', { bin: '970436', account: '0123456789', accountName: 'AN EMAIL' }); }, [bk.id]);
  const [cx] = await waitMail(emailA, 'booking_cancelled', bk.code); return `paid + cancelled ${bk.code}: ${cx.subject}`;
}, { shot: false });
await step(p, 'email', '08-link-opened-in-other-browser', async () => {
  // Đăng ký ở trình duyệt này, bấm link ở một ngữ cảnh khác (không có phiên): quay lại trang Tài khoản thì tự lấy proof qua verify/status.
  await api(p, 'a=>a.logout()');
  await register('Bình Email', phone(2), emailB); await p.waitForURL((u) => u.pathname === '/');
  const link = (await waitMail(emailB, 'verify')).at(-1).link;
  const other = await (await b.newContext()).newPage(); await other.goto(link); await other.waitForSelector('#verify-title');
  assert.equal(await other.locator('#verify-title').textContent(), 'Email đã được xác nhận'); await other.context().close();
  await p.goto(U + '/account.html'); await p.waitForSelector('#email-status'); await p.waitForFunction(() => /Email đã xác nhận/.test(document.getElementById('email-status').textContent));
  await book('20:00');
  await waitMail(emailB, 'booking_held');
}, { full: true });
await step(p, 'email', '09-bad-link-neutral', async () => {
  await p.goto(U + '/verify-email.html?t=khong.hop-le'); await p.waitForSelector('#verify-title');
  const t = await p.locator('.verify-result').innerText(); assert.doesNotMatch(t, /tồn tại|không tìm thấy email/i); return t.replace(/\n/g, ' ');
}, { full: true });
await step(p, 'email', '10-register-when-daily-cap', async () => {
  await api(p, 'a=>a.logout()');
  await p.route('**/mail-api/verify/send', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'daily_cap', retryAfter: 3600 }) }));
  await register('Chi Hạn Mức', phone(3), emailC);
  await p.waitForSelector('#mail-notice:not([hidden])');
  const text = await p.locator('#mail-notice-text').innerText(); assert.match(text, /Tạm thời chưa gửi được mail/); assert.match(text, /Tài khoản đã được tạo/);
  const me = await api(p, 'a=>a.me()'); assert.equal(me.user?.email, emailC, 'tài khoản phải được tạo');
  await p.screenshot({ path: `e2e/out/email-10b-notice-${W}.png` });
  await p.unroute('**/mail-api/verify/send');
  await p.click('#mail-notice-go'); await p.waitForURL((u) => u.pathname === '/');
  await p.goto(U + '/account.html'); await p.waitForSelector('#email-status');
  assert.match(await p.locator('#email-status').innerText(), /chưa xác nhận/); assert.equal(await p.locator('#resend').count(), 1);
  await p.click('#resend'); await waitMail(emailC, 'verify');
  return text;
}, { full: true });
await step(p, 'email', '11-notice-failure-does-not-break-booking', async () => {
  await api(p, 'a=>a.logout()'); await p.evaluate(async (e) => { const { api } = await import('/js/api.js'); await api.login({ identifier: e, password: 'Matkhau@123' }); }, emailA);
  await p.route('**/mail-api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
  const pick = await pickAny(p, 4, day, '18:00'); const bk = await api(p, `a=>a.createBooking({courtId:${pick.court},date:"${day}",start:"${pick.start}"})`);
  await p.unroute('**/mail-api/**'); assert.ok(bk.code); return bk.code;
}, { shot: false });
if (logs.length) console.log('LOGS', logs.join(' | '));
save(); await b.close();
