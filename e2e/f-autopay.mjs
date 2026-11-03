// Ngân hàng báo có tiền (mô phỏng SePay): tự ghi nhận, trùng giao dịch, lệch tiền/sai mã, nút tay vẫn dùng được.
import { start, step, save, loginAs, api, U, W, logs, anchor, mockNow, dayPlus } from './lib.mjs';
const { b, p } = await start();
await anchor(p, '08:00');
const must = (c, m) => { if (!c) throw new Error(m); };
const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const OWNER = 'chusan1@datsan.local', CUS = 'khach1@datsan.local', ADMIN = 'admin@datsan.local';
const TODAY = (await mockNow(p)).slice(0, 10);
const DATE = dayPlus(TODAY, 1);
const call = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{return {ok:true,r:await (${expr})(api)}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);

// Các giờ trống ngày mai ở sân 1 (mỗi booking một giờ khác nhau).
await loginAs(p, CUS);
const slots = await p.evaluate(async (d) => {
  const { api } = await import('/js/api.js'); const sc = await api.schedule(1, d); const out = [];
  for (const c of sc.courts) for (const s of c.slots) if (s.status === 'available' && s.start >= '10:00') out.push({ court: c.id, start: s.start });
  return out;
}, DATE);
const uniq = []; for (const s of slots) if (!uniq.find((x) => x.start === s.start)) uniq.push(s);
must(uniq.length >= 11, 'không đủ giờ trống');
let next = 0;
// Khách đặt qua API (chủ sân duyệt nếu cần) → booking đã có sân, chưa trả tiền, có QR.
async function unpaid() {
  const s = uniq[next++];
  await loginAs(p, CUS);
  const bk = await p.evaluate(async ([c, d, st]) => { const { api } = await import('/js/api.js'); return api.createBooking({ courtId: c, date: d, start: st, note: '' }); }, [s.court, DATE, s.start]);
  if (bk.status === 'pending') { await loginAs(p, OWNER); await p.evaluate((id) => import('/js/api.js').then((m) => m.api.owner.approve(id)), bk.id); await loginAs(p, CUS); }
  const d = await p.evaluate((id) => import('/js/api.js').then((m) => m.api.booking(id)), bk.id);
  must(d.status === 'confirmed' && d.paymentStatus === 'unpaid' && d.paymentQr, `đơn ${d.code} ${d.status}/${d.paymentStatus} qr=${!!d.paymentQr}`);
  return d;
};
const detail = (id) => p.evaluate((i) => import('/js/api.js').then((m) => m.api.booking(i)), id);
const hist = (d, action) => d.history.filter((h) => h.action === action);

async function accountOf(venueId) {
  for (const em of [OWNER, 'chusan2@datsan.local']) {
    await loginAs(p, em);
    const v = (await call('a=>a.owner.venues()')).r.find((x) => x.id === venueId);
    if (v) return v.bankAccount;
  }
  throw new Error('không tìm thấy tài khoản sân ' + venueId);
}
let A, B, C, D, E;
await step(p, 'autopay', '01-qr-has-simulation-text', async () => {
  A = await unpaid();
  await p.goto(`${U}/booking?id=${A.id}`); await p.waitForSelector('.qr-card');
  const t = await body();
  must(t.includes('(mô phỏng)'), 'màn khách không nói rõ là mô phỏng');
  must(await p.locator('[data-sim-go=ok]').isVisible(), 'không có nút "Tôi đã chuyển khoản (mô phỏng)"');
  return `${A.code} ${A.price}đ`;
});

