// Chống đặt trùng ở tầng CSDL: SQL thô (bỏ qua mọi code ứng dụng) cũng không tạo được hai chủ cho một ô.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { setStatus } = require('../src/services/bookingState');
const { claimBlockSlots } = require('../src/services/slotClaims');
const { withTransaction } = require('../src/db');
const { loadVenue } = require('../src/services/venueStore');
const { clock } = h;

let owner;
let customer;
let customer2;
let venueId;
let courtId;
let day;

const insertBooking = (conn, { user = customer, court = courtId, start = '19:00', status = 'confirmed', code } = {}) =>
  conn.query(
    `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, price, base_price, rules_snapshot, policy_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 300000, 300000, '', '', ?, ?)`,
    [code || `X${Math.random().toString(36).slice(2, 10)}`, user.id, venueId, court, `${day} ${start}:00`, `${day} ${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00:00`, status, clock.now(), clock.now()],
  );

test.before(async () => {
  await h.emptyData();
  owner = await h.makeUser({ role: 'owner' });
  customer = await h.makeUser();
  customer2 = await h.makeUser();
  ({ venueId, courtIds: [courtId] } = await h.makeVenueWithCourt({ ownerId: owner.id }));
  day = h.tomorrow();
});
test.after(() => h.closeAll());

test('hai lịch đang giữ cùng ô bị DB từ chối, kể cả khi bỏ qua code ứng dụng', async () => {
  await insertBooking(h.db, { start: '18:00' });
  await assert.rejects(insertBooking(h.db, { user: customer2, start: '18:00' }), (e) => e.code === 'ER_DUP_ENTRY');
  await assert.rejects(insertBooking(h.db, { user: customer2, start: '18:00', status: 'pending' }), (e) => e.code === 'ER_DUP_ENTRY');
});

test('lịch đã hủy/hết hạn không cản ai; hủy xong ô đặt lại được', async () => {
  const dead = await insertBooking(h.db, { start: '10:00', status: 'cancelled' });
  assert.ok(dead.insertId);
  await insertBooking(h.db, { user: customer2, start: '10:00', status: 'confirmed' });
  await withTransaction((tx) => setStatus(tx, dead.insertId, 'expired'));

  const a = await insertBooking(h.db, { start: '11:00', status: 'pending' });
  await withTransaction(async (tx) => {
    await tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [courtId, `${day} 11:00:00`, a.insertId]);
  });
  await withTransaction((tx) => setStatus(tx, a.insertId, 'cancelled', { cancelled_by: 'owner' }));
  const again = await insertBooking(h.db, { user: customer2, start: '11:00' });
  assert.ok(again.insertId);
});

test('setStatus giữ slot_claims khớp status và không để lệch', async () => {
  const r = await insertBooking(h.db, { start: '12:00', status: 'rejected' });
  await withTransaction((tx) => setStatus(tx, r.insertId, 'pending')); // vào trạng thái giữ ô: chiếm ô
  assert.equal((await h.db.query('SELECT 1 FROM slot_claims WHERE booking_id = ?', [r.insertId])).length, 1);
  await withTransaction((tx) => setStatus(tx, r.insertId, 'confirmed')); // giữ ô -> giữ ô: không đổi
  assert.equal((await h.db.query('SELECT 1 FROM slot_claims WHERE booking_id = ?', [r.insertId])).length, 1);
  await withTransaction((tx) => setStatus(tx, r.insertId, 'transferred')); // ra: nhả
  assert.equal((await h.db.query('SELECT 1 FROM slot_claims WHERE booking_id = ?', [r.insertId])).length, 0);
  const drift = await h.findClaimDrift(h.db);
  assert.deepEqual(drift.stale, []);
});

test('setStatus vào lại trạng thái giữ ô khi ô đã bị người khác lấy thì 409 và hoàn tác', async () => {
  const dead = await insertBooking(h.db, { start: '13:00', status: 'expired' });
  await insertBooking(h.db, { user: customer2, start: '13:00', status: 'confirmed' });
  await assert.rejects(withTransaction((tx) => setStatus(tx, dead.insertId, 'pending')), (e) => e.status === 409);
  assert.equal((await h.db.one('SELECT status FROM bookings WHERE id = ?', [dead.insertId])).status, 'expired');
});

