// Ghép kèo (R13) và kèo tiền sân (R15) qua HTTP trên MySQL thật. Mỗi test dựng dữ liệu riêng và kiểm slot_claims không lệch.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { sweep } = require('../src/services/bookingOps');
const matchOps = require('../src/services/matchOps');
const { reliabilityOf } = require('../src/services/reliability');

let app;
let seq = 0;
let TODAY; // cố định theo từng test: đồng hồ bị tua nên không gọi lại clock.today()
let DAY;
const D = () => DAY;
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

async function login(user) {
  const a = app.agent();
  const r = await a.post('/api/auth/login', { email: user.email, password: 'Matkhau@123' });
  assert.equal(r.status, 200, r.text);
  return a;
}
async function person(role = 'customer', name = 'Người thử') {
  seq += 1;
  const email = `m${seq}-${Date.now()}@test.local`;
  const u = await h.makeUser({ role, email, fullName: name });
  return { ...u, email, a: await login({ email }) };
}

/** Sân con bật ghép kèo 18:00–22:00 (19:00 giá cao điểm 450.000, 21:00 giá thường 300.000), chủ sân và các khách. */
async function world({ customers = 3 } = {}) {
  await h.emptyData();
  TODAY = h.clock.today();
  DAY = h.tomorrow();
  h.setNow(stamp(TODAY, '09:00'));
  const owner = await person('owner', 'Chủ sân');
  const { venueId, courtIds } = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 2 });
  await h.db.query("UPDATE venues SET bank_bin = '970436', bank_account = '0011223344', bank_account_name = 'CHU SAN' WHERE id = ?", [venueId]);
  await h.db.query("UPDATE courts SET team_mode_enabled = 1, team_mode_from = '18:00', team_mode_to = '22:00' WHERE id = ?", [courtIds[0]]);
  const people = [];
  for (let i = 0; i < customers; i += 1) people.push(await person('customer', `Đội ${i + 1}`));
  return { owner, venueId, courtId: courtIds[0], plainCourtId: courtIds[1], people };
}
const open = (w, host, { start = '19:00', loserPercent = 50, closesAt, date = D() } = {}) =>
  host.a.post('/api/matches', { courtId: w.courtId, date, start, loserPercent, closesAt: closesAt || stamp(date, '16:00') });
const confirm = (w, id, part) => w.owner.a.post(`/api/owner/matches/${id}/confirm-part`, { part });
const row = (id) => h.db.one('SELECT * FROM matches WHERE id = ?', [id]);
const booking = (id) => h.db.one('SELECT * FROM bookings WHERE id = ?', [id]);

/** Mở kèo, chủ sân xác nhận đội mở, đội vào, chủ sân xác nhận đội vào: trả về trận đã chốt. */
async function confirmedMatch(w, { loserPercent = 70, start = '19:00' } = {}) {
  const [host, guest] = w.people;
  const m = (await open(w, host, { start, loserPercent })).body;
  assert.equal((await confirm(w, m.id, 'host')).status, 200);
  assert.equal((await guest.a.post(`/api/matches/${m.id}/join`)).status, 200);
  const done = await confirm(w, m.id, 'guest');
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.status, 'confirmed');
  return m.id;
}

