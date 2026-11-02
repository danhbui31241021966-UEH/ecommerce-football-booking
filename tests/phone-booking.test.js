// R16: lịch khách gọi điện/Zalo do chủ sân ghi. Không tài khoản, không thông báo, không đụng uy tín; chiếm ô như lịch web.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { addDays } = require('../src/lib/time');

let app;
let o1;
let o2;
let admin;
let v;
let day1;
const person = async (role) => {
  const email = `${role}${Math.random().toString(36).slice(2, 8)}@test.local`;
  return { ...(await h.makeUser({ role, email, fullName: `Người ${role}` })), email };
};
const loginAs = async (u) => {
  const a = app.agent();
  assert.equal((await a.post('/api/auth/login', { email: u.email, password: 'Matkhau@123' })).status, 200);
  return a;
};
const noDrift = async () => assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });

test.before(async () => {
  await h.emptyData();
  o1 = await person('owner');
  o2 = await person('owner');
  admin = await person('admin');
  v = await h.makeVenueWithCourt({ ownerId: o1.id, courts: 2 });
  day1 = addDays(h.clock.today(), 1);
  app = await h.startApp();
});
test.after(async () => {
  await app.close();
  await h.closeAll();
});

test('thêm lịch điện thoại: source phone, không tài khoản, không thông báo, chiếm ô, hiện ở danh sách chủ sân/admin và là ô đã đặt với khách', async () => {
  const ow = await loginAs(o1);
  const r = await ow.post('/api/owner/bookings', { courtId: v.courtIds[0], date: day1, start: '18:00', customerName: ' Anh Tùng ', customerPhone: '0903 111 222', paid: true, note: 'Đá hằng tuần' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.source, r.body.status, r.body.paymentStatus, r.body.price, r.body.customerName, r.body.customerPhone], ['phone', 'confirmed', 'paid', 450000, 'Anh Tùng', '0903 111 222']);
  const row = await h.db.one('SELECT user_id, walk_in_name FROM bookings WHERE id = ?', [r.body.id]);
  assert.deepEqual([row.userId, row.walkInName], [null, 'Anh Tùng']);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications')).n, 0);
  assert.ok((await ow.get('/api/owner/bookings')).body.some((b) => b.id === r.body.id && b.source === 'phone' && b.customerName === 'Anh Tùng'));
  const ad = await loginAs(admin);
  assert.equal((await ad.get(`/api/admin/bookings?q=${encodeURIComponent('Tùng')}`)).body.length, 1);
  const sched = (await ow.get(`/api/owner/venues/${v.venueId}/schedule?date=${day1}`)).body;
  const cell = sched.courts[0].slots.find((s) => s.start === '18:00');
  assert.deepEqual([cell.status, cell.booking.source, cell.booking.customerName, cell.booking.paymentStatus], ['booked', 'phone', 'Anh Tùng', 'paid']);
  const detail = (await ow.get(`/api/bookings/${r.body.id}`)).body;
  assert.equal(detail.customerReliability, null);
  assert.equal(detail.history[0].action, 'phone_create');
  const guest = await loginAs(await person('customer'));
  const slot = (await guest.get(`/api/venues/${v.venueId}/schedule?date=${day1}`)).body.courts[0].slots.find((s) => s.start === '18:00');
  assert.equal(slot.status, 'booked');
  const taken = await guest.post('/api/bookings', { courtId: v.courtIds[0], date: day1, start: '18:00' });
  assert.equal(taken.status, 409);
  // Giá mặc định lấy giá thường, nhập lại được.
  const d = await ow.post('/api/owner/bookings', { courtId: v.courtIds[0], date: day1, start: '10:00', customerName: 'Chị Lan', price: 200000 });
  assert.deepEqual([d.status, d.body.price, d.body.paymentStatus], [201, 200000, 'unpaid']);
  await noDrift();
});

test('kiểm tra đầu vào và giờ không thêm được', async () => {
  const ow = await loginAs(o1);
  const post = (b) => ow.post('/api/owner/bookings', { courtId: v.courtIds[1], date: day1, start: '12:00', customerName: 'A', ...b });
  assert.equal((await post({ customerName: '  ' })).status, 400);
  assert.equal((await post({ customerName: 'x'.repeat(81) })).status, 400);
  assert.equal((await post({ customerPhone: 'abc' })).status, 400);
  assert.equal((await post({ price: -1 })).status, 400);
  assert.equal((await post({ price: 100000001 })).status, 400);
  assert.equal((await post({ start: '12:30' })).status, 400);
  assert.equal((await post({ date: addDays(h.clock.today(), -1) })).status, 400);
  assert.equal((await post({ courtId: 999999 })).status, 404);
  await h.db.query('UPDATE courts SET is_active = 0 WHERE id = ?', [v.courtIds[1]]);
  assert.equal((await post({})).status, 409);
  await h.db.query('UPDATE courts SET is_active = 1, team_mode_enabled = 1 WHERE id = ?', [v.courtIds[1]]);
  assert.equal((await post({})).status, 409, 'giờ chỉ ghép kèo');
  await h.db.query('UPDATE courts SET team_mode_enabled = 0 WHERE id = ?', [v.courtIds[1]]);
  const blk = await h.db.query("INSERT INTO blocks (court_id, start_at, end_at, reason, created_by, created_at) VALUES (?, ?, ?, 'Bảo trì', ?, ?)", [v.courtIds[1], `${day1} 13:00:00`, `${day1} 14:00:00`, o1.id, h.clock.now()]);
  await h.db.query("INSERT INTO slot_claims (court_id, start_at, kind, block_id) VALUES (?, ?, 'block', ?)", [v.courtIds[1], `${day1} 13:00:00`, blk.insertId]);
  assert.equal((await post({ start: '13:00' })).status, 409, 'giờ bị chặn');
  assert.equal((await post({})).status, 201);
  assert.equal((await post({})).status, 409, 'đã có lịch');
  assert.equal((await (await loginAs(o2)).post('/api/owner/bookings', { courtId: v.courtIds[1], date: day1, start: '15:00', customerName: 'A' })).status, 403);
  assert.equal((await (await loginAs(await person('customer'))).post('/api/owner/bookings', {})).status, 403);
  await noDrift();
});

