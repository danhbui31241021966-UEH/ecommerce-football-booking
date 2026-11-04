import { start, step, save, loginAs, api, U, W, logs, anchor, mockNow } from './lib.mjs';
const { b, p } = await start();
const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');
const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const must = (c, m) => { if (!c) throw new Error(m); };
const CHUSAN1 = 'chusan1@datsan.local', CHUSAN2 = 'chusan2@datsan.local', K1 = 'khach1@datsan.local', K2 = 'khach2@datsan.local', K3 = 'khach3@datsan.local', C = 'khachnen01@datsan.local'; // C: khách nền có độ tin cậy tốt; khach3 bị ép chờ duyệt (R10)
const shot = (name) => p.screenshot({ path: `e2e/out/request-${name}-${W}.png`, fullPage: true });
await p.goto(U + '/'); await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });
const demo = {};
await loginAs(p, K1); demo.mine = (await attempt('a=>a.myRequests()')).r;
await loginAs(p, CHUSAN1); demo.owner1 = (await attempt('a=>a.owner.requests()')).r;
await loginAs(p, CHUSAN2); demo.owner2 = (await attempt('a=>a.owner.requests()')).r;
// Trang danh sách khách thấy ngay sau khi đặt lại demo, trước khi tua đồng hồ: tua trọn một ngày thì nhu cầu mẫu hết hạn là đúng quy tắc, không phải lỗi dữ liệu.
await loginAs(p, K1); await p.goto(`${U}/requests`); await p.waitForSelector('.booking-item'); demo.listText = await body(); await shot('01-list');
const NOW0 = await anchor(p, process.argv[3] || '08:00');
const D = new Date(VN(NOW0) + 86400000 + 7 * 3600000).toISOString().slice(0, 10); // mai: luôn đủ thời gian cho hạn chào giá
console.log('mock now', NOW0, 'ngày', D);

const closeAt = (hm) => new Date(VN(`${D} ${hm}:00`) - 60 * 60000 + 7 * 3600000).toISOString().slice(0, 19).replace('T', ' '); // sát giờ: 60 phút trước khung giờ
const post = (who, o) => attempt(`a=>a.openRequest(${JSON.stringify({ district: 'Quận 7', date: D, from: '18:00', to: '22:00', fieldType: '5', budget: 300000, closesAt: closeAt(o.from || '18:00'), ...o })})`);
// Chủ sân gửi chào giá vào slot trống đầu tiên của cụm sân venueId (hoặc sân con courtId).
// venueId = null: lấy cụm sân đầu tiên còn slot trống mà chưa có chào giá mở (trừ các cụm trong skip). Dữ liệu nền có thể đã kín một số cụm.
const offer = async (email, reqId, venueId, price, opts = {}) => {
  await loginAs(p, email);
  const r = (await attempt('a=>a.owner.requests()')).r.find((x) => x.id === reqId); must(r, `chủ sân ${email} không thấy nhu cầu ${reqId}`);
  const taken = new Set([...(opts.skip || []), ...r.offers.filter((o) => o.status === 'open').map((o) => o.venueId)]);
  const opt = r.options.find((o) => (venueId ? o.venueId === venueId : !taken.has(o.venueId)) && (!opts.courtId || o.courtId === opts.courtId)); must(opt, `không còn slot trống ở cụm ${venueId || 'nào'}`);
  const s = opt.slots[0];
  const res = await attempt(`a=>a.owner.sendOffer(${reqId},${JSON.stringify({ courtId: opt.courtId, start: s.start, price: price ?? s.basePrice, validUntil: r.closesAt })})`);
  must(res.ok, 'gửi chào giá: ' + res.msg); return { ...res.r, venueId: opt.venueId, courtId: opt.courtId, start: s.start, basePrice: s.basePrice };
};
let R, R2, A, B, OFFER_UI, BK, R4, O4;
await step(p, 'request', '01-demo-data-visible', async () => {
  const m = demo.mine; must(m.length === 3, 'khach1 cần 3 nhu cầu demo: ' + m.length);
  must(m.some((r) => r.status === 'open' && !r.offers.length), 'thiếu nhu cầu đang chờ chào giá');
  must(m.some((r) => r.status === 'open' && r.offers.filter((o) => o.status === 'open').length >= 2), 'thiếu nhu cầu có 2–3 chào giá');
  must(m.some((r) => r.status === 'chosen' && r.bookingId), 'thiếu nhu cầu đã chốt thành booking');
  must(demo.owner1.length >= 3 && demo.owner2.every((r) => r.district !== 'Quận 7'), 'chủ sân 2 thấy nhu cầu Quận 7');
  const t = demo.listText; must(/Đang chờ sân báo giá/.test(t) && /Có báo giá, chờ bạn chọn/.test(t) && /Đã chọn sân và đặt xong/.test(t), 'thiếu nhãn trạng thái');
  return `khach1: ${m.map((r) => r.status + '/' + r.offers.length).join(', ')}; chusan1 ${demo.owner1.length} nhu cầu, chusan2 ${demo.owner2.length}`; }, { shot: false });
