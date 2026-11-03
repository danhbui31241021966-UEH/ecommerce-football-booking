// Ngân hàng báo có tiền (SePay, R17): webhook thật qua HTTP trên MySQL thật; không gọi SePay. Mỗi test dựng dữ liệu riêng.
process.env.SEPAY_API_KEY = 'test-sepay-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const bank = require('../src/services/bankOps');

const KEY = 'test-sepay-key';
const ACC = '0011223344';
let app;
let seq = 0;
let txn = 0;
let TODAY;
let DAY;
const stamp = (date, hm) => `${date} ${hm}`;

test.before(async () => {
  app = await h.startApp();
});
test.after(async () => {
  await app.close();
  await h.closeAll();
});
test.afterEach(async () => {
  assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
});

async function person(role = 'customer', name = 'Người thử') {
  seq += 1;
  const email = `b${seq}-${Date.now()}@test.local`;
  const u = await h.makeUser({ role, email, fullName: name });
  const a = app.agent();
  assert.equal((await a.post('/api/auth/login', { email, password: 'Matkhau@123' })).status, 200);
  return { ...u, email, fullName: name, a };
}

/** Một chủ sân, một cụm sân (tài khoản ACC, 2 sân con, ghép kèo 18–22h ở sân con 1) và hai khách. */
async function world({ approval = false } = {}) {
  await h.emptyData();
  slotNo = 0;
  TODAY = h.clock.today();
  DAY = h.tomorrow();
  h.setNow(stamp(TODAY, '09:00'));
  const owner = await person('owner', 'Chủ sân');
  const v = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 2, requiresApproval: approval ? 1 : 0 });
  await h.db.query("UPDATE venues SET bank_bin = '970436', bank_account = ?, bank_account_name = 'CHU SAN' WHERE id = ?", [ACC, v.venueId]);
  await h.db.query("UPDATE courts SET team_mode_enabled = 1, team_mode_from = '18:00', team_mode_to = '22:00' WHERE id = ?", [v.courtIds[0]]);
  return { owner, venueId: v.venueId, c1: v.courtIds[0], c2: v.courtIds[1], a: await person('customer', 'Khách A'), b: await person('customer', 'Khách B'), g: await person('customer', 'Khách G') };
}
let slotNo = 0;
/** Khách đặt một giờ ở sân con 2 (không ghép kèo): đơn confirmed + unpaid (hoặc pending khi sân cần duyệt). */
async function order(w, who = w.a) {
  const start = `${String(6 + slotNo++).padStart(2, '0')}:00`;
  const r = await who.a.post('/api/bookings', { courtId: w.c2, date: DAY, start });
  assert.equal(r.status, 201, r.text);
  return { id: r.body.id, code: r.body.code, price: r.body.price, status: r.body.status };
}

const post = async (body, key = KEY, extra = {}) => {
  const res = await fetch(`${app.base}/api/webhooks/sepay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { Authorization: `Apikey ${key}` }), ...extra },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
/** Giao dịch SePay: id tự tăng nếu không nêu; mặc định tiền vào tài khoản ACC. */
const tx = (content, amount, over = {}) => ({
  id: over.id ?? `T${Date.now()}${++txn}`, gateway: 'MBBank', transactionDate: stamp(TODAY, '09:00:00'), accountNumber: ACC, code: null,
  content, transferType: 'in', transferAmount: amount, accumulated: 0, subAccount: null, referenceCode: 'FT1', description: content, ...over,
});
const events = async (who) => (await who.a.get('/api/owner/bank-events')).body;
const row = (txId) => h.db.one('SELECT * FROM bank_transactions WHERE provider_tx_id = ?', [txId]);
const count = async (t, where = '1=1') => Number((await h.db.one(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`)).n);
const booking = (id) => h.db.one('SELECT * FROM bookings WHERE id = ?', [id]);
const hist = (id, action) => h.db.query('SELECT * FROM booking_history WHERE booking_id = ? AND action = ?', [id, action]);
const note = (userId, like) => count('notifications', `user_id = ${userId} AND message LIKE '%${like}%'`);

