// Tranh chấp thật qua HTTP: nhiều khách đặt cùng một ô cùng lúc, đúng một bên thành công, các bên còn lại nhận 409.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
let owner;
let courtIds;
let venueId;
let day;
const customers = [];

async function login(user) {
  const a = app.agent();
  const r = await a.post('/api/auth/login', { email: user.email, password: 'Matkhau@123' });
  assert.equal(r.status, 200, r.text);
  return a;
}
const book = (a, courtId, start, extra = {}) => a.post('/api/bookings', { courtId, date: day, start, note: '', ...extra });

test.before(async () => {
  await h.emptyData();
  owner = await h.makeUser({ role: 'owner' });
  ({ venueId, courtIds } = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 2 }));
  day = h.tomorrow();
  for (let i = 0; i < 6; i += 1) {
    const email = `race${i}@test.local`;
    const u = await h.makeUser({ email });
    customers.push({ ...u, email });
  }
  app = await h.startApp();
});
test.after(async () => {
  await app.close();
  await h.closeAll();
});

test('hai yêu cầu đặt cùng một ô cùng lúc: đúng một 201, bên kia 409', async () => {
  const [a, b] = await Promise.all([login(customers[0]), login(customers[1])]);
  for (const start of ['18:00', '19:00', '20:00', '07:00', '08:00']) {
    const results = await Promise.all([book(a, courtIds[0], start), book(b, courtIds[0], start)]);
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [201, 409], `ô ${start}: ${JSON.stringify(results.map((r) => r.body))}`);
    const loser = results.find((r) => r.status === 409);
    assert.match(loser.body.error, /người khác đặt/);
  }
  const rows = await h.db.query("SELECT court_id, start_at, COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed','matching') GROUP BY court_id, start_at");
  assert.ok(rows.length >= 5 && rows.every((r) => r.n === 1), 'mỗi ô chỉ có một lịch đang giữ');
  const drift = await h.findClaimDrift(h.db);
  assert.deepEqual(drift, { missing: [], stale: [] });
});

test('sáu khách cùng tranh một ô: đúng một thành công, năm bên 409, không lịch nào bị bỏ lơ', async () => {
  const agents = await Promise.all(customers.map(login));
  const results = await Promise.all(agents.map((a) => book(a, courtIds[1], '19:00')));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 5, JSON.stringify(results.map((r) => [r.status, r.body])));
  assert.equal((await h.db.query("SELECT 1 FROM bookings WHERE court_id = ? AND start_at = ?", [courtIds[1], `${day} 19:00:00`])).length, 1, 'lịch thua bị hoàn tác hẳn');
});

test('ô khác nhau cùng lúc đều thành công (không khóa nhầm cả sân)', async () => {
  const agents = await Promise.all(customers.slice(0, 3).map(login));
  const results = await Promise.all([book(agents[0], courtIds[0], '09:00'), book(agents[1], courtIds[0], '10:00'), book(agents[2], courtIds[1], '09:00')]);
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201]);
});

test('bấm lặp cùng idempotencyKey trả đúng lịch cũ, không tạo thêm', async () => {
  const a = await login(customers[2]);
  const key = 'abc-123';
  const [r1, r2] = [await book(a, courtIds[0], '11:00', { idempotencyKey: key }), await book(a, courtIds[0], '11:00', { idempotencyKey: key })];
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.equal(r1.body.id, r2.body.id);
  // Gửi đồng thời cùng khóa: vẫn chỉ một lịch.
  const racing = await Promise.all([book(a, courtIds[0], '12:00', { idempotencyKey: 'k2' }), book(a, courtIds[0], '12:00', { idempotencyKey: 'k2' })]);
  assert.equal(new Set(racing.map((r) => r.body.id)).size, 1, JSON.stringify(racing.map((r) => [r.status, r.body])));
});

test('đặt xong thì lưới ngày hiện ô đó đã đặt; sân tự xác nhận → confirmed, sân chờ duyệt → pending giữ 15 phút', async () => {
  const a = await login(customers[3]);
  const ok = await book(a, courtIds[0], '13:00');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, 'confirmed');
  assert.equal(ok.body.expiresAt, null);
  assert.match(ok.body.code, /^SN\d{5}$/);
  assert.equal(ok.body.price, 300000);
  const sched = await a.get(`/api/venues/${venueId}/schedule?date=${day}`);
  const slot = sched.body.courts[0].slots.find((s) => s.start === '13:00');
  assert.equal(slot.status, 'booked');
  assert.equal(slot.mine, true);

  const appr = await h.makeVenueWithCourt({ ownerId: owner.id, requiresApproval: 1 });
  const p = await book(a, appr.courtIds[0], '19:00');
  assert.equal(p.body.status, 'pending');
  assert.ok(p.body.expiresAt);
  const grid = await a.get(`/api/venues/${appr.venueId}/schedule?date=${day}`);
  assert.equal(grid.body.courts[0].slots.find((s) => s.start === '19:00').status, 'held');
  assert.equal(p.body.price, 450000, 'giờ cao điểm 17–21h');
  const mins = (new Date(p.body.expiresAt.replace(' ', 'T') + '+07:00') - new Date(p.body.createdAt.replace(' ', 'T') + '+07:00')) / 60000;
  assert.equal(mins, 15);
});

test('lỗi đầu vào: chưa đăng nhập 401, chủ sân không đặt được 403, giờ lệch lưới/quá 3 ngày/giờ đã qua 400', async () => {
  const anon = app.agent();
  assert.equal((await book(anon, courtIds[0], '14:00')).status, 401);
  const ownerAgent = await login({ ...owner, email: (await h.db.one('SELECT email FROM users WHERE id = ?', [owner.id])).email });
  assert.equal((await book(ownerAgent, courtIds[0], '14:00')).status, 403);
  const a = await login(customers[4]);
  assert.equal((await book(a, courtIds[0], '14:30')).status, 400);
  assert.equal((await a.post('/api/bookings', { courtId: courtIds[0], date: h.clock.today(), start: '00:00' })).status, 400); // ngoài lưới/đã qua
  const far = require('../src/lib/time').addDays(h.clock.today(), 3);
  assert.equal((await a.post('/api/bookings', { courtId: courtIds[0], date: far, start: '14:00' })).status, 400);
  assert.equal((await a.post('/api/bookings', { courtId: 999999, date: day, start: '14:00' })).status, 404);
  const noCsrf = await fetch(`${app.base}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
});
