import { start, step, save, loginAs, api, U, W, logs, anchor, pickCourt, pickAny, dayPlus, mockNow } from './lib.mjs';
const { b, p } = await start();
const toast = async () => { await p.waitForSelector('.toast', { timeout: 4000 }); return (await p.locator('.toast').last().innerText()).replace(/\n/g,' '); };
const today = async () => (await api(p, 'a=>a.meta()')).now.slice(0, 10);
const openSlot = async (venueId, date, start, court) => { await p.goto(`${U}/venue?id=${venueId}&date=${date}&slot=${start}&court=${court}`); await p.locator('#grid .slot:visible').first().waitFor(); };
const bookUI = async (venueId, date, start, court) => { await openSlot(venueId, date, start, court); await p.locator('[data-pick][aria-pressed=true]:visible').first().waitFor(); await p.click('#bar-book'); await p.waitForSelector('#confirm-dialog[open]'); await p.click('#do-book'); await p.waitForURL(/\/booking(\.html)?(?=[?#]|$)/); await p.waitForSelector('.booking-code'); return (await p.locator('.booking-code').innerText()).trim(); };
const NOW0 = await anchor(p, process.argv[3] || '08:00');
const D = NOW0.slice(0, 10);
const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');
// Chọn slot (venue 1) cách giờ mock hiện tại từ minH đến maxH giờ, vào giờ tròn 06–22h, còn trống, chưa dùng.
const used = new Set();
async function plan(minH, maxH, name) {
  const base = Math.ceil(VN(NOW0) / 3600000) * 3600000;
  for (let h = minH; h <= maxH; h++) {
    const at = new Date(base + h * 3600000 + 7 * 3600000).toISOString();
    const date = at.slice(0, 10), start = at.slice(11, 16), hour = +at.slice(11, 13);
    if (hour < 6 || hour > 22 || used.has(date + start)) continue;
    const court = await pickCourt(p, 1, date, start);
    if (!court) continue;
    used.add(date + start);
    const hoursAhead = (VN(date + ' ' + start + ':00') - VN(NOW0)) / 3600000;
    console.log('slot', name, date, start, 'sân', court, 'cách', hoursAhead.toFixed(1) + 'h');
    return { date, start, court, hoursAhead };
  }
  throw new Error('không có slot cho ' + name);
}
// A, B bị khách 2 hủy: cách >= 13h để không tính là hủy muộn (<12h) và không làm khách 2 bị buộc chờ duyệt.
const R50 = await plan(13, 23, 'R7 50%');
const A = await plan(14, 40, 'A (luồng 3)');
const B = await plan(14, 40, 'B (hết hạn lượt giữ)');
const R0 = await plan(1, 11, 'R7 0%');
const R100 = await plan(25, 46, 'R7 100%');
const E = await plan(1, 10, 'luồng 5 (sớm)');

// ===== Luồng 3: danh sách chờ =====
let code3, url3;
await loginAs(p, 'khach2@datsan.local');
await step(p, 'luong3', '01-khach2-books-slot', async () => { code3 = await bookUI(1, A.date, A.start, A.court); url3 = p.url(); return code3; }, { shot: false });
await loginAs(p, 'khach1@datsan.local');
await step(p, 'luong3', '02-khach1-sees-booked-wait-btn', async () => { await openSlot(1, A.date, A.start, A.court); await p.waitForTimeout(300); const sel = W < 600 ? '' : ''; if (W < 600) await p.click(`[data-court-tab="${A.court}"]`).catch(()=>{}); const n = await p.locator(`[data-wait][data-start="${A.start}"][data-court="${A.court}"]:visible`).count(); if (!n) throw new Error('không có nút Báo tôi khi trống'); await p.locator(`[data-wait][data-start="${A.start}"][data-court="${A.court}"]:visible`).first().scrollIntoViewIfNeeded(); return 'nút có'; });
await step(p, 'luong3', '03-join-waitlist', async () => { await p.locator(`[data-wait][data-start="${A.start}"][data-court="${A.court}"]:visible`).first().click(); const t = await toast(); await p.waitForTimeout(600); return t; });
await step(p, 'luong3', '04-my-bookings-waiting-tab', async () => { await p.goto(U + '/my-bookings?tab=waiting'); await p.waitForSelector('.booking-item'); return (await p.locator('.booking-item').first().innerText()).replace(/\n/g, ' | '); });
await loginAs(p, 'khach2@datsan.local');
await step(p, 'luong3', '05-khach2-cancels', async () => { await p.goto(url3); await p.click('#open-cancel'); await p.waitForSelector('#cancel-dialog[open]'); const t = (await p.locator('#cancel-refund').innerText()).replace(/\n/g,' '); await p.screenshot({ path: `e2e/out/luong3-05b-cancel-dialog-${W}.png` }); await p.click('#do-cancel'); await toast(); return t; });
await loginAs(p, 'khach1@datsan.local');
let offerLink;
await step(p, 'luong3', '06-khach1-offer-notification', async () => { await p.goto(U + '/notifications'); await p.waitForSelector('.notif-item'); const f = p.locator('.notif-item').first(); offerLink = await f.getAttribute('href'); const t = (await f.innerText()).replace(/\n/g,' '); if (!/giữ/i.test(t)) throw new Error('thông báo đầu: ' + t); return offerLink + ' :: ' + t; });
await step(p, 'luong3', '07-my-bookings-offer-banner', async () => { await p.goto(U + '/my-bookings?tab=waiting'); await p.waitForSelector('.offer-banner, .booking-item.offer'); return (await p.locator('.offer-banner').first().innerText()).replace(/\n/g,' '); });
await step(p, 'luong3', '08-open-offer-slot-for-you', async () => { await p.goto(U + offerLink); await p.locator('.slot-for-you:visible').first().waitFor(); await p.waitForTimeout(1200); const bar = await p.locator('#bar-what').innerText(); return 'bar=' + bar + ' offer=' + await p.locator('.slot-for-you:visible').first().innerText().then(t=>t.replace(/\n/g,' ')); });
await step(p, 'luong3', '09-khach3-cannot-take-offered-slot', async () => { await loginAs(p, 'khach3@datsan.local'); await openSlot(1, A.date, A.start, A.court); const n = await p.locator('.slot-offered:visible').count(); const pick = await p.locator(`[data-pick][data-start="${A.start}"][data-court="${A.court}"]:visible`).count(); if (pick) throw new Error('khach3 chọn được ô đang giữ cho người chờ'); return `slot-offered=${n}`; });
await step(p, 'luong3', '10-khach1-books-offered', async () => { await loginAs(p, 'khach1@datsan.local'); const c = await bookUI(1, A.date, A.start, A.court); return c + ' ' + (await p.locator('.badge').allInnerTexts()).join(','); });
await step(p, 'luong3', '11-offer-expiry-passes-to-next', async () => {
  // khach2 giữ 21:00 sân 1, khach1 + khach3 xếp hàng, khach2 hủy -> khach1 được giữ; tua 11 phút -> khach3 được giữ
  await loginAs(p, 'khach2@datsan.local'); await bookUI(1, B.date, B.start, B.court); const u = p.url();
  for (const e of ['khach1', 'khach3']) { await loginAs(p, e + '@datsan.local'); await openSlot(1, B.date, B.start, B.court); await p.locator(`[data-wait][data-start="${B.start}"][data-court="${B.court}"]:visible`).first().click(); await toast(); }
  await loginAs(p, 'khach2@datsan.local'); await p.goto(u); await p.click('#open-cancel'); await p.click('#do-cancel'); await toast();
  const n1 = 'n/a';
  await api(p, 'a=>a.proto.advanceClock(11)');
  await loginAs(p, 'khach3@datsan.local'); await p.goto(U + '/notifications'); await p.waitForSelector('.notif-item');
  const t3 = (await p.locator('.notif-item').first().innerText()).replace(/\n/g, ' ');
  if (!/giữ cho bạn/.test(t3)) throw new Error('khach3 không được báo: ' + t3 + ' waitlist=' + n1);
  return 'waitlist sau hủy=' + n1 + ' | khach3: ' + t3;
});
await step(p, 'luong3', '12-R1-only-3-day-chips', async () => { await openSlot(1, D, '19:00', 1); const n = await p.locator('#days .day-chip').count(); if (n !== 3) throw new Error('chip ngày = ' + n); return '3 chip'; });
// ===== Luồng 4: hủy & hoàn tiền (R7) =====
let c4, u4;
await step(p, 'luong4', '01-khach-books-and-owner-pays', async () => { await loginAs(p, 'khach2@datsan.local'); c4 = await bookUI(1, R50.date, R50.start, R50.court); u4 = p.url(); await loginAs(p, 'chusan1@datsan.local'); await p.goto(U + '/owner-bookings?status=unpaid&q=' + c4); await p.waitForSelector('.bk'); await p.locator(`.bk:has-text("${c4}") [data-act=paid]`).click(); await p.locator('dialog button[type=submit]').click(); return c4 + ' ' + await toast(); }, { shot: false });
await step(p, 'luong4', '02-cancel-dialog-shows-refund', async () => { await loginAs(p, 'khach2@datsan.local'); await p.goto(u4); await p.click('#open-cancel'); await p.waitForSelector('#cancel-dialog[open]'); const tx = (await p.locator('#cancel-refund').innerText()).replace(/\n/g, ' '); if (!/trả lại 50%/.test(tx)) throw new Error('kỳ vọng 50% (cách ' + R50.hoursAhead.toFixed(1) + 'h): ' + tx); return tx; });
await step(p, 'luong4', '03-cancelled-refund-box', async () => { await p.click('#do-cancel'); const t = await toast(); await p.waitForSelector('#root .refund-box'); return t + ' || ' + (await p.locator('#root .refund-box').innerText()); }, { full: true });
await step(p, 'luong4', '04-owner-notified-and-refund-filter', async () => { await loginAs(p, 'chusan1@datsan.local'); await p.goto(U + '/notifications'); const t = (await p.locator('.notif-item', { hasText: c4 }).first().innerText()).replace(/\n/g,' '); await p.goto(U + '/owner-bookings?status=refund'); await p.waitForSelector('.bk'); if (!await p.locator(`.bk:has-text("${c4}")`).count()) throw new Error('không thấy trong Chờ hoàn tiền'); return t; });
await step(p, 'luong4', '05-owner-marks-refunded', async () => { await p.locator(`.bk:has-text("${c4}") [data-act=refund]`).click(); await p.screenshot({ path: `e2e/out/luong4-05b-refund-dialog-${W}.png` }); await p.locator('dialog button[type=submit]').click(); return await toast(); });
await step(p, 'luong4', '06-customer-sees-refund-done', async () => { await loginAs(p, 'khach2@datsan.local'); await p.goto(u4); await p.waitForSelector('#root .refund-box'); const t = await p.locator('#root .refund-box').innerText(); if (!/Đã trả lại/i.test(t)) throw new Error(t); const n = (await p.locator('.notif-item').count()); return t; }, { full: true });
// R7 các mốc còn lại bằng UI dialog
for (const [label, S, expect] of [['100pct', R100, '100'], ['0pct', R0, '0']]) {
  await step(p, 'luong4', `07-R7-${label}`, async () => { await loginAs(p, 'khach3@datsan.local'); await bookUI(1, S.date, S.start, S.court); await p.click('#open-cancel'); await p.waitForSelector('#cancel-dialog[open]'); const tx = (await p.locator('#cancel-refund').innerText()).replace(/\n/g, ' '); if (!new RegExp(`được trả lại <?b?>?\\s*${expect}%`).test(tx)) throw new Error('kỳ vọng ' + expect + '% (cách ' + S.hoursAhead.toFixed(1) + 'h): ' + tx); return tx; });
}

// Slot trống đầu tiên của venue 1 cách giờ mock hiện tại ít nhất 1 giờ (hôm nay, không có thì các ngày sau).
async function nextFree() {
  const now = await mockNow(p);
  const hm = new Date(VN(now) + 3600000 + 7 * 3600000).toISOString();
  for (let i = 0; i < 3; i++) {
    const date = dayPlus(now.slice(0, 10), i);
    const r = await pickAny(p, 1, date, i === 0 ? hm.slice(11, 16) : '06:00');
    if (r && (i > 0 || hm.slice(0, 10) === date)) return { date, ...r };
  }
  throw new Error('hết slot trống');
}
// ===== Luồng 5: bùng sân =====
let c5, u5;
await step(p, 'luong5', '01-khach1-books-early-slot', async () => { await loginAs(p, 'khach1@datsan.local'); const r = await api(p, 'a=>a.myReliability()'); c5 = await bookUI(1, E.date, E.start, E.court); u5 = p.url(); return c5 + ' reliability-before=' + JSON.stringify(r); });
await step(p, 'luong5', '02-owner-cannot-mark-before-start', async () => { await loginAs(p, 'chusan1@datsan.local'); await p.goto(U + '/owner-bookings?q=' + c5); await p.waitForSelector('.bk'); const n = await p.locator('[data-act=no_show]').count(); if (n) throw new Error('nút Bùng hiện trước giờ đá'); await api(p, `async a=>{const b=(await a.owner.bookings({q:'${c5}'})).find((x)=>x.code==='${c5}');await a.owner.markPaid(b.id,'đã chuyển khoản')}`); return 'không có nút Đã đá/Bùng trước giờ đá; chủ sân ghi nhận đã trả (đơn chưa trả tự hết hạn sau 15 phút, nên không còn để bùng sân)'; });
await step(p, 'luong5', '03-advance-clock-owner-marks-noshow', async () => { await api(p, 'a=>a.proto.advanceClock('+(Math.ceil(E.hoursAhead*60)+60)+')'); await p.reload(); await p.waitForSelector('.bk'); await p.locator(`.bk:has-text("${c5}") [data-act=no_show]`).click(); await p.screenshot({ path: `e2e/out/luong5-03b-noshow-dialog-${W}.png` }); await p.locator('dialog button[type=submit]').click(); return await toast(); });
await step(p, 'luong5', '04-customer-notified-noshow', async () => { await loginAs(p, 'khach1@datsan.local'); await p.goto(U + '/notifications'); const t = (await p.locator('.notif-item', { hasText: /vắng|bùng/ }).first().innerText()).replace(/\n/g,' '); const r = await api(p, 'a=>a.myReliability()'); return t + ' || ' + JSON.stringify(r); });
await step(p, 'luong5', '05-next-booking-forced-pending', async () => { const nf = await nextFree(); await openSlot(1, nf.date, nf.start, nf.court); await p.locator('[data-pick][aria-pressed=true]:visible').first().waitFor(); await p.click('#bar-book'); await p.waitForSelector('#confirm-dialog[open]'); const w = await p.locator('#dlg-approval').isVisible(); const txt = w ? await p.locator('#dlg-approval').innerText() : 'không cảnh báo'; if (!w) throw new Error('không báo chờ duyệt dù đã vi phạm'); return txt; });
await step(p, 'luong5', '06-booking-is-pending-on-self-confirm-venue', async () => { await p.click('#do-book'); await p.waitForURL(/\/booking(\.html)?(?=[?#]|$)/); await p.waitForSelector('#cd', { timeout: 4000 }); return (await p.locator('.badge').allInnerTexts()).join(',') + ' ' + await p.locator('#cd').innerText(); });
await step(p, 'luong5', '07-owner-sees-restricted-reliability', async () => { await loginAs(p, 'chusan1@datsan.local'); await p.goto(U + '/owner-bookings?status=pending'); await p.waitForSelector('.bk .rel'); return await p.locator('.bk .rel').first().innerText(); });
save(); console.log('LOGS', logs.join('\n')); await b.close();