test('mã đơn tìm ở bất kỳ đâu trong nội dung; bên phải phải hết mã; dạng dài nhất thắng; hai mã khác nhau thì không đoán', () => {
  const p = bank.parseCodes;
  const booking = (code) => ({ kind: 'booking', code });
  assert.deepEqual(p('SN01238'), [booking('SN01238')]);
  assert.deepEqual(p('MBVCB.123456.SN01238 chuyen tien san'), [booking('SN01238')]);
  assert.deepEqual(p('KEOSN01238'), [booking('SN01238')]);
  assert.deepEqual(p('XSN01238'), [booking('SN01238')]);
  assert.deepEqual(p('chuyen sn01238 nhe'), [booking('SN01238')]);
  assert.deepEqual(p('SN01238.'), [booking('SN01238')]);
  assert.deepEqual(p('NHSN01238'), [{ kind: 'transfer', code: 'SN01238' }]);
  assert.deepEqual(p('abc NHSN01238 xyz'), [{ kind: 'transfer', code: 'SN01238' }]);
  assert.deepEqual(p('TDSN01238A'), [{ kind: 'match', code: 'SN01238', part: 'host' }]);
  assert.deepEqual(p('FT123 TDSN01238B tien kem'), [{ kind: 'match', code: 'SN01238', part: 'guest' }]);
  assert.deepEqual(p('KEOTDSN01238A'), [{ kind: 'match', code: 'SN01238', part: 'host' }]);
  // thừa chữ số: không phải mã (cũng không phải SN01238)
  assert.deepEqual(p('SN012381'), []);
  // hợp lệ trùng nhau chỉ tính một; khác loại, khác mã hoặc khác phần thì là nhiều mã
  assert.deepEqual(p('SN01238 SN01238'), [booking('SN01238')]);
  assert.equal(p('SN01238 SN01239').length, 2);
  assert.equal(p('TDSN01238A TDSN01238B').length, 2);
  assert.equal(p('SN01238 NHSN01238').length, 2);
  assert.equal(p('TDSN01238A SN01238').length, 2);
  // không phải mã
  for (const bad of ['SN01238X', 'SN01238AB', 'SN0123', 'TDSN01238', 'NHSN01238A', 'SN01238A', 'TD SN01238A', 'chuyen tien san', '', null, 'SN 01238', 'S N01238']) {
    assert.deepEqual(p(bad), [], String(bad));
  }
});

test('xác thực: sai/thiếu khóa → 401 và không ghi gì; chưa cấu hình khóa thì từ chối hết; chỉ nhận tiền vào', async () => {
  const w = await world();
  const o = await order(w);
  const body = tx(o.code, o.price);
  for (const [key, extra] of [[null, {}], ['sai-khoa', {}], ['', {}], [KEY + 'x', {}], [null, { Authorization: `Bearer ${KEY}` }], [null, { Authorization: KEY }]]) {
    const r = await post(body, key, extra);
    assert.equal(r.status, 401, `${key} ${JSON.stringify(extra)}`);
  }
  assert.equal(await count('bank_transactions'), 0);
  assert.equal((await booking(o.id)).paymentStatus, 'unpaid');
  const saved = process.env.SEPAY_API_KEY;
  delete process.env.SEPAY_API_KEY;
  try {
    assert.equal((await post(body, '')).status, 401, 'chưa cấu hình khóa');
    assert.equal((await post(body, 'undefined')).status, 401);
  } finally {
    process.env.SEPAY_API_KEY = saved;
  }
  assert.equal(await count('bank_transactions'), 0);
  // Tiền ra (hoặc loại khác): 200 nhưng bỏ qua hoàn toàn.
  for (const t of ['out', 'OUT', '', undefined]) {
    const r = await post({ ...body, transferType: t });
    assert.deepEqual([r.status, r.body], [200, { success: true }]);
  }
  assert.equal(await count('bank_transactions'), 0);
  assert.equal((await booking(o.id)).paymentStatus, 'unpaid');
  // Thiếu mã giao dịch hoặc số tiền sai: 400, không ghi.
  assert.equal((await post({ ...body, id: undefined })).status, 400);
  for (const amount of [0, -5, 'abc', 1000.5, null]) assert.equal((await post({ ...body, transferAmount: amount })).status, 400, String(amount));
  assert.equal(await count('bank_transactions'), 0);
});

