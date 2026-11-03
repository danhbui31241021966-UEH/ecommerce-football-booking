const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

async function setup({ secondOwner = false, approval = false } = {}) {
  await h.emptyData();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = { ...(await h.makeUser({ role: 'owner', email: `owner-${suffix}@test.local` })), email: `owner-${suffix}@test.local` };
  const otherOwner = secondOwner
    ? { ...(await h.makeUser({ role: 'owner', email: `other-owner-${suffix}@test.local` })), email: `other-owner-${suffix}@test.local` }
    : null;
  const giver = { ...(await h.makeUser({ email: `giver-${suffix}@test.local` })), email: `giver-${suffix}@test.local` };
  const receiver = { ...(await h.makeUser({ email: `receiver-${suffix}@test.local` })), email: `receiver-${suffix}@test.local` };
  const receiverTwo = { ...(await h.makeUser({ email: `receiver-two-${suffix}@test.local` })), email: `receiver-two-${suffix}@test.local` };
  const admin = { ...(await h.makeUser({ role: 'admin', email: `admin-${suffix}@test.local` })), email: `admin-${suffix}@test.local` };
  const venue = await h.makeVenueWithCourt({ ownerId: owner.id, requiresApproval: approval ? 1 : 0 });
  await h.db.query('UPDATE venues SET bank_bin = ?, bank_account = ?, bank_account_name = ? WHERE id = ?', ['970415', '123456789', 'CHU SAN', venue.venueId]);
  const otherVenue = otherOwner ? await h.makeVenueWithCourt({ ownerId: otherOwner.id }) : null;
  const app = await h.startApp();
  const ctx = { app, owner, otherOwner, giver, receiver, receiverTwo, admin, venue, otherVenue, date: h.tomorrow() };
  ctx.ownerAgent = await login(app, owner);
  ctx.giverAgent = await login(app, giver);
  ctx.receiverAgent = await login(app, receiver);
  ctx.receiverTwoAgent = await login(app, receiverTwo);
  ctx.adminAgent = await login(app, admin);
  return ctx;
}

async function login(app, user) {
  const agent = app.agent();
  const response = await agent.post('/api/auth/login', { email: user.email, password: 'Matkhau@123' });
  assert.equal(response.status, 200, response.text);
  return agent;
}

async function createBooking(ctx, { start = '19:00', courtId = ctx.venue.courtIds[0] } = {}) {
  const response = await ctx.giverAgent.post('/api/bookings', { courtId, date: ctx.date, start, note: '' });
  assert.equal(response.status, 201, response.text);
  return response.body;
}

async function markPaid(ctx, bookingId) {
  const response = await ctx.ownerAgent.post(`/api/owner/bookings/${bookingId}/paid`, { note: 'Đã nhận tiền' });
  assert.equal(response.status, 200, response.text);
}

async function createTransfer(ctx, booking, askPrice = 200000) {
  const response = await ctx.giverAgent.post(`/api/bookings/${booking.id}/transfer`, { askPrice });
  assert.equal(response.status, 201, response.text);
  return response.body;
}

async function close(ctx) {
  await ctx.app.close();
}

test.after(() => h.closeAll());

test('transfer requires a confirmed and paid booking', async () => {
  const ctx = await setup({ approval: true });
  try {
    const booking = await createBooking(ctx);
    assert.equal(booking.status, 'pending');
    assert.equal((await ctx.giverAgent.post(`/api/bookings/${booking.id}/transfer`, { askPrice: 200000 })).status, 409);
    assert.equal((await ctx.ownerAgent.post(`/api/owner/bookings/${booking.id}/approve`, {})).status, 200);
    assert.equal((await ctx.giverAgent.post(`/api/bookings/${booking.id}/transfer`, { askPrice: 200000 })).status, 409);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    assert.equal(transfer.status, 'open');
    const bookingView = await ctx.giverAgent.get(`/api/bookings/${booking.id}`);
    assert.deepEqual(bookingView.body.transfer, {
      id: transfer.id, status: 'open', askPrice: 200000, closesAt: transfer.closesAt, claimExpiresAt: null,
    });
    const schedule = await ctx.app.agent().get(`/api/venues/${ctx.venue.venueId}/schedule?date=${ctx.date}`);
    const slot = schedule.body.courts[0].slots.find((item) => item.start === '19:00');
    assert.deepEqual(slot.transfer, { id: transfer.id, askPrice: 200000, originalPrice: booking.price });
  } finally {
    await close(ctx);
  }
});