test('nhượng sân: lịch cũ nhả ô và lịch mới chiếm ô trong một transaction, claim chuyển sang lịch mới', async () => {
  const { claimForBooking } = require('../src/services/bookingState');
  const old = await insertBooking(h.db, { start: '14:00', status: 'confirmed' });
  await withTransaction((tx) => claimForBooking(tx, { id: old.insertId, courtId, startAt: `${day} 14:00:00` }));
  let fresh;
  await withTransaction(async (tx) => {
    await setStatus(tx, old.insertId, 'transferred');
    fresh = await insertBooking(tx, { user: customer2, start: '14:00', status: 'confirmed' });
    await claimForBooking(tx, { id: fresh.insertId, courtId, startAt: `${day} 14:00:00` });
  });
  const claim = await h.db.one('SELECT booking_id FROM slot_claims WHERE court_id = ? AND start_at = ?', [courtId, `${day} 14:00:00`]);
  assert.equal(claim.bookingId, fresh.insertId);
});

test('chặn giờ chiếm ô: trùng lịch đặt thì claimBlockSlots ném 409 và không để lại block lẻ; xóa block nhả ô', async () => {
  const venue = await loadVenue(venueId);
  const b = await insertBooking(h.db, { start: '15:00', status: 'confirmed' });
  await withTransaction((tx) => tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [courtId, `${day} 15:00:00`, b.insertId]));

  const tryBlock = (start, end) =>
    withTransaction(async (tx) => {
      const r = await tx.query('INSERT INTO blocks (court_id, start_at, end_at, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [courtId, `${day} ${start}:00`, `${day} ${end}:00`, 'Sửa sân', owner.id, clock.now()]);
      await claimBlockSlots(tx, { blockId: r.insertId, courtId, venue, startAt: `${day} ${start}:00`, endAt: `${day} ${end}:00` });
      return r.insertId;
    });

  await assert.rejects(tryBlock('14:00', '16:00'), (e) => e.status === 409);
  assert.equal((await h.db.query('SELECT 1 FROM blocks WHERE start_at = ?', [`${day} 14:00:00`])).length, 0, 'block bị hoàn tác');
  assert.equal((await h.db.query("SELECT 1 FROM slot_claims WHERE court_id = ? AND start_at = ? AND kind = 'block'", [courtId, `${day} 16:00:00`])).length, 0);

  const blockId = await tryBlock('16:00', '18:00');
  assert.equal((await h.db.query('SELECT 1 FROM slot_claims WHERE block_id = ?', [blockId])).length, 2);
  // Đặt vào ô bị chặn: lớp 2 từ chối (qua claimForBooking).
  const late = await insertBooking(h.db, { user: customer2, start: '16:00', status: 'confirmed' });
  await assert.rejects(
    withTransaction((tx) => require('../src/services/bookingState').claimForBooking(tx, { id: late.insertId, courtId, startAt: `${day} 16:00:00` })),
    (e) => e.status === 409,
  );
  await h.db.query('DELETE FROM blocks WHERE id = ?', [blockId]);
  assert.equal((await h.db.query('SELECT 1 FROM slot_claims WHERE block_id = ?', [blockId])).length, 0, 'ON DELETE CASCADE nhả ô');
});

test('claim phải khớp ô của lịch: không đổi giờ của lịch đang giữ ô', async () => {
  const b = await insertBooking(h.db, { start: '20:00', status: 'confirmed' });
  await withTransaction((tx) => tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [courtId, `${day} 20:00:00`, b.insertId]));
  await assert.rejects(h.db.query('UPDATE bookings SET start_at = ? WHERE id = ?', [`${day} 21:00:00`, b.insertId]), (e) => e.code === 'ER_ROW_IS_REFERENCED_2');
  await assert.rejects(
    h.db.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [courtId, `${day} 21:00:00`, b.insertId]),
    (e) => e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_DUP_ENTRY',
  );
});