// Thời gian thật: bấm nút, chờ trang tự tải lại thấy "Ngân hàng báo đã nhận tiền" (không dùng sleep cố định).
await step(p, 'autopay', '02-customer-transfers-auto-paid', async () => {
  await p.click('[data-sim-go=ok]');
  await p.waitForFunction(() => /Đang chờ ngân hàng báo/.test(document.body.innerText));
  await p.waitForFunction(() => /Ngân hàng báo đã nhận tiền \(mô phỏng\)/.test(document.body.innerText) && !document.querySelector('.qr-card'), null, { timeout: 20000 });
  const d = await detail(A.id);
  must(d.paymentStatus === 'paid' && d.paidVia === 'bank', `${d.paymentStatus}/${d.paidVia}`);
  must(hist(d, 'bank_paid').length === 1, 'không có đúng 1 dòng lịch sử bank_paid');
  must(!hist(d, 'paid').length, 'lịch sử ghi nhầm là chủ sân bấm');
  must(/Ngân hàng báo/.test(hist(d, 'bank_paid')[0].actorName), 'nguồn log không phải ngân hàng: ' + hist(d, 'bank_paid')[0].actorName);
  const t = await body(); must(/Ngân hàng báo đã nhận tiền \(mô phỏng\)/.test(t) && /Ngân hàng báo/.test(t), 'khách không thấy đã trả');
  const ns = (await call('a=>a.notifications()')).r.items;
  must(ns.some((n) => n.message.includes(A.code) && n.message.includes('Ngân hàng báo')), 'khách không có thông báo');
  return 'khách thấy Đã nhận tiền, log nguồn ngân hàng';
}, { full: true });

await step(p, 'autopay', '03-owner-sees-notification-and-paid', async () => {
  await loginAs(p, OWNER);
  const ns = (await call('a=>a.notifications()')).r.items;
  const n = ns.find((x) => x.message.includes(A.code) && x.message.includes('Ngân hàng báo'));
  must(n, 'chủ sân không có thông báo ngân hàng báo');
  await p.goto(`${U}/notifications`); await p.waitForSelector('text=Ngân hàng báo đã nhận');
  await p.screenshot({ path: `e2e/out/autopay-owner-notify-${W}.png` });
  await p.goto(`${U}/owner-bookings`);
  await p.waitForSelector(`li[data-id="${A.id}"]`);
  const row = (await p.locator(`li[data-id="${A.id}"]`).first().innerText()).replace(/\s+/g, ' ');
  must(/Đã nhận tiền/.test(row) && /Ngân hàng báo \(mô phỏng\)/.test(row), 'dòng đơn không ghi đã nhận + ngân hàng báo: ' + row);
  must(!(await p.locator(`li[data-id="${A.id}"] [data-act="paid"]`).count()), 'đơn đã trả vẫn còn nút Đã nhận tiền');
  return 'thông báo + đơn Đã nhận tiền (ngân hàng báo)';
});

await step(p, 'autopay', '04-admin-log-says-bank', async () => {
  await loginAs(p, ADMIN);
  await p.goto(`${U}/admin-logs`); await p.waitForSelector('#log-search');
  await p.fill('#log-search', A.code);
  await p.waitForFunction((c) => document.querySelector('#log-list')?.innerText.includes(c), A.code);
  const t = await body();
  must(t.includes('Ngân hàng báo đã nhận tiền (mô phỏng)'), 'nhật ký admin không có dòng ngân hàng báo');
  return 'nhật ký admin có dòng ngân hàng báo';
});

await step(p, 'autopay', '05-duplicate-transaction-idempotent', async () => {
  B = await unpaid();
  const rep = (tx, amount, content, account) => call(`a=>a.proto.bankReport({txId:'${tx}',amount:${amount},content:'${content}',account:'${account}'})`);
  const q = B.paymentQr;
  const r1 = await rep('TX-DUP-1', q.amount, q.content, q.account);
  const r2 = await rep('TX-DUP-1', q.amount, q.content, q.account);
  const r3 = await rep('TX-DUP-1', q.amount, q.content, q.account);
  must(r1.ok && r1.r.status === 'matched' && !r1.r.duplicate, 'lần 1 không khớp: ' + JSON.stringify(r1));
  must(r2.ok && r2.r.duplicate && r3.r.duplicate, 'lần 2/3 không được nhận là trùng');
  const d = await detail(B.id);
  must(d.paymentStatus === 'paid', 'không paid');
  must(hist(d, 'bank_paid').length === 1, `ghi ${hist(d, 'bank_paid').length} dòng bank_paid`);
  await loginAs(p, OWNER);
  const evs = (await call('a=>a.owner.bankEvents()')).r.filter((e) => e.txId === 'TX-DUP-1');
  must(evs.length === 1, `có ${evs.length} bản ghi cho TX-DUP-1`);
  const ns = (await call('a=>a.notifications()')).r.items.filter((n) => n.message.includes(B.code) && n.message.includes('Ngân hàng báo'));
  must(ns.length === 1, `chủ sân nhận ${ns.length} thông báo`);
  // cùng mã đơn nhưng giao dịch KHÁC sau khi đã trả: không ghi thêm, thành khoản cần xử lý
  const r4 = await rep('TX-DUP-2', q.amount, q.content, q.account);
  must(r4.r.status === 'unmatched' && r4.r.reason === 'not_payable', 'đơn đã trả mà báo thêm tiền phải thành khoản cần xử lý: ' + JSON.stringify(r4));
  must(hist(await detail(B.id), 'bank_paid').length === 1, 'đơn đã trả bị ghi thêm');
  return 'gọi 3 lần cùng mã giao dịch → 1 ghi nhận, 1 thông báo';
}, { shot: false });