test('khớp: mã + số tiền đúng → đơn paid, paidVia bank, nhật ký bank_paid, khách và chủ sân được báo; nội dung có chữ thừa vẫn khớp', async () => {
  const w = await world();
  const a = await order(w);
  const b = await order(w);
  const r = await post(tx(a.code, a.price, { id: 'TX-A' }));
  assert.deepEqual([r.status, r.body], [200, { success: true }]);
  const rowA = await booking(a.id);
  assert.deepEqual([rowA.paymentStatus, rowA.paidVia, !!rowA.paidAt], ['paid', 'bank', true]);
  const [log] = await hist(a.id, 'bank_paid');
  assert.deepEqual([log.actorRole, log.actorId], ['bank', null]);
  assert.match(log.note, /TX-A/);
  assert.equal((await hist(a.id, 'paid')).length, 0);
  assert.equal(await note(w.a.id, `Ngân hàng báo đã nhận tiền của lịch đặt ${a.code}`), 1);
  assert.equal(await note(w.owner.id, `đơn ${a.code}`), 1);
  const detail = (await w.a.a.get(`/api/bookings/${a.id}`)).body;
  assert.deepEqual([detail.paymentStatus, detail.paidVia, detail.paymentQr], ['paid', 'bank', null]);
  assert.equal(detail.history.find((x) => x.action === 'bank_paid').actorName, 'Ngân hàng báo');
  const [ev] = await events(w.owner);
  assert.deepEqual(ev, { id: ev.id, txId: 'TX-A', content: a.code, amount: a.price, venueId: w.venueId, bookingId: a.id, bookingCode: a.code, expected: a.price, status: 'matched', reason: null, reasonText: null, receivedAt: ev.receivedAt });
  // Ngân hàng thêm chữ quanh mã (chữ thường, có dấu chấm): vẫn khớp.
  await post(tx(`MBVCB.3345.${b.code.toLowerCase()} chuyen tien san`, b.price));
  assert.equal((await booking(b.id)).paidVia, 'bank');
  // "KEO" dính liền trước mã (ngân hàng/khách dán thêm chữ): vẫn khớp, số tiền vẫn phải đúng
  const c = await order(w);
  await post(tx(`KEO${c.code}`, c.price - 1000, { id: 'KEO-SHORT' }));
  assert.equal((await row('KEO-SHORT')).reason, 'short');
  await post(tx(`KEO${c.code}`, c.price, { id: 'KEO-OK' }));
  assert.equal((await row('KEO-OK')).status, 'matched');
  assert.equal((await booking(c.id)).paidVia, 'bank');
});

test('không tự ghi nhận: thiếu, thừa, sai mã, mã lạ, hai mã khác nhau, đơn đã trả/hủy/hết hạn, đơn chưa duyệt, lịch điện thoại — kèm lý do, thông báo, nhật ký', async () => {
  const w = await world();
  const short = await order(w);
  const over = await order(w);
  const keo = await order(w);
  const paid = await order(w);
  const cancelled = await order(w);
  const phone = (await w.owner.a.post('/api/owner/bookings', { courtId: w.c2, date: DAY, start: '22:00', customerName: 'Anh Tùng' })).body;
  await w.owner.a.post(`/api/owner/bookings/${paid.id}/paid`, { note: '' });
  await w.a.a.post(`/api/bookings/${cancelled.id}/cancel`, {});
  const expectReason = async (content, amount, reason, bookingId = null) => {
    const id = `X${++txn}`;
    assert.equal((await post(tx(content, amount, { id }))).status, 200);
    const e = await row(id);
    assert.deepEqual([e.status, e.reason, e.bookingId], ['unmatched', reason, bookingId], content);
    return e;
  };
  const eShort = await expectReason(short.code, short.price - 10000, 'short', short.id);
  assert.equal(eShort.expected, short.price);
  assert.equal((await expectReason(over.code, over.price + 10000, 'over', over.id)).expected, over.price);
  await expectReason('chuyen tien san', keo.price, 'no_code');
  await expectReason(`${keo.code}1`, keo.price, 'no_code'); // thừa chữ số: không phải mã
  await expectReason(`${keo.code} SN99999`, keo.price, 'multiple_codes');
  await expectReason(`${keo.code} NH${keo.code}`, keo.price, 'multiple_codes');
  await expectReason(`TD${keo.code}A TD${keo.code}B`, keo.price, 'multiple_codes');
  await expectReason('SN99999', 100000, 'unknown_order');
  await expectReason(paid.code, paid.price, 'not_payable', paid.id);
  await expectReason(cancelled.code, cancelled.price, 'not_payable', cancelled.id);
  await expectReason(`NH${keo.code}`, keo.price, 'not_payable', keo.id); // không có pass đang chờ tiền
  await expectReason(`TD${keo.code}A`, keo.price, 'not_payable', keo.id); // không phải kèo ghép
  const ph = await h.db.one('SELECT id, code FROM bookings WHERE id = ?', [phone.id]);
  await expectReason(ph.code, 300000, 'not_payable', phone.id);
  // sai tài khoản / thiếu tài khoản: đơn đúng mã và đúng tiền cũng không được tự nhận
  for (const [i, account] of [[1, '000111222'], [2, ''], [3, undefined]]) {
    const id = `ACC${i}`;
    await post(tx(keo.code, keo.price, { id, accountNumber: account }));
    assert.equal((await row(id)).reason, account === '000111222' ? 'wrong_account' : 'no_account', String(account));
  }
  // Mọi khoản trên: đơn short/over/keo/paid... không đổi, không có bank_paid
  for (const o of [short, over, keo, cancelled]) assert.deepEqual([(await booking(o.id)).paymentStatus, (await booking(o.id)).paidVia], ['unpaid', null]);
  assert.equal((await hist(short.id, 'bank_unmatched')).length, 1);
  assert.match((await hist(short.id, 'bank_unmatched'))[0].note, /ít hơn.*cần/);
  assert.equal(await note(w.a.id, `chưa khớp số cần chuyển`), 2, 'khách được báo khi thiếu/thừa tiền');
  assert.equal((await hist(keo.id, 'bank_unmatched')).length, 2, 'chỉ các khoản đã tìm ra đơn trong sân của tài khoản (không tính sai/thiếu tài khoản)');
  // chủ sân thấy các khoản cần xử lý, mới nhất trước, có lý do chữ
  const list = await events(w.owner);
  assert.equal(list.length, 13);
  assert.ok(list.every((e) => e.status === 'unmatched' && e.reasonText));
  const times = list.map((e) => e.id);
  assert.deepEqual(times, [...times].sort((x, y) => y - x));
  assert.equal(await note(w.owner.id, 'chưa tự ghi nhận được'), 13);
});

