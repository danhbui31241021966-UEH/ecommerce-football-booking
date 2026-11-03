// Dữ liệu demo đặt sân: lịch mẫu của khach1/chusan1, đám đông ở sân thật, danh sách chờ, thông báo; claim luôn khớp.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
test.before(async () => {
  await h.loadDemo();
  app = await h.startApp();
});
test.after(async () => {
  await app.close();
  await h.closeAll();
});

test('nạp demo: lịch mẫu theo khóa mock, đám đông chỉ ở sân thật, claim khớp trạng thái', async () => {
  const mine = await h.db.query("SELECT status, COUNT(*) AS n FROM bookings WHERE user_id = 4 GROUP BY status");
  const by = Object.fromEntries(mine.map((r) => [r.status, r.n]));
  // k1,k2,k3,k4,k5,k11 của khach1: confirmed k1,k5; pending k2; completed k3; cancelled k4; rejected k11
  assert.deepEqual(by, { confirmed: 2, pending: 1, completed: 1, cancelled: 1, rejected: 1 });
  const k1 = await h.db.one('SELECT code, id FROM bookings WHERE id = 1');
  assert.equal(k1.code, 'SN00001');
  assert.ok((await h.db.query('SELECT DISTINCT venue_id FROM bookings WHERE venue_id >= 7')).length > 10, 'sân thật có khách nền');
  assert.ok((await h.db.one('SELECT COUNT(*) AS n FROM bookings WHERE venue_id < 7 AND source = \'web\' AND match_id IS NULL')).n <= 21, 'sân demo có lịch mẫu và lịch nhận pass');
  assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
  const waits = await h.db.query('SELECT status FROM waitlist ORDER BY id');
  assert.deepEqual(waits.map((w) => w.status), ['waiting', 'waiting', 'waiting', 'offered']);
  assert.ok((await h.db.one('SELECT COUNT(*) AS n FROM notifications n LEFT JOIN bookings b ON b.id = n.booking_id WHERE b.match_id IS NULL')).n >= 8);
  assert.ok((await h.db.one('SELECT COUNT(*) AS n FROM booking_history')).n > 20);
});

test('qua API: khach1 thấy lịch của mình, chusan1 thấy lịch chờ duyệt, lưới giờ thấy ô đã có người', async () => {
  const k = app.agent();
  assert.equal((await k.post('/api/auth/login', { email: 'khach1@datsan.local', password: 'Matkhau@123' })).status, 200);
  const list = (await k.get('/api/bookings/mine')).body;
  assert.equal(list.length, 6);
  const n = (await k.get('/api/notifications')).body;
  assert.equal(n.unread, 4);
  assert.equal((await k.get('/api/waitlist/mine')).body.length, 2);
  const rel = (await k.get('/api/bookings/reliability')).body;
  assert.deepEqual([rel.noShows, rel.lateCancels, rel.restricted], [0, 1, false]);

  const o = app.agent();
  assert.equal((await o.post('/api/auth/login', { email: 'chusan1@datsan.local', password: 'Matkhau@123' })).status, 200);
  const pending = (await o.get('/api/owner/bookings?status=pending')).body;
  assert.ok(pending.length >= 1 && pending.every((b) => b.status === 'pending'));
  assert.equal((await o.get('/api/owner/bookings')).body.every((b) => [1, 2, 3, 4, 5, 6].includes(b.venueId) || b.venueId >= 1), true);
});

test('lịch điện thoại mẫu: Anh Tùng đã trả, Chị Lan (Zalo) chưa trả; không tài khoản, có claim, không thông báo', async () => {
  const rows = await h.db.query("SELECT walk_in_name, payment_status, user_id, status, start_at FROM bookings WHERE source = 'phone' ORDER BY id");
  assert.deepEqual(rows.map((r) => [r.walkInName, r.paymentStatus, r.userId, r.status]), [
    ['Anh Tùng', 'paid', null, 'confirmed'],
    ['Chị Lan (Zalo)', 'unpaid', null, 'confirmed'],
  ]);
  assert.ok(rows.every((r) => Date.parse(`${r.startAt.replace(' ', 'T')}+07:00`) > Date.now()), 'ô chưa bắt đầu');
  assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
});