test('transfer rejects invalid or above-paid ask prices', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    for (const askPrice of [0, 200001, booking.price + 1000]) {
      const response = await ctx.giverAgent.post(`/api/bookings/${booking.id}/transfer`, { askPrice });
      assert.equal(response.status, 400);
    }
    assert.equal((await ctx.giverAgent.post(`/api/bookings/${booking.id}/transfer`, { askPrice: 200000 })).status, 201);
  } finally {
    await close(ctx);
  }
});

test('transfer must be created before the configured closing time', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx, { start: '19:00' });
    await markPaid(ctx, booking.id);
    h.setNow(`${ctx.date} 18:01`);
    const response = await ctx.giverAgent.post(`/api/bookings/${booking.id}/transfer`, { askPrice: 200000 });
    assert.equal(response.status, 400);
  } finally {
    h.clock.setOffsetMinutes(0);
    await close(ctx);
  }
});

test('two customers claiming one transfer concurrently produce one winner', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    const results = await Promise.all([
      ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`),
      ctx.receiverTwoAgent.post(`/api/transfers/${transfer.id}/claim`),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const stored = await h.db.one('SELECT status, to_user_id FROM transfers WHERE id = ?', [transfer.id]);
    assert.equal(stored.status, 'claimed');
    assert.ok([ctx.receiver.id, ctx.receiverTwo.id].includes(stored.toUserId));
  } finally {
    await close(ctx);
  }
});

test('customer cannot cancel the booking while a transfer is claimed', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    await ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`);

    const response = await ctx.giverAgent.post(`/api/bookings/${booking.id}/cancel`, { reason: '' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'Đang có đội nhận pass, hãy chờ chủ sân xác nhận hoặc từ chối rồi hủy');
    assert.equal((await h.db.one('SELECT status FROM bookings WHERE id = ?', [booking.id])).status, 'confirmed');
    assert.equal((await h.db.one('SELECT status FROM transfers WHERE id = ?', [transfer.id])).status, 'claimed');
  } finally {
    await close(ctx);
  }
});

test('owner confirmation transfers the booking atomically and preserves slot claims', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    await ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`);

    const response = await ctx.ownerAgent.post(`/api/owner/transfers/${transfer.id}/confirm`, { note: 'Đã nhận tiền mặt' });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.status, 'completed');
    assert.equal(response.body.refund.status, 'pending');
    const oldBooking = await h.db.one('SELECT status, refund_status, refund_amount FROM bookings WHERE id = ?', [booking.id]);
    assert.deepEqual(oldBooking, { status: 'transferred', refundStatus: 'pending', refundAmount: 200000 });
    const newBooking = await h.db.one('SELECT id, user_id, status, payment_status, paid_via, transfer_from_booking_id FROM bookings WHERE transfer_from_booking_id = ?', [booking.id]);
    assert.deepEqual(newBooking, {
      id: response.body.newBookingId,
      userId: ctx.receiver.id,
      status: 'confirmed',
      paymentStatus: 'paid',
      paidVia: 'owner',
      transferFromBookingId: booking.id,
    });
    assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
    const claim = await h.db.one('SELECT booking_id FROM slot_claims WHERE court_id = ? AND start_at = ?', [ctx.venue.courtIds[0], `${ctx.date} 19:00:00`]);
    assert.equal(claim.bookingId, newBooking.id);
  } finally {
    await close(ctx);
  }
});

test('owner rejection reopens a claimed transfer before its deadline', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    await ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`);
    const rejected = await ctx.ownerAgent.post(`/api/owner/transfers/${transfer.id}/reject`, { reason: 'Chuyển sai nội dung' });
    assert.equal(rejected.status, 200, rejected.text);
    assert.equal(rejected.body.status, 'open');
    assert.equal(rejected.body.claimerName, null);
  } finally {
    await close(ctx);
  }
});

