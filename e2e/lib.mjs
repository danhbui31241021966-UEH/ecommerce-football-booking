import { chromium } from 'playwright';
import fs from 'node:fs';
export const U = process.env.U || 'http://127.0.0.1:4100';
export const W = Number(process.argv[2] || 390);
fs.mkdirSync('e2e/out', { recursive: true });
const results = [];
export const logs = [];
export async function start() {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const c = await b.newContext({ viewport: { width: W, height: W > 600 ? 860 : 844 }, isMobile: W < 600, hasTouch: W < 600 });
  // FAKE_HM=HH:MM giả lập "bây giờ" (giờ VN, hôm nay) để thử demo ở các giờ khác nhau; đồng hồ vẫn chạy tiếp.
  if (process.env.FAKE_HM) { const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); await c.clock.install({ time: new Date(`${day}T${process.env.FAKE_HM}:00+07:00`) }); }
  const p = await c.newPage();
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${p.url().replace(U,'')} ${m.text()}`); });
  p.on('pageerror', (e) => logs.push('PAGEERR ' + p.url().replace(U,'') + ' ' + e.message));
  return { b, c, p };
}
export async function step(p, flow, name, fn, { shot = true, full = false } = {}) {
  let ok = true, note = '';
  try { const r = await fn(); if (typeof r === 'string') note = r; } catch (e) { ok = false; note = e.message.split('\n')[0]; }
  const path = `e2e/out/${flow}-${name}-${W}.png`;
  if (shot) await p.waitForTimeout(700);
  if (shot) await p.screenshot({ path, fullPage: full }).catch(() => {});
  results.push({ flow, name, ok, note, path: shot ? path : '' });
  console.log(ok ? 'OK  ' : 'FAIL', flow, name, note);
  return ok;
}
export const save = () => fs.writeFileSync(`e2e/out/results-${process.argv[1].split('/').pop().replace('.mjs','')}-${W}.json`, JSON.stringify({ results, logs }, null, 1));
export async function loginAs(p, identifier) {
  await p.goto(U + '/');
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout().catch(() => {}); });
  await p.goto(U + '/login');
  await p.fill('input[name=identifier]', identifier);
  await p.fill('input[name=password]', 'Matkhau@123');
  await Promise.all([p.waitForURL((u) => !u.pathname.includes('login')), p.click('button[type=submit]')]);
  // Chờ trang đích tải xong dữ liệu: nếu bước sau đăng xuất ngay, các request còn dở của trang trả 401 trên BE thật.
  await p.waitForLoadState('networkidle');
}
export const api = (p, expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');return await (${expr})(api)})()`);

// Đặt lại demo rồi tua đồng hồ mock tới 08:00 (hôm nay nếu chưa tới 08:00, không thì sáng mai) để mọi slot cần dùng nằm ở tương lai.
export async function anchor(p, hm = '08:00') {
  await p.goto(U + '/');
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });
  const now = (await api(p, 'a=>a.meta()')).now;
  const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  let add = toMin(hm) - toMin(now.slice(11, 16));
  if (add <= 0) add += 1440;
  await api(p, `a=>a.proto.advanceClock(${add})`);
  return (await api(p, 'a=>a.meta()')).now;
}
export const dayPlus = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// Sân con còn trống ở giờ start (không nằm trong avoid); null nếu hết.
export async function pickCourt(p, venueId, date, start, avoid = []) {
  return p.evaluate(async ([v, d, s, av]) => { const { api } = await import('/js/api.js'); const sc = await api.schedule(v, d);
    const c = sc.courts.find((c) => !av.includes(c.id) && c.slots.find((x) => x.start === s)?.status === 'available'); return c ? c.id : null; }, [venueId, date, start, avoid]);
}
// Giờ trống đầu tiên của venue sau hhmm (mọi sân con).
export async function pickAny(p, venueId, date, afterHm) {
  return p.evaluate(async ([v, d, a]) => { const { api } = await import('/js/api.js'); const sc = await api.schedule(v, d);
    for (const c of sc.courts) for (const s of c.slots) if (s.start >= a && s.status === 'available') return { court: c.id, start: s.start }; return null; }, [venueId, date, afterHm]);
}
export const mockNow = async (p) => (await api(p, 'a=>a.meta()')).now;