test('đơn chưa được chủ sân đồng ý (pending): tiền về sớm là khoản cần xử lý; duyệt xong thì tiền đúng mới được tự nhận', async () => {
  const w = await world({ approval: true });
  const o = await order(w);
  assert.equal(o.status, 'pending');
  await post(tx(o.code, o.price, { id: 'EARLY' }));
  const e = await row('EARLY');
  assert.deepEqual([e.status, e.reason, e.bookingId], ['unmatched', 'not_approved', o.id]);
  assert.equal((await booking(o.id)).paymentStatus, 'unpaid');
  assert.equal((await w.owner.a.post(`/api/owner/bookings/${o.id}/approve`, {})).status, 200);
  await post(tx(o.code, o.price, { id: 'LATE' }));
  assert.equal((await row('LATE')).status, 'matched');
  assert.equal((await booking(o.id)).paidVia, 'bank');
});

test('đơn hết hạn giữ chỗ (expired): không tự nhận', async () => {
  const w = await world({ approval: true });
  const o = await order(w);
  h.setNow(stamp(TODAY, '09:20'));
  await w.a.a.get('/api/bookings/mine'); // sweep chạy theo request
  assert.equal((await booking(o.id)).status, 'expired');
  await post(tx(o.code, o.price, { id: 'EXP' }));
  assert.deepEqual([(await row('EXP')).status, (await row('EXP')).reason], ['unmatched', 'not_payable']);
});

test('tìm sân theo tài khoản trước: tài khoản của sân khác chủ → khoản hiện cho chủ của tài khoản; tài khoản lạ không gắn chủ', async () => {
  const w = await world();
  const other = await person('owner', 'Chủ khác');
  const ov = await h.makeVenueWithCourt({ ownerId: other.id });
  await h.db.query("UPDATE venues SET bank_account = '5566778899' WHERE id = ?", [ov.venueId]);
  const o = await order(w);
  await post(tx(o.code, o.price, { id: 'WRONG', accountNumber: '5566778899' }));
  const e = await row('WRONG');
  assert.deepEqual([e.status, e.reason, e.ownerId, e.bookingId, e.expected], ['unmatched', 'wrong_account', other.id, null, null]);
  assert.deepEqual((await events(other)).map((x) => x.txId), ['WRONG']);
  assert.deepEqual(await events(w.owner), []);
  assert.equal(await count('booking_history', `booking_id = ${o.id} AND action = 'bank_unmatched'`), 0, 'không ghi nhật ký lên đơn của sân khác');
  await post(tx(o.code, o.price, { id: 'NOBODY', accountNumber: '000111222' }));
  const n = await row('NOBODY');
  assert.deepEqual([n.reason, n.ownerId, n.venueId], ['wrong_account', null, null]);
  assert.equal((await events(w.owner)).length + (await events(other)).length, 1);
  assert.equal((await booking(o.id)).paymentStatus, 'unpaid');
  // đúng tài khoản thì tự nhận
  await post(tx(o.code, o.price, { id: 'RIGHT' }));
  assert.equal((await row('RIGHT')).status, 'matched');
});

