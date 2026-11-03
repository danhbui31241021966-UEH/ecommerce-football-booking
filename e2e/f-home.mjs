import { chromium } from 'playwright';
const U = process.env.U || 'http://127.0.0.1:4100';
const W = Number(process.argv[2] || 390);
const EXE = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let fails = 0;
const ok = (c, name, note = '') => { console.log(c ? 'OK  ' : 'FAIL', name, note); if (!c) fails++; };
const day = (off = 0) => new Date(Date.now() + 7 * 3600000 + off * 86400000).toISOString().slice(0, 10);
const b = await chromium.launch({ executablePath: EXE });
async function ctx(hm, extra = {}) {
  const c = await b.newContext({ viewport: { width: W, height: W > 600 ? 860 : 844 }, isMobile: W < 600, hasTouch: W < 600, ...extra });
  if (hm) await c.clock.install({ time: new Date(`${day()}T${hm}:00+07:00`) });
  const p = await c.newPage();
  const errs = []; p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { window.__cls = 0; window.__clsAll = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__clsAll += e.value; if (e.startTime > 2000) window.__cls += e.value; } }).observe({ type: 'layout-shift', buffered: true }); });
  return { c, p, errs };
}
// Chế độ thật: BE dùng giờ thật, giả đồng hồ trình duyệt không đổi được "bây giờ". Khi đó chỉ kiểm câu chào đúng với giờ thật của BE (cùng luật:
// từ 21:30 là "Mai", trước 15:00 là "Hôm nay", còn lại "Tối nay"); các giờ giả lập chỉ chạy được trên mock (chặt như cũ).
const probe = await b.newPage();
await probe.goto(U + '/');
const REAL = (await probe.evaluate(async () => (await import('/js/api.js')).MODE)) === 'real';
const serverNow = REAL ? await probe.evaluate(async () => (await (await import('/js/api.js')).api.meta()).now) : null;
await probe.close();
const today = REAL ? serverNow.slice(0, 10) : day();
const tomorrowOf = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const realHm = REAL ? serverNow.slice(11, 16) : null;
if (REAL) console.log(`INFO chế độ thật: các giờ giả lập 09:00–22:30 bỏ qua, kiểm theo giờ thật của BE ${serverNow}`);
// 1. câu chào theo giờ demo
for (const [hm, word, tomorrow] of REAL ? [[null, realHm >= '21:30' ? 'Mai' : realHm < '15:00' ? 'Hôm nay' : 'Tối nay', realHm >= '21:30']] : [['09:00', 'Hôm nay', false], ['14:59', 'Hôm nay', false], ['15:00', 'Tối nay', false], ['18:00', 'Tối nay', false], ['21:29', 'Tối nay', false], ['22:30', 'Mai', true]]) {
  const label = hm ?? `giờ thật ${realHm}`;
  const { c, p, errs } = await ctx(hm);
  await p.goto(U + '/'); await p.waitForFunction(() => document.querySelectorAll('#f-date option').length > 0);
  const t = (await p.locator('#hero-when').textContent()).trim();
  const h1 = (await p.locator('h1.display').innerText()).replace(/\n/g, ' ');
  const sel = await p.locator('#f-date').inputValue();
  ok(t === word, `${label} câu chào`, h1);
  ok(tomorrow ? sel === tomorrowOf(today) : sel === today, `${label} ô ngày chọn sẵn`, `${sel} (hôm nay ${today})`);
  if (['09:00', '18:00', '22:30'].includes(hm)) await p.waitForTimeout(800), await p.screenshot({ path: `e2e/out/home2-${hm.replace(':', '')}-${W}.png` });
  if (hm === '18:00' || REAL) {
    // 2. ảnh đổi, không giật bố cục
    const box = () => p.evaluate(() => { const r = document.querySelector('.hero-main').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top + scrollY)]; });
    const before = await box();
    await p.waitForFunction(() => document.querySelector('.hero-main.slides'), null, { timeout: 15000 });
    const on = () => p.evaluate(() => document.querySelector('.hero-slide.is-on')?.currentSrc);
    const a = await on(); await p.waitForTimeout(8200); const a2 = await on(); await p.waitForTimeout(7000); const a3 = await on();
    ok(a && a2 && a !== a2 && a2 !== a3, 'ảnh đổi sau ~7 giây', `${a?.split('/').pop()} → ${a2?.split('/').pop()} → ${a3?.split('/').pop()}`);
    const after = await box();
    ok(JSON.stringify(before) === JSON.stringify(after), 'khung hero không đổi kích thước', `${before} vs ${after}`);
    ok((await p.evaluate(() => window.__cls)) < 0.02, 'CLS từ giây thứ 2 (sau khi trang dựng xong)', String(await p.evaluate(() => window.__cls)));
    ok((await p.evaluate(() => window.__clsAll)) < 0.1, 'CLS toàn bộ lúc tải (không bỏ qua 2 giây đầu)', String(await p.evaluate(() => window.__clsAll)));
    const imgs = await p.evaluate(() => [...document.querySelectorAll('.hero-main img')].map((i) => ({ src: i.currentSrc, alt: i.alt, on: i.classList.contains('is-on'), hidden: i.getAttribute('aria-hidden') })));
    ok(imgs.length === 6, 'đủ 6 ảnh vào vòng đổi', String(imgs.length));
    ok(imgs.every((i) => i.alt.length > 20), 'mọi ảnh có alt');
    ok(imgs.filter((i) => i.on).length === 1 && imgs.filter((i) => i.on && i.hidden).length === 0 && imgs.filter((i) => !i.on).every((i) => i.hidden === 'true'), 'chỉ ảnh đang hiện được đọc (aria-hidden các ảnh còn lại)');
    for (const i of imgs) { const r = await fetch(i.src); ok(r.status === 200, 'ảnh 200', `${i.src.split('/').pop()} ${r.status}`); }
    if (W < 600) ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'không tràn ngang ở 390', String(await p.evaluate(() => document.documentElement.scrollWidth)));
    await p.screenshot({ path: `e2e/out/home2-1800-slide2-${W}.png` });
  }
  ok(errs.length === 0, `${label} console không lỗi`, errs.join(' | ').slice(0, 200));
  await c.close();
}
// 3. reduced motion: chỉ một ảnh, không đổi
{
  const { c, p } = await ctx('18:00', { reducedMotion: 'reduce' });
  await p.goto(U + '/'); await p.waitForTimeout(12000);
  const n = await p.evaluate(() => ({ imgs: document.querySelectorAll('.hero-main img').length, slides: document.querySelectorAll('.hero-slide').length, cls: document.querySelector('.hero-main').classList.contains('slides') }));
  ok(n.imgs === 1 && n.slides === 0 && !n.cls, 'reduced-motion: một ảnh, không đổi', JSON.stringify(n));
  await c.close();
}
await b.close();
console.log('FAILS', fails);