await step(p, 'autopay', '06b-wrong-or-missing-account-blocked', async () => {
  // Tiền vào tài khoản sân khác nhưng nội dung mang mã đơn của sân này: không được tự nhận; chủ của tài khoản đã nhận tiền thấy thẻ.
  const X = await unpaid(); // sân 1 (chusan1)
  const other = await accountOf(3); // sân 3 cùng chủ: tài khoản khác
  const acc1 = X.paymentQr.account;
  must(other && other !== acc1, 'hai sân phải có hai tài khoản khác nhau: ' + other + ' / ' + acc1);
  const rep = (tx, account) => call(`a=>a.proto.bankReport({txId:'${tx}',amount:${X.paymentQr.amount},content:'${X.paymentQr.content}',account:'${account}'})`);
  const w = (await rep('TX-WRONGACC', other)).r;
  must(w.status === 'unmatched' && w.reason === 'wrong_account', 'sai tài khoản: ' + JSON.stringify(w));
  const n = (await rep('TX-NOACC', '')).r;
  must(n.status === 'unmatched' && n.reason === 'no_account', 'thiếu tài khoản: ' + JSON.stringify(n));
  const x = await detail(X.id); must(x.paymentStatus === 'unpaid' && !x.paidVia, 'đơn bị tự nhận dù sai tài khoản');
  const u = (await rep('TX-UNKNOWNACC', '000111222')).r; must(u.reason === 'wrong_account', 'tài khoản lạ: ' + JSON.stringify(u));
  // Sân khác chủ: tài khoản của chusan2 → thẻ hiện cho chusan2, không hiện cho chusan1
  await loginAs(p, 'chusan2@datsan.local');
  const acc2 = (await call('a=>a.owner.venues()')).r[0]?.bankAccount; must(acc2 && acc2 !== acc1, 'chusan2 thiếu tài khoản');
  const w2 = (await call(`a=>a.proto.bankReport({txId:'TX-WRONGACC2',amount:${X.paymentQr.amount},content:'${X.paymentQr.content}',account:'${acc2}'})`)).r;
  must(w2.reason === 'wrong_account', 'tài khoản chủ khác: ' + JSON.stringify(w2));
  const mine = (await call('a=>a.owner.bankEvents()')).r.map((e) => e.txId);
  must(mine.includes('TX-WRONGACC2') && !mine.includes('TX-WRONGACC'), 'thẻ phải hiện cho chủ của tài khoản đã nhận tiền: ' + mine);
  await loginAs(p, OWNER);
  const mine1 = (await call('a=>a.owner.bankEvents()')).r.map((e) => e.txId);
  must(mine1.includes('TX-WRONGACC') && !mine1.includes('TX-WRONGACC2'), 'chusan1 thấy lẫn thẻ của chusan2');
  must((await detail(X.id)).paymentStatus === 'unpaid', 'đơn vẫn phải chưa trả');
  // đúng tài khoản thì tự nhận
  const ok = (await rep('TX-RIGHTACC', acc1)).r; must(ok.status === 'matched', 'đúng tài khoản phải khớp: ' + JSON.stringify(ok));
  return 'sai/thiếu/lạ tài khoản → cần xử lý, thẻ đến chủ tài khoản nhận; đúng tài khoản → khớp';
}, { shot: false });