test('expired receiver hold reopens transfer and notifies the parties', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    const claim = await ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`);
    const dueAt = require('../src/lib/time').vnToMs(claim.body.claimExpiresAt) + 60000;
    h.clock.setOffsetMinutes((dueAt - Date.now()) / 60000);
    const reopened = await ctx.giverAgent.get(`/api/transfers/${transfer.id}`);
    assert.equal(reopened.body.status, 'open');
    assert.equal((await h.db.query("SELECT action FROM booking_history WHERE booking_id = ? AND action = 'transfer_release'", [booking.id])).length, 1);
  } finally {
    h.clock.setOffsetMinutes(0);
    await close(ctx);
  }
});

test('open transfer expires at its close time', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    h.setNow(`${ctx.date} 18:00`);
    const expired = await ctx.giverAgent.get(`/api/transfers/${transfer.id}`);
    assert.equal(expired.body.status, 'expired');
  } finally {
    h.clock.setOffsetMinutes(0);
    await close(ctx);
  }
});

test('waitlist gets transfer priority and other viewers see priorityLocked', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const waiting = await ctx.receiverAgent.post('/api/waitlist', {
      courtId: ctx.venue.courtIds[0], date: ctx.date, start: '19:00',
    });
    assert.equal(waiting.status, 201);
    const transfer = await createTransfer(ctx, booking);
    const publicList = await ctx.app.agent().get(`/api/transfers?venueId=${ctx.venue.venueId}&date=${ctx.date}`);
    assert.equal(publicList.body[0].priorityLocked, true);
    const locked = await ctx.receiverTwoAgent.post(`/api/transfers/${transfer.id}/claim`);
    assert.equal(locked.status, 409);
    assert.equal((await ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`)).status, 200);
  } finally {
    await close(ctx);
  }
});

test('transfer details expose payment QR only to the claiming customer', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    const publicView = await ctx.app.agent().get(`/api/transfers/${transfer.id}`);
    assert.equal(publicView.body.paymentQr, undefined);
    await ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`);
    const claimerView = await ctx.receiverAgent.get(`/api/transfers/${transfer.id}`);
    assert.equal(claimerView.body.paymentQr.amount, 200000);
    assert.equal(claimerView.body.paymentQr.content, `NH${booking.code}`);
    const ownerView = await ctx.ownerAgent.get(`/api/transfers/${transfer.id}`);
    assert.equal(ownerView.body.paymentQr, undefined);
    assert.equal(ownerView.body.role, 'staff');
  } finally {
    await close(ctx);
  }
});

test('owner transfer actions are scoped to that owner venue', async () => {
  const ctx = await setup({ secondOwner: true });
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    const otherOwner = await login(ctx.app, ctx.otherOwner);
    assert.equal((await otherOwner.get('/api/owner/transfers')).body.length, 0);
    assert.equal((await otherOwner.post(`/api/owner/transfers/${transfer.id}/confirm`, {})).status, 403);
    await ctx.receiverAgent.post(`/api/transfers/${transfer.id}/claim`);
    assert.equal((await otherOwner.post(`/api/owner/transfers/${transfer.id}/reject`, { reason: 'No' })).status, 403);
  } finally {
    await close(ctx);
  }
});

test('giver can withdraw an open transfer but cannot withdraw after claim', async () => {
  const ctx = await setup();
  try {
    const booking = await createBooking(ctx);
    await markPaid(ctx, booking.id);
    const transfer = await createTransfer(ctx, booking);
    assert.equal((await ctx.giverAgent.del(`/api/transfers/${transfer.id}`)).status, 200);
    const second = await ctx.giverAgent.post(`/api/bookings/${booking.id}/transfer`, { askPrice: 200000 });
    assert.equal(second.status, 201);
    await ctx.receiverAgent.post(`/api/transfers/${second.body.id}/claim`);
    assert.equal((await ctx.giverAgent.del(`/api/transfers/${second.body.id}`)).status, 409);
  } finally {
    await close(ctx);
  }
});

test('demo seeder creates all mock transfers including completed ownership change', async () => {
  const seeded = await h.loadDemo();
  const transfers = await h.db.query('SELECT status FROM transfers ORDER BY id');
  assert.equal(transfers.length, 5);
  assert.deepEqual(transfers.map((row) => row.status), ['open', 'open', 'claimed', 'completed', 'open']);
  const moved = await h.db.one("SELECT id, status, transfer_from_booking_id FROM bookings WHERE transfer_from_booking_id IS NOT NULL");
  assert.equal(moved.status, 'confirmed');
  assert.ok(moved.transferFromBookingId);
  assert.ok(seeded.transfers.transfers === 5);
  assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
});
