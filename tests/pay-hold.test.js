// R3: đơn đã có sân mà khách chưa chuyển khoản chỉ được giữ payHoldMinutes (15 phút). MySQL thật qua HTTP, đồng hồ ứng dụng dịch được.
process.env.SEPAY_API_KEY = 'test-sepay-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { addDays } = require('../src/lib/time');

const ACC = '0011223344';
const pw = 'Matkhau@123';
let app;
let day0;
let day1;
let owner;
let withQr; // tự xác nhận, có VietQR
let manualQr; // chờ duyệt, có VietQR
let noQr; // tự xác nhận, chưa có VietQR
let n = 0;

const login = async (u) => {
  const a = app.agent();
  assert.equal((await a.post('/api/auth/login', { email: u.email, password: pw })).status, 200);
  return a;
};
const person = async (role) => {
  const email = `${role}${++n}${Math.random().toString(36).slice(2, 7)}@test.local`;
  return { ...(await h.makeUser({ role, email, fullName: `Người ${role} ${n}` })), email };
};
const at = (hm, day = day0) => h.setNow(`${day} ${hm}`);
const row = (id) => h.db.one('SELECT * FROM bookings WHERE id = ?', [id]);
const claims = async (id) => Number((await h.db.one('SELECT COUNT(*) AS n FROM slot_claims WHERE booking_id = ?', [id])).n);
const msgs = async (userId) => (await h.db.query('SELECT message FROM notifications WHERE user_id = ?', [userId])).map((m) => m.message);
const touch = (a) => a.get('/api/notifications'); // một request bất kỳ kích hoạt quét hết hạn

test.before(async () => {
  await h.emptyData();
  owner = await person('owner');
  day0 = h.clock.today();
  day1 = addDays(day0, 1);
  withQr = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 3 });
  manualQr = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 1, requiresApproval: 1 });
  noQr = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 1 });
  for (const v of [withQr, manualQr]) {
    await h.db.query("UPDATE venues SET bank_bin = '970436', bank_account = ?, bank_account_name = 'CHU SAN' WHERE id = ?", [ACC, v.venueId]);
  }
  app = await h.startApp();
});
test.beforeEach(() => at('08:00'));
test.after(async () => {
  h.clock.setOffsetMinutes(0);
  await app.close();
  await h.closeAll();
});
test.afterEach(async () => {
  assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
});

async function customerBook(court, start, date = day1) {
  const u = await person('customer');
  const a = await login(u);
  const r = await a.post('/api/bookings', { courtId: court, date, start });
  assert.equal(r.status, 201, r.text);
  return { u, a, b: r.body };
}

test('đơn tự xác nhận có hạn chuyển khoản 15 phút kể từ lúc đặt, báo giờ cho khách', async () => {
  const { u, b } = await customerBook(withQr.courtIds[0], '10:00');
  assert.equal(b.status, 'confirmed');
  assert.ok(b.expiresAt.startsWith(`${day0} 08:15:`), b.expiresAt);
  assert.ok((await msgs(u.id)).some((m) => m.includes('trước 08:15')));
});

test('quá hạn chưa chuyển khoản: expired, nhả ô, báo khách và chủ sân, người chờ được mời, không tính vào uy tín', async () => {
  const court = withQr.courtIds[0];
  const { u, a, b } = await customerBook(court, '11:00');
  const waiter = await person('customer');
  const w = await login(waiter);
  assert.equal((await w.post('/api/waitlist', { courtId: court, date: day1, start: '11:00' })).status, 201);

  at('08:14');
  await touch(a);
  assert.equal((await row(b.id)).status, 'confirmed', 'chưa tới hạn');
  at('08:16');
  await touch(a);
  const r = await row(b.id);
  assert.deepEqual([r.status, r.paymentStatus], ['expired', 'unpaid']);
  assert.equal(await claims(b.id), 0, 'ô đã nhả');
  const hist = await h.db.query("SELECT from_status, to_status, note FROM booking_history WHERE booking_id = ? AND action = 'expire'", [b.id]);
  assert.deepEqual([hist[0].fromStatus, hist[0].toStatus, hist[0].note], ['confirmed', 'expired', 'Quá hạn giữ chỗ chưa chuyển khoản']);
  assert.ok((await msgs(u.id)).some((m) => m.includes('hết hạn giữ chỗ vì chưa nhận được chuyển khoản')));
  assert.ok((await msgs(owner.id)).some((m) => m.includes(b.code) && m.includes('khách chưa chuyển khoản')));
  assert.equal((await w.get('/api/waitlist/mine')).body[0].status, 'offered', 'người chờ được mời');
  const rel = (await a.get('/api/bookings/reliability')).body;
  assert.deepEqual([rel.noShows, rel.lateCancels, rel.restricted], [0, 0, false]);
});