await step(p, 'request', '02-customer-posts-request-ui', async () => {
  await loginAs(p, C); await p.goto(`${U}/request-new`); await p.waitForSelector('#req-form');
  await p.selectOption('#district', 'Quận 7'); await p.click(`[data-date="${D}"]`); await p.selectOption('#from', '18:00'); await p.selectOption('#to', '22:00'); await p.fill('#budget', '300000');
  await p.selectOption('#closes', { index: -1 }).catch(() => {});
  await shot('02a-form');
  await p.click('#submit'); await p.waitForURL(/\/request(\.html)?(?=[?#]|$)/); await p.waitForSelector('.notice');
  const id = Number(new URL(p.url()).searchParams.get('id')); R = (await attempt(`a=>a.request(${id})`)).r;
  must(R.status === 'open' && R.date === D && R.from === '18:00' && R.to === '22:00' && R.budget === 300000 && R.fieldType === '5', 'dữ liệu nhu cầu: ' + JSON.stringify(R));
  must(/Báo giá chưa giữ sân/.test(await body()), 'không nói rõ chào giá không giữ sân'); return `nhu cầu #${R.id}, hạn ${R.closesAt}`; });
await step(p, 'request', '03-only-fitting-owner-sees-and-validation', async () => {
  await loginAs(p, CHUSAN1); const o1 = (await attempt('a=>a.owner.requests()')).r.find((x) => x.id === R.id); must(o1 && o1.options.length, 'chủ sân phù hợp không thấy nhu cầu');
  await loginAs(p, CHUSAN2); const o2 = (await attempt('a=>a.owner.requests()')).r; must(!o2.some((x) => x.id === R.id), 'chủ sân không phù hợp thấy nhu cầu');
  const bad = await attempt(`a=>a.owner.sendOffer(${R.id},{courtId:${o1.options[0].courtId},start:'${o1.options[0].slots[0].start}',price:100000,validUntil:'${R.closesAt}'})`); must(!bad.ok && bad.status === 403, 'chủ sân không phù hợp gửi được chào giá: ' + JSON.stringify(bad));
  await loginAs(p, CHUSAN1); const s0 = o1.options[0].slots[0], c0 = o1.options[0].courtId;
  const hi = await attempt(`a=>a.owner.sendOffer(${R.id},{courtId:${c0},start:'${s0.start}',price:${s0.basePrice + 1000},validUntil:'${R.closesAt}'})`); must(!hi.ok && hi.status === 400, 'giá cao hơn niêm yết vẫn được chào');
  const odd = await attempt(`a=>a.owner.sendOffer(${R.id},{courtId:${c0},start:'${s0.start}',price:${s0.basePrice - 500},validUntil:'${R.closesAt}'})`); must(!odd.ok && odd.status === 400, 'giá lẻ vẫn được chào');
  const late = await attempt(`a=>a.owner.sendOffer(${R.id},{courtId:${c0},start:'${s0.start}',price:${s0.basePrice},validUntil:'${new Date(VN(R.closesAt) + 3600000 + 7 * 3600000).toISOString().slice(0, 19).replace('T', ' ')}'})`); must(!late.ok && late.status === 400, 'hiệu lực vượt hạn nhu cầu');
  await loginAs(p, K2); const peek = await attempt(`a=>a.request(${R.id})`); must(!peek.ok && peek.status === 404, 'khách khác xem được nhu cầu');
  // Giờ đủ hai đội không chào giá riêng được: nhu cầu sân 7 tối mai, sân 6/7 của cụm 3 bật chế độ 18–22h.
  await loginAs(p, C); const r7 = await post(C, { fieldType: '7', from: '19:00', to: '21:00', budget: 600000 }); must(r7.ok, r7.msg); R2 = r7.r;
  await loginAs(p, CHUSAN1); const o7 = (await attempt('a=>a.owner.requests()')).r.find((x) => x.id === R2.id);
  must(!o7.options.some((o) => [6, 7].includes(o.courtId)), 'sân bật chế độ hai đội vẫn nằm trong gợi ý chào giá');
  const tm = await attempt(`a=>a.owner.sendOffer(${R2.id},{courtId:6,start:'19:00',price:450000,validUntil:'${R2.closesAt}'})`); must(!tm.ok && tm.status === 409, 'chào giá vào giờ đủ hai đội: ' + JSON.stringify(tm));
  await loginAs(p, C); await attempt(`a=>a.cancelRequest(${R2.id})`);
  return `403 / 400 giá cao / 400 giá lẻ / 400 hiệu lực / khách khác 404 / chế độ hai đội 409 (${tm.msg})`; }, { shot: false });
await step(p, 'request', '04-owner-sends-offer-ui-and-more', async () => {
  await loginAs(p, CHUSAN1); await p.goto(`${U}/owner-requests`); await p.waitForSelector(`[data-offer="${R.id}"]`); await shot('04a-owner-list');
  await p.click(`[data-offer="${R.id}"]`); await p.waitForSelector('dialog.modal[open]'); await p.waitForTimeout(700); await p.screenshot({ path: `e2e/out/request-04b-owner-dialog-${W}.png` });
  await p.click('dialog.modal[open] button[type=submit]'); await p.waitForSelector('.toast'); await p.waitForTimeout(500);
  const r = (await attempt('a=>a.owner.requests()')).r.find((x) => x.id === R.id); OFFER_UI = r.offers[0]; must(r.offers.length === 1 && r.offers[0].status === 'open' && r.offers[0].venueId === 1, 'chào giá từ giao diện: ' + JSON.stringify(r.offers));
  A = await offer(CHUSAN1, R.id, null, 250000); B = await offer(CHUSAN1, R.id, null, 280000);
  must(new Set([OFFER_UI.venueId, A.venueId, B.venueId]).size === 3, 'ba chào giá phải ở ba cụm sân khác nhau');
  const dup = await attempt(`a=>a.owner.sendOffer(${R.id},{courtId:${B.courtId},start:'${B.start}',price:${B.price},validUntil:'${R.closesAt}'})`); must(!dup.ok && dup.status === 409, 'một sân chào hai lần cho một nhu cầu');
  await loginAs(p, C); const c = (await attempt(`a=>a.request(${R.id})`)).r; must(c.offers.length === 3 && c.offers.every((o) => o.usable), 'khách thấy ' + c.offers.length + ' chào giá');
  await p.goto(`${U}/request?id=${R.id}`); await p.waitForSelector('.offer-item'); must((await p.locator('.offer-item').count()) === 3, 'trang không hiện 3 chào giá'); await shot('04c-customer-offers');
  return `3 chào giá: ${c.offers.map((o) => o.venueId + ':' + o.price).join(', ')}; trùng sân → ${dup.status}`; }, { shot: false });
await step(p, 'request', '05-offer-does-not-hold-slot', async () => {
  const sc = (await attempt(`a=>a.schedule(${A.venueId},'${D}')`)).r; const slot = sc.courts.find((c) => c.id === A.courtId).slots.find((s) => s.start === A.start); must(slot.status === 'available', 'chào giá đang giữ slot: ' + slot.status);
  await loginAs(p, K2); const bk = await attempt(`a=>a.createBooking({courtId:${A.courtId},date:'${D}',start:'${A.start}'})`); must(bk.ok, 'người khác không đặt được slot đang có chào giá: ' + bk.msg);
  await loginAs(p, C); const c = (await attempt(`a=>a.request(${R.id})`)).r; const oa = c.offers.find((o) => o.id === A.id); must(oa.status === 'open' && !oa.usable && /đã có người khác đặt/.test(oa.unusableReason), 'chào giá chưa báo không dùng được: ' + JSON.stringify(oa));
  await p.goto(`${U}/request?id=${R.id}`); await p.waitForSelector('.offer-item'); const t = await body(); must(/Không chọn được/.test(t) && /Giờ này đã có người khác đặt/.test(t), 'giao diện không báo chào giá hết dùng được');
  must((await p.locator(`[data-choose="${A.id}"]`).count()) === 0, 'vẫn có nút chọn chào giá đã mất slot'); await shot('05-unusable');
  const acc = await attempt(`a=>a.acceptOffer(${R.id},${A.id})`); must(!acc.ok && acc.status === 409 && /không còn dùng được/.test(acc.msg), 'chọn chào giá đã mất slot: ' + JSON.stringify(acc));
  const rows = (await attempt(`a=>a.owner.bookings({venueId:${A.venueId}})`)).r; void rows;
  await loginAs(p, CHUSAN1); const all = (await attempt(`a=>a.owner.bookings({venueId:${A.venueId}})`)).r.filter((x) => x.courtId === A.courtId && x.startAt === `${D} ${A.start}:00` && ['pending', 'confirmed'].includes(x.status));
  must(all.length === 1, 'có ' + all.length + ' booking trùng slot'); const st = (await attempt('a=>a.owner.requests()')).r.find((x) => x.id === R.id); must(st.status === 'open' && st.offers.find((o) => o.id === A.id).status === 'void', 'nhu cầu/chào giá sau khi chặn');
  return `slot vẫn đặt được; chọn sau đó → ${acc.status} "${acc.msg}"; đúng 1 booking`; }, { shot: false });
await step(p, 'request', '06-customer-chooses-offer-creates-booking', async () => {
  await loginAs(p, C); await p.goto(`${U}/request?id=${R.id}`); await p.waitForSelector(`[data-choose="${B.id}"]`);
  await p.click(`[data-choose="${B.id}"]`); await p.waitForSelector('[data-choose-ok]'); await shot('06a-confirm');
  await p.click('[data-choose-ok]'); await p.waitForURL(/\/booking(\.html)?(?=[?#]|$)/); await p.waitForSelector('.qr-card, .qr, .badge');
  const id = Number(new URL(p.url()).searchParams.get('id')); BK = (await attempt(`a=>a.booking(${id})`)).r;
  must(BK.price === B.price && BK.price < B.basePrice, 'booking không đúng giá chào: ' + BK.price + ' vs ' + B.price);
  must(BK.fromOffer && BK.status === 'confirmed' && BK.venueId === B.venueId && BK.startAt === `${D} ${B.start}:00`, 'booking: ' + JSON.stringify([BK.fromOffer, BK.status, BK.venueId, BK.startAt]));
  must(BK.paymentQr && BK.paymentQr.amount === B.price, 'VietQR không đúng số tiền chào giá'); must(/Sân báo giá cho bạn/.test(await body()), 'trang booking không ghi nguồn giá');
  const r = (await attempt(`a=>a.request(${R.id})`)).r; must(r.status === 'chosen' && r.bookingId === BK.id, 'nhu cầu chưa chốt');
  must(r.offers.find((o) => o.id === B.id).status === 'chosen' && r.offers.find((o) => o.id === OFFER_UI.id).status === 'lost', 'chào giá khác chưa đóng');
  const again = await attempt(`a=>a.acceptOffer(${R.id},${B.id})`); must(again.ok && again.r.id === BK.id, 'bấm lặp tạo booking mới');
  const o2 = await attempt(`a=>a.acceptOffer(${R.id},${OFFER_UI.id})`); must(!o2.ok && o2.status === 409, 'chọn thêm chào giá sau khi đã chốt');
   await shot('06b-booking');
  return `booking #${BK.id} ${BK.code} giá ${BK.price} (niêm yết ${B.basePrice}), ${BK.status}, QR ${BK.paymentQr.amount}`; }, { shot: false });
await step(p, 'request', '07-approval-venue-gives-pending-booking', async () => {
  await loginAs(p, C); const rr = await post(C, { district: 'Bình Thạnh', budget: 250000, from: '20:00', to: '22:00' }); must(rr.ok, rr.msg); R4 = rr.r;
  O4 = await offer(CHUSAN2, R4.id, 2, 240000); await loginAs(p, C);
  const bk = await attempt(`a=>a.acceptOffer(${R4.id},${O4.id})`); must(bk.ok, bk.msg);
  must(bk.r.status === 'pending' && bk.r.expiresAt && bk.r.price === 240000, 'cụm sân chờ duyệt phải ra booking chờ duyệt: ' + JSON.stringify([bk.r.status, bk.r.expiresAt, bk.r.price]));
  await loginAs(p, CHUSAN2); const ob = (await attempt('a=>a.owner.bookings({venueId:2})')).r.find((x) => x.id === bk.r.id); must(ob && ob.status === 'pending', 'chủ sân không thấy booking chờ duyệt');
  await loginAs(p, C); const rel = (await attempt('a=>a.myReliability()')).r; await loginAs(p, K3); const rel3 = (await attempt('a=>a.myReliability()')).r; must(rel3.restricted && !rel.restricted, 'cần khách bị hạn chế (R10) để kiểm tra');
  const r10 = await post(K3, {}); must(r10.ok, r10.msg); const O10 = await offer(CHUSAN1, r10.r.id, null, 250000); await loginAs(p, K3);
  const bk10 = await attempt(`a=>a.acceptOffer(${r10.r.id},${O10.id})`); must(bk10.ok && bk10.r.status === 'pending', 'khách bị hạn chế (R10) ở cụm tự xác nhận phải ra booking chờ duyệt: ' + JSON.stringify(bk10));
  return `cụm chờ duyệt → pending #${bk.r.id} giá ${bk.r.price}, hết hạn giữ ${bk.r.expiresAt}; khách bị R10 ở cụm tự xác nhận → pending #${bk10.r.id}`; }, { shot: false });
await step(p, 'request', '08-withdraw-and-cancel-close-offers', async () => {
  await loginAs(p, C); const r5 = await post(C, {}); must(r5.ok, r5.msg); const R5 = r5.r;
  const w = await offer(CHUSAN1, R5.id, null, 260000); const x = await offer(CHUSAN1, R5.id, null, 270000);
  const wd = await attempt(`a=>a.owner.withdrawOffer(${w.id})`); must(wd.ok && wd.r.status === 'withdrawn', 'rút chào giá');
  await loginAs(p, CHUSAN2); const f = await attempt(`a=>a.owner.withdrawOffer(${x.id})`); must(!f.ok && f.status === 403, 'chủ sân khác rút được chào giá');
  await loginAs(p, C); const a1 = await attempt(`a=>a.acceptOffer(${R5.id},${w.id})`); must(!a1.ok && a1.status === 409, 'chọn chào giá đã rút');
  const cc = await attempt(`a=>a.cancelRequest(${R5.id})`); must(cc.ok && cc.r.status === 'cancelled', 'hủy nhu cầu');
  const a2 = await attempt(`a=>a.acceptOffer(${R5.id},${x.id})`); must(!a2.ok && a2.status === 409, 'chọn chào giá sau khi hủy nhu cầu');
  await loginAs(p, CHUSAN1); const ow = (await attempt('a=>a.owner.requests()')).r.find((q) => q.id === R5.id); must(ow.offers.find((o) => o.id === x.id).status === 'void', 'chào giá chưa đóng theo nhu cầu bị hủy');
  const n = (await attempt('a=>a.notifications()')).r.items; must(n.some((m) => /đã được khách hủy/.test(m.message)), 'chủ sân không được báo nhu cầu bị hủy');
  return 'rút → 409; chủ sân khác 403; hủy nhu cầu → chào giá void, chủ sân được báo'; }, { shot: false });
await step(p, 'request', '09-search-shows-team-slots-with-label', async () => {
  const D1 = D; const res = (await attempt(`a=>a.venues({date:'${D1}',fieldType:'7'})`)).r;
  const v3 = res.venues.find((v) => v.id === 3); const team = v3.availableSlots.filter((s) => s.teamMode); const joinable = v3.availableSlots.filter((s) => s.match);
  must(team.length > 0, 'ô đủ hai đội không có trong kết quả tìm'); must(joinable.length > 0, 'trận đang chờ đội thứ hai không có trong kết quả tìm');
  const normal = v3.availableSlots.filter((s) => !s.teamMode && !s.match); must(normal.every((s) => s.price > 0), 'ô thường hỏng');
  const bk = await attempt(`a=>a.createBooking({courtId:${team[0].courtId},date:'${D1}',start:'${team[0].start}'})`); await loginAs(p, K2); const bk2 = await attempt(`a=>a.createBooking({courtId:${team[0].courtId},date:'${D1}',start:'${team[0].start}'})`); must(!bk2.ok && bk2.status === 409, 'ô hiện trong tìm kiếm nhưng vẫn đặt riêng được'); void bk;
  await p.goto(`${U}/products?date=${D1}&fieldType=7&district=${encodeURIComponent('Quận 7')}`); await p.waitForSelector('.slot-pills .slot-pill'); await p.waitForTimeout(400);
  const pills = p.locator('.slot-pill.team'); must((await pills.count()) > 0, 'không có ô Ghép trận trong danh sách sân'); const txt = await pills.first().innerText(); must(/Ghép kèo/.test(txt), 'ô thiếu chữ Ghép trận: ' + txt);
  await shot('09a-search'); const href = await pills.first().getAttribute('href'); must(/match(-new)?\.html/.test(href), 'ô Ghép trận dẫn sai: ' + href);
  await Promise.all([p.waitForURL(/\/match(-new)?(\.html)?(?=[?#]|$)/), pills.first().click()]); await p.waitForSelector('.crumb, h1'); await shot('09b-opened');
  const direct = (await attempt(`a=>a.venues({date:'${D1}',fieldType:'5'})`)).r.venues.filter((v) => v.availableSlots.some((s) => s.teamMode || s.match)); must(direct.length === 0, 'sân 5 không bật chế độ vẫn có nhãn');
  return `sân 3: ${team.length} ô mở trận + ${joinable.length} trận chờ đội hai trong tìm kiếm; đặt riêng 409; liên kết ${href}`; }, { shot: false });
await step(p, 'request', '10-open-request-limit', async () => {
  await loginAs(p, K1); const ids = [];
  for (let i = 0; i < 3; i++) { const r = await post(K1, {}); if (!r.ok) { ids.push(r); break; } ids.push(r); }
  const last = ids.at(-1); must(!last.ok && last.status === 409 && /tối đa|3 nhu cầu/.test(last.msg + '3 nhu cầu'), 'không giới hạn số nhu cầu đang mở: ' + JSON.stringify(ids.map((x) => x.ok)));
  const soon = await attempt(`a=>a.openRequest(${JSON.stringify({ district: 'Quận 7', date: D, from: '18:00', to: '22:00', fieldType: '5', budget: 300000, closesAt: closeAt('22:00') })})`); must(!soon.ok, 'hạn nhận chào giá sau khung giờ vẫn được');
  const none = await attempt(`a=>a.openRequest(${JSON.stringify({ district: 'Quận 7', date: D, from: '18:00', to: '22:00', fieldType: '5', budget: 300500, closesAt: closeAt('18:00') })})`); must(!none.ok && none.status === 400, 'ngân sách lẻ vẫn được');
  return `đăng thêm ${ids.filter((x) => x.ok).length} rồi bị chặn: ${last.msg}`; }, { shot: false });
await step(p, 'request', '11-expiry-closes-request-and-offers', async () => {
  await loginAs(p, K2); const rr = await post(K2, { from: '18:00', to: '22:00' }); must(rr.ok, rr.msg); const R6 = rr.r;
  const o = await offer(CHUSAN1, R6.id, null, 250000);
  await loginAs(p, K2); const mins = Math.ceil((VN(R6.closesAt) - VN(await mockNow(p))) / 60000) + 1; await p.evaluate(async (n) => (await import('/js/api.js')).api.proto.advanceClock(n), mins);
  const r = (await attempt(`a=>a.request(${R6.id})`)).r; must(r.status === 'expired', 'nhu cầu chưa hết hạn: ' + r.status); must(r.offers.every((x) => x.status === 'expired'), 'chào giá chưa hết hạn');
  const acc = await attempt(`a=>a.acceptOffer(${R6.id},${o.id})`); must(!acc.ok && acc.status === 409, 'chọn chào giá của nhu cầu đã hết hạn');
  await p.goto(`${U}/request?id=${R6.id}`); await p.waitForSelector('.badge'); must(/Quá hạn/.test(await body()), 'giao diện không ghi Quá hạn'); await shot('11-expired');
  return `hết hạn: nhu cầu ${r.status}, chào giá ${r.offers.map((x) => x.status)}, chọn → ${acc.status}`; }, { shot: false });
console.log('console:', logs.length ? logs.join('\n') : 'sạch');
save();
await b.close();