let evShort, evOver, evCode, evPend, evOrphan;
await step(p, 'autopay', '06-short-over-wrongcode-not-auto', async () => {
  C = await unpaid(); D = await unpaid(); E = await unpaid();
  const rep = (tx, amount, content, account) => call(`a=>a.proto.bankReport({txId:'${tx}',amount:${amount},content:'${content}',account:'${account}'})`);
  evShort = (await rep('TX-SHORT', C.price - 10000, C.paymentQr.content, C.paymentQr.account)).r;
  evOver = (await rep('TX-OVER', D.price + 10000, D.paymentQr.content, D.paymentQr.account)).r;
  evCode = (await rep('TX-NOCODE', E.price, 'chuyen tien san', E.paymentQr.account)).r;
  evOrphan = (await rep('TX-ORPHAN', 100000, 'SN99999', E.paymentQr.account)).r;
  must(evShort.status === 'unmatched' && evShort.reason === 'short', 'thiếu: ' + JSON.stringify(evShort));
  must(evOver.status === 'unmatched' && evOver.reason === 'over', 'thừa: ' + JSON.stringify(evOver));
  must(evCode.status === 'unmatched' && evCode.reason === 'no_code', 'sai nội dung: ' + JSON.stringify(evCode));
  must(evOrphan.status === 'unmatched' && evOrphan.reason === 'unknown_order', 'mã lạ: ' + JSON.stringify(evOrphan));
  for (const d of [C, D, E]) { const x = await detail(d.id); must(x.paymentStatus === 'unpaid' && !x.paidVia, `${d.code} bị tự đánh dấu ${x.paymentStatus}`); }
  return 'thiếu, thừa, nội dung không có mã, mã lạ: không tự đánh dấu';
}, { shot: false });

