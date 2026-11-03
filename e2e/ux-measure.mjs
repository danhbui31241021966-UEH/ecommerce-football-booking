import { chromium } from 'playwright';
import fs from 'node:fs';

const width = Number(process.argv[2] || 390);
if (![390, 1366].includes(width)) throw new Error('Usage: U=http://127.0.0.1:4110 node e2e/ux-measure.mjs <390|1366>');
const base = process.env.U || 'http://127.0.0.1:4110';
const out = process.env.OUT || '/tmp/ggo-ux-before';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width < 600, hasTouch: width < 600 });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__uxAppearance = {};
  const mark = () => {
    if (!window.__uxAppearance.brand && document.querySelector('header .brand')?.getClientRects().length) window.__uxAppearance.brand = Math.round(performance.now());
    if (!window.__uxAppearance.primary && document.querySelector('#search button[type="submit"]')?.getClientRects().length) window.__uxAppearance.primary = Math.round(performance.now());
  };
  new MutationObserver(mark).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', mark, { once: true });
});
const rows = [];
const file = (s) => `${out}/${width}-${s}.png`;
const record = async (name, nextStep, extras = {}) => {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: file(name), fullPage: true });
  rows.push({ name, url: page.url(), expectedNextStep: nextStep, fiveSecondAssessment: 'Cần hỏi người tham gia; không thể suy ra hiểu biết từ tự động hóa.', ...extras, screenshot: file(name) });
};
const dimensions = async () => page.evaluate(() => ({ documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, domContentLoadedMs: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd, primaryTop: (() => { const e = document.querySelector('main button[type=submit], main .btn-lime, main button.btn-primary'); return e ? Math.round(e.getBoundingClientRect().top) : null; })() }));
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('header .brand').waitFor();
  const homeTiming = await page.evaluate(() => window.__uxAppearance);
  await record('01-home', 'Tìm sân / tìm giờ còn trống', { measurements: await dimensions(), headerAppearanceMs: homeTiming });

  await page.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });
  let meta = await page.evaluate(async () => { const { api } = await import('/js/api.js'); return api.meta(); });
  const toMinutes = t => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  let delta = 8 * 60 - toMinutes(meta.now);
  if (delta <= 0) delta += 24 * 60;
  await page.evaluate(async mins => { const { api } = await import('/js/api.js'); await api.proto.advanceClock(mins); }, delta);
  meta = await page.evaluate(async () => { const { api } = await import('/js/api.js'); return api.meta(); });
  const today = meta.now.slice(0, 10);
  await page.locator('#f-date').selectOption(today).catch(() => {});
  const timeSelect = page.locator('#f-at');
  await timeSelect.waitFor();
  const times = await timeSelect.locator('option').evaluateAll(os => os.map(o => o.value || o.textContent.trim()).filter(Boolean));
  const desired = times.find(t => t >= '18:00') || times[0];
  if (desired) await timeSelect.selectOption(desired);
  await page.locator('#search button[type=submit]').click();
  await page.waitForURL(/venues/);
  await page.locator('.venue-card').first().waitFor();
  const resultsMetrics = await page.evaluate(() => {
    const slot = document.querySelector('.venue-card .slot-pill:not(.more)');
    return { documentHeight: document.documentElement.scrollHeight, firstSlotTop: slot ? Math.round(slot.getBoundingClientRect().top + scrollY) : null, viewportHeight: innerHeight, firstSlotViewportRatio: slot ? Math.round(slot.getBoundingClientRect().top / innerHeight * 100) : null };
  });
  await record('02-results', 'Chọn một giờ còn trống', { measurements: resultsMetrics });
  let slot = page.locator('.venue-card .slot-pill:not(.more)').first();
  if (!await slot.count()) throw new Error('Không tìm được giờ trống trên kết quả');
  await slot.click();
  await page.waitForURL(/venue/);
  await page.locator('#grid').waitFor();
  const firstSlotMetrics = await page.evaluate(() => {
    const slot = [...document.querySelectorAll('.slot-mobile [data-pick], .slot-desktop [data-pick]')].find(e => e.getClientRects().length);
    return { documentHeight: document.documentElement.scrollHeight, firstSlotTop: slot ? Math.round(slot.getBoundingClientRect().top + scrollY) : null, viewportHeight: innerHeight, firstSlotViewportRatio: slot ? Math.round(slot.getBoundingClientRect().top / innerHeight * 100) : null };
  });
  await record('03-venue', 'Chọn giờ trống rồi bấm Đặt sân', { measurements: firstSlotMetrics });
  const selectedVenueUrl = page.url();
  const pick = page.locator('[data-pick][aria-pressed="true"]:visible').first();
  if (!await pick.count()) await page.locator('[data-pick]:visible').first().click();
  await page.locator('#bar-book').click();
  await page.waitForURL(/login/);
  await record('04-login-required', 'Đăng nhập để tiếp tục đặt sân');
  // Bản cũ: ô email, đăng nhập xong về trang chủ nên phải quay lại sân và bấm Đặt sân lần nữa.
  // Bản mới: ô "Số điện thoại hoặc email", đăng nhập xong tự quay lại sân và mở hộp xác nhận.
  const newLogin = await page.locator('input[name=identifier]').count();
  await page.fill(newLogin ? 'input[name=identifier]' : 'input[name=email]', 'khach1@datsan.local');
  await page.fill('input[name=password]', 'Matkhau@123');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(u => !u.pathname.includes('login'));
  let clicks = 5;
  if (!newLogin || !(await page.locator('#confirm-dialog[open]').waitFor({ timeout: 10000 }).then(() => true, () => false))) {
    clicks = 6;
    await page.goto(selectedVenueUrl);
    await page.locator('#bar-book').waitFor();
    if (!(await page.locator('[data-pick][aria-pressed="true"]:visible').count())) await page.locator('[data-pick]:visible').first().click();
    await page.locator('#bar-book').click();
  }
  await page.locator('#confirm-dialog[open]').waitFor();
  await record('05-confirm', 'Xem thông tin và xác nhận đặt sân');
  await page.locator('#do-book').click();
  await page.waitForURL(/booking/);
  await page.locator('.booking-code').waitFor();
  await record('06-order-transfer', 'Xem thông tin đơn và cách chuyển khoản', { measurements: await dimensions() });
  const code = (await page.locator('.booking-code').innerText()).trim();
  const ordersLink = page.locator('a[href="/my-bookings.html"]:visible').first();
  if (!await ordersLink.count()) { await page.locator('.menu-btn').click(); }
  await page.locator('a[href="/my-bookings.html"]:visible').first().click();
  await page.waitForURL(/my-bookings/);
  await page.waitForTimeout(500);
  await record('07-my-orders', 'Mở đơn vừa đặt', { bookingCode: code, measurements: await dimensions() });
  const result = { width, base, date: today, desiredTime: desired, actionsUntilBookingCreated: { clicks, fieldsFilled: 2, note: clicks === 6 ? 'Tally: submit search; choose result slot; initial book; submit login; book again after login; confirm booking. No account creation.' : 'Tally: submit search; choose result slot; initial book; submit login (returns to venue with dialog open); confirm booking. No account creation.' }, steps: rows };
  fs.writeFileSync(`${out}/${width}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
