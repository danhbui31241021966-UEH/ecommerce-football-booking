// Đặt sân đầy đủ trên MySQL thật qua HTTP: hoàn tiền theo mốc giờ, uy tín (R10), hết hạn giữ chỗ và danh sách chờ,
// phân quyền chủ sân/admin, thông báo. Sau mỗi thao tác đổi trạng thái, slot_claims phải khớp trạng thái lịch.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { addDays, vnToMs, msToVn } = require('../src/lib/time');

let app;
let base;
let o1;
let o2;
let admin;
let auto; // cụm sân tự xác nhận của o1
let manual; // cụm sân chờ duyệt của o1
let other; // cụm sân của o2
const pw = 'Matkhau@123';

const loginAs = async (user) => {
  const a = app.agent();
  const r = await a.post('/api/auth/login', { email: user.email, password: pw });
  assert.equal(r.status, 200, r.text);
  return a;
};
const person = async (role) => {
  const email = `${role}${Math.random().toString(36).slice(2, 8)}@test.local`;
  const u = await h.makeUser({ role, email, fullName: `Người ${role}` });
  return { ...u, email };
};
const noDrift = async () => assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
const at = (stamp) => h.setNow(stamp);
const stampBefore = (startAt, hours) => msToVn(vnToMs(startAt) - hours * 3600000).slice(0, 16);
const book = (a, courtId, date, start, extra = {}) => a.post('/api/bookings', { courtId, date, start, ...extra });
const statusOf = async (id) => (await h.db.one('SELECT status FROM bookings WHERE id = ?', [id])).status;

let day0;
let day1;
test.before(async () => {
  await h.emptyData();
  o1 = await person('owner');
  o2 = await person('owner');
  admin = await person('admin');
  auto = await h.makeVenueWithCourt({ ownerId: o1.id, courts: 3 });
  manual = await h.makeVenueWithCourt({ ownerId: o1.id, requiresApproval: 1, courts: 2 });
  other = await h.makeVenueWithCourt({ ownerId: o2.id });
  day0 = h.clock.today();
  day1 = addDays(day0, 1);
  app = await h.startApp();
  base = app.base;
});
test.beforeEach(() => at(`${day0} 08:00`));
test.after(async () => {
  h.clock.setOffsetMinutes(0);
  await app.close();
  await h.closeAll();
});

