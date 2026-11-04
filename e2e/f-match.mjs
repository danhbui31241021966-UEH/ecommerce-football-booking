import { start, step, save, loginAs, api, U, W, logs, anchor, mockNow } from './lib.mjs';
const { b, p } = await start();
const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');
const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const must = (c, m) => { if (!c) throw new Error(m); };
const OWNER = 'chusan1@datsan.local';
const ownerConfirm = async (id, part) => { await loginAs(p, OWNER); await p.goto(`${U}/owner-bookings`); await p.waitForSelector('#venue'); await p.selectOption('#venue', '3'); await p.waitForSelector(`[data-mt-confirm="${id}"][data-part="${part}"]`); await p.click(`[data-mt-confirm="${id}"][data-part="${part}"]`); await p.waitForSelector('dialog.modal[open]'); await p.click('dialog.modal[open] button[type=submit]'); await p.waitForSelector('.toast'); await p.waitForTimeout(400); };
const ev = (fn, arg) => p.evaluate(fn, arg);
await p.goto(U + '/'); await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });
const demo = {};
await loginAs(p, 'khach3@datsan.local'); demo.pub = (await attempt('a=>a.matches({})')).r;
await loginAs(p, 'chusan1@datsan.local'); demo.owner = (await attempt('a=>a.owner.matches()')).r;
const NOW0 = await anchor(p, process.argv[3] || '08:00');