test('mở kèo: giữ ô bằng booking matching, QR nửa tiền, chỉ hiện cho đội khác sau khi chủ sân xác nhận', async () => {
  const w = await world();
  const [host, other] = w.people;
  const r = await open(w, host, { loserPercent: 60 });
  assert.equal(r.status, 201, r.text);
  const m = r.body;
  assert.equal(m.status, 'open');
  assert.equal(m.price, 450000);
  assert.equal(m.hostAmount, 225000);
  assert.equal(m.guestAmount, 225000);
  assert.equal(m.loserAmount, 270000);
  assert.equal(m.winnerAmount, 180000);
  assert.equal(m.role, 'host');
  assert.equal(m.paymentQr.amount, 225000);
  assert.match(m.paymentQr.content, /^TDSN\d{5}A$/);
  const b = await booking(m.bookingId);
  assert.equal(b.status, 'matching');
  assert.equal(b.matchId, m.id);
  assert.equal(b.userId, host.id);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM slot_claims WHERE booking_id = ?', [b.id])).n, 1);
  // Chủ sân được báo; đội khác chưa thấy kèo trong danh sách.
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND booking_id = ?', [w.owner.id, b.id])).n, 1);
  assert.equal((await app.agent().get('/api/matches')).body.length, 0);
  assert.equal((await other.a.get(`/api/matches/${m.id}`)).body.joinable, false);
  await confirm(w, m.id, 'host');
  const list = (await app.agent().get(`/api/matches?venueId=${w.venueId}&date=${D()}`)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].joinable, true);
  assert.equal(list[0].paymentQr, undefined);
  assert.equal((await app.agent().get('/api/matches?date=2000-01-01')).body.length, 0);
  const slotOf = async (viewer) => (await viewer.get(`/api/venues/${w.venueId}/schedule?date=${D()}`)).body.courts.find((c) => c.id === w.courtId).slots.find((x) => x.start === '19:00');
  assert.deepEqual(await slotOf(other.a).then((x) => [x.status, x.match]), ['held', { id: m.id, status: 'open', joinable: true }]);
  assert.equal((await slotOf(host.a)).match.joinable, false, 'đội mở không tự vào');
  // Danh sách của tôi và của chủ sân.
  assert.equal((await host.a.get('/api/matches/mine')).body.length, 1);
  assert.equal((await w.owner.a.get('/api/owner/matches')).body.length, 1);
  const bk = (await host.a.get('/api/bookings/mine')).body[0];
  assert.deepEqual({ id: bk.match.id, status: bk.match.status }, { id: m.id, status: 'open' });
});

test('mở kèo: kiểm đầu vào và giờ không phải ghép kèo, ô đã có người', async () => {
  const w = await world();
  const [host, other] = w.people;
  const plain = await host.a.post('/api/matches', { courtId: w.plainCourtId, date: D(), start: '19:00', loserPercent: 50, closesAt: stamp(D(), '16:00') });
  assert.equal(plain.status, 409);
  assert.equal((await host.a.post('/api/matches', { courtId: w.courtId, date: D(), start: '10:00', loserPercent: 50, closesAt: stamp(D(), '08:00') })).status, 409);
  assert.equal((await open(w, host, { loserPercent: 55 })).status, 400);
  assert.equal((await open(w, host, { closesAt: stamp(D(), '17:30') })).status, 400, 'hạn chót sát giờ đá quá 2 giờ');
  assert.equal((await open(w, host, { closesAt: stamp(TODAY, '09:30') })).status, 400, 'hạn chót trước 60 phút từ bây giờ');
  assert.equal((await open(w, host, { closesAt: 'mai' })).status, 400);
  assert.equal((await app.agent().post('/api/matches', {})).status, 401);
  assert.equal((await w.owner.a.post('/api/matches', {})).status, 403);
  // Đặt thường trong giờ ghép kèo bị chặn; kèo mở rồi thì người khác không mở/đặt trùng ô.
  assert.equal((await other.a.post('/api/bookings', { courtId: w.courtId, date: D(), start: '20:00' })).status, 409);
  assert.equal((await open(w, host)).status, 201);
  assert.equal((await open(w, other)).status, 409);
  const slots = (await other.a.get(`/api/venues/${w.venueId}/schedule?date=${D()}`)).body;
  const slot = slots.courts.find((c) => c.id === w.courtId).slots.find((s) => s.start === '19:00');
  assert.equal(slot.status, 'held');
});