test('nhiều sân dùng chung một tài khoản: đơn phân định chủ; không có đơn thì chỉ gắn chủ khi cả nhóm sân chung một chủ', async () => {
  const w = await world();
  const other = await person('owner', 'Chủ khác');
  const ov = await h.makeVenueWithCourt({ ownerId: other.id });
  await h.db.query('UPDATE venues SET bank_account = ? WHERE id = ?', [ACC, ov.venueId]); // hai chủ chung tài khoản
  const o = await order(w);
  await post(tx(o.code, o.price, { id: 'SHARED-OK' }));
  const ok = await row('SHARED-OK');
  assert.deepEqual([ok.status, ok.ownerId, ok.venueId], ['matched', w.owner.id, w.venueId]);
  // đơn của sân chủ khác (chung tài khoản): vẫn tự nhận và hiện cho chủ của đơn
  const ob = await h.db.query('SELECT id FROM courts WHERE venue_id = ?', [ov.venueId]);
  const mine = await w.a.a.post('/api/bookings', { courtId: ob[0].id, date: DAY, start: '08:00' });
  assert.equal(mine.status, 201, mine.text);
  await post(tx(mine.body.code, mine.body.price, { id: 'SHARED-OTHER' }));
  assert.deepEqual([(await row('SHARED-OTHER')).status, (await row('SHARED-OTHER')).ownerId], ['matched', other.id]);
  // không có mã: không biết của chủ nào → không gắn chủ (không chủ nào thấy)
  await post(tx('chuyen tien', 100000, { id: 'SHARED-AMBIG' }));
  assert.equal((await row('SHARED-AMBIG')).ownerId, null);
  assert.ok(!(await events(w.owner)).some((e) => e.txId === 'SHARED-AMBIG') && !(await events(other)).some((e) => e.txId === 'SHARED-AMBIG'));
  // cùng một chủ có hai sân chung tài khoản: gắn chủ đó
  await h.db.query('UPDATE venues SET owner_id = ? WHERE id = ?', [w.owner.id, ov.venueId]);
  await post(tx('chuyen tien', 100000, { id: 'SAME-OWNER' }));
  assert.equal((await row('SAME-OWNER')).ownerId, w.owner.id);
});

test('lặp lại vô hại: cùng id gọi nhiều lần (tuần tự và đồng thời) chỉ ghi một lần; id khác báo thêm cho đơn đã trả thành khoản cần xử lý', async () => {
  const w = await world();
  const a = await order(w);
  const body = tx(a.code, a.price, { id: 'DUP' });
  for (let i = 0; i < 3; i += 1) assert.deepEqual((await post(body)).body, { success: true });
  assert.equal(await count('bank_transactions', "provider_tx_id = 'DUP'"), 1);
  assert.equal((await hist(a.id, 'bank_paid')).length, 1);
  assert.equal(await note(w.owner.id, `đơn ${a.code}`), 1);
  assert.equal(await note(w.a.id, `Ngân hàng báo đã nhận tiền của lịch đặt ${a.code}`), 1);
  // đồng thời, cùng id
  const b = await order(w);
  const rs = await Promise.all(Array.from({ length: 6 }, () => post(tx(b.code, b.price, { id: 'DUP-PAR' }))));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(await count('bank_transactions', "provider_tx_id = 'DUP-PAR'"), 1);
  assert.equal((await hist(b.id, 'bank_paid')).length, 1);
  // id khác, đơn đã trả
  await post(tx(a.code, a.price, { id: 'DUP-2' }));
  const e = await row('DUP-2');
  assert.deepEqual([e.status, e.reason], ['unmatched', 'not_payable']);
  assert.equal((await hist(a.id, 'bank_paid')).length, 1);
});