// Chọn ngày có đủ 4 slot trống trên hai sân bật chế độ (sân 6, 7; khung 18–22h) và còn cách giờ hiện tại >= 4 giờ.
const SL = { m1: [6, '21:00'], m2: [7, '21:00'], m3: [6, '18:00'], m4: [7, '18:00'] };
let D;
for (let i = 0; i < 3 && !D; i++) {
  const d = new Date(VN(NOW0) + i * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
  if (VN(`${d} 18:00:00`) - VN(NOW0) < 4 * 3600000) continue;
  const sc = await ev(async (dd) => (await import('/js/api.js')).api.schedule(3, dd), d);
  const free = Object.values(SL).every(([c, s]) => sc.courts.find((x) => x.id === c).slots.find((x) => x.start === s).status === 'available');
  if (free) D = d;
}
if (!D) throw new Error('không có ngày phù hợp');
console.log('ngày', D, 'now', NOW0);
const open = (c, s, pct = 50, closes) => attempt(`async a=>{const m=await a.meta();const st=Date.parse('${D} ${s}:00'.replace(' ','T')+'+07:00');const ca=new Date(st-m.matchCloseMinutes*60000+7*3600000).toISOString().slice(0,19).replace('T',' ');return a.openMatch({courtId:${c},date:'${D}',start:'${s}',loserPercent:50,closesAt:ca})}`);

let M1, M2, M3, M4, B1;
await step(p, 'match', '01-demo-data-visible', async () => {
  await loginAs(p, 'khach3@datsan.local');
  const pub = demo.pub; must(pub.length >= 2, 'trận chờ đội B: ' + pub.length);
  const om = demo.owner;
  must(om.some((m) => m.status === 'open') && om.some((m) => m.status === 'joined' && !m.guestPaid && m.hostPaid), 'thiếu trận open / joined chưa đủ tiền');
  await loginAs(p, 'khach3@datsan.local'); await p.goto(`${U}/matches`); await p.waitForSelector('.match-item');
  await loginAs(p, 'chusan2@datsan.local');
  const all = (await attempt('a=>a.owner.matches()')).r; must(all.length === 0, 'chủ sân khác thấy trận không phải của mình');
  return `public ${pub.length}, owner ${om.length}; trận đã chốt: ` + JSON.stringify(await ev(async () => (await (await import('/js/api.js')).api.schedule(3, new Date().toISOString().slice(0,10))).courts.length)); });
await step(p, 'match', '02-normal-booking-unaffected', async () => {
  await loginAs(p, 'khach3@datsan.local');
  const r = await attempt(`a=>a.createBooking({courtId:${SL.m1[0]},date:'${D}',start:'${SL.m1[1]}'})`); must(!r.ok && r.status === 409, 'đặt thường ở giờ đủ hai đội không bị chặn');
  const r2 = await attempt(`a=>a.createBooking({courtId:8,date:'${D}',start:'${SL.m1[1]}'})`); must(r2.ok, 'sân chưa bật chế độ đặt thường lỗi: ' + r2.msg);
  const r3 = await attempt(`a=>a.createBooking({courtId:6,date:'${D}',start:'17:00'})`); must(r3.ok, 'ngoài khung giờ bật chế độ đặt thường lỗi: ' + r3.msg);
  return 'đủ hai đội: ' + r.msg + '; sân 8 và 17:00 vẫn đặt thường'; }, { shot: false });
await step(p, 'match', '03-host-opens-match-ui', async () => {
  await loginAs(p, 'khach1@datsan.local');
  await p.goto(`${U}/product-detail?id=3&date=${D}&court=${SL.m1[0]}`); await p.locator('a.slot-team:visible').first().waitFor();
  await p.locator(`a.slot-team[href*="court=${SL.m1[0]}"][href*="start=${SL.m1[1]}"]:visible`).first().click();
  await p.waitForSelector('#match-form'); await p.click('[data-stake="70"]'); await p.waitForSelector('#closes'); await p.screenshot({ path: `e2e/out/match-03a-open-form-${W}.png`, fullPage: true });
  await p.click('#match-form button[type=submit]'); await p.waitForURL(/\/match(\.html)?(?=[?#]|$)/); await p.waitForSelector('.qr-card, .qr');
  const id = Number(new URL(p.url()).searchParams.get('id')); M1 = (await attempt(`a=>a.match(${id})`)).r;
  must(M1.hostAmount + M1.guestAmount === M1.price, 'tổng hai phần khác giá sân'); must(M1.loserPercent === 70 && M1.hostAmount === Math.round(M1.price / 2000) * 1000, 'tỉ lệ');
  must((await body()).includes(M1.hostAmount.toLocaleString('vi-VN')), 'QR không có số tiền phần đội mở'); return `trận #${M1.id}: ${M1.hostAmount} + ${M1.guestAmount} = ${M1.price}`; });
await step(p, 'match', '04-slot-held-no-double-booking', async () => {
  await loginAs(p, 'khach2@datsan.local');
  const r = await attempt(`a=>a.createBooking({courtId:${SL.m1[0]},date:'${D}',start:'${SL.m1[1]}'})`); must(!r.ok && r.status === 409, 'đặt trùng slot đang giữ cho trận');
  const sc = await attempt(`a=>a.schedule(3,'${D}')`); const slot = sc.r.courts.find((c) => c.id === SL.m1[0]).slots.find((s) => s.start === SL.m1[1]);
  must(slot.status === 'held' && slot.match?.id === M1.id, 'ô lịch không ở trạng thái giữ: ' + slot.status);
  const j = await attempt(`a=>a.joinMatch(${M1.id})`); must(!j.ok && j.status === 409, 'vào trận khi chủ sân chưa xác nhận phần đội mở'); return `${r.msg} | ${j.msg}`; }, { shot: false });
await step(p, 'match', '05-unauthorized-owner-actions', async () => {
  await loginAs(p, 'khach3@datsan.local'); const a = await attempt(`a=>a.owner.confirmMatchPart(${M1.id},'host','')`); must(!a.ok && a.status === 403, 'khách xác nhận được');
  await loginAs(p, 'chusan2@datsan.local'); const c = await attempt(`a=>a.owner.confirmMatchPart(${M1.id},'host','')`); must(!c.ok && c.status === 403, 'chủ sân khác xác nhận được');
  return `khách ${a.status}, chủ sân khác ${c.status}`; }, { shot: false });
await step(p, 'match', '06-owner-confirms-host-part-only', async () => {
  await ownerConfirm(M1.id, 'host');
  const m = (await attempt(`a=>a.owner.matches()`)).r.find((x) => x.id === M1.id); must(m.hostPaid && !m.guestPaid && m.status === 'open', 'trạng thái sau xác nhận phần đội mở');
  const bk = (await attempt(`a=>a.booking(${M1.bookingId})`)).r; must(bk.status === 'matching' && bk.paymentStatus === 'unpaid', 'booking chốt sớm: ' + bk.status); return 'mới một phần: booking vẫn ' + bk.status; });
await step(p, 'match', '07-guest-joins-and-sees-qr', async () => {
  await loginAs(p, 'khach2@datsan.local'); await p.goto(`${U}/matches`); await p.waitForSelector(`a[href="/match.html?id=${M1.id}"]`);
  await p.goto(`${U}/match?id=${M1.id}`); await p.click('#join'); await p.waitForSelector('.qr-card, .qr');
  const t = await body(); must(t.includes(M1.guestAmount.toLocaleString('vi-VN')), 'QR không có số tiền phần đội vào'); must(/chưa chuyển khoản/.test(t), 'không ghi rõ chưa được xác nhận');
  must(await p.locator('.toast').count() === 0, 'toast che QR'); return 'đội vào thấy QR phần ' + M1.guestAmount; });
await step(p, 'match', '08-second-joiner-blocked-and-host-cannot-join', async () => {
  await loginAs(p, 'khach3@datsan.local'); const r = await attempt(`a=>a.joinMatch(${M1.id})`); must(!r.ok && r.status === 409, 'đội thứ ba vẫn vào được');
  await p.goto(`${U}/match?id=${M1.id}`); await p.waitForSelector('.notice'); must(!(await p.locator('#join').count()), 'vẫn có nút vào trận');
  await loginAs(p, 'khach1@datsan.local'); const h = await attempt(`a=>a.joinMatch(${M1.id})`); must(!h.ok, 'đội mở tự vào trận của mình'); return `${r.status} ${r.msg} | host ${h.status}`; });
await step(p, 'match', '09-owner-confirms-guest-part-booking-confirmed', async () => {
  await ownerConfirm(M1.id, 'guest');
  const bk = (await attempt(`a=>a.booking(${M1.bookingId})`)).r; await loginAs(p, 'khach1@datsan.local');
  const bk2 = (await attempt(`a=>a.booking(${M1.bookingId})`)).r; must(bk2.status === 'confirmed' && bk2.paymentStatus === 'paid', 'booking chưa chốt: ' + bk2.status);
  await p.goto(`${U}/match?id=${M1.id}`); await p.waitForSelector('.badge'); must(/Đã chốt/.test(await body()), 'trang trận không ghi Đã chốt');
  await loginAs(p, 'khach2@datsan.local'); await p.goto(`${U}/match?id=${M1.id}`); await p.waitForSelector('.badge'); must(/Đã chốt/.test(await body()), 'đội vào không thấy Đã chốt'); void bk; return 'đủ hai phần → confirmed + paid'; });
await step(p, 'match', '10-host-unpaid-match-releases-slot-later', async () => {
  await loginAs(p, 'khach3@datsan.local'); const r = await open(SL.m3[0], SL.m3[1]); must(r.ok, r.msg); M3 = r.r; return `trận #${M3.id} chưa trả`; }, { shot: false });
await step(p, 'match', '11-withdraw-before-guest-free-with-pending-refund', async () => {
  await loginAs(p, 'khach1@datsan.local'); const relBefore = (await attempt('a=>a.myReliability()')).r; const r = await open(SL.m4[0], SL.m4[1]); must(r.ok, r.msg); M4 = r.r; await ownerConfirm(M4.id, 'host');
  await loginAs(p, 'khach1@datsan.local'); const w = await attempt(`a=>a.withdrawMatch(${M4.id})`); must(w.ok, w.msg);
  const m = (await attempt(`a=>a.match(${M4.id})`)).r; must(m.status === 'cancelled' && m.yourPart.refund?.status === 'pending' && m.yourPart.refund.amount === M4.hostAmount, 'hoàn cho đội rút: ' + JSON.stringify(m.yourPart));
  const rel = (await attempt('a=>a.myReliability()')).r; must(rel.lateCancels === relBefore.lateCancels && rel.violations === relBefore.violations, 'rút trước khi có đội vào bị tính hủy muộn');
  const sc = (await attempt(`a=>a.schedule(3,'${D}')`)).r; must(sc.courts.find((c) => c.id === SL.m4[0]).slots.find((s) => s.start === SL.m4[1]).status === 'available', 'slot chưa nhả');
  await p.goto(`${U}/match?id=${M4.id}`); await p.waitForSelector('.refund-box'); must(/Chưa trả lại/.test(await body()) && !/Đã trả lại/.test(await body()), 'chữ hoàn tiền sai'); return 'rút miễn phí, Chưa hoàn ' + M4.hostAmount; });
await step(p, 'match', '12-guest-hold-lapses-match-reopens', async () => {
  await loginAs(p, 'khach1@datsan.local'); const r = await open(SL.m2[0], SL.m2[1]); must(r.ok, r.msg); M2 = r.r; await ownerConfirm(M2.id, 'host');
  await loginAs(p, 'khach3@datsan.local'); const j = await attempt(`a=>a.joinMatch(${M2.id})`); must(j.ok, j.msg);
  await ev(async () => (await import('/js/api.js')).api.proto.advanceClock(16)); const m = (await attempt(`a=>a.match(${M2.id})`)).r;
  must(m.status === 'open' && !m.hasGuest && m.hostPaid, 'trận chưa mở lại: ' + m.status); await loginAs(p, 'khach2@datsan.local'); const j2 = await attempt(`a=>a.joinMatch(${M2.id})`); must(j2.ok, j2.msg);
  return 'đội 1 quá hạn → mở lại → đội khác vào'; }, { shot: false });
await step(p, 'match', '13-deadline-releases-slot-and-records-refund', async () => {
  const m0 = (await attempt(`a=>a.owner.matches()`)).r; void m0;
  await loginAs(p, 'khach1@datsan.local'); const cur = (await attempt(`a=>a.match(${M2.id})`)).r;
  const mins = Math.ceil((VN(cur.closesAt) - VN(await mockNow(p))) / 60000) + 1; await ev(async (n) => (await import('/js/api.js')).api.proto.advanceClock(n), mins);
  const m = (await attempt(`a=>a.match(${M2.id})`)).r; must(m.status === 'expired', 'trận chưa hết hạn: ' + m.status);
  must(m.yourPart.refund?.status === 'pending' && m.yourPart.refund.amount === M2.hostAmount, 'khoản hoàn đội mở: ' + JSON.stringify(m.yourPart));
  const sc = (await attempt(`a=>a.schedule(3,'${D}')`)).r; must(sc.courts.find((c) => c.id === SL.m2[0]).slots.find((s) => s.start === SL.m2[1]).status !== 'held', 'slot chưa nhả');
  const m3 = (await attempt(`a=>a.match(${M3.id})`)).r; await loginAs(p, 'khach3@datsan.local'); const m3b = (await attempt(`a=>a.match(${M3.id})`)).r; must(m3b.status === 'cancelled' && !m3b.yourPart.refund, 'trận chưa trả tiền: ' + m3b.status); void m3;
  await loginAs(p, 'khach2@datsan.local'); const g = (await attempt(`a=>a.match(${M2.id})`)).r; must(!g.yourPart.refund, 'đội vào chưa được ghi nhận mà có hoàn');
  await loginAs(p, 'khach1@datsan.local'); await p.goto(`${U}/match?id=${M2.id}`); await p.waitForSelector('.refund-box'); const t = await body(); must(/Chưa trả lại/.test(t) && !/Đã trả lại/.test(t), 'chữ hoàn tiền sai trước khi chủ sân ghi'); return `hết hạn; hoàn ${M2.hostAmount} chưa hoàn; trận chưa trả tự hủy, không hoàn`; });
await step(p, 'match', '14-owner-records-refund', async () => {
  await loginAs(p, OWNER); await p.goto(`${U}/owner-bookings`); await p.waitForSelector('#venue'); await p.selectOption('#venue', '3'); await p.waitForSelector(`[data-mt-refund="${M2.id}"]`); await p.screenshot({ path: `e2e/out/match-14a-owner-refund-${W}.png`, fullPage: true });
  await p.click(`[data-mt-refund="${M2.id}"]`); await p.waitForSelector('dialog.modal[open]'); await p.click('dialog.modal[open] button[type=submit]'); await p.waitForSelector('.toast');
  await loginAs(p, 'khach1@datsan.local'); await p.goto(`${U}/match?id=${M2.id}`); await p.waitForSelector('.refund-box'); must(/Đã trả lại/.test(await body()), 'không ghi Đã hoàn'); return 'đã hoàn'; });
console.log('console:', logs.length ? logs.join('\n') : 'sạch');
save();
await b.close();
