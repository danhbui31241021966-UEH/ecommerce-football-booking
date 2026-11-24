// Sân demo gắn tài khoản nhận tiền thật (TPBank): QR trên trang thanh toán là ảnh VietQR thật, đúng số tiền và nội dung là mã đơn.
// Hai sân của hai chủ khác nhau dùng chung tài khoản: tiền báo về phải ghi cho đúng sân và đúng chủ của đơn.
import { start, step, save, api, anchor, loginAs, U, logs } from './lib.mjs';
const { b, p } = await start();
const must = (c, m) => { if (!c) throw new Error(m); };
const REAL = { bin: '970423', account: '10002544163', accountName: 'NGUYEN THANH DAT' };
const HOANG_GIA = 2, THANH_PHAT = 1;

// Ô trống đầu tiên của sân trong ngày mai (đủ xa để không dính giờ đã qua).
async function freeSlot(venueId) {
  const day = (await api(p, 'a=>a.meta()')).now.slice(0, 10);
  const date = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const sc = await api(p, `a=>a.schedule(${venueId}, '${date}')`);
  for (const c of sc.courts) { const s = c.slots.find((x) => x.status === 'available'); if (s) return { courtId: c.id, date, start: s.start }; }
  throw new Error('không còn ô trống ở sân ' + venueId);
}
async function book(venueId) {
  const slot = await freeSlot(venueId);
  const r = await api(p, `a=>a.createBooking(${JSON.stringify(slot)})`);
  return (r.booking || r);
}
async function checkQr(bk) {
  await p.goto(`${U}/booking.html?id=${bk.id}`); await p.waitForSelector('.qr-card img');
  const src = await p.locator('.qr-card img').first().getAttribute('src');
  const u = new URL(src);
  must(u.host === 'img.vietqr.io' && u.pathname === `/image/${REAL.bin}-${REAL.account}-compact2.svg`, 'QR không trỏ tài khoản thật: ' + src);
  const d = await api(p, `a=>a.booking(${bk.id})`); const due = (d.booking || d).paymentQr?.amount;
  must(u.searchParams.get('amount') === String(due) && u.searchParams.get('addInfo') === bk.code && u.searchParams.get('accountName') === REAL.accountName, 'tham số QR: ' + u.search);
  const res = await fetch(src);
  must(res.status === 200 && /svg/.test(res.headers.get('content-type') || ''), `ảnh QR trả ${res.status} ${res.headers.get('content-type')}`);
  return { src, due };
}

let hg, tp;
await step(p, 'realqr', '00-reset', async () => { await anchor(p, '08:00'); }, { shot: false });
await step(p, 'realqr', '01-hoang-gia-approved-shows-real-qr', async () => {
  await loginAs(p, 'khach1@datsan.local'); hg = await book(HOANG_GIA);
  await loginAs(p, 'chusan2@datsan.local'); await api(p, `a=>a.owner.approve(${hg.id})`);
  await loginAs(p, 'khach1@datsan.local'); const q = await checkQr(hg); hg.due = q.due;
  return `${hg.code} ${q.src.replace('https://img.vietqr.io', '')}`;
}, { full: true });
await step(p, 'realqr', '02-thanh-phat-shows-real-qr', async () => {
  tp = await book(THANH_PHAT); const q = await checkQr(tp); tp.due = q.due;
  return `${tp.code} amount=${q.due}`;
}, { shot: false });
await step(p, 'realqr', '03-shared-account-credits-the-right-owner', async () => {
  for (const [bk, tx] of [[hg, 'RQHG'], [tp, 'RQTP']]) {
    await api(p, `a=>a.proto.bankReport({ txId: '${tx}${Date.now()}', amount: ${bk.due}, content: '${bk.code}', account: '${REAL.account}' })`);
  }
  await loginAs(p, 'chusan2@datsan.local');
  const ev2 = (await api(p, 'a=>a.owner.bankEvents()')); const list2 = ev2.events || ev2;
  must(list2.some((e) => e.bookingCode === hg.code && e.status === 'matched'), 'chủ Hoàng Gia không thấy tiền của ' + hg.code);
  must(!list2.some((e) => e.bookingCode === tp.code), 'chủ Hoàng Gia thấy nhầm tiền của ' + tp.code);
  await loginAs(p, 'chusan1@datsan.local');
  const ev1 = (await api(p, 'a=>a.owner.bankEvents()')); const list1 = ev1.events || ev1;
  must(list1.some((e) => e.bookingCode === tp.code && e.status === 'matched'), 'chủ Thành Phát không thấy tiền của ' + tp.code);
  must(!list1.some((e) => e.bookingCode === hg.code), 'chủ Thành Phát thấy nhầm tiền của ' + hg.code);
  return 'mỗi chủ sân chỉ thấy tiền của đơn mình';
}, { shot: false });
if (logs.length) console.log('LOGS', logs.join(' | '));
save(); await b.close();