test('đua: hai webhook khác mã giao dịch cho cùng một đơn → chỉ một lần ghi nhận, lần kia thành khoản cần xử lý', async () => {
  const w = await world();
  for (let round = 0; round < 6; round += 1) {
    const o = await order(w);
    const ids = [`R${round}-1`, `R${round}-2`, `R${round}-3`];
    const rs = await Promise.all(ids.map((id) => post(tx(o.code, o.price, { id }))));
    assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs));
    const rows = await Promise.all(ids.map(row));
    assert.deepEqual(rows.map((r) => r.status).sort(), ['matched', 'unmatched', 'unmatched'], `vòng ${round}`);
    assert.ok(rows.filter((r) => r.status === 'unmatched').every((r) => r.reason === 'not_payable'));
    assert.equal((await hist(o.id, 'bank_paid')).length, 1);
    assert.equal(await note(w.a.id, `Ngân hàng báo đã nhận tiền của lịch đặt ${o.code}`), 1);
  }
});

test('đua: webhook đúng lúc chủ sân bấm tay "Đã nhận tiền" → đúng một bên ghi nhận, bên kia 409 hoặc khoản cần xử lý', async () => {
  const w = await world();
  const outcomes = new Set();
  for (let round = 0; round < 8; round += 1) {
    const o = await order(w);
    const [manual, hook] = await Promise.all([
      w.owner.a.post(`/api/owner/bookings/${o.id}/paid`, { note: '' }),
      post(tx(o.code, o.price, { id: `M${round}` })),
    ]);
    assert.equal(hook.status, 200);
    const e = await row(`M${round}`);
    const b = await booking(o.id);
    assert.equal(b.paymentStatus, 'paid');
    if (manual.status === 200) {
      outcomes.add('manual');
      assert.deepEqual([e.status, e.reason, b.paidVia], ['unmatched', 'not_payable', 'owner']);
      assert.equal((await hist(o.id, 'paid')).length + (await hist(o.id, 'bank_paid')).length, 1);
    } else {
      outcomes.add('bank');
      assert.equal(manual.status, 409);
      assert.deepEqual([e.status, b.paidVia], ['matched', 'bank']);
      assert.equal((await hist(o.id, 'paid')).length, 0);
    }
  }
  assert.ok(outcomes.size >= 1);
});

test('đua tất định: webhook chờ khóa dòng đơn đang bị giữ, rồi thấy đơn đã trả và không ghi nhận lần hai', async () => {
  const w = await world();
  const o = await order(w);
  const { pool } = require('../src/db');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM bookings WHERE id = ? FOR UPDATE', [o.id]);
    const pending = post(tx(o.code, o.price, { id: 'HOLD' }));
    await new Promise((r) => setTimeout(r, 300));
    // bên kia (chủ sân bấm tay) ghi nhận trong lúc webhook đang đợi, rồi nhả khóa
    await conn.query("UPDATE bookings SET payment_status = 'paid', paid_via = 'owner', paid_at = ? WHERE id = ?", [h.clock.now(), o.id]);
    await conn.commit();
    assert.equal((await pending).status, 200);
  } finally {
    conn.release();
  }
  const e = await row('HOLD');
  assert.deepEqual([e.status, e.reason], ['unmatched', 'not_payable']);
  assert.equal((await hist(o.id, 'bank_paid')).length, 0);
});

test('chủ sân xử lý khoản: resolve → resolved + nhật ký bank_resolved; 404 không phải của mình; 409 khoản đã khớp/đã xử lý; chỉ chủ sân', async () => {
  const w = await world();
  const other = await person('owner', 'Chủ khác');
  const o = await order(w);
  const ok = await order(w);
  await post(tx(o.code, o.price - 5000, { id: 'RES' }));
  await post(tx(ok.code, ok.price, { id: 'OK' }));
  const [res, matched] = [await row('RES'), await row('OK')];
  assert.equal((await other.a.post(`/api/owner/bank-events/${res.id}/resolve`, {})).status, 404);
  assert.equal((await w.a.a.post(`/api/owner/bank-events/${res.id}/resolve`, {})).status, 403);
  assert.equal((await app.agent().get('/api/owner/bank-events')).status, 401);
  assert.equal((await w.owner.a.post('/api/owner/bank-events/999999/resolve', {})).status, 404);
  assert.equal((await w.owner.a.post(`/api/owner/bank-events/${matched.id}/resolve`, {})).status, 409);
  const r = await w.owner.a.post(`/api/owner/bank-events/${res.id}/resolve`, { note: 'Khách bù thêm 5.000đ' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.status, r.body.reason, r.body.txId], ['resolved', 'short', 'RES']);
  const [log] = await hist(o.id, 'bank_resolved');
  assert.match(log.note, /Khách bù thêm/);
  assert.equal(log.actorId, w.owner.id);
  assert.equal((await w.owner.a.post(`/api/owner/bank-events/${res.id}/resolve`, {})).status, 409, 'xử lý lại');
  assert.deepEqual((await events(w.owner)).map((e) => e.status).sort(), ['matched', 'resolved']);
  // khoản đã xử lý thì chủ sân vẫn bấm tay nhận tiền được (đơn chưa trả)
  assert.equal((await w.owner.a.post(`/api/owner/bookings/${o.id}/paid`, { note: '' })).status, 200);
});