test('hai đội vào cùng lúc: đúng một đội được vào, các đội còn lại 409', async () => {
  const w = await world({ customers: 9 });
  const [host, ...guests] = w.people;
  const m = (await open(w, host)).body;
  assert.equal((await guests[0].a.post(`/api/matches/${m.id}/join`)).status, 409, 'phần của đội mở chưa được xác nhận');
  await confirm(w, m.id, 'host');
  assert.equal((await host.a.post(`/api/matches/${m.id}/join`)).status, 400, 'đội mở không tự vào');
  const results = await Promise.all(guests.map((g) => g.a.post(`/api/matches/${m.id}/join`)));
  // Cùng lúc ở tầng dịch vụ (không qua HTTP, các lời gọi chồng lên nhau chặt hơn): vẫn đúng một đội thắng.
  const m2 = (await open(w, host, { start: '20:00' })).body;
  await confirm(w, m2.id, 'host');
  const direct = await Promise.allSettled(guests.map((g) => matchOps.joinMatch(g, m2.id)));
  assert.equal(direct.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(direct.map((r) => r.status)));
  assert.ok(direct.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409));
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM matches WHERE id = ? AND guest_id IS NOT NULL', [m2.id])).n, 1);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, ...Array(guests.length - 1).fill(409)]);
  const winner = guests[results.findIndex((r) => r.status === 200)];
  const after = await row(m.id);
  assert.equal(after.guestId, winner.id);
  assert.equal(after.status, 'joined');
  const ok = results.find((r) => r.status === 200).body;
  assert.equal(ok.role, 'guest');
  assert.equal(ok.paymentQr.amount, 225000);
  assert.match(ok.paymentQr.content, /B$/);
  // Đội thua không thấy QR hay vai trò trong kèo.
  const lost = guests[results.findIndex((r) => r.status === 409)];
  const view = (await lost.a.get(`/api/matches/${m.id}`)).body;
  assert.equal(view.role, null);
  assert.equal(view.paymentQr, undefined);
});