test('hủy theo mốc giờ (R7): >=24h 100%, 12-24h 50%, <12h 0% và ghi hủy sát giờ (R10); chưa trả tiền thì không hoàn', async () => {
  const cust = await person('customer');
  const a = await loginAs(cust);
  const ow = await loginAs(o1);
  const cases = [
    // [giờ bắt đầu, còn lại (giờ) lúc hủy, đã trả tiền, % kỳ vọng, tiền kỳ vọng, hủy sát giờ]
    ['10:00', 30, true, 100, 300000, false],
    ['11:00', 24, true, 100, 300000, false],
    ['12:00', 23.5, true, 50, 150000, false],
    ['13:00', 12, true, 50, 150000, false],
    ['14:00', 11.5, true, 0, 0, true],
    ['15:00', 30, false, 100, 0, false],
  ];
  for (const [start, left, paid, pct, amount, late] of cases) {
    at(`${day0} 08:00`);
    const r = await book(a, auto.courtIds[0], day1, start);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.status, 'confirmed');
    if (paid) assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/paid`, { note: 'ck' })).status, 200);
    at(stampBefore(`${day1} ${start}:00`, left));
    const c = await a.post(`/api/bookings/${r.body.id}/cancel`, { reason: 'bận' });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.body.status, 'cancelled');
    assert.equal(c.body.cancelledBy, 'customer');
    assert.equal(c.body.refundPercent, pct, `${start} còn ${left}h`);
    assert.equal(c.body.refundAmount, amount);
    assert.equal(c.body.refundStatus, amount > 0 ? 'pending' : 'none');
    const row = await h.db.one('SELECT late_cancel FROM bookings WHERE id = ?', [r.body.id]);
    assert.equal(!!row.lateCancel, late, `${start} hủy sát giờ`);
    assert.equal((await a.post(`/api/bookings/${r.body.id}/cancel`)).status, 409, 'hủy lần hai bị chặn');
  }
  assert.equal((await a.get('/api/bookings/reliability')).body.lateCancels, 1);
  await noDrift();
});

test('chủ sân hoặc admin hủy luôn hoàn 100%, không tính hủy sát giờ; hoàn tiền xong chuyển refundStatus done', async () => {
  const cust = await person('customer');
  const a = await loginAs(cust);
  const ow = await loginAs(o1);
  const ad = await loginAs(admin);
  const r1 = await book(a, auto.courtIds[1], day1, '10:00');
  const r2 = await book(a, auto.courtIds[1], day1, '11:00');
  for (const r of [r1, r2]) await ow.post(`/api/owner/bookings/${r.body.id}/paid`);
  at(stampBefore(`${day1} 10:00:00`, 3));
  const c1 = await ow.post(`/api/owner/bookings/${r1.body.id}/cancel`, { reason: 'Mưa lớn' });
  assert.equal(c1.status, 200, c1.text);
  const c2 = await ad.post(`/api/admin/bookings/${r2.body.id}/cancel`, { reason: 'Sự cố' });
  assert.equal(c2.status, 200, c2.text);
  for (const [r, by] of [[r1, 'owner'], [r2, 'admin']]) {
    const d = (await a.get(`/api/bookings/${r.body.id}`)).body;
    assert.deepEqual([d.status, d.cancelledBy, d.refundPercent, d.refundAmount, d.refundStatus], ['cancelled', by, 100, 300000, 'pending']);
    assert.equal((await h.db.one('SELECT late_cancel FROM bookings WHERE id = ?', [r.body.id])).lateCancel, 0);
  }
  assert.equal((await a.get('/api/bookings/reliability')).body.lateCancels, 0);
  assert.equal((await ow.post(`/api/owner/bookings/${r1.body.id}/refund`, { note: 'Đã chuyển' })).status, 200);
  assert.equal((await ad.post(`/api/admin/bookings/${r2.body.id}/refund`)).status, 200);
  assert.equal((await ow.post(`/api/owner/bookings/${r1.body.id}/refund`)).status, 409, 'không hoàn hai lần');
  assert.equal((await a.get(`/api/bookings/${r1.body.id}`)).body.refundStatus, 'done');
  const notes = (await a.get('/api/notifications')).body.items.map((n) => n.message);
  assert.ok(notes.some((m) => /chủ sân hủy/.test(m) && /300\.000đ/.test(m)), notes.join(' | '));
  assert.ok(notes.some((m) => /quản trị viên hủy/.test(m)));
  await noDrift();
});

test('uy tín thấp (R10): đủ 2 lần vi phạm trong 60 ngày thì sân tự xác nhận vẫn phải chờ chủ sân đồng ý', async () => {
  const insertPast = (userId, daysAgo, status, late = 0) => {
    const start = `${addDays(day0, -daysAgo)} 18:00:00`;
    return h.db.query(
      `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, price, base_price, rules_snapshot, policy_snapshot, late_cancel, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'web', 1, 1, '', '', ?, ?, ?)`,
      [`P${Math.random().toString(36).slice(2, 10)}`, userId, auto.venueId, auto.courtIds[2], start, `${start.slice(0, 10)} 19:00:00`, status, late, start, start],
    );
  };
  const one = await person('customer');
  const two = await person('customer');
  const old = await person('customer');
  await insertPast(one.id, 5, 'no_show');
  await insertPast(two.id, 5, 'no_show');
  await insertPast(two.id, 9, 'cancelled', 1);
  await insertPast(old.id, 70, 'no_show');
  await insertPast(old.id, 80, 'no_show');

  const r2 = await book(await loginAs(two), auto.courtIds[2], day1, '10:00');
  assert.equal(r2.status, 201, r2.text);
  assert.equal(r2.body.status, 'pending');
  assert.ok(r2.body.expiresAt);
  assert.equal((await book(await loginAs(one), auto.courtIds[2], day1, '11:00')).body.status, 'confirmed', 'một vi phạm chưa bị hạn chế');
  assert.equal((await book(await loginAs(old), auto.courtIds[2], day1, '12:00')).body.status, 'confirmed', 'vi phạm quá 60 ngày không tính');

  const rel = (await (await loginAs(two)).get('/api/bookings/reliability')).body;
  assert.deepEqual([rel.noShows, rel.lateCancels, rel.violations, rel.restricted], [1, 1, 2, true]);

  const ow = await loginAs(o1);
  const d = (await ow.get(`/api/bookings/${r2.body.id}`)).body;
  assert.equal(d.customerReliability.restricted, true);
  assert.match(d.history[0].note, /uy tín/);
  assert.equal((await ow.post(`/api/owner/bookings/${r2.body.id}/approve`)).status, 200);
  assert.equal(await statusOf(r2.body.id), 'confirmed');
  await noDrift();
});

test('hết hạn giữ chỗ 15 phút nhả ô và mời người chờ sớm nhất; lượt mời hết hạn thì mời người kế tiếp', async () => {
  const [cust, w1, w2, stranger] = await Promise.all([person('customer'), person('customer'), person('customer'), person('customer')]);
  const [a, b1, b2, s] = await Promise.all([loginAs(cust), loginAs(w1), loginAs(w2), loginAs(stranger)]);
  const court = manual.courtIds[0];
  const r = await book(a, court, day1, '18:00');
  assert.equal(r.body.status, 'pending');
  assert.ok(r.body.expiresAt.startsWith(`${day0} 08:15:`), r.body.expiresAt);
  assert.equal((await b1.post('/api/waitlist', { courtId: court, date: day1, start: '18:00' })).body.position, 1);
  assert.equal((await b2.post('/api/waitlist', { courtId: court, date: day1, start: '18:00' })).body.position, 2);
  assert.equal((await b1.post('/api/waitlist', { courtId: court, date: day1, start: '18:00' })).status, 409, 'không chờ hai lần');

  at(`${day0} 08:14`);
  assert.equal((await a.get(`/api/bookings/${r.body.id}`)).body.status, 'pending');
  at(`${day0} 08:16`);
  assert.equal((await a.get(`/api/bookings/${r.body.id}`)).body.status, 'expired');
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM slot_claims WHERE booking_id = ?', [r.body.id])).n, 0, 'ô đã nhả');
  await noDrift();
  assert.ok((await a.get('/api/notifications')).body.items.some((n) => /quá hạn/.test(n.message)));

  const mine = (await b1.get('/api/waitlist/mine')).body[0];
  assert.deepEqual([mine.status, mine.offerActive], ['offered', true]);
  assert.ok(mine.offerExpiresAt.startsWith(`${day0} 08:26:`), mine.offerExpiresAt);
  assert.equal((await b2.get('/api/waitlist/mine')).body[0].status, 'waiting');
  assert.ok((await b1.get('/api/notifications')).body.items.some((n) => /đang giữ cho bạn/.test(n.message)));
  assert.equal((await b2.get('/api/notifications')).body.unread, 0);

  // Trong lúc giữ quyền: người lạ và người chờ sau bị chặn, người được mời đặt được.
  assert.equal((await book(s, court, day1, '18:00')).status, 409);
  assert.equal((await book(b2, court, day1, '18:00')).status, 409);
  const slotOf = async (agent) => (await agent.get(`/api/venues/${manual.venueId}/schedule?date=${day1}`)).body.courts.find((c) => c.id === court).slots.find((x) => x.start === '18:00');
  assert.equal((await slotOf(s)).status, 'offered');
  assert.equal((await slotOf(b1)).offeredToYou, true);

  // Hết hạn lượt mời (10 phút): bỏ lượt của b1, mời b2.
  at(`${day0} 08:27`);
  assert.equal((await s.get('/api/notifications')).status, 200); // một request bất kỳ kích hoạt quét
  assert.deepEqual((await b1.get('/api/waitlist/mine')).body, []);
  assert.equal((await b2.get('/api/waitlist/mine')).body[0].status, 'offered');
  assert.ok((await b1.get('/api/notifications')).body.items.some((n) => /không đặt kịp/.test(n.message)));

  const won = await book(b2, court, day1, '18:00');
  assert.equal(won.status, 201, won.text);
  assert.deepEqual((await b2.get('/api/waitlist/mine')).body, [], 'đặt được thì lượt chờ hoàn tất');
  await noDrift();
});

test('lượt mời không vượt quá giờ bắt đầu; rút lượt đang được mời thì mời người kế tiếp', async () => {
  const [cust, w1, w2] = await Promise.all([person('customer'), person('customer'), person('customer')]);
  const [a, b1, b2] = await Promise.all([loginAs(cust), loginAs(w1), loginAs(w2)]);
  const court = auto.courtIds[0];
  const start = '09:00';
  at(`${day0} 08:00`);
  const r = await book(a, court, day0, start);
  assert.equal(r.status, 201, r.text);
  await b1.post('/api/waitlist', { courtId: court, date: day0, start });
  assert.equal((await b2.post('/api/waitlist', { courtId: court, date: day0, start })).status, 201);
  at(`${day0} 08:55`);
  assert.equal((await a.post(`/api/bookings/${r.body.id}/cancel`)).status, 200);
  const offer = (await b1.get('/api/waitlist/mine')).body[0];
  assert.equal(offer.offerExpiresAt, `${day0} 09:00:00`, 'tối đa tới giờ bắt đầu');
  const id1 = offer.id;
  assert.equal((await b1.del(`/api/waitlist/${id1}`)).status, 200);
  assert.equal((await b2.get('/api/waitlist/mine')).body[0].status, 'offered');
  assert.equal((await b1.del(`/api/waitlist/${id1}`)).status, 404);
  await noDrift();
});

test('đăng ký chờ chỉ khi giờ có người đặt; giờ trống bị từ chối', async () => {
  const cust = await person('customer');
  const a = await loginAs(cust);
  const r = await a.post('/api/waitlist', { courtId: auto.courtIds[2], date: day1, start: '20:00' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /đang trống/);
  const owner = await book(await loginAs(await person('customer')), auto.courtIds[2], day1, '20:00');
  assert.equal(owner.status, 201);
  assert.equal((await a.post('/api/waitlist', { courtId: auto.courtIds[2], date: day1, start: '20:00' })).status, 201);
});

test('chủ sân chỉ thao tác trên cụm sân của mình; khách chỉ xem lịch của mình', async () => {
  const cust = await person('customer');
  const a = await loginAs(cust);
  const r = await book(a, manual.courtIds[1], day1, '19:00');
  assert.equal(r.body.status, 'pending');
  const ow2 = await loginAs(o2);
  for (const op of ['approve', 'reject', 'cancel', 'paid', 'refund', 'attendance']) {
    const res = await ow2.post(`/api/owner/bookings/${r.body.id}/${op}`, { reason: 'x', result: 'no_show' });
    assert.equal(res.status, 403, `${op}: ${res.text}`);
  }
  assert.equal(await statusOf(r.body.id), 'pending');
  assert.equal((await ow2.get(`/api/bookings/${r.body.id}`)).status, 403);
  assert.ok(!(await ow2.get('/api/owner/bookings')).body.some((b) => b.id === r.body.id));
  const ow1 = await loginAs(o1);
  assert.ok((await ow1.get('/api/owner/bookings?status=pending')).body.some((b) => b.id === r.body.id));
  assert.equal((await ow1.get('/api/owner/bookings?status=pending')).body.find((b) => b.id === r.body.id).customerName, 'Người customer');
  assert.equal((await ow1.get(`/api/owner/bookings?date=${day1}`)).status, 200);
  assert.equal((await ow1.post('/api/owner/bookings/999999/approve')).status, 404);
  // Khách khác không thấy lịch này; khách không dùng được API của chủ sân.
  const stranger = await loginAs(await person('customer'));
  assert.equal((await stranger.get(`/api/bookings/${r.body.id}`)).status, 404);
  assert.equal((await stranger.post(`/api/bookings/${r.body.id}/cancel`)).status, 404);
  assert.equal((await a.get('/api/owner/bookings')).status, 403);
  assert.equal((await a.get('/api/admin/bookings')).status, 403);
  assert.equal((await app.agent().get('/api/bookings/mine')).status, 401);

  // Từ chối cần lý do; từ chối nhả ô để đặt lại.
  assert.equal((await ow1.post(`/api/owner/bookings/${r.body.id}/reject`, { reason: '  ' })).status, 400);
  assert.equal((await ow1.post(`/api/owner/bookings/${r.body.id}/reject`, { reason: 'Sân bảo trì' })).status, 200);
  assert.equal((await ow1.post(`/api/owner/bookings/${r.body.id}/approve`)).status, 409);
  assert.match((await a.get('/api/notifications')).body.items[0].message, /từ chối.*Sân bảo trì/);
  assert.equal((await book(await loginAs(await person('customer')), manual.courtIds[1], day1, '19:00')).status, 201);
  await noDrift();
});

test('duyệt: khách nhận thông báo và mã QR; ghi nhận chuyển khoản; quá giờ đá thì điểm danh bùng sân (ảnh hưởng uy tín)', async () => {
  const cust = await person('customer');
  const a = await loginAs(cust);
  const ow = await loginAs(o1);
  const r = await book(a, manual.courtIds[0], day0, '15:00', { note: 'Đội 10 người' });
  assert.equal(r.body.status, 'pending');
  assert.equal((await a.get(`/api/bookings/${r.body.id}`)).body.paymentQr, null, 'chưa duyệt thì chưa có QR');
  assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/approve`)).status, 200);
  const d = (await a.get(`/api/bookings/${r.body.id}`)).body;
  assert.equal(d.status, 'confirmed');
  assert.equal(d.customerNote, 'Đội 10 người');
  assert.deepEqual(d.history.map((x) => x.action), ['create', 'approve']);
  assert.equal(d.history[1].actorName, 'Người owner');
  assert.equal(d.paymentQr, null, 'sân thử không có tài khoản ngân hàng');
  await h.db.query("UPDATE venues SET bank_bin = '970436', bank_account = '0123456789', bank_account_name = 'SAN THU' WHERE id = ?", [manual.venueId]);
  const qr = (await a.get(`/api/bookings/${r.body.id}`)).body.paymentQr;
  assert.equal(qr.bankName, 'Vietcombank');
  assert.equal(qr.amount, d.price);
  assert.equal(qr.content, d.code);

  assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/attendance`, { result: 'no_show' })).status, 400, 'chưa tới giờ đá');
  assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/attendance`, { result: 'bay' })).status, 400);
  assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/paid`)).status, 200);
  assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/paid`)).status, 409);
  assert.equal((await a.get(`/api/bookings/${r.body.id}`)).body.paymentQr, null, 'đã trả thì hết QR');
  at(`${day0} 16:30`);
  assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/attendance`, { result: 'no_show' })).status, 200);
  assert.equal(await statusOf(r.body.id), 'no_show');
  assert.equal((await a.get('/api/bookings/reliability')).body.noShows, 1);
  assert.match((await a.get('/api/notifications')).body.items[0].message, /bùng sân.*1\/2/);
  assert.equal((await ow.post(`/api/owner/bookings/${r.body.id}/attendance`, { result: 'completed' })).status, 409);
  await noDrift();
});

test('admin làm được mọi thao tác trên lịch của mọi chủ sân', async () => {
  const cust = await person('customer');
  const a = await loginAs(cust);
  const ad = await loginAs(admin);
  const r1 = await book(a, other.courtIds[0], day1, '10:00');
  const r2 = await book(a, other.courtIds[0], day0, '14:00');
  assert.equal((await ad.post(`/api/admin/bookings/${r1.body.id}/paid`, { note: 'ok' })).status, 200);
  assert.equal((await ad.post(`/api/admin/bookings/${r1.body.id}/cancel`, { reason: 'Test' })).status, 200);
  assert.equal((await ad.post(`/api/admin/bookings/${r1.body.id}/refund`)).status, 200);
  at(`${day0} 15:30`);
  assert.equal((await ad.post(`/api/admin/bookings/${r2.body.id}/attendance`, { result: 'completed' })).status, 200);
  const list = (await ad.get('/api/admin/bookings')).body;
  assert.ok([r1, r2].every((r) => list.some((b) => b.id === r.body.id)));
  assert.equal((await ad.get('/api/admin/bookings?status=completed')).body.some((b) => b.id === r2.body.id), true);
  assert.equal((await ad.get(`/api/admin/bookings?q=${r1.body.code}`)).body.length, 1);
  const detail = (await ad.get(`/api/bookings/${r1.body.id}`)).body;
  assert.equal(detail.customerReliability.windowDays, 60);
  assert.ok(detail.history.some((x) => x.action === 'refund'));
  await noDrift();
});

test('thông báo: chủ sân nhận khi có lịch chờ duyệt; đánh dấu đã đọc', async () => {
  const cust = await person('customer');
  const a = await loginAs(cust);
  const ow = await loginAs(o1);
  const before = (await ow.get('/api/notifications')).body.unread;
  const r = await book(a, manual.courtIds[1], day1, '13:00');
  const n = (await ow.get('/api/notifications')).body;
  assert.equal(n.unread, before + 1);
  assert.equal(n.items[0].bookingId, r.body.id);
  assert.equal(n.items[0].link, `/owner-bookings.html?id=${r.body.id}`);
  assert.equal((await ow.post('/api/notifications/read-all')).status, 200);
  const after = (await ow.get('/api/notifications')).body;
  assert.equal(after.unread, 0);
  assert.ok(after.items.every((x) => x.isRead === true));
  assert.equal((await app.agent().get('/api/notifications')).status, 401);
});

test('hai thao tác tranh nhau trên một lịch (duyệt và hủy cùng lúc): đúng một bên thắng, claim vẫn khớp', async () => {
  for (let i = 0; i < 4; i += 1) {
    const cust = await person('customer');
    const a = await loginAs(cust);
    const ow = await loginAs(o1);
    const r = await book(a, manual.courtIds[0], day1, `${String(8 + i).padStart(2, '0')}:00`);
    assert.equal(r.status, 201, r.text);
    const res = await Promise.all([ow.post(`/api/owner/bookings/${r.body.id}/approve`), a.post(`/api/bookings/${r.body.id}/cancel`)]);
    const statuses = res.map((x) => x.status).sort();
    // approve rồi cancel đều hợp lệ (cả hai 200); hoặc cancel trước làm approve 409. Không được có 500.
    assert.ok(statuses.every((s) => s === 200 || s === 409), JSON.stringify(res.map((x) => [x.status, x.text])));
    assert.equal(await statusOf(r.body.id), 'cancelled');
  }
  await noDrift();
});

test('đặt được ô cuối ngày của sân đóng cửa 24:00 (giờ kết thúc lưu là 00:00 hôm sau)', async () => {
  const late = await h.makeVenueWithCourt({ ownerId: o1.id });
  await h.db.query("UPDATE venues SET close_time = '24:00:00' WHERE id = ?", [late.venueId]);
  const a = await loginAs(await person('customer'));
  const r = await book(a, late.courtIds[0], day1, '23:00');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.endAt, `${addDays(day1, 1)} 00:00:00`);
});