test('nhượng sân (NH + mã): đội nhận chuyển đúng tiền → pass hoàn tất, đơn mới paidVia bank; sai tiền thì không', async () => {
  const w = await world();
  const o = await order(w);
  await w.owner.a.post(`/api/owner/bookings/${o.id}/paid`, { note: '' });
  const t = await w.a.a.post(`/api/bookings/${o.id}/transfer`, { askPrice: 200000 });
  assert.equal(t.status, 201, t.text);
  assert.equal((await w.b.a.post(`/api/transfers/${t.body.id}/claim`)).status, 200);
  await post(tx(`NH${o.code}`, 150000, { id: 'NH-SHORT' }));
  assert.deepEqual([(await row('NH-SHORT')).reason, (await row('NH-SHORT')).expected], ['short', 200000]);
  assert.equal((await h.db.one('SELECT status FROM transfers WHERE id = ?', [t.body.id])).status, 'claimed');
  await post(tx(o.code, 200000, { id: 'NH-NOPREFIX' })); // không có tiền tố NH: đơn đã trả
  assert.equal((await row('NH-NOPREFIX')).reason, 'not_payable');
  await post(tx(`NH${o.code}`, 200000, { id: 'NH-OK' }));
  assert.equal((await row('NH-OK')).status, 'matched');
  const tr = await h.db.one('SELECT * FROM transfers WHERE id = ?', [t.body.id]);
  assert.equal(tr.status, 'completed');
  const nb = await booking(tr.newBookingId);
  assert.deepEqual([nb.status, nb.userId, nb.paymentStatus, nb.paidVia], ['confirmed', w.b.id, 'paid', 'bank']);
  assert.equal((await booking(o.id)).status, 'transferred');
  const [log] = await hist(o.id, 'transfer_done');
  assert.equal(log.actorRole, 'bank');
  await post(tx(`NH${o.code}`, 200000, { id: 'NH-AGAIN' }));
  assert.equal((await row('NH-AGAIN')).reason, 'not_payable');
});

test('nhượng sân quá hạn giữ chỗ của đội nhận: không tự nhận', async () => {
  const w = await world();
  const o = await order(w);
  await w.owner.a.post(`/api/owner/bookings/${o.id}/paid`, { note: '' });
  const t = await w.a.a.post(`/api/bookings/${o.id}/transfer`, { askPrice: 200000 });
  await w.b.a.post(`/api/transfers/${t.body.id}/claim`);
  const exp = (await h.db.one('SELECT claim_expires_at FROM transfers WHERE id = ?', [t.body.id])).claimExpiresAt;
  h.setNow(`${exp.slice(0, 10)} ${exp.slice(11, 16)}`);
  h.clock.setOffsetMinutes(h.clock.getOffsetMinutes() + 1);
  await post(tx(`NH${o.code}`, 200000, { id: 'NH-LATE' }));
  assert.deepEqual([(await row('NH-LATE')).status, (await row('NH-LATE')).reason], ['unmatched', 'not_payable']);
});