test('chủ sân xác nhận từng phần: đủ hai phần thì booking confirmed + paid; kiểm quyền và xác nhận lặp', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const stranger = await person('owner');
  const m = (await open(w, host)).body;
  assert.equal((await stranger.a.post(`/api/owner/matches/${m.id}/confirm-part`, { part: 'host' })).status, 403);
  assert.equal((await host.a.post(`/api/owner/matches/${m.id}/confirm-part`, { part: 'host' })).status, 403);
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m.id}/confirm-part`, { part: 'x' })).status, 400);
  assert.equal((await confirm(w, m.id, 'guest')).status, 409, 'chưa có đội vào');
  assert.equal((await confirm(w, m.id, 'host')).status, 200);
  assert.equal((await confirm(w, m.id, 'host')).status, 409);
  await guest.a.post(`/api/matches/${m.id}/join`);
  assert.equal((await booking(m.bookingId)).status, 'matching');
  const done = (await confirm(w, m.id, 'guest')).body;
  assert.equal(done.status, 'confirmed');
  assert.equal(done.hostPaid && done.guestPaid, true);
  assert.equal(done.hostReliability.violations, 0);
  const b = await booking(m.bookingId);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.paymentStatus, 'paid');
  assert.equal(b.userId, host.id);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [guest.id, '%đã chốt%'])).n, 1);
  // Booking của trận đã chốt: khách không tự hủy được; không còn QR đặt sân thường.
  const cancel = await host.a.post(`/api/bookings/${m.bookingId}/cancel`, {});
  assert.equal(cancel.status, 409);
  const detail = (await host.a.get(`/api/bookings/${m.bookingId}`)).body;
  assert.equal(detail.paymentQr, null);
  assert.equal(detail.match.id, m.id);
});

test('chủ sân từ chối đội vào: kèo mở lại, đội khác vào được', async () => {
  const w = await world();
  const [host, g1, g2] = w.people;
  const m = (await open(w, host)).body;
  await confirm(w, m.id, 'host');
  await g1.a.post(`/api/matches/${m.id}/join`);
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m.id}/reject-guest`, {})).status, 400, 'bắt buộc lý do');
  const r = await w.owner.a.post(`/api/owner/matches/${m.id}/reject-guest`, { reason: 'Đội này từng bùng' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'open');
  assert.equal(r.body.hasGuest, false);
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m.id}/reject-guest`, { reason: 'x' })).status, 409);
  assert.equal((await g2.a.post(`/api/matches/${m.id}/join`)).status, 200);
  assert.equal((await g1.a.get(`/api/matches/${m.id}`)).body.role, null);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [g1.id, '%từ chối%'])).n, 1);
});

test('hết giữ chỗ: đội mở chưa được xác nhận thì hủy nhả ô, không hoàn; đội vào quá hạn thì rời trận', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const m1 = (await open(w, host)).body;
  h.setNow(stamp(TODAY, '09:16'));
  await sweep();
  const a = await row(m1.id);
  assert.equal(a.status, 'cancelled');
  assert.equal((await booking(m1.bookingId)).status, 'expired');
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM match_refunds')).n, 0);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM slot_claims WHERE booking_id = ?', [m1.bookingId])).n, 0);
  assert.equal((await guest.a.post(`/api/matches/${m1.id}/join`)).status, 409);

  // Ô nhả ra, mở lại được; đội vào quá 15 phút chưa được xác nhận thì rời trận.
  const m2 = (await open(w, host)).body;
  await confirm(w, m2.id, 'host');
  await guest.a.post(`/api/matches/${m2.id}/join`);
  h.setNow(stamp(TODAY, '09:32'));
  await sweep();
  const b = await row(m2.id);
  assert.equal(b.status, 'open');
  assert.equal(b.guestId, null);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [guest.id, '%Bạn không còn trong kèo%'])).n, 1);
});

test('hết hạn tìm đội: trận expired, ô nhả, hoàn đủ phần đã xác nhận; chủ sân ghi nhận hoàn từng đội', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const m = (await open(w, host)).body;
  await confirm(w, m.id, 'host');
  await guest.a.post(`/api/matches/${m.id}/join`);
  await confirm(w, m.id, 'guest').then(async (r) => assert.equal(r.status, 200));
  // Đội thứ hai đã chốt nên thử trận khác: chỉ có đội mở, quá hạn.
  const m2 = (await open(w, w.people[2], { start: '20:00', closesAt: stamp(D(), '16:00') })).body;
  await confirm(w, m2.id, 'host');
  h.setNow(stamp(D(), '16:01'));
  await sweep();
  const e = await row(m2.id);
  assert.equal(e.status, 'expired');
  assert.equal((await booking(m2.bookingId)).status, 'expired');
  const refunds = await h.db.query('SELECT * FROM match_refunds WHERE match_id = ?', [m2.id]);
  assert.deepEqual(refunds.map((r) => [r.part, r.amount, r.status]), [['host', 225000, 'pending']]);
  assert.equal((await booking(m2.bookingId)).refundStatus, 'pending');
  const owner = (await w.owner.a.get('/api/owner/matches')).body.find((x) => x.id === m2.id);
  assert.equal(owner.refunds[0].status, 'pending');
  const mine = (await w.people[2].a.get(`/api/matches/${m2.id}`)).body;
  assert.deepEqual(mine.yourPart.refund, { status: 'pending', amount: 225000 });
  const done = await w.owner.a.post(`/api/owner/matches/${m2.id}/refund`, { note: 'đã chuyển' });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.refunds[0].status, 'done');
  assert.equal((await booking(m2.bookingId)).refundStatus, 'done');
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m2.id}/refund`, {})).status, 409);
  // Trận đã chốt đầy đủ không bị hết hạn.
  assert.equal((await row(m.id)).status, 'confirmed');
});

