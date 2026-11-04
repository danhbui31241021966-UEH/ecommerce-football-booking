import { start, step, save, loginAs, api, U, W, logs, anchor, pickCourt, mockNow } from './lib.mjs';
const { b, p } = await start();
const NOW0 = await anchor(p, process.argv[3] || '08:00');
const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');
const toast = async () => { await p.waitForSelector('.toast', { timeout: 4000 }); return (await p.locator('.toast').last().innerText()).replace(/\n/g, ' '); };
const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const must = (c, m) => { if (!c) throw new Error(m); };
const OWNER = 'chusan1@datsan.local';

// Hai slot cùng giờ cách ~6h (giờ tròn 06–21h), hai sân khác nhau ở venue 1.
async function plan() {
  const base = Math.ceil(VN(NOW0) / 3600000) * 3600000;
  for (let h = 5; h < 30; h++) {
    const at = new Date(base + h * 3600000 + 7 * 3600000).toISOString();
    const date = at.slice(0, 10), start = at.slice(11, 16), hour = +at.slice(11, 13);
    if (hour < 7 || hour > 21) continue;
    const c1 = await pickCourt(p, 1, date, start);
    const c2 = c1 && await pickCourt(p, 1, date, start, [c1]);
    const c3 = c2 && await pickCourt(p, 1, date, start, [c1, c2]);
    if (c3) return { date, start, courts: [c1, c2, c3] };
  }
  throw new Error('không có slot');
}
const S = await plan();
console.log('slot', S.date, S.start, S.courts, 'now', NOW0);

// Khách đặt qua API, chủ sân duyệt (nếu cần) và thu tiền: chuẩn bị booking đã xác nhận + đã thanh toán.
async function paidBooking(email, court) {
  await loginAs(p, email);
  const bk = await p.evaluate(async ([c, d, s]) => { const { api } = await import('/js/api.js'); return api.createBooking({ courtId: c, date: d, start: s, note: '' }); }, [court, S.date, S.start]);
  await loginAs(p, OWNER);
  await p.evaluate(async ([id]) => { const { api } = await import('/js/api.js'); const x = await api.booking(id); if (x.status === 'pending') await api.owner.approve(id); await api.owner.markPaid(id, ''); }, [bk.id]);
  await loginAs(p, email);
  return p.evaluate((id) => import('/js/api.js').then((m) => m.api.booking(id)), bk.id);
}

let A, TR, newId;
await step(p, 'transfer', '01-setup-paid-booking', async () => { A = await paidBooking('khach2@datsan.local', S.courts[0]); must(A.status === 'confirmed' && A.paymentStatus === 'paid', `trạng thái ${A.status}/${A.paymentStatus}`); return `${A.code} ${A.price}đ`; }, { shot: false });
await step(p, 'transfer', '02-waitlist-person-joins', async () => { await loginAs(p, 'khach1@datsan.local'); const r = await attempt(`a=>a.joinWaitlist({courtId:${S.courts[0]},date:'${S.date}',start:'${S.start}'})`); must(r.ok, r.msg); return 'khach1 vào hàng chờ'; }, { shot: false });

await loginAs(p, 'khach2@datsan.local');
await step(p, 'transfer', '03-blocked-price-over-original', async () => {
  const r = await attempt(`a=>a.offerTransfer(${A.id},{askPrice:${A.price + 1000}})`);
  must(!r.ok, 'giá cao hơn gốc vẫn được đăng'); const r2 = await attempt(`a=>a.offerTransfer(${A.id},{askPrice:${A.price - 500}})`); must(!r2.ok, 'giá lẻ nghìn vẫn được đăng');
  await p.goto(`${U}/booking?id=${A.id}`); await p.waitForSelector('#transfer-form');
  must((await p.locator('#ask-price').getAttribute('max')) === String(A.price), 'ô giá không chặn ở giá gốc');
  return `API: ${r.status} ${r.msg}`; });
await step(p, 'transfer', '04-unauthorized-cannot-offer', async () => {
  await loginAs(p, 'khach3@datsan.local'); const r = await attempt(`a=>a.offerTransfer(${A.id},{askPrice:${A.price}})`); must(!r.ok, 'khách khác đăng nhượng được booking của người khác');
  await loginAs(p, 'chusan2@datsan.local'); const r2 = await attempt(`a=>a.owner.confirmTransfer(1,'')`); must(!r2.ok, 'chủ sân khác duyệt được'); return `khách khác ${r.status}; chủ sân khác ${r2.status}`; }, { shot: false });
await loginAs(p, 'khach2@datsan.local');
const ask = A.price - 20000;
await step(p, 'transfer', '05-giver-posts-transfer', async () => {
  await p.goto(`${U}/booking?id=${A.id}`); await p.waitForSelector('#transfer-form');
  await p.fill('#ask-price', String(ask)); await p.click('#transfer-form button[type=submit]'); await toast();
  await p.waitForSelector('#withdraw-transfer');
  TR = (await attempt('a=>a.myTransfers()')).r.find((t) => t.bookingId === A.id); must(TR && TR.status === 'open' && TR.askPrice === ask, 'không thấy đăng nhượng open'); return `transfer #${TR.id} giá ${ask}`; });