test('ghép kèo (TD + mã + A/B): từng phần đúng tiền được nhận; đủ hai phần thì chốt sân, đơn paidVia bank; phần sai tiền/đã nhận/hết hạn thì không', async () => {
  const w = await world();
  const m = (await w.a.a.post('/api/matches', { courtId: w.c1, date: DAY, start: '19:00', loserPercent: 50, closesAt: stamp(DAY, '16:00') })).body;
  const b = await booking(m.bookingId);
  const base = await h.db.one('SELECT host_amount, guest_amount FROM matches WHERE id = ?', [m.id]);
  // phần B khi chưa có đội vào: không có gì để nhận
  await post(tx(`TD${b.code}B`, base.guestAmount, { id: 'TD-EARLY' }));
  assert.equal((await row('TD-EARLY')).reason, 'not_payable');
  await post(tx(`TD${b.code}A`, base.hostAmount - 1000, { id: 'TD-SHORT' }));
  assert.equal((await row('TD-SHORT')).reason, 'short');
  await post(tx(b.code, b.price, { id: 'TD-PLAIN' })); // mã đơn thường cho đơn đang ghép: chưa được xác nhận
  assert.equal((await row('TD-PLAIN')).reason, 'not_payable');
  await post(tx(`TD${b.code}A`, base.hostAmount, { id: 'TD-A' }));
  assert.equal((await row('TD-A')).status, 'matched');
  assert.ok((await h.db.one('SELECT host_paid_at FROM matches WHERE id = ?', [m.id])).hostPaidAt);
  assert.equal((await booking(m.bookingId)).status, 'matching');
  await post(tx(`TD${b.code}A`, base.hostAmount, { id: 'TD-A2' }));
  assert.equal((await row('TD-A2')).reason, 'not_payable', 'phần A đã nhận');
  assert.equal((await w.b.a.post(`/api/matches/${m.id}/join`)).status, 200);
  await post(tx(`TD${b.code}B`, base.guestAmount + 5000, { id: 'TD-OVER' }));
  assert.equal((await row('TD-OVER')).reason, 'over');
  await post(tx(`TD${b.code}B`, base.guestAmount, { id: 'TD-B' }));
  assert.equal((await row('TD-B')).status, 'matched');
  const done = await h.db.one('SELECT * FROM matches WHERE id = ?', [m.id]);
  assert.equal(done.status, 'confirmed');
  const fin = await booking(m.bookingId);
  assert.deepEqual([fin.status, fin.paymentStatus, fin.paidVia], ['confirmed', 'paid', 'bank']);
  assert.equal((await hist(m.bookingId, 'match_part_paid')).length, 2);
  assert.ok((await hist(m.bookingId, 'match_part_paid')).every((x) => x.actorRole === 'bank'));
  assert.equal(await note(w.b.id, 'ngân hàng báo đã nhận đủ tiền'), 1);
  await post(tx(`TD${b.code}B`, base.guestAmount, { id: 'TD-B2' }));
  assert.equal((await row('TD-B2')).reason, 'not_payable');
});

test('đua: hai webhook khác id cho cùng một phần kèo → chỉ một lần ghi nhận', async () => {
  const w = await world();
  const m = (await w.a.a.post('/api/matches', { courtId: w.c1, date: DAY, start: '19:00', loserPercent: 50, closesAt: stamp(DAY, '16:00') })).body;
  const b = await booking(m.bookingId);
  const amt = (await h.db.one('SELECT host_amount FROM matches WHERE id = ?', [m.id])).hostAmount;
  await Promise.all([1, 2, 3].map((i) => post(tx(`TD${b.code}A`, amt, { id: `TDR${i}` }))));
  const rows = await Promise.all([1, 2, 3].map((i) => row(`TDR${i}`)));
  assert.deepEqual(rows.map((r) => r.status).sort(), ['matched', 'unmatched', 'unmatched']);
  assert.equal((await hist(m.bookingId, 'match_part_paid')).length, 1);
});

test('route dev mô phỏng ngân hàng dùng cùng hàm với webhook; production không có route này', async () => {
  const w = await world();
  const o = await order(w);
  const r = await w.a.a.post('/api/dev/bank-report', { txId: 'DEV-1', content: o.code, amount: o.price, account: ACC });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.status, r.body.duplicate, r.body.txId], ['matched', false, 'DEV-1']);
  assert.equal((await w.a.a.post('/api/dev/bank-report', { txId: 'DEV-1', content: o.code, amount: o.price, account: ACC })).body.duplicate, true);
  assert.equal((await booking(o.id)).paidVia, 'bank');
  const o2 = await order(w);
  const s = await w.a.a.post('/api/dev/simulate-transfer', { content: o2.code, amount: o2.price, account: ACC });
  assert.equal(s.body.delayMs, 4000);
  assert.equal((await booking(o2.id)).paymentStatus, 'unpaid');
  const f = await w.a.a.post('/api/dev/flush-bank', {});
  assert.equal(f.body.reported, 1);
  assert.equal((await booking(o2.id)).paidVia, 'bank');
  const prod = await h.startApp({ production: true });
  try {
    const pa = prod.agent();
    for (const p of ['bank-report', 'simulate-transfer', 'flush-bank']) assert.equal((await pa.post(`/api/dev/${p}`, {})).status, 404, p);
  } finally {
    await prod.close();
  }
});