test('chủ sân hủy: kèo đang chờ hoàn phần đã xác nhận; kèo đã chốt hủy qua lịch đặt hoàn 100% hai đội, ghi nhận từng đội', async () => {
  const w = await world();
  const [host, guest, third] = w.people;
  const m = (await open(w, host)).body;
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m.id}/cancel`, {})).status, 400, 'bắt buộc lý do');
  await confirm(w, m.id, 'host');
  await guest.a.post(`/api/matches/${m.id}/join`);
  const c = await w.owner.a.post(`/api/owner/matches/${m.id}/cancel`, { reason: 'Sân bảo trì' });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.status, 'cancelled');
  assert.deepEqual(c.body.refunds.map((r) => [r.part, r.amount]), [['host', 225000]], 'đội vào chưa được xác nhận nên không có hoàn');
  assert.equal((await booking(m.bookingId)).status, 'cancelled');
  assert.equal((await booking(m.bookingId)).cancelledBy, 'owner');
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m.id}/cancel`, { reason: 'x' })).status, 409);
  assert.equal((await w.owner.a.post(`/api/owner/bookings/${m.bookingId}/refund`, {})).status, 200, 'hoàn qua lịch đặt khi chỉ có một khoản');
  assert.equal((await booking(m.bookingId)).refundStatus, 'done');

  // Kèo đã chốt: hủy bằng lịch đặt (chủ sân), hoàn 100% hai đội.
  const w2 = { ...w, people: [third, host] };
  const m2 = (await open(w2, third, { start: '20:00' })).body;
  await confirm(w2, m2.id, 'host');
  await host.a.post(`/api/matches/${m2.id}/join`);
  await confirm(w2, m2.id, 'guest');
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m2.id}/cancel`, { reason: 'x' })).status, 409, 'API trận chỉ hủy trận chưa chốt');
  assert.equal((await w.owner.a.post(`/api/owner/bookings/${m2.bookingId}/cancel`, { reason: 'Mất điện' })).status, 200);
  const bk = await booking(m2.bookingId);
  assert.equal(bk.status, 'cancelled');
  assert.equal(bk.refundAmount, 450000);
  assert.equal(bk.refundPercent, 100);
  assert.equal(bk.refundStatus, 'pending');
  const b = (await w.owner.a.get('/api/owner/bookings')).body.find((x) => x.id === m2.bookingId);
  assert.equal(b.match.refunds.length, 2);
  assert.equal((await w.owner.a.post(`/api/owner/bookings/${m2.bookingId}/refund`, {})).status, 400, 'hai khoản: phải chọn đội');
  assert.equal((await w.owner.a.post(`/api/owner/bookings/${m2.bookingId}/refund`, { part: 'guest' })).status, 200);
  assert.equal((await booking(m2.bookingId)).refundStatus, 'pending');
  assert.equal((await w.owner.a.post(`/api/owner/matches/${m2.id}/refund`, { part: 'host' })).status, 200);
  assert.equal((await booking(m2.bookingId)).refundStatus, 'done');
});

test('đội mở rút: chưa có đội vào hoàn đủ không tính hủy muộn; đã có đội vào hoàn theo R7 và tính hủy muộn khi < 12 giờ', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const m1 = (await open(w, host)).body;
  await confirm(w, m1.id, 'host');
  assert.equal((await guest.a.del(`/api/matches/${m1.id}`)).status, 404, 'chỉ đội mở rút được');
  assert.equal((await host.a.del(`/api/matches/${m1.id}`)).status, 200);
  assert.equal((await host.a.del(`/api/matches/${m1.id}`)).status, 409);
  const b1 = await booking(m1.bookingId);
  assert.deepEqual([b1.status, b1.cancelledBy, b1.lateCancel, b1.refundAmount], ['cancelled', 'customer', 0, 225000]);

  // Đã có đội vào, còn hơn 24 giờ: hoàn 100% phần đội mở.
  const m2 = (await open(w, host, { start: '20:00' })).body;
  await confirm(w, m2.id, 'host');
  await guest.a.post(`/api/matches/${m2.id}/join`);
  await host.a.del(`/api/matches/${m2.id}`);
  assert.equal((await booking(m2.bookingId)).refundAmount, 225000);
  assert.equal((await booking(m2.bookingId)).lateCancel, 0);

  // Còn dưới 12 giờ: hoàn 0, hủy muộn tính vào uy tín của đội mở. Mở kèo hôm nay, giờ đá 20:00 khi bây giờ 09:00 mới hợp lệ cho 21:00.
  const today = TODAY;
  h.setNow(stamp(TODAY, '09:30'));
  const m3 = (await host.a.post('/api/matches', { courtId: w.courtId, date: today, start: '21:00', loserPercent: 50, closesAt: stamp(today, '19:00') })).body;
  assert.ok(m3.id, JSON.stringify(m3));
  await confirm(w, m3.id, 'host');
  await guest.a.post(`/api/matches/${m3.id}/join`);
  await host.a.del(`/api/matches/${m3.id}`);
  const b3 = await booking(m3.bookingId);
  assert.deepEqual([b3.lateCancel, b3.refundAmount, b3.refundStatus], [1, 0, 'none']);
  assert.equal((await reliabilityOf(h.db, host.id)).lateCancels, 1);
});

test('kết quả: hai báo cáo khớp thì chốt và tính phần chênh; chỉ đội trong kèo báo được', async () => {
  const w = await world();
  const [host, guest, other] = w.people;
  const id = await confirmedMatch(w, { loserPercent: 70 });
  assert.equal((await host.a.post(`/api/matches/${id}/result`, { winner: 'host' })).status, 409, 'chưa đá xong');
  h.setNow(stamp(D(), '20:30'));
  assert.equal((await other.a.post(`/api/matches/${id}/result`, { winner: 'host' })).status, 403);
  assert.equal((await host.a.post(`/api/matches/${id}/result`, { winner: 'ai đó' })).status, 400);
  assert.equal((await host.a.post(`/api/matches/${id}/result`, { winner: 'host', bank: { bin: '000', account: '1', accountName: 'A' } })).status, 400);
  const first = (await host.a.post(`/api/matches/${id}/result`, { winner: 'host', bank: { bin: '970436', account: '0071 0012 3456', accountName: 'nguyen van a' } })).body;
  assert.equal(first.result.status, 'awaiting');
  assert.equal(first.result.yourReport, 'host');
  assert.equal(first.result.otherReported, false);
  assert.equal(first.yourBank.account, '007100123456');
  assert.equal(first.yourBank.accountName, 'NGUYEN VAN A');
  // Đội kia chỉ thấy là đã có báo cáo, không thấy nội dung; chủ sân thấy cả hai.
  const g = (await guest.a.get(`/api/matches/${id}`)).body;
  assert.deepEqual([g.result.yourReport, g.result.otherReported, g.result.hostReport], [null, true, undefined]);
  assert.equal(g.yourBank, null);
  assert.equal((await w.owner.a.post(`/api/owner/matches/${id}/result`, { winner: 'host' })).status, 409, 'còn trong hạn báo');
  const settled = (await guest.a.post(`/api/matches/${id}/result`, { winner: 'host' })).body;
  assert.equal(settled.result.status, 'settled');
  assert.equal(settled.result.settledBy, 'agree');
  assert.equal(settled.result.winner, 'host');
  // Thắng/thua 7-3 trên 450.000: đội thua chịu 315.000, đã trả trước 225.000, trả thêm 90.000.
  assert.deepEqual([settled.result.topUp.from, settled.result.topUp.to, settled.result.topUp.amount, settled.result.topUp.status], ['guest', 'host', 90000, 'unpaid']);
  assert.equal(settled.topUpQr.amount, 90000, 'đội thua (người báo cuối) thấy QR trả chênh tới tài khoản đội thắng');
  assert.equal((await host.a.post(`/api/matches/${id}/result`, { winner: 'guest' })).status, 409, 'đã chốt');
});

test('kết quả: hai báo cáo lệch hoặc quá hạn báo thì chủ sân chốt; admin chỉ xem', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const id = await confirmedMatch(w, { loserPercent: 60 });
  h.setNow(stamp(D(), '20:30'));
  await host.a.post(`/api/matches/${id}/result`, { winner: 'host' });
  const r = (await guest.a.post(`/api/matches/${id}/result`, { winner: 'guest' })).body;
  assert.equal(r.result.status, 'needs_owner');
  assert.equal((await host.a.post(`/api/matches/${id}/result`, { winner: 'host' })).status, 409, 'đang chờ chủ sân');
  const list = (await w.owner.a.get('/api/owner/matches')).body.find((x) => x.id === id);
  assert.deepEqual([list.result.hostReport, list.result.guestReport], ['host', 'guest']);
  assert.equal((await w.owner.a.post(`/api/owner/matches/${id}/result`, { winner: 'xx' })).status, 400);
  const stranger = await person('owner');
  assert.equal((await stranger.a.post(`/api/owner/matches/${id}/result`, { winner: 'host' })).status, 403);
  const done = (await w.owner.a.post(`/api/owner/matches/${id}/result`, { winner: 'guest' })).body;
  assert.deepEqual([done.result.status, done.result.settledBy, done.result.winner, done.result.topUp.amount], ['settled', 'owner', 'guest', 45000]);
  assert.equal((await w.owner.a.post(`/api/owner/matches/${id}/result`, { winner: 'guest' })).status, 409);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [w.owner.id, '%cần bạn chốt kết quả%'])).n, 1);
});

test('kết quả: quá hạn báo mà chưa khớp thì needs_owner và đội không báo lại được; kèo 5-5 không có bước kết quả', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const stake = await confirmedMatch(w, { loserPercent: 100 });
  const even = await confirmedMatch({ ...w, people: [w.people[2], host] }, { loserPercent: 50, start: '20:00' });
  h.setNow(stamp(D(), '20:30'));
  await host.a.post(`/api/matches/${stake}/result`, { winner: 'host' }); // một bên báo
  const before = (await guest.a.get(`/api/matches/${stake}`)).body;
  assert.equal(before.result.status, 'awaiting');
  assert.ok(before.result.reportBy > stamp(D(), '20:00'));
  h.setNow(stamp(addDay(D(), 2), '21:00'));
  await sweep();
  const late = (await guest.a.get(`/api/matches/${stake}`)).body;
  assert.equal(late.result.status, 'needs_owner');
  assert.equal((await guest.a.post(`/api/matches/${stake}/result`, { winner: 'host' })).status, 409);
  const done = (await w.owner.a.post(`/api/owner/matches/${stake}/result`, { winner: 'host' })).body;
  assert.equal(done.result.topUp.amount, 225000, 'thua bao sân: trả nốt phần còn lại');
  const m = (await host.a.get(`/api/matches/${even}`)).body;
  assert.equal(m.result, null);
  assert.equal((await host.a.post(`/api/matches/${even}/result`, { winner: 'host' })).status, 409);
});

function addDay(date, n) {
  return require('../src/lib/time').addDays(date, n);
}

test('phần chênh: QR đội thua chỉ có khi đội thắng nhập tài khoản; chỉ đội thắng bấm đã nhận; hòa thì không có', async () => {
  const w = await world();
  const [host, guest, other] = w.people;
  const id = await confirmedMatch(w, { loserPercent: 70 });
  h.setNow(stamp(D(), '20:30'));
  await host.a.post(`/api/matches/${id}/result`, { winner: 'guest' });
  const s = (await guest.a.post(`/api/matches/${id}/result`, { winner: 'guest' })).body;
  assert.equal(s.result.winner, 'guest');
  assert.equal((await host.a.get(`/api/matches/${id}`)).body.topUpQr, null, 'đội thắng chưa nhập tài khoản');
  assert.equal((await other.a.put(`/api/matches/${id}/bank`, { bin: '970436', account: '123456', accountName: 'XY' })).status, 403);
  assert.equal((await guest.a.put(`/api/matches/${id}/bank`, { bin: '970436', account: '12', accountName: 'X' })).status, 400);
  assert.equal((await guest.a.put(`/api/matches/${id}/bank`, { bin: '970436', account: '9999888877', accountName: 'Tran B' })).status, 200);
  const loser = (await host.a.get(`/api/matches/${id}`)).body;
  assert.equal(loser.topUpQr.amount, 90000);
  assert.match(loser.topUpQr.url, /9999888877/);
  assert.match(loser.topUpQr.content, /^KEOSN\d{5}$/);
  assert.equal(loser.yourBank, null, 'đội thua không thấy tài khoản như của mình');
  // Chủ sân, người ngoài không thấy số tài khoản.
  const ownerView = (await w.owner.a.get(`/api/matches/${id}`)).body;
  assert.equal(ownerView.role, 'staff');
  assert.equal(JSON.stringify(ownerView).includes('9999888877'), false);
  assert.equal(JSON.stringify((await other.a.get(`/api/matches/${id}`)).body).includes('9999888877'), false);
  assert.equal((await host.a.post(`/api/matches/${id}/topup-received`)).status, 403);
  assert.equal((await other.a.post(`/api/matches/${id}/topup-received`)).status, 403);
  const got = (await guest.a.post(`/api/matches/${id}/topup-received`)).body;
  assert.equal(got.result.topUp.status, 'received');
  assert.equal((await guest.a.post(`/api/matches/${id}/topup-received`)).status, 409);
  assert.equal((await host.a.get(`/api/matches/${id}`)).body.topUpQr, undefined);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [host.id, '%Xong kèo%'])).n, 1);
});

test('hòa: không có phần chênh', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const id = await confirmedMatch(w, { loserPercent: 60 });
  h.setNow(stamp(D(), '20:30'));
  await host.a.post(`/api/matches/${id}/result`, { winner: 'draw' });
  const draw = (await guest.a.post(`/api/matches/${id}/result`, { winner: 'draw' })).body;
  assert.deepEqual([draw.result.status, draw.result.winner, draw.result.topUp], ['settled', 'draw', null]);
  assert.equal((await guest.a.post(`/api/matches/${id}/topup-received`)).status, 409);
});

test('phần chênh chưa trả quá hạn chỉ hiện overdue, không phạt uy tín', async () => {
  const w = await world();
  const [host, guest] = w.people;
  const id = await confirmedMatch(w, { loserPercent: 60 });
  h.setNow(stamp(D(), '20:30'));
  await host.a.post(`/api/matches/${id}/result`, { winner: 'host' });
  await guest.a.post(`/api/matches/${id}/result`, { winner: 'host' });
  assert.equal((await guest.a.get(`/api/matches/${id}`)).body.result.topUp.overdue, false);
  h.setNow(stamp(addDay(D(), 2), '21:00'));
  const t = (await guest.a.get(`/api/matches/${id}`)).body.result.topUp;
  assert.deepEqual([t.status, t.overdue], ['unpaid', true]);
  assert.equal((await reliabilityOf(h.db, guest.id)).violations, 0);
});

test('quyền: khách chưa đăng nhập, sai vai trò, kèo không tồn tại, id sai', async () => {
  const w = await world();
  const [host] = w.people;
  const m = (await open(w, host)).body;
  const anon = app.agent();
  assert.equal((await anon.post(`/api/matches/${m.id}/join`)).status, 401);
  assert.equal((await anon.get('/api/matches/mine')).status, 401);
  assert.equal((await anon.get('/api/owner/matches')).status, 401);
  assert.equal((await host.a.get('/api/owner/matches')).status, 403);
  assert.equal((await w.owner.a.post(`/api/matches/${m.id}/join`)).status, 403);
  assert.equal((await anon.get(`/api/matches/${m.id}`)).status, 200);
  assert.equal((await anon.get('/api/matches/99999')).status, 404);
  assert.equal((await anon.get('/api/matches/abc')).status, 404);
  assert.equal((await host.a.post('/api/matches/99999/join')).status, 404);
  // Thấy dữ liệu liên hệ của đội chỉ khi là chủ sân; người ngoài không thấy.
  const pub = (await anon.get(`/api/matches/${m.id}`)).body;
  assert.equal(pub.hostPhone, undefined);
  assert.equal(pub.hostName, undefined);
  const staff = (await w.owner.a.get('/api/owner/matches')).body[0];
  assert.equal(staff.hostName, 'Đội 1');
  assert.deepEqual(h.snakeKeys(staff), []);
});

test('nạp demo: kèo mẫu có đủ trạng thái, claim khớp, chủ sân thấy kèo cần xử lý', async () => {
  await h.loadDemo();
  const rows = await h.db.query('SELECT status, result_status, loser_percent FROM matches ORDER BY id');
  assert.ok(rows.length >= 5, 'có kèo mẫu');
  assert.ok(rows.some((r) => r.status === 'open') && rows.some((r) => r.status === 'joined') && rows.some((r) => r.status === 'confirmed'));
  assert.ok(rows.some((r) => r.resultStatus === 'settled') && rows.some((r) => r.resultStatus === 'awaiting'));
  assert.equal((await h.db.one("SELECT COUNT(*) AS n FROM bookings WHERE match_id IS NOT NULL AND status NOT IN ('matching','confirmed')")).n, 0);
  const open = (await app.agent().get('/api/matches')).body;
  assert.ok(open.length >= 2);
});