await step(p, 'transfer', '06-duplicate-offer-blocked', async () => { const r = await attempt(`a=>a.offerTransfer(${A.id},{askPrice:${ask}})`); must(!r.ok && r.status === 409, 'đăng trùng không bị chặn'); return r.msg; }, { shot: false });
await step(p, 'transfer', '07-waitlist-person-notified', async () => {
  await loginAs(p, 'khach1@datsan.local'); await p.goto(`${U}/notifications`); await p.waitForSelector('.notif-item');
  const t = (await p.locator('.notif-item').first().innerText()).replace(/\n/g, ' '); must(/pass/i.test(t), 'thông báo đầu: ' + t);
  must((await p.locator('.notif-item').first().getAttribute('href')).includes('/transfer.html'), 'liên kết sai'); return t; });
await step(p, 'transfer', '08-transfers-list-and-grid-chip', async () => {
  await loginAs(p, 'khach3@datsan.local'); await p.goto(`${U}/transfers`); await p.waitForSelector('.transfer-item');
  must(await p.locator(`a[href="/transfer.html?id=${TR.id}"]`).count(), 'danh sách không có đăng nhượng');
  await p.goto(`${U}/product-detail?id=1&date=${S.date}&slot=${S.start}&court=${S.courts[0]}`); await p.waitForSelector('.slot-transfer', { state: 'attached' }); return 'có chip ở lưới giờ'; });
await step(p, 'transfer', '09-priority-blocks-non-waiter', async () => {
  const r = await attempt(`a=>a.claimTransfer(${TR.id})`); must(!r.ok && r.status === 409, 'người không chờ nhận được trong lúc ưu tiên'); await p.goto(`${U}/transfer?id=${TR.id}`); await p.waitForSelector('.notice');
  must(/ưu tiên/i.test(await body()), 'không giải thích ưu tiên'); must(await p.locator('#claim').count() === 0, 'vẫn có nút nhận'); return r.msg; });
await step(p, 'transfer', '10-waitlist-person-claims-sees-qr', async () => {
  await loginAs(p, 'khach1@datsan.local'); await p.goto(`${U}/transfer?id=${TR.id}`); await p.click('#claim');
  await p.waitForSelector('.qr-card, .qr'); await p.screenshot({ path: `e2e/out/transfer-claim-qr-immediate-${W}.png` }); must(!(await p.locator('.toast').count()), 'toast che QR'); const t = await body(); must(t.includes(String(ask.toLocaleString('vi-VN'))), 'QR/số tiền không đúng giá nhượng'); must(/NH/.test(t), 'thiếu nội dung chuyển khoản'); return 'QR hiện sau khi nhận, số tiền ' + ask; });
await step(p, 'transfer', '11-duplicate-claim-blocked', async () => {
  await loginAs(p, 'khach3@datsan.local'); const r = await attempt(`a=>a.claimTransfer(${TR.id})`); must(!r.ok && r.status === 409, 'đội thứ hai vẫn nhận được'); await p.goto(`${U}/transfer?id=${TR.id}`); await p.waitForSelector('.notice'); must(!(await p.locator('#claim').count()), 'vẫn có nút nhận'); return r.msg; });
await step(p, 'transfer', '12-giver-cannot-cancel-while-claimed', async () => {
  await loginAs(p, 'khach2@datsan.local'); const r = await attempt(`a=>a.cancelBooking(${A.id},'')`); must(!r.ok && r.status === 409, 'giver hủy được khi đã có đội nhận'); await p.goto(`${U}/booking?id=${A.id}`); await p.waitForSelector('.booking-code');
 return r.msg; });
await step(p, 'transfer', '13-owner-confirms-money', async () => {
  await loginAs(p, OWNER); await p.goto(`${U}/owner-bookings`); await p.waitForSelector(`[data-tr-confirm="${TR.id}"]`);
  await p.click(`[data-tr-confirm="${TR.id}"]`); await p.waitForSelector('dialog.modal[open]'); await p.screenshot({ path: `e2e/out/transfer-13b-owner-dialog-${W}.png` });
  await p.click('dialog.modal[open] button[type=submit]');
  await p.waitForFunction(() => [...document.querySelectorAll('.toast:not(.error)')].some((t) => /Sân đã sang đội nhận/.test(t.textContent)));
  const result = await attempt(`a=>a.transfer(${TR.id})`);
  must(result.ok && result.r.status === 'completed' && result.r.newBookingId && result.r.refund?.status === 'pending', 'trạng thái transfer: ' + JSON.stringify(result));
  return `đã xác nhận; transfer ${result.r.status}, booking mới #${result.r.newBookingId}, hoàn ${result.r.refund.status}`; });