test('trả tiền trước hạn thì xóa hạn, quét sau đó không đụng tới đơn', async () => {
  const { a, b } = await customerBook(withQr.courtIds[1], '12:00');
  const ow = await login(owner);
  at('08:10');
  assert.equal((await ow.post(`/api/owner/bookings/${b.id}/paid`, { note: 'ck' })).status, 200);
  assert.equal((await row(b.id)).expiresAt, null);
  at('09:30');
  await touch(a);
  const r = await row(b.id);
  assert.deepEqual([r.status, r.paymentStatus], ['confirmed', 'paid']);
});

test('tiền về sau khi hết hạn: không khôi phục đơn, thành khoản cần xử lý với lý do riêng; chủ bấm đã nhận tiền thì 409', async () => {
  const { a, b } = await customerBook(withQr.courtIds[2], '13:00');
  const ow = await login(owner);
  at('08:20');
  await touch(a);
  assert.equal((await row(b.id)).status, 'expired');
  const res = await fetch(`${app.base}/api/webhooks/sepay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Apikey test-sepay-key' },
    body: JSON.stringify({ id: `LATE${Date.now()}`, accountNumber: ACC, content: b.code, transferType: 'in', transferAmount: b.price }),
  });
  assert.equal(res.status, 200);
  const r = await row(b.id);
  assert.deepEqual([r.status, r.paymentStatus], ['expired', 'unpaid']);
  const ev = (await ow.get('/api/owner/bank-events')).body.find((e) => e.bookingId === b.id);
  assert.deepEqual([ev.status, ev.reason, ev.reasonText], ['unmatched', 'not_payable', 'Khách chuyển sau khi đơn đã hết hạn giữ chỗ']);
  const paid = await ow.post(`/api/owner/bookings/${b.id}/paid`, {});
  assert.equal(paid.status, 409);
  assert.match(paid.body.error || paid.text, /hết hạn giữ chỗ/);
});

test('sân chờ duyệt: hạn duyệt 15 phút tính từ lúc đặt, hạn chuyển khoản 15 phút tính từ lúc chủ duyệt', async () => {
  const { a, b } = await customerBook(manualQr.courtIds[0], '10:00');
  assert.equal(b.status, 'pending');
  assert.ok(b.expiresAt.startsWith(`${day0} 08:15:`));
  const ow = await login(owner);
  at('08:12');
  assert.equal((await ow.post(`/api/owner/bookings/${b.id}/approve`)).status, 200);
  const r = await row(b.id);
  assert.equal(r.status, 'confirmed');
  assert.ok(r.expiresAt.startsWith(`${day0} 08:27:`), r.expiresAt);
  at('08:20');
  await touch(a);
  assert.equal((await row(b.id)).status, 'confirmed', 'hạn cũ 08:15 không còn áp dụng');
  at('08:30');
  await touch(a);
  assert.equal((await row(b.id)).status, 'expired');
});

test('miễn hạn: sân chưa có VietQR và lịch điện thoại không bao giờ hết hạn vì chưa chuyển khoản', async () => {
  const { a, b } = await customerBook(noQr.courtIds[0], '10:00');
  assert.equal(b.expiresAt, null);
  const ow = await login(owner);
  const ph = await ow.post('/api/owner/bookings', { courtId: withQr.courtIds[0], date: day1, start: '17:00', customerName: 'Anh Tùng', paid: false });
  assert.equal(ph.status, 201, ph.text);
  assert.equal(ph.body.expiresAt, null);
  at('20:00');
  await touch(a);
  assert.equal((await row(b.id)).status, 'confirmed');
  assert.equal((await row(ph.body.id)).status, 'confirmed');
});

test('hạn không vượt giờ đá', async () => {
  at('08:50');
  const { b } = await customerBook(withQr.courtIds[0], '09:00', day0);
  assert.equal(b.status, 'confirmed');
  assert.ok(b.expiresAt.startsWith(`${day0} 09:00:`), b.expiresAt);
});
