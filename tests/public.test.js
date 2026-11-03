// Đọc công khai theo contract mục 7: kiểu dữ liệu, trường bắt buộc, trạng thái ô giờ, và không lộ snake_case.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { addDays } = require('../src/lib/time');

let app;
let guest;
let day;
const isStr = (x) => typeof x === 'string';
const isInt = (x) => Number.isInteger(x);

test.before(async () => {
  await h.loadDemo();
  app = await h.startApp();
  guest = app.agent();
  day = h.tomorrow();
});
test.after(async () => {
  await app.close();
  await h.closeAll();
});

test('GET /api/venues: 40 sân, đủ trường và kiểu dữ liệu của Venue, có dataSource-liên quan imageIsIllustrative/imageCredit', async () => {
  const r = await guest.get('/api/venues');
  assert.equal(r.status, 200);
  assert.equal(r.body.date, null);
  assert.equal(r.body.venues.length, 40);
  for (const v of r.body.venues) {
    assert.ok(isInt(v.id) && isStr(v.name) && isStr(v.district) && isStr(v.address) && isStr(v.phone) && isStr(v.imageUrl));
    assert.equal(typeof v.imageIsIllustrative, 'boolean');
    assert.ok(v.imageCredit === null || (typeof v.imageCredit === 'object' && isStr(v.imageCredit.source)));
    assert.ok(Array.isArray(v.amenities));
    assert.match(v.openTime, /^\d{2}:\d{2}$/);
    assert.match(v.closeTime, /^\d{2}:\d{2}$/);
    assert.ok(isInt(v.slotMinutes) && isInt(v.lastMinutePercent) && isInt(v.minPrice) && isInt(v.maxPrice));
    assert.equal(typeof v.requiresApproval, 'boolean');
    assert.equal(typeof v.vietQr, 'boolean');
    assert.ok(v.fieldTypes.every((t) => t === '5' || t === '7'));
    assert.ok(v.minPrice <= v.maxPrice);
    assert.equal('availableSlots' in v, false);
  }
  const first = r.body.venues[0];
  assert.equal(first.name, 'Sân bóng Thành Phát');
  assert.equal(first.imageIsIllustrative, true);
  assert.equal(first.vietQr, true);
  const real = r.body.venues.find((v) => v.id === 12);
  assert.equal(real.imageIsIllustrative, false);
  assert.equal(real.imageCredit.contributor, 'Long Duy');
});

test('không response công khai nào lộ khóa snake_case', async () => {
  const urls = ['/api/meta', '/api/venues', `/api/venues?date=${day}`, '/api/venues/districts', '/api/venues/1', `/api/venues/1/schedule?date=${day}`, `/api/venues/slots?date=${day}&at=19:00`, '/api/auth/me'];
  for (const u of urls) {
    const r = await guest.get(u);
    assert.equal(r.status, 200, u);
    assert.deepEqual(h.snakeKeys(r.body), [], u);
  }
});

test('GET /api/venues/:id: VenueDetail có mapsUrl, cancelPolicy, courts với teamMode, dataSource cho sân thật, không lộ tài khoản ngân hàng', async () => {
  const d = (await guest.get('/api/venues/12')).body;
  assert.equal(d.id, 12);
  assert.match(d.mapsUrl, /^https:\/\/www\.google\.com\/maps/);
  assert.match(d.cancelPolicy, /hoàn 100%/);
  assert.ok(d.dataSource && d.dataSource.retrievedOn && Array.isArray(d.dataSource.sources));
  assert.equal(d.imageIsIllustrative, false);
  assert.ok(d.courts.length >= 1);
  for (const c of d.courts) {
    assert.ok(isInt(c.id) && isInt(c.price) && isInt(c.peakPrice));
    assert.equal(c.teamMode, null);
  }
  assert.equal(d.peakStart, '17:00');
  assert.deepEqual(d.leagues, []);
  assert.equal(JSON.stringify(d).includes('0123456722'), false, 'số tài khoản nhận tiền không công khai');
  const demo = (await guest.get('/api/venues/1')).body;
  assert.equal('dataSource' in demo, false, 'sân demo không có dataSource');
  assert.equal((await guest.get('/api/venues/999')).status, 404);
  assert.equal((await guest.get('/api/venues/abc')).status, 404);
});

test('GET /api/venues/districts: có quận, sắp xếp, không trùng', async () => {
  const r = await guest.get('/api/venues/districts');
  assert.ok(r.body.length >= 5);
  assert.equal(new Set(r.body).size, r.body.length);
  assert.ok(r.body.includes('Quận 7'));
});

