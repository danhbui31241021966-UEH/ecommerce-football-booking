const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { addDays } = require('../src/lib/time');
test.after(() => h.closeAll());

async function setup() {
  await h.emptyData();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerA = { ...(await h.makeUser({ role: 'owner', email: `owner-a-${suffix}@test.local` })), email: `owner-a-${suffix}@test.local` };
  const ownerB = { ...(await h.makeUser({ role: 'owner', email: `owner-b-${suffix}@test.local` })), email: `owner-b-${suffix}@test.local` };
  const customer = { ...(await h.makeUser({ email: `customer-${suffix}@test.local` })), email: `customer-${suffix}@test.local` };
  const admin = { ...(await h.makeUser({ role: 'admin', email: `admin-${suffix}@test.local` })), email: `admin-${suffix}@test.local` };
  const venue = await h.makeVenueWithCourt({ ownerId: ownerA.id });
  const app = await h.startApp();
  return { app, ownerA, ownerB, customer, admin, venue, date: h.tomorrow() };
}

async function login(app, user) {
  const agent = app.agent();
  const response = await agent.post('/api/auth/login', { email: user.email, password: 'Matkhau@123' });
  assert.equal(response.status, 200, response.text);
  return agent;
}

test('chủ sân vẫn xem được lịch xa ngoài cửa sổ đặt', async () => {
  const ctx = await setup();
  try {
    const owner = await login(ctx.app, ctx.ownerA);
    const far = addDays(h.clock.today(), 30);
    const response = await owner.get(`/api/owner/venues/${ctx.venue.venueId}/schedule?date=${far}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.date, far);
  } finally {
    await ctx.app.close();
  }
});

test('chủ sân B không xóa được lịch chặn của chủ sân A, lịch chặn vẫn còn', async () => {
  const ctx = await setup();
  try {
    const ownerA = await login(ctx.app, ctx.ownerA);
    const ownerB = await login(ctx.app, ctx.ownerB);
    const created = await ownerA.post('/api/owner/blocks', {
      courtId: ctx.venue.courtIds[0], date: ctx.date, start: '10:00', end: '11:00', reason: 'Bảo trì',
    });
    assert.equal(created.status, 201);

    const denied = await ownerB.del(`/api/owner/blocks/${created.body.id}`);
    assert.equal(denied.status, 403);
    assert.equal((await h.db.one('SELECT id FROM blocks WHERE id = ?', [created.body.id])).id, created.body.id);
  } finally {
    await ctx.app.close();
  }
});

test('chủ sân B không sửa được sân con của chủ sân A', async () => {
  const ctx = await setup();
  try {
    const ownerB = await login(ctx.app, ctx.ownerB);
    const response = await ownerB.put(`/api/owner/courts/${ctx.venue.courtIds[0]}`, { price: 999000 });
    assert.equal(response.status, 403);
    const court = await h.db.one('SELECT price FROM courts WHERE id = ?', [ctx.venue.courtIds[0]]);
    assert.equal(court.price, 300000);
  } finally {
    await ctx.app.close();
  }
});

test('chặn nhiều ô trùng một lịch đặt thì 409, không để lại lịch chặn hay claim nào', async () => {
  const ctx = await setup();
  try {
    const owner = await login(ctx.app, ctx.ownerA);
    const customer = await login(ctx.app, ctx.customer);
    const booking = await customer.post('/api/bookings', {
      courtId: ctx.venue.courtIds[0], date: ctx.date, start: '11:00', note: '',
    });
    assert.equal(booking.status, 201);

    const blocked = await owner.post('/api/owner/blocks', {
      courtId: ctx.venue.courtIds[0], date: ctx.date, start: '10:00', end: '12:00', reason: 'Bảo trì',
    });
    assert.equal(blocked.status, 409);
    assert.equal((await h.db.query('SELECT id FROM blocks')).length, 0);
    const claims = await h.db.query('SELECT kind FROM slot_claims');
    assert.deepEqual(claims, [{ kind: 'booking' }]);
  } finally {
    await ctx.app.close();
  }
});

test('bỏ chặn thì ô đặt lại được', async () => {
  const ctx = await setup();
  try {
    const owner = await login(ctx.app, ctx.ownerA);
    const customer = await login(ctx.app, ctx.customer);
    const blocked = await owner.post('/api/owner/blocks', {
      courtId: ctx.venue.courtIds[0], date: ctx.date, start: '10:00', end: '11:00', reason: 'Bảo trì',
    });
    assert.equal(blocked.status, 201);
    assert.equal((await owner.del(`/api/owner/blocks/${blocked.body.id}`)).status, 204);
    assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });

    const booking = await customer.post('/api/bookings', {
      courtId: ctx.venue.courtIds[0], date: ctx.date, start: '10:00', note: '',
    });
    assert.equal(booking.status, 201);
  } finally {
    await ctx.app.close();
  }
});

test('đổi giá sân con và khung cao điểm thì giá ô trên lịch đổi theo', async () => {
  const ctx = await setup();
  try {
    const owner = await login(ctx.app, ctx.ownerA);
    const courtUpdate = await owner.put(`/api/owner/courts/${ctx.venue.courtIds[0]}`, { price: 350000, peakPrice: 500000 });
    assert.equal(courtUpdate.status, 200);
    let schedule = await owner.get(`/api/owner/venues/${ctx.venue.venueId}/schedule?date=${ctx.date}`);
    assert.equal(schedule.body.courts[0].slots.find((slot) => slot.start === '10:00').basePrice, 350000);

    const venueUpdate = await owner.put(`/api/owner/venues/${ctx.venue.venueId}`, {
      peakStart: '09:00', peakEnd: '11:00', bankBin: '970415', bankAccount: '123456', bankAccountName: 'CHU SAN',
    });
    assert.equal(venueUpdate.status, 200);
    assert.equal(venueUpdate.body.bankBin, '970415');
    schedule = await owner.get(`/api/owner/venues/${ctx.venue.venueId}/schedule?date=${ctx.date}`);
    assert.equal(schedule.body.courts[0].slots.find((slot) => slot.start === '10:00').basePrice, 500000);
    assert.equal(JSON.stringify(schedule.body).includes('court_id'), false);
  } finally {
    await ctx.app.close();
  }
});

test('admin xem danh sách người dùng lọc theo vai trò, khóa camelCase; người không phải admin bị 403', async () => {
  const ctx = await setup();
  try {
    const admin = await login(ctx.app, ctx.admin);
    const customer = await login(ctx.app, ctx.customer);
    const response = await admin.get('/api/admin/users?role=owner');
    assert.equal(response.status, 200);
    assert.ok(response.body.length >= 1);
    assert.ok(response.body.every((user) => user.role === 'owner'));
    assert.deepEqual(Object.keys(response.body[0]).sort(), ['createdAt', 'email', 'fullName', 'id', 'isActive', 'phone', 'role'].sort());
    assert.equal((await customer.get('/api/admin/users')).status, 403);
  } finally {
    await ctx.app.close();
  }
});

test('admin tạo chủ sân, chủ sân mới đăng nhập được với vai trò owner', async () => {
  const ctx = await setup();
  try {
    const admin = await login(ctx.app, ctx.admin);
    const email = `new-owner-${Date.now()}@test.local`;
    const created = await admin.post('/api/admin/owners', {
      fullName: 'Chủ sân mới', email, phone: '0912345678', password: 'OwnerPass123',
    });
    assert.equal(created.status, 201);
    const owner = ctx.app.agent();
    const loginResult = await owner.post('/api/auth/login', { email, password: 'OwnerPass123' });
    assert.equal(loginResult.status, 200);
    assert.equal(loginResult.body.user.role, 'owner');
  } finally {
    await ctx.app.close();
  }
});

test('tạo chủ sân trùng email thì 409', async () => {
  const ctx = await setup();
  try {
    const admin = await login(ctx.app, ctx.admin);
    const response = await admin.post('/api/admin/owners', {
      fullName: 'Trùng email', email: ctx.ownerA.email, phone: '0912345678', password: 'OwnerPass123',
    });
    assert.equal(response.status, 409);
  } finally {
    await ctx.app.close();
  }
});

test('tạo chủ sân với dữ liệu sai thì 400', async () => {
  const ctx = await setup();
  try {
    const admin = await login(ctx.app, ctx.admin);
    const response = await admin.post('/api/admin/owners', {
      fullName: 'X', email: 'not-an-email', phone: '123', password: 'short',
    });
    assert.equal(response.status, 400);
  } finally {
    await ctx.app.close();
  }
});

test('khóa tài khoản có hiệu lực ngay ở request sau; mở khóa thì đăng nhập lại được', async () => {
  const ctx = await setup();
  try {
    const admin = await login(ctx.app, ctx.admin);
    const formerSession = await login(ctx.app, ctx.ownerA);
    assert.equal((await admin.post(`/api/admin/users/${ctx.ownerA.id}/active`, { active: false })).status, 200);
    assert.equal((await formerSession.get('/api/owner/venues')).status, 401);
    assert.equal((await admin.post(`/api/admin/users/${ctx.ownerA.id}/active`, { active: true })).status, 200);

    const reopenedLogin = await ctx.app.agent().post('/api/auth/login', {
      email: ctx.ownerA.email, password: 'Matkhau@123',
    });
    assert.equal(reopenedLogin.status, 200);
    assert.equal(reopenedLogin.body.user.role, 'owner');
  } finally {
    await ctx.app.close();
  }
});

test('bỏ chặn thì người đang chờ ô đó được mời đặt (R9)', async () => {
  const ctx = await setup();
  try {
    const owner = await login(ctx.app, ctx.ownerA);
    const courtId = ctx.venue.courtIds[0];
    const blocked = await owner.post('/api/owner/blocks', { courtId, date: ctx.date, start: '10:00', end: '11:00', reason: 'Bảo trì' });
    assert.equal(blocked.status, 201);
    // Người chờ còn lại từ một lịch đặt trước đó của ô này; khách không tự vào hàng chờ được khi ô đang bị chặn.
    await h.db.query(
      "INSERT INTO waitlist (user_id, court_id, start_at, status, created_at) VALUES (?, ?, ?, 'waiting', ?)",
      [ctx.customer.id, courtId, `${ctx.date} 10:00:00`, `${ctx.date.slice(0, 10)} 00:00:00`],
    );

    assert.equal((await owner.del(`/api/owner/blocks/${blocked.body.id}`)).status, 204);

    const entry = await h.db.one('SELECT status, offer_expires_at FROM waitlist WHERE user_id = ?', [ctx.customer.id]);
    assert.equal(entry.status, 'offered');
    assert.ok(entry.offerExpiresAt);
    const notes = await h.db.query('SELECT link FROM notifications WHERE user_id = ?', [ctx.customer.id]);
    assert.equal(notes.length, 1);
    assert.match(notes[0].link, new RegExp(`court=${courtId}`));
    assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
  } finally {
    await ctx.app.close();
  }
});