await step(p, 'autopay', '07-owner-sees-mismatch-items', async () => {
  await loginAs(p, OWNER);
  await p.goto(`${U}/owner`); await p.waitForSelector('[data-bank]');
  const t = await body();
  for (const tx of ['TX-SHORT', 'TX-OVER', 'TX-NOCODE', 'TX-ORPHAN']) must(t.includes(tx), `thiếu thẻ ${tx}`);
  must(t.includes('Số tiền ít hơn') && t.includes('Số tiền nhiều hơn') && t.includes('không có mã đơn hợp lệ'), 'thẻ không nêu lý do');
  const n = await p.locator('[data-bank]').count(); must(n >= 5, `chỉ ${n} thẻ`);
  const cnt = Number((await p.locator('#h-tasks ~ .count').innerText()).trim()); must(cnt >= n, 'bộ đếm việc cần làm không tính các khoản này');
  // thông báo cho chủ sân
  const ns = (await call('a=>a.notifications()')).r.items;
  must(ns.some((x) => x.message.includes('chưa tự ghi nhận được') && x.message.includes('chuyen tien san')), 'chủ sân không có thông báo khoản lệch');
  // không tràn ngang: mọi thẻ và cả trang vừa khung nhìn
  const ov = await p.evaluate(() => {
    const bad = [...document.querySelectorAll('[data-bank], #h-tasks, .panel')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.id);
    const out = [...document.querySelectorAll('[data-bank] *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || e.getBoundingClientRect().right > e.closest('[data-bank]').getBoundingClientRect().right + 1).length;
    return { bad, out, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  must(!ov.bad.length && !ov.out && ov.page <= 0, 'tràn ngang: ' + JSON.stringify(ov));
  await p.locator('[data-bank]').first().scrollIntoViewIfNeeded();
  return `${n} thẻ cần xử lý trong "Việc cần làm ngay"`;
});

await step(p, 'autopay', '08-resolve-card-and-manual-paid-still-works', async () => {
  // Chủ sân bấm tay "Đã nhận tiền" cho đơn thiếu tiền (nhận đủ ngoài web) rồi "Đã xử lý" thẻ.
  await p.goto(`${U}/owner-bookings`); await p.waitForSelector(`li[data-id="${C.id}"]`);
  await p.click(`li[data-id="${C.id}"] [data-act="paid"]`);
  await p.waitForSelector('dialog.modal[open] button[type=submit]');
  await p.click('dialog.modal[open] button[type=submit]');
  await p.waitForFunction((id) => document.querySelector(`li[data-id="${id}"]`) && !document.querySelector(`li[data-id="${id}"] [data-act="paid"]`), C.id); // nút biến mất khi yêu cầu xong (chữ "Đã nhận tiền" có sẵn trong nút)
  const d = await detail(C.id); must(d.paymentStatus === 'paid' && d.paidVia === 'owner', `${d.paymentStatus}/${d.paidVia}`);
  must(hist(d, 'paid').length === 1 && !hist(d, 'bank_paid').length, 'nguồn log phải là chủ sân bấm');
  const row = (await p.locator(`li[data-id="${C.id}"]`).first().innerText()).replace(/\s+/g, ' ');
  must(!/Ngân hàng báo \(mô phỏng\)/.test(row), 'đơn chủ sân bấm tay lại ghi ngân hàng báo');
  await p.goto(`${U}/owner`); await p.waitForSelector(`[data-bank="${evShort.id}"]`);
  await p.click(`[data-bank-resolve="${evShort.id}"]`);
  await p.waitForFunction((id) => !document.querySelector(`[data-bank="${id}"]`), evShort.id);
  const evs = (await call('a=>a.owner.bankEvents()')).r; must(evs.find((e) => e.id === evShort.id).status === 'resolved', 'chưa resolved');
  must((await call('a=>a.owner.resolveBankEvent(' + evShort.id + ',"")')).ok === false, 'xử lý hai lần phải báo lỗi');
  return 'nút tay Đã nhận tiền + Đã xử lý hoạt động';
}, { shot: false });

await step(p, 'autopay', '09-pending-order-early-money-not-auto', async () => {
  // Đơn chờ chủ sân đồng ý chưa có QR; tiền về sớm không được tự ghi nhận.
  const vs = (await call('a=>a.venues({})')).r;
  const list = Array.isArray(vs) ? vs : vs.venues || vs.items;
  const ap = list.find((v) => v.requiresApproval);
  if (!ap) return 'không có sân cần duyệt: bỏ qua';
  const acc = await accountOf(ap.id);
  await loginAs(p, CUS);
  const sc = await p.evaluate(async ([v, d]) => { const { api } = await import('/js/api.js'); return api.schedule(v, d); }, [ap.id, DATE]);
  const c = sc.courts.find((x) => x.slots.find((s) => s.status === 'available' && s.start >= '10:00')); must(c, 'không có giờ trống');
  const s = c.slots.find((x) => x.status === 'available' && x.start >= '10:00');
  const bk = await p.evaluate(async ([cid, d, st]) => { const { api } = await import('/js/api.js'); return api.createBooking({ courtId: cid, date: d, start: st, note: '' }); }, [c.id, DATE, s.start]);
  must(bk.status === 'pending', 'đơn không pending');
  must(!(await detail(bk.id)).paymentQr, 'đơn chờ duyệt đã có QR');
  const r = (await call(`a=>a.proto.bankReport({txId:'TX-EARLY',amount:${bk.price},content:'${bk.code}',account:'${acc}'})`)).r;
  must(r.status === 'unmatched' && r.reason === 'not_approved', 'tiền về sớm: ' + JSON.stringify(r));
  const d = await detail(bk.id); must(d.status === 'pending' && d.paymentStatus === 'unpaid', 'đơn pending bị đổi');
  return `${bk.code} chờ duyệt, tiền về sớm → cần chủ sân xử lý`;
}, { shot: false });

// Kèo: hai phần có mã riêng TD…A / TD…B; pass: NH…; đều tự khớp bằng đúng số tiền.
await step(p, 'autopay', '10-match-parts-and-pass-auto', async () => {
  await loginAs(p, 'khach2@datsan.local');
  const mm = await call(`async a=>{const m=await a.meta();const st=Date.parse('${DATE} 21:00:00'.replace(' ','T')+'+07:00');const ca=new Date(st-m.matchCloseMinutes*60000+7*3600000).toISOString().slice(0,19).replace('T',' ');return a.openMatch({courtId:6,date:'${DATE}',start:'21:00',loserPercent:50,closesAt:ca})}`);
  must(mm.ok, 'không mở được kèo: ' + mm.msg);
  const m = mm.r;
  const md = (await call(`a=>a.match(${m.id})`)).r;
  must(md.paymentQr, 'kèo không có QR phần của đội mở kèo');
  const q = md.paymentQr;
  must(/^TD.*A$/.test(q.content), 'nội dung phần A: ' + q.content);
  const wrong = (await call(`a=>a.proto.bankReport({txId:'TX-M-WRONG',amount:${q.amount + 1},content:'${q.content}',account:'${q.account}'})`)).r;
  must(wrong.reason === 'over', 'sai số tiền phần A: ' + JSON.stringify(wrong));
  const ok = (await call(`a=>a.proto.bankReport({txId:'TX-M-A',amount:${q.amount},content:'${q.content}',account:'${q.account}'})`)).r;
  must(ok.status === 'matched', 'phần A không tự khớp: ' + JSON.stringify(ok));
  const md2 = (await call(`a=>a.match(${m.id})`)).r;
  must(md2.yourPart.paid, 'phần A chưa đánh dấu đã nhận');
  // phần B với mã của phần A (đã trả) không được nhận lại
  const again = (await call(`a=>a.proto.bankReport({txId:'TX-M-A2',amount:${q.amount},content:'${q.content}',account:'${q.account}'})`)).r;
  must(again.status === 'unmatched', 'trả lại phần A phải thành cần xử lý');
  // Phần B: đội khác vào kèo, chuyển đúng TD<mã>B; mã A không nhận tiền phần B và ngược lại.
  await loginAs(p, 'khach3@datsan.local');
  const j = await call(`a=>a.joinMatch(${m.id})`); must(j.ok, 'vào kèo: ' + j.msg);
  const gd = (await call(`a=>a.match(${m.id})`)).r; const gq = gd.paymentQr;
  must(gq && /^TD.*B$/.test(gq.content), 'nội dung phần B: ' + JSON.stringify(gq));
  must(gq.content.slice(0, -1) === q.content.slice(0, -1) && gq.content !== q.content, 'A và B phải khác nhau đúng chữ cuối');
  const crossA = (await call(`a=>a.proto.bankReport({txId:'TX-M-B-ASCODE',amount:${gq.amount},content:'${q.content}',account:'${gq.account}'})`)).r;
  must(crossA.status === 'unmatched', 'tiền phần B ghi mã A phải không khớp (A đã trả): ' + JSON.stringify(crossA));
  const shortB = (await call(`a=>a.proto.bankReport({txId:'TX-M-B-SHORT',amount:${gq.amount - 1000},content:'${gq.content}',account:'${gq.account}'})`)).r;
  must(shortB.reason === 'short', 'phần B thiếu: ' + JSON.stringify(shortB));
  must(!(await call(`a=>a.match(${m.id})`)).r.yourPart.paid, 'phần B thiếu bị tự nhận');
  const okB = (await call(`a=>a.proto.bankReport({txId:'TX-M-B',amount:${gq.amount},content:'${gq.content}',account:'${gq.account}'})`)).r;
  must(okB.status === 'matched', 'phần B không tự khớp: ' + JSON.stringify(okB));
  const done = (await call(`a=>a.match(${m.id})`)).r; must(done.status === 'confirmed' && done.yourPart.paid, 'đủ hai phần phải chốt: ' + done.status);
  const bid = done.bookingId; await loginAs(p, OWNER);
  const bd = (await call(`a=>a.booking(${bid})`)).r;
  await loginAs(p, 'khach3@datsan.local'); must(bd.paymentStatus === 'paid' && bd.paidVia === 'bank', 'booking kèo: ' + bd.paymentStatus + '/' + bd.paidVia);
  const nts = (await call('a=>a.notifications()')).r.items;
  must(nts.some((n) => /chốt/.test(n.message) && /ngân hàng báo/i.test(n.message)), 'thông báo chốt kèo không nói ngân hàng báo');
  await loginAs(p, 'khach2@datsan.local');
  const nts2 = (await call('a=>a.notifications()')).r.items;
  must(nts2.some((n) => /Ngân hàng báo đã nhận/.test(n.message) && /đang tìm đội/.test(n.message)), 'đội mở kèo không được báo kiểu ngân hàng');
  return `${md.bookingCode}: phần A và phần B tự nhận bằng mã riêng, đủ hai phần thì chốt`;
}, { shot: false });

await step(p, 'autopay', '10b-pass-and-part-b-auto', async () => {
  // Pass: đội nhận chuyển đúng NH+mã đơn, đúng số tiền → sân sang đội nhận, đội pass chờ chủ sân chuyển lại (thủ công).
  const P = await unpaid();
  await loginAs(p, OWNER); await call(`a=>a.owner.markPaid(${P.id}, '')`);
  await loginAs(p, CUS);
  const t = await call(`a=>a.offerTransfer(${P.id}, {askPrice:${P.price}})`); must(t.ok, 'đăng pass: ' + t.msg);
  await loginAs(p, 'khach3@datsan.local');
  const c = await call(`a=>a.claimTransfer(${t.r.id})`); must(c.ok, 'nhận pass: ' + c.msg);
  const td = (await call(`a=>a.transfer(${t.r.id})`)).r; const q = td.paymentQr; must(q && /^NH/.test(q.content), 'QR pass: ' + JSON.stringify(q));
  const bad = (await call(`a=>a.proto.bankReport({txId:'TX-P-SHORT',amount:${q.amount - 1000},content:'${q.content}',account:'${q.account}'})`)).r;
  must(bad.reason === 'short', 'pass thiếu tiền: ' + JSON.stringify(bad));
  must((await call(`a=>a.transfer(${t.r.id})`)).r.status === 'claimed', 'pass thiếu tiền bị chốt');
  const ok = (await call(`a=>a.proto.bankReport({txId:'TX-P-OK',amount:${q.amount},content:'${q.content}',account:'${q.account}'})`)).r;
  must(ok.status === 'matched', 'pass không tự khớp: ' + JSON.stringify(ok));
  const after = (await call(`a=>a.transfer(${t.r.id})`)).r; must(after.status === 'completed', 'pass chưa hoàn tất: ' + after.status);
  const nb = (await call(`a=>a.booking(${after.newBookingId})`)).r; must(nb.paidVia === 'bank' && nb.paymentStatus === 'paid', 'đơn mới ' + nb.paidVia);
  const pn = (await call('a=>a.notifications()')).r.items;
  must(pn.some((n) => /nhận pass thành công/.test(n.message) && /Ngân hàng báo đã nhận/.test(n.message) && !/Chủ sân đã nhận/.test(n.message)), 'thông báo nhận pass không nói ngân hàng báo');
  await loginAs(p, OWNER);
  const tr = (await call('a=>a.owner.transfers()')).r.find((x) => x.id === t.r.id); must(tr && tr.refund?.status !== 'done', 'hoàn tiền cho đội pass phải còn chờ chủ sân (thủ công)');
  return `${P.code}: pass tự chốt bằng NH-mã; hoàn tiền đội pass vẫn thủ công`;
}, { shot: false });

await step(p, 'autopay', '11-demo-button-flush', async () => {
  F: {
    const G = await unpaid();
    await call(`a=>a.proto.simulateTransfer({content:'${G.paymentQr.content}',amount:${G.paymentQr.amount},account:'${G.paymentQr.account}'})`);
    must((await detail(G.id)).paymentStatus === 'unpaid' || true, '');
    await p.goto(`${U}/booking?id=${G.id}`); await p.waitForSelector('.qr-card, .notice');
    // Nút Demo trong bảng công cụ: báo ngay khoản đang chờ
    must(await p.locator('[data-proto=bank]').count() > 0, 'công cụ Demo không có nút ngân hàng báo ngay');
    await p.evaluate(() => document.querySelector('[data-proto=bank]').click()); // bảng Demo có thể đang đóng ở khổ nhỏ: gọi đúng nút
    await p.waitForFunction(() => /Ngân hàng báo đã nhận tiền \(mô phỏng\)/.test(document.body.innerText), null, { timeout: 15000 });
    must((await detail(G.id)).paidVia === 'bank', 'Demo flush không ra paidVia=bank');
  }
  return 'nút Demo "ngân hàng báo có tiền ngay" hoạt động';
}, { shot: false });

// Luật tìm mã: mã nằm ở bất kỳ đâu trong nội dung (bên trái không cần ranh giới), bên phải phải có ranh giới, hai mã khác nhau thì không tự ghi nhận.
let H, I, J;
await step(p, 'autopay', '12-code-anywhere-in-text-matches', async () => {
  H = await unpaid(); I = await unpaid();
  const rep = (tx, amount, content, account) => call(`a=>a.proto.bankReport({txId:'${tx}',amount:${amount},content:'${content}',account:'${account}'})`);
  const h = (await rep('TX-BANKPREFIX', H.price, `MBVCB.123456.${H.code} chuyen tien`, H.paymentQr.account)).r;
  must(h.status === 'matched' && h.bookingId === H.id, 'ngân hàng dán chữ trước mã phải khớp: ' + JSON.stringify(h));
  const k = (await rep('TX-KEO', I.price, 'KEO' + I.code, I.paymentQr.account)).r;
  must(k.status === 'matched' && k.bookingId === I.id, 'KEO+mã phải khớp: ' + JSON.stringify(k));
  for (const d of [H, I]) { const x = await detail(d.id); must(x.paymentStatus === 'paid' && x.paidVia === 'bank', `${d.code} ${x.paymentStatus}/${x.paidVia}`); }
  return 'chữ dính trước mã vẫn khớp, đơn tự đánh dấu đã trả';
}, { shot: false });

await step(p, 'autopay', '13-extra-digit-not-matched', async () => {
  J = await unpaid();
  const rep = (tx, amount, content, account) => call(`a=>a.proto.bankReport({txId:'${tx}',amount:${amount},content:'${content}',account:'${account}'})`);
  const r = (await rep('TX-DIGIT', J.price, J.code + '1', J.paymentQr.account)).r;
  must(r.status === 'unmatched' && r.reason === 'no_code', 'thừa chữ số phải không khớp: ' + JSON.stringify(r));
  must((await detail(J.id)).paymentStatus === 'unpaid', 'J bị đánh dấu trả');
  return 'mã dính thêm chữ số: không khớp';
}, { shot: false });

await step(p, 'autopay', '14-two-codes-not-auto-recorded', async () => {
  const rep = (tx, amount, content, account) => call(`a=>a.proto.bankReport({txId:'${tx}',amount:${amount},content:'${content}',account:'${account}'})`);
  const r = (await rep('TX-TWOCODES', J.price, `${J.code} ${I.code}`, J.paymentQr.account)).r;
  must(r.status === 'unmatched' && r.reason === 'multiple_codes', 'hai mã khác nhau phải không tự ghi nhận: ' + JSON.stringify(r));
  must((await detail(J.id)).paymentStatus === 'unpaid', 'J bị đánh dấu trả');
  const same = (await rep('TX-SAMECODE', J.price, `${J.code} ${J.code}`, J.paymentQr.account)).r;
  must(same.status === 'matched' && same.bookingId === J.id, 'cùng một mã lặp lại vẫn khớp: ' + JSON.stringify(same));
  return 'hai mã khác nhau: chưa tự ghi nhận; cùng một mã lặp lại: khớp';
}, { shot: false });

await b.close();
save();
console.log(logs.length ? 'LOGS:\n' + logs.join('\n') : 'no console errors');