test('lọc: theo quận, loại sân, giá tối đa, từ khóa', async () => {
  const q7 = (await guest.get('/api/venues?district=' + encodeURIComponent('Quận 7'))).body.venues;
  assert.ok(q7.length >= 1 && q7.every((v) => v.district === 'Quận 7'));
  const f7 = (await guest.get('/api/venues?fieldType=7')).body.venues;
  assert.ok(f7.length >= 1 && f7.every((v) => v.fieldTypes.includes('7')));
  const cheap = (await guest.get('/api/venues?maxPrice=200000')).body.venues;
  assert.ok(cheap.every((v) => v.minPrice <= 200000));
  const byName = (await guest.get('/api/venues?q=' + encodeURIComponent('thành phát'))).body.venues;
  assert.deepEqual(byName.map((v) => v.id), [1]);
});

test('GET /api/venues?date=: availableSlots đủ trường, tôn trọng from và giờ đã đặt', async () => {
  const r = await guest.get(`/api/venues?date=${day}&from=18:00`);
  const v1 = r.body.venues.find((v) => v.id === 1);
  assert.ok(v1.availableSlots.length > 0);
  for (const s of v1.availableSlots) {
    assert.ok(isInt(s.courtId) && isStr(s.courtName) && isInt(s.price) && isInt(s.basePrice) && isInt(s.discountPercent));
    assert.equal(typeof s.peak, 'boolean');
    assert.equal(typeof s.offeredToYou, 'boolean');
    assert.equal(s.teamMode, false);
    assert.equal(s.match, null);
    assert.ok(s.start >= '18:00');
  }
  // Ô 19:00 của sân con 1 ngày mai có thể đang được giải demo giữ, nên lấy ô 19:00 còn trống bất kỳ.
  const peak = v1.availableSlots.find((s) => s.start === '19:00' && s.courtId === 1) || v1.availableSlots.find((s) => s.start === '19:00');
  assert.equal(peak.price, (await h.db.one('SELECT peak_price FROM courts WHERE id = ?', [peak.courtId])).peakPrice, 'giờ cao điểm dùng peakPrice');
  assert.equal((await guest.get('/api/venues?date=2026-13-45')).status, 400);
});

test('GET schedule công khai chỉ nhận ngày trong cửa sổ đặt', async () => {
  const venues = (await guest.get('/api/venues')).body.venues;
  const id = venues[0].id;
  const last = addDays(h.clock.today(), require('../src/rules').RULES.bookingWindowDays - 1);
  const next = addDays(last, 1);
  const inWindow = await guest.get(`/api/venues/${id}/schedule?date=${last}`);
  assert.equal(inWindow.status, 200);
  assert.ok(inWindow.body.courts[0].slots.length > 0);
  assert.equal((await guest.get(`/api/venues/${id}/schedule?date=${next}`)).status, 400);
  assert.equal((await guest.get(`/api/venues/${id}/schedule?date=${addDays(h.clock.today(), -1)}`)).status, 400);
});