test('hai lần thêm cùng một ô cùng lúc: đúng một 201, bên kia 409 do CSDL', async () => {
  const ow = await loginAs(o1);
  const ow2 = await loginAs(o1);
  const send = (a) => a.post('/api/owner/bookings', { courtId: v.courtIds[0], date: day1, start: '20:00', customerName: 'Đua' });
  const rs = await Promise.all([send(ow), send(ow2)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409], JSON.stringify(rs.map((r) => r.text)));
  await noDrift();
});

test('sửa lịch điện thoại: tên/SĐT/giá/ghi chú; lịch web 409; đã trả khóa giá; chủ sân khác 403; đã hủy 409', async () => {
  const ow = await loginAs(o1);
  const mk = async (start, extra = {}) => (await ow.post('/api/owner/bookings', { courtId: v.courtIds[0], date: day1, start, customerName: 'Gốc', customerPhone: '0900 000 001', ...extra })).body;
  const b = await mk('07:00');
  const u = await ow.put(`/api/owner/bookings/${b.id}`, { customerName: 'Mới', price: 250000, note: 'đổi' });
  assert.equal(u.status, 200, u.text);
  assert.deepEqual([u.body.customerName, u.body.customerPhone, u.body.price], ['Mới', '0900 000 001', 250000]);
  const d = (await ow.get(`/api/bookings/${b.id}`)).body;
  assert.equal(d.customerNote, 'đổi');
  assert.deepEqual(d.history.map((x) => x.action), ['phone_create', 'phone_update']);
  assert.equal((await ow.put(`/api/owner/bookings/${b.id}`, { customerPhone: 'zz' })).status, 400);
  assert.equal((await ow.put(`/api/owner/bookings/${b.id}`, { customerName: '' })).status, 400);
  assert.equal((await (await loginAs(o2)).put(`/api/owner/bookings/${b.id}`, { customerName: 'X' })).status, 403);
  // đã nhận tiền thì khóa giá nhưng vẫn sửa được tên
  await ow.post(`/api/owner/bookings/${b.id}/paid`);
  assert.equal((await ow.put(`/api/owner/bookings/${b.id}`, { price: 1 })).status, 409);
  assert.equal((await ow.put(`/api/owner/bookings/${b.id}`, { price: 250000, customerName: 'Vẫn sửa' })).status, 200);
  // lịch web
  const cust = await person('customer');
  const web = await (await loginAs(cust)).post('/api/bookings', { courtId: v.courtIds[0], date: day1, start: '08:00' });
  assert.equal((await ow.put(`/api/owner/bookings/${web.body.id}`, { customerName: 'X' })).status, 409);
  // đã hủy: hủy lịch điện thoại không có khoản trả lại, giờ trống lại
  const c = await mk('09:00', { paid: true });
  assert.equal((await ow.post(`/api/owner/bookings/${c.id}/cancel`, { reason: 'Khách báo hủy' })).status, 200);
  const after = (await ow.get(`/api/bookings/${c.id}`)).body;
  assert.deepEqual([after.status, after.refundPercent, after.refundStatus, after.refundAmount], ['cancelled', 0, 'none', 0]);
  assert.equal((await ow.put(`/api/owner/bookings/${c.id}`, { customerName: 'X' })).status, 409);
  assert.equal((await mk('09:00')).source, 'phone', 'ô trống lại nên thêm được');
  assert.equal((await ow.put('/api/owner/bookings/999999', {})).status, 404);
  await noDrift();
});

test('lịch điện thoại không đổi uy tín của ai: bùng sân không ghi vào ai, không ai bị tính vi phạm', async () => {
  const ow = await loginAs(o1);
  const notesBefore = (await h.db.one('SELECT COUNT(*) AS n FROM notifications')).n;
  h.setNow(`${h.clock.today()} 08:00`);
  const b = (await ow.post('/api/owner/bookings', { courtId: v.courtIds[1], date: h.clock.today(), start: '09:00', customerName: 'Vắng' })).body;
  assert.ok(b.id);
  h.setNow(`${h.clock.today()} 10:30`);
  assert.equal((await ow.post(`/api/owner/bookings/${b.id}/attendance`, { result: 'no_show' })).status, 200);
  assert.equal((await h.db.one('SELECT COUNT(*) AS n FROM notifications')).n, notesBefore, 'không thông báo ai');
  const { reliabilityOf } = require('../src/services/reliability');
  assert.equal((await reliabilityOf(h.db, null)).violations, 0);
  const users = await h.db.query('SELECT id FROM users');
  for (const u of users) assert.equal((await reliabilityOf(h.db, u.id)).noShows, 0);
  h.clock.setOffsetMinutes(0);
  await noDrift();
});