await step(p, 'transfer', '14-booking-changed-owner-old-team-pending-refund', async () => {
  await loginAs(p, 'khach2@datsan.local'); const a = (await attempt(`a=>a.booking(${A.id})`)).r; must(a.status === 'transferred', 'A: ' + a.status); must(a.refundStatus === 'pending' && a.refundAmount === ask, `refund ${a.refundStatus} ${a.refundAmount}`);
  await p.goto(`${U}/booking?id=${A.id}`); await p.waitForSelector('.booking-code'); const t = await body(); must(/Chưa trả lại/.test(t), 'thiếu chữ "Chưa hoàn"'); must(!/Đã trả lại/.test(t), 'ghi "Đã hoàn" khi chưa hoàn');
  const noPenalty = (await attempt('a=>a.myReliability()')).r; return `A=${a.status}; hoàn ${a.refundStatus}; độ tin cậy ${JSON.stringify(noPenalty).slice(0, 80)}`; });
await step(p, 'transfer', '15-new-team-owns-booking', async () => {
  await loginAs(p, 'khach1@datsan.local'); const list = (await attempt('a=>a.myBookings()')).r; const nb = list.find((x) => x.acquiredByTransfer && x.startAt === A.startAt && x.courtId === A.courtId); must(nb && nb.status === 'confirmed' && nb.paymentStatus === 'paid', 'khach1 không có booking confirmed+paid'); newId = nb.id;
  await p.goto(`${U}/booking?id=${nb.id}`); await p.waitForSelector('.booking-code'); return `booking mới #${nb.id} giá ${nb.price}`; });
await step(p, 'transfer', '16-old-team-my-transfers-tab', async () => { await loginAs(p, 'khach2@datsan.local'); await p.goto(`${U}/my-bookings?tab=transfers`); await p.waitForSelector('.booking-item'); const t = await body(); must(/Chưa trả lại/.test(t), 'tab không ghi Chưa hoàn'); return 'có dòng Chưa hoàn'; });
await step(p, 'transfer', '17-owner-records-refund', async () => {
  await loginAs(p, OWNER); await p.goto(`${U}/owner-bookings`); await p.waitForSelector(`[data-act="refund"][data-id="${A.id}"]`); await p.click(`[data-act="refund"][data-id="${A.id}"]`); await p.waitForSelector('dialog.modal[open]'); await p.click('dialog.modal[open] button[type=submit]'); await toast();
  await loginAs(p, 'khach2@datsan.local'); const a = (await attempt(`a=>a.booking(${A.id})`)).r; must(a.refundStatus === 'done', 'refund ' + a.refundStatus); await p.goto(`${U}/booking?id=${A.id}`); await p.waitForSelector('.booking-code'); must(/Đã trả lại/.test(await body()), 'trang không ghi Đã hoàn'); return 'đã hoàn'; });
await step(p, 'transfer', '18-history-logged', async () => { const a = (await attempt(`a=>a.booking(${A.id})`)).r; const acts = (a.logs || a.history || []).map((l) => l.action); must(['transfer_open', 'transfer_claim', 'transfer_done'].every((k) => acts.includes(k)), 'logs: ' + acts.join()); return acts.join(','); }, { shot: false });

// Quá hạn: hai booking còn lại (sân 2, 3) — một đã đăng nhượng sớm, một chưa; tua đồng hồ tới 30 phút trước giờ đá.
let B2, B3, T2;
await step(p, 'transfer', '19-setup-deadline-cases', async () => {
  B2 = await paidBooking('khach2@datsan.local', S.courts[1]); B3 = await paidBooking('khach2@datsan.local', S.courts[2]);
  const r = await attempt(`a=>a.offerTransfer(${B2.id},{askPrice:${B2.price}})`); must(r.ok, r.msg); T2 = r.r;
  const mins = Math.floor((VN(B2.startAt) - VN(await mockNow(p))) / 60000) - 30; await p.evaluate(async (m) => { const { api } = await import('/js/api.js'); await api.proto.advanceClock(m); }, mins); return `tua ${mins} phút`; }, { shot: false });
await step(p, 'transfer', '20-past-deadline-blocked', async () => {
  const r = await attempt(`a=>a.offerTransfer(${B3.id},{askPrice:${B3.price}})`); must(!r.ok, 'đăng nhượng quá hạn vẫn được');
  await loginAs(p, 'khach3@datsan.local'); const c = await attempt(`a=>a.claimTransfer(${T2.id})`); must(!c.ok, 'nhận quá hạn vẫn được');
  await p.goto(`${U}/transfer?id=${T2.id}`); await p.waitForSelector('.notice'); return `đăng: ${r.status} ${r.msg}; nhận: ${c.status} ${c.msg}`; });
await step(p, 'transfer', '21-expired-keeps-booking-with-giver', async () => {
  await loginAs(p, 'khach2@datsan.local'); const x = (await attempt(`a=>a.booking(${B2.id})`)).r; must(x.status === 'confirmed' && x.transfer?.status !== 'open', `booking ${x.status}, transfer ${x.transfer?.status}`); return `booking vẫn ${x.status}; đăng nhượng ${x.transfer?.status}`; });

console.log('console:', logs.length ? logs.join('\n') : 'sạch');
save();
await b.close();