test('GET /api/venues/:id/schedule: trạng thái ô theo đặt/chặn/đã qua/ghép kèo/đang giữ cho người chờ', async () => {
  const user = await h.makeUser();
  const other = await h.makeUser();
  // Cụm sân riêng của test: dữ liệu mẫu (đơn nền, giải mẫu) xếp ô theo giờ chạy nên không được dựa vào ô nào của sân mẫu còn trống.
  const owner = await h.makeUser({ role: 'owner' });
  const { venueId, courtIds: [c1, c2] } = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 2, lastMinutePercent: 20 });
  await h.db.query("UPDATE venues SET peak_end = '22:00' WHERE id = ?", [venueId]); // như sân mẫu: cao điểm 17–22h
  const venue = owner.id;
  const now = h.clock.now();
  const ins = async (start, status, userId) =>
    (await h.db.query(
      `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, price, base_price, rules_snapshot, policy_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 300000, 300000, '', '', ?, ?)`,
      [`Z${Math.random().toString(36).slice(2, 9)}`, userId, venueId, c1, `${day} ${start}:00`, `${day} ${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00:00`, status, now, now],
    )).insertId;
  const { claimForBooking } = require('../src/services/bookingState');
  const { withTransaction } = require('../src/db');
  for (const [start, status, uid] of [['08:00', 'confirmed', other.id], ['09:00', 'pending', other.id], ['10:00', 'confirmed', user.id]]) {
    const id = await ins(start, status, uid);
    await withTransaction((tx) => claimForBooking(tx, { id, courtId: c1, startAt: `${day} ${start}:00` }));
  }
  const blk = await h.db.query('INSERT INTO blocks (court_id, start_at, end_at, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [c1, `${day} 11:00:00`, `${day} 12:00:00`, 'Bảo trì', venue, now]);
  await h.db.query("INSERT INTO slot_claims (court_id, start_at, kind, block_id) VALUES (?, ?, 'block', ?)", [c1, `${day} 11:00:00`, blk.insertId]);
  await h.db.query("INSERT INTO waitlist (user_id, court_id, start_at, status, offer_expires_at, created_at) VALUES (?, ?, ?, 'offered', ?, ?)", [user.id, c1, `${day} 13:00:00`, addDays(day, 1) + ' 00:00:00', now]);
  await h.db.query('UPDATE courts SET team_mode_enabled = 1, team_mode_from = ?, team_mode_to = ? WHERE id = ?', ['18:00', '21:00', c2]);

  const asGuest = (await guest.get(`/api/venues/${venueId}/schedule?date=${day}`)).body;
  assert.equal(asGuest.date, day);
  assert.equal(asGuest.slotMinutes, 60);
  const slots = Object.fromEntries(asGuest.courts[0].slots.map((s) => [s.start, s]));
  assert.equal(slots['08:00'].status, 'booked');
  assert.equal(slots['09:00'].status, 'held');
  assert.equal(slots['11:00'].status, 'blocked');
  assert.equal(slots['13:00'].status, 'offered');
  assert.equal(slots['13:00'].offeredToYou, undefined);
  assert.equal(slots['14:00'].status, 'available');
  assert.equal('mine' in slots['10:00'], false);
  const court2 = Object.fromEntries(asGuest.courts[1].slots.map((s) => [s.start, s]));
  assert.equal(court2['18:00'].teamMode, true);
  assert.equal(court2['17:00'].teamMode, undefined);

  // Người xem là chủ của lịch / người được giữ quyền.
  const a = app.agent();
  const email = (await h.db.one('SELECT email FROM users WHERE id = ?', [user.id])).email;
  await a.post('/api/auth/login', { email, password: 'Matkhau@123' });
  const mine = Object.fromEntries((await a.get(`/api/venues/${venueId}/schedule?date=${day}`)).body.courts[0].slots.map((s) => [s.start, s]));
  assert.equal(mine['10:00'].mine, true);
  assert.equal(mine['13:00'].offeredToYou, true);
  assert.ok(mine['13:00'].offerExpiresAt);
  assert.equal(mine['13:00'].onWaitlist, true);

  // Ô đã qua theo đồng hồ server (tua đồng hồ bằng cách đặt "bây giờ" là 20:30 ngày đó).
  h.setNow(`${day} 20:30`);
  const late = Object.fromEntries((await guest.get(`/api/venues/${venueId}/schedule?date=${day}`)).body.courts[0].slots.map((s) => [s.start, s]));
  assert.equal(late['20:00'].status, 'past');
  assert.equal(late['21:00'].status, 'available');
  assert.equal(late['21:00'].discountPercent, 20, 'R6: còn trong 3 giờ tới thì giảm giá giờ chót của sân 1 (20%)');
  assert.equal(late['21:00'].price, 360000, 'giá cao điểm 450.000 giảm 20%');
  assert.equal(late['22:00'].discountPercent, 20);
  h.clock.setOffsetMinutes(0);
  assert.equal((await guest.get(`/api/venues/${venueId}/schedule`)).status, 400);
});

test('GET /api/venues/slots: tìm theo giờ trong [at-30, at+60], gần giờ chọn nhất lên trước', async () => {
  const r = await guest.get(`/api/venues/slots?date=${day}&at=19:00&fieldType=5`);
  assert.equal(r.status, 200);
  assert.equal(r.body.at, '19:00');
  assert.ok(r.body.slots.length > 0);
  for (const s of r.body.slots) {
    assert.ok(isInt(s.venueId) && isStr(s.venueName) && isStr(s.district) && isStr(s.address) && typeof s.requiresApproval === 'boolean');
    assert.ok(s.start >= '18:30' && s.start <= '20:00', s.start);
  }
  const dist = r.body.slots.map((s) => Math.abs(Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3)) - 1140));
  assert.deepEqual(dist, [...dist].sort((a, b) => a - b));
  assert.equal((await guest.get(`/api/venues/slots?date=${day}&at=25:00`)).status, 400);
  const lm = await guest.get(`/api/venues/slots?date=${day}&at=19:00&lastMinute=1`);
  assert.deepEqual(lm.body.slots, [], 'ngày mai chưa nằm trong 3 giờ chót nên không có giờ giảm giá');
});
