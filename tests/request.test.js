// Nhu cầu nhờ báo giá và chào giá (R14) qua HTTP trên MySQL thật. Mỗi test dựng dữ liệu riêng; claim không được lệch.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { sweep } = require('../src/services/bookingOps');
const requestOps = require('../src/services/requestOps');
const { createBooking } = require('../src/services/bookingCore');
const { addDays } = require('../src/lib/time');

let app;
let seq = 0;
let TODAY;
let DAY;
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

async function person(role = 'customer', name = 'Người thử') {
  seq += 1;
  const email = `q${seq}-${Date.now()}@test.local`;
  const u = await h.makeUser({ role, email, fullName: name });
  const a = app.agent();
  const r = await a.post('/api/auth/login', { email, password: 'Matkhau@123' });
  assert.equal(r.status, 200, r.text);
  return { ...u, email, fullName: name, a };
}

/** Thêm một cụm sân của chủ sân mới ở quận `district` (mặc định Quận 1, sân con loại 5). */
async function venueOf(district = 'Quận 1', { courts = 1, fieldType = '5', requiresApproval = 0, name = 'Chủ sân' } = {}) {
  const owner = await person('owner', name);
  const v = await h.makeVenueWithCourt({ ownerId: owner.id, courts, requiresApproval });
  await h.db.query('UPDATE venues SET district = ? WHERE id = ?', [district, v.venueId]);
  await h.db.query('UPDATE courts SET field_type = ? WHERE venue_id = ?', [fieldType, v.venueId]);
  return { owner, venueId: v.venueId, courtIds: v.courtIds };
}

/** Quận 1: một cụm sân (hai sân con) và hai khách; "bây giờ" là 09:00 hôm nay, nhu cầu mặc định ngày mai 18:00–20:00. */
async function world({ requiresApproval = 0 } = {}) {
  await h.emptyData();
  TODAY = h.clock.today();
  DAY = h.tomorrow();
  h.setNow(stamp(TODAY, '09:00'));
  const v = await venueOf('Quận 1', { courts: 2, requiresApproval });
  await h.db.query("UPDATE venues SET bank_bin = '970436', bank_account = '0011223344', bank_account_name = 'CHU SAN' WHERE id = ?", [v.venueId]);
  const [a, b] = [await person('customer', 'Khách A'), await person('customer', 'Khách B')];
  return { ...v, courtId: v.courtIds[0], a, b };
}
const reqBody = (over = {}) => ({ district: 'Quận 1', date: DAY, from: '18:00', to: '20:00', fieldType: '5', budget: 400000, closesAt: stamp(DAY, '16:00'), note: 'Đá giao hữu', ...over });
const post = async (c, over) => {
  const r = await c.a.post('/api/requests', reqBody(over));
  assert.equal(r.status, 201, r.text);
  return r.body;
};
const sendOffer = (owner, requestId, body) =>
  owner.a.post(`/api/owner/requests/${requestId}/offers`, { start: '18:00', price: 400000, validUntil: stamp(DAY, '15:00'), note: 'Giá tốt', ...body });
const offerOk = async (owner, requestId, body) => {
  const r = await sendOffer(owner, requestId, body);
  assert.equal(r.status, 201, r.text);
  return r.body;
};
const accept = (c, requestId, offerId) => c.a.post(`/api/requests/${requestId}/accept`, { offerId });
const notes = (userId) => h.db.query('SELECT * FROM notifications WHERE user_id = ? ORDER BY id', [userId]);
const offerRow = (id) => h.db.one('SELECT * FROM offers WHERE id = ?', [id]);
const requestRow = (id) => h.db.one('SELECT * FROM requests WHERE id = ?', [id]);
const bookingsOf = (userId) => h.db.query('SELECT * FROM bookings WHERE user_id = ? ORDER BY id', [userId]);

/* ---------- Đăng nhu cầu ---------- */

test('đăng nhu cầu: lưu đúng, chỉ chủ sân phù hợp được báo, khách chỉ thấy tin của mình', async () => {
  const w = await world();
  const far = await venueOf('Quận 7'); // khác quận: không phù hợp
  const noType = await venueOf('Quận 1', { fieldType: '7', name: 'Sân 7' }); // cùng quận nhưng không có sân 5
  const r = await post(w.a);
  assert.equal(r.status, 'open');
  assert.deepEqual([r.district, r.date, r.from, r.to, r.fieldType, r.budget, r.note, r.closesAt], ['Quận 1', DAY, '18:00', '20:00', '5', 400000, 'Đá giao hữu', stamp(DAY, '16:00:00')]);
  assert.deepEqual(r.offers, []);
  assert.equal(r.bookingId, null);
  assert.equal((await notes(w.owner.id)).length, 1);
  assert.match((await notes(w.owner.id))[0].message, /nhờ báo giá/);
  assert.equal((await notes(far.owner.id)).length, 0);
  assert.equal((await notes(noType.owner.id)).length, 0);
  assert.equal((await w.a.a.get(`/api/requests/${r.id}`)).status, 200);
  assert.equal((await w.b.a.get(`/api/requests/${r.id}`)).status, 404);
  assert.equal((await w.b.a.del(`/api/requests/${r.id}`)).status, 404);
  assert.deepEqual((await w.b.a.get('/api/requests/mine')).body, []);
  assert.deepEqual((await w.a.a.get('/api/requests/mine')).body.map((x) => x.id), [r.id]);
});

test('đăng nhu cầu: thiếu/sai dữ liệu → 400, ngân sách không chặn, uy tín thấp vẫn đăng được', async () => {
  const w = await world();
  const bad = async (over, re) => {
    const r = await w.a.a.post('/api/requests', reqBody(over));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.match(r.body.error || r.body.message, re);
  };
  await bad({ district: 'Quận 9' }, /quận/i);
  await bad({ fieldType: '11' }, /Loại sân/);
  await bad({ date: 'mai' }, /Ngày/);
  await bad({ date: '2000-01-01' }, /ngày tới/);
  await bad({ date: addDays(TODAY, 3) }, /ngày tới/);
  await bad({ from: '18:00', to: '18:30' }, /60 phút/);
  await bad({ from: '25:00' }, /Khung giờ/);
  await bad({ budget: 400500 }, /tròn nghìn/);
  await bad({ budget: 5001000 }, /tròn nghìn/);
  await bad({ budget: 0 }, /tròn nghìn/);
  await bad({ closesAt: stamp(TODAY, '09:20') }, /Hạn nhận/); // chưa tới 30 phút
  await bad({ closesAt: stamp(DAY, '17:30') }, /Hạn nhận/); // quá 60 phút trước giờ bắt đầu
  await bad({ closesAt: 'sớm' }, /Hạn nhận/);
  await bad({ from: '10:00', to: '12:00', date: TODAY, closesAt: stamp(TODAY, '09:40') }, /quá ít thời gian/);
  await bad({ from: '04:00', to: '06:00', closesAt: stamp(DAY, '02:00') }, /giờ mở cửa/); // sân mở từ 06:00 nên không có giờ nào trọn trong khung
  assert.equal((await h.db.query('SELECT 1 FROM requests')).length, 0);
  // ngân sách thấp hơn mọi giá niêm yết vẫn đăng được; khách bị hạn chế R10 cũng không bị chặn
  assert.equal((await w.a.a.post('/api/requests', reqBody({ budget: 1000 }))).status, 201);
  for (const [i, code] of ['X1', 'X2'].entries()) {
    await h.db.query(
      "INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, price, base_price, rules_snapshot, policy_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'no_show', 'web', 1000, 1000, '', '', ?, ?)",
      [code, w.a.id, w.venueId, w.courtId, stamp(TODAY, `0${6 + i}:00:00`), stamp(TODAY, `0${7 + i}:00:00`), stamp(TODAY, '05:00:00'), stamp(TODAY, '05:00:00')],
    );
  }
  assert.equal((await w.a.a.post('/api/requests', reqBody())).status, 201);
});

test('đăng nhu cầu: tối đa 3 nhu cầu đang mở (cả khi gửi đồng thời); hủy/hết hạn thì đăng tiếp được; chủ sân không đăng được', async () => {
  const w = await world();
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push((await post(w.a)).id);
  const fourth = await w.a.a.post('/api/requests', reqBody());
  assert.equal(fourth.status, 409);
  assert.equal((await w.a.a.del(`/api/requests/${ids[0]}`)).status, 200);
  assert.equal((await w.a.a.post('/api/requests', reqBody())).status, 201);
  assert.equal((await w.owner.a.post('/api/requests', reqBody())).status, 403);
  // đồng thời: hai lần đăng cùng lúc khi còn đúng một chỗ trống chỉ một lần thành công
  assert.equal((await w.b.a.post('/api/requests', reqBody())).status, 201);
  assert.equal((await w.b.a.post('/api/requests', reqBody())).status, 201);
  const res = await Promise.all([w.b.a.post('/api/requests', reqBody()), w.b.a.post('/api/requests', reqBody())]);
  assert.deepEqual(res.map((x) => x.status).sort(), [201, 409]);
  assert.equal((await h.db.query("SELECT 1 FROM requests WHERE user_id = ? AND status = 'open'", [w.b.id])).length, 3);
});

/* ---------- Chủ sân thấy nhu cầu và gửi chào giá ---------- */

test('chủ sân chỉ thấy nhu cầu phù hợp kèm các giờ có thể chào (không gồm giờ đã có người đặt hoặc chế độ đủ hai đội)', async () => {
  const w = await world();
  const far = await venueOf('Quận 7');
  await h.db.query("UPDATE courts SET team_mode_enabled = 1, team_mode_from = '19:00', team_mode_to = '20:00' WHERE id = ?", [w.courtIds[1]]);
  assert.equal((await w.b.a.post('/api/bookings', { courtId: w.courtId, date: DAY, start: '18:00' })).status, 201);
  const r = await post(w.a, { budget: 1000 });
  const list = (await w.owner.a.get('/api/owner/requests')).body;
  assert.equal(list.length, 1);
  const q = list[0];
  assert.equal(q.id, r.id);
  assert.equal(q.customerName, 'Khách A');
  assert.equal(q.customerReliability.restricted, false);
  assert.deepEqual(q.venues.map((v) => v.id), [w.venueId]);
  assert.equal(q.maxOffers, 5);
  assert.equal(q.openOfferCount, 0);
  const slots = Object.fromEntries(q.options.map((o) => [o.courtId, o.slots.map((s) => s.start)]));
  assert.deepEqual(slots, { [w.courtId]: ['19:00'], [w.courtIds[1]]: ['18:00'] });
  assert.equal(q.options[0].slots[0].basePrice, 450000);
  assert.deepEqual((await far.owner.a.get('/api/owner/requests')).body, []);
  assert.equal((await w.a.a.get('/api/owner/requests')).status, 403);
});

test('gửi chào giá: lưu đúng, khách được báo, nhãn vượt ngân sách; chủ sân khác không thấy chào giá của sân này', async () => {
  const w = await world();
  const rival = await venueOf('Quận 1', { name: 'Sân đối thủ' });
  const r = await post(w.a, { budget: 300000 });
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId, price: 350000 });
  assert.deepEqual([o.status, o.price, o.listedPrice, o.overBudget, o.usable, o.venueId, o.courtId, o.startAt, o.endAt, o.validUntil],
    ['open', 350000, 450000, true, true, w.venueId, w.courtId, stamp(DAY, '18:00:00'), stamp(DAY, '19:00:00'), stamp(DAY, '15:00:00')]);
  const msg = (await notes(w.a.id)).at(-1).message;
  assert.match(msg, /báo giá 350\.000đ/);
  assert.match(msg, /cao hơn mức bạn muốn/);
  await offerOk(rival.owner, r.id, { courtId: rival.courtIds[0], price: 300000 });
  const mine = (await w.owner.a.get('/api/owner/requests')).body[0];
  assert.deepEqual(mine.offers.map((x) => x.id), [o.id]);
  assert.equal(mine.openOfferCount, 2);
  const cust = (await w.a.a.get(`/api/requests/${r.id}`)).body;
  assert.deepEqual(cust.offers.map((x) => x.price), [300000, 350000]); // theo giá tăng dần
  // chào giá không giữ giờ: người khác vẫn đặt được
  assert.equal((await w.b.a.post('/api/bookings', { courtId: w.courtId, date: DAY, start: '18:00' })).status, 201);
  const after = (await w.a.a.get(`/api/requests/${r.id}`)).body.offers.find((x) => x.id === o.id);
  assert.equal(after.usable, false);
  assert.match(after.unusableReason, /người khác đặt/);
});

test('gửi chào giá: các nhánh từ chối (403, 400, 409)', async () => {
  const w = await world();
  const other = await venueOf('Quận 1', { name: 'Chủ khác' });
  const far = await venueOf('Quận 7');
  const r = await post(w.a);
  const expectErr = async (who, body, status, re) => {
    const res = await sendOffer(who, r.id, body);
    assert.equal(res.status, status, `${JSON.stringify(body)} → ${res.text}`);
    assert.match(res.body.error || res.body.message, re);
  };
  await expectErr(w.owner, { courtId: other.courtIds[0] }, 403, /không thuộc/);
  await expectErr(far.owner, { courtId: far.courtIds[0] }, 403, /không phù hợp/);
  await expectErr(w.owner, { courtId: 999999 }, 404, /sân/i);
  assert.equal((await w.owner.a.post('/api/owner/requests/999999/offers', { courtId: w.courtId })).status, 404);
  await expectErr(w.owner, { courtId: w.courtId, start: '17:00' }, 400, /trọn trong khung/);
  await expectErr(w.owner, { courtId: w.courtId, start: '19:30' }, 400, /trọn trong khung/);
  await expectErr(w.owner, { courtId: w.courtId, price: 350500 }, 400, /tròn nghìn/);
  await expectErr(w.owner, { courtId: w.courtId, price: 0 }, 400, /tròn nghìn/);
  await expectErr(w.owner, { courtId: w.courtId, price: 451000 }, 400, /không được cao hơn/); // giá niêm yết 18:00 là 450.000
  await expectErr(w.owner, { courtId: w.courtId, validUntil: stamp(TODAY, '09:10') }, 400, /Hiệu lực/); // chưa tới 15 phút
  await expectErr(w.owner, { courtId: w.courtId, validUntil: stamp(DAY, '16:30') }, 400, /Hiệu lực/); // sau hạn nhận chào giá
  await expectErr(w.owner, { courtId: w.courtId, validUntil: 'mai' }, 400, /Hiệu lực/);
  // giờ đủ hai đội, giờ đã có người đặt, giờ bị chặn
  await h.db.query("UPDATE courts SET team_mode_enabled = 1, team_mode_from = '18:00', team_mode_to = '19:00' WHERE id = ?", [w.courtIds[1]]);
  await expectErr(w.owner, { courtId: w.courtIds[1], start: '18:00' }, 409, /ghép kèo/);
  assert.equal((await w.b.a.post('/api/bookings', { courtId: w.courtId, date: DAY, start: '18:00' })).status, 201);
  await expectErr(w.owner, { courtId: w.courtId, start: '18:00' }, 409, /không còn trống/);
  assert.equal((await w.owner.a.post('/api/owner/blocks', { courtId: w.courtId, date: DAY, start: '19:00', end: '20:00' })).status, 201);
  await expectErr(w.owner, { courtId: w.courtId, start: '19:00' }, 409, /không còn trống/);
  assert.equal((await h.db.query('SELECT 1 FROM offers')).length, 0);
  // chủ sân tạm đóng thì không còn phù hợp
  await h.db.query('UPDATE venues SET is_active = 0 WHERE id = ?', [w.venueId]);
  await expectErr(w.owner, { courtId: w.courtIds[1], start: '19:00' }, 403, /không phù hợp/);
});

test('mỗi cụm sân một chào giá mở; tối đa 5 chào giá mở; nhu cầu đã đóng không nhận chào giá; rút xong chào lại được', async () => {
  const w = await world();
  const r = await post(w.a);
  const first = await offerOk(w.owner, r.id, { courtId: w.courtId });
  const dup = await sendOffer(w.owner, r.id, { courtId: w.courtIds[1], start: '19:00' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error || dup.body.message, /đã có báo giá đang mở/);
  const rivals = [];
  for (let i = 0; i < 4; i += 1) {
    const v = await venueOf('Quận 1', { name: `Đối thủ ${i}` });
    rivals.push(v);
    await offerOk(v.owner, r.id, { courtId: v.courtIds[0] });
  }
  const sixth = await venueOf('Quận 1', { name: 'Thứ sáu' });
  const full = await sendOffer(sixth.owner, r.id, { courtId: sixth.courtIds[0] });
  assert.equal(full.status, 409);
  assert.match(full.body.error || full.body.message, /đủ 5/);
  // rút một chào giá thì chỗ trống lại; chính cụm đó cũng chào lại được
  assert.equal((await rivals[0].owner.a.del(`/api/owner/offers/${(await h.db.one('SELECT id FROM offers WHERE venue_id = ?', [rivals[0].venueId])).id}`)).status, 200);
  assert.equal((await sendOffer(sixth.owner, r.id, { courtId: sixth.courtIds[0] })).status, 201);
  assert.equal((await w.a.a.del(`/api/requests/${r.id}`)).status, 200);
  const closed = await sendOffer(w.owner, r.id, { courtId: w.courtId });
  assert.equal(closed.status, 409);
  assert.match(closed.body.error || closed.body.message, /đã kết thúc/);
  assert.equal((await offerRow(first.id)).status, 'void');
});

test('hai lần chào cùng lúc của một cụm sân: DB giữ luật một chào giá mở', async () => {
  const w = await world();
  const r = await post(w.a);
  const res = await Promise.all([
    sendOffer(w.owner, r.id, { courtId: w.courtId, start: '18:00' }),
    sendOffer(w.owner, r.id, { courtId: w.courtIds[1], start: '19:00' }),
  ]);
  assert.deepEqual(res.map((x) => x.status).sort(), [201, 409]);
  assert.equal((await h.db.query("SELECT 1 FROM offers WHERE request_id = ? AND status = 'open'", [r.id])).length, 1);
});

test('rút chào giá: withdrawn, khách được báo; chủ sân khác 403; rút lại 409; chào giá đã rút không chọn được', async () => {
  const w = await world();
  const other = await venueOf('Quận 1', { name: 'Chủ khác' });
  const r = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId });
  assert.equal((await other.owner.a.del(`/api/owner/offers/${o.id}`)).status, 403);
  assert.equal((await w.owner.a.del('/api/owner/offers/999999')).status, 404);
  const done = await w.owner.a.del(`/api/owner/offers/${o.id}`);
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'withdrawn');
  assert.match((await notes(w.a.id)).at(-1).message, /đã rút báo giá/);
  assert.equal((await w.owner.a.del(`/api/owner/offers/${o.id}`)).status, 409);
  const res = await accept(w.a, r.id, o.id);
  assert.equal(res.status, 409);
  assert.equal((await bookingsOf(w.a.id)).length, 0);
  assert.equal((await offerRow(o.id)).status, 'withdrawn');
});

/* ---------- Chọn chào giá ---------- */

test('chọn chào giá: booking qua luồng thường, giá = giá chào, không giảm giờ chót, offerId, lịch sử offer_accept; các chào giá khác lost', async () => {
  const w = await world();
  await h.db.query('UPDATE venues SET last_minute_percent = 20 WHERE id = ?', [w.venueId]);
  const rival = await venueOf('Quận 1', { name: 'Đối thủ' });
  const r = await post(w.a);
  const win = await offerOk(w.owner, r.id, { courtId: w.courtId, price: 380000 });
  const lose = await offerOk(rival.owner, r.id, { courtId: rival.courtIds[0], price: 300000 });
  const res = await accept(w.a, r.id, win.id);
  assert.equal(res.status, 200, res.text);
  const b = res.body;
  assert.deepEqual([b.status, b.price, b.basePrice, b.discountPercent, b.fromOffer, b.courtId, b.startAt], ['confirmed', 380000, 450000, 0, true, w.courtId, stamp(DAY, '18:00:00')]);
  assert.equal((await w.a.a.get(`/api/bookings/${b.id}`)).body.paymentQr?.amount, 380000, 'VietQR như đặt thường, theo giá chào');
  const row = await h.db.one('SELECT * FROM bookings WHERE id = ?', [b.id]);
  assert.equal(row.offerId, win.id);
  const hist = await h.db.query('SELECT action, note FROM booking_history WHERE booking_id = ? ORDER BY id', [b.id]);
  assert.deepEqual(hist.map((x) => x.action), ['create', 'offer_accept']);
  assert.match(hist[1].note, /380\.000đ.*450\.000đ/);
  assert.equal((await requestRow(r.id)).status, 'chosen');
  assert.equal((await requestRow(r.id)).bookingId, b.id);
  assert.equal((await offerRow(win.id)).status, 'chosen');
  const lost = await offerRow(lose.id);
  assert.equal(lost.status, 'lost');
  assert.match(lost.endReason, /chọn báo giá khác/);
  assert.match((await notes(w.owner.id)).at(-1).message, /đã chọn báo giá 380\.000đ.*mã/);
  assert.match((await notes(rival.owner.id)).at(-1).message, /đã chọn sân khác/);
  const seen = (await w.a.a.get(`/api/requests/${r.id}`)).body;
  assert.equal(seen.status, 'chosen');
  assert.equal(seen.bookingId, b.id);
  assert.equal(seen.offers.find((x) => x.id === win.id).bookingId, b.id);
  // chính sách hủy tính trên price: không phát sinh thêm booking nào
  assert.equal((await bookingsOf(w.a.id)).length, 1);
  assert.equal((await w.a.a.del(`/api/requests/${r.id}`)).status, 409);
});

test('chọn chào giá của sân cần duyệt → booking pending, hết hạn giữ chỗ như thường', async () => {
  const w = await world({ requiresApproval: 1 });
  const r = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId, price: 400000 });
  const res = await accept(w.a, r.id, o.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.status, 'pending');
  assert.equal(res.body.price, 400000);
  assert.ok(res.body.expiresAt);
  h.setNow(stamp(TODAY, '12:00'));
  await sweep();
  assert.equal((await h.db.one('SELECT status FROM bookings WHERE id = ?', [res.body.id])).status, 'expired');
});

test('bấm lặp cùng một chào giá trả đúng booking cũ (tuần tự và đồng thời)', async () => {
  const w = await world();
  const r = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId });
  const first = await accept(w.a, r.id, o.id);
  const second = await accept(w.a, r.id, o.id);
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
  const r2 = await post(w.a);
  const o2 = await offerOk(w.owner, r2.id, { courtId: w.courtIds[1], start: '19:00' });
  const both = await Promise.all([accept(w.a, r2.id, o2.id), accept(w.a, r2.id, o2.id), accept(w.a, r2.id, o2.id)]);
  assert.deepEqual(both.map((x) => x.status), [200, 200, 200], both.map((x) => x.text).join('|'));
  assert.equal(new Set(both.map((x) => x.body.id)).size, 1);
  assert.equal((await bookingsOf(w.a.id)).length, 2);
  assert.equal((await offerRow(o2.id)).status, 'chosen'); // bấm đồng thời không làm chào giá thành void
});

test('chọn: nhu cầu của người khác 404, chào giá của nhu cầu khác 404, thiếu offerId 404, chủ sân 403', async () => {
  const w = await world();
  const r = await post(w.a);
  const r2 = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId });
  assert.equal((await accept(w.b, r.id, o.id)).status, 404);
  assert.equal((await accept(w.a, r2.id, o.id)).status, 404);
  assert.equal((await w.a.a.post(`/api/requests/${r.id}/accept`, {})).status, 404);
  assert.equal((await accept(w.owner, r.id, o.id)).status, 403);
  assert.equal((await offerRow(o.id)).status, 'open');
});

test('chọn: ô đã bị người khác đặt → 409, chào giá void, không tạo booking', async () => {
  const w = await world();
  const r = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId });
  assert.equal((await w.b.a.post('/api/bookings', { courtId: w.courtId, date: DAY, start: '18:00' })).status, 201);
  const res = await accept(w.a, r.id, o.id);
  assert.equal(res.status, 409);
  assert.match(res.body.error || res.body.message, /^Chào giá này không còn dùng được: giờ này đã có người khác đặt/);
  const row = await offerRow(o.id);
  assert.equal(row.status, 'void');
  assert.match(row.endReason, /người khác đặt/);
  assert.equal((await bookingsOf(w.a.id)).length, 0);
  assert.equal((await requestRow(r.id)).status, 'open'); // nhu cầu vẫn mở để khách chọn chào giá khác
});

test('chọn: ô bị chặn, giữ cho người chờ, chuyển sang đủ hai đội, giá niêm yết thấp hơn giá chào, sân đóng → 409 và void', async () => {
  const w = await world();
  const mk = async (court, start, price = 300000) => {
    const r = await post(w.a, { closesAt: stamp(DAY, '16:00') });
    return { r, o: await offerOk(w.owner, r.id, { courtId: court, start, price }) };
  };
  const expectVoid = async ({ r, o }, re) => {
    const res = await accept(w.a, r.id, o.id);
    assert.equal(res.status, 409, res.text);
    assert.match(res.body.error || res.body.message, re);
    assert.equal((await offerRow(o.id)).status, 'void');
    await w.a.a.del(`/api/requests/${r.id}`); // giải phóng chỗ cho nhu cầu kế (tối đa 3)
  };
  const blockCase = await mk(w.courtId, '18:00');
  const blk = await w.owner.a.post('/api/owner/blocks', { courtId: w.courtId, date: DAY, start: '18:00', end: '19:00' });
  assert.equal(blk.status, 201);
  await expectVoid(blockCase, /chủ sân đã chặn/);
  const teamCase = await mk(w.courtIds[1], '19:00');
  await h.db.query("UPDATE courts SET team_mode_enabled = 1 WHERE id = ?", [w.courtIds[1]]);
  await expectVoid(teamCase, /chỉ nhận ghép kèo/);
  await h.db.query("UPDATE courts SET team_mode_enabled = 0 WHERE id = ?", [w.courtIds[1]]);
  const priceCase = await mk(w.courtIds[1], '19:00', 440000);
  await h.db.query('UPDATE courts SET peak_price = 420000 WHERE id = ?', [w.courtIds[1]]);
  await expectVoid(priceCase, /thấp hơn giá chào/);
  await h.db.query('UPDATE courts SET peak_price = 450000 WHERE id = ?', [w.courtIds[1]]);
  const closedCase = await mk(w.courtIds[1], '19:00');
  await h.db.query('UPDATE courts SET is_active = 0 WHERE id = ?', [w.courtIds[1]]);
  await expectVoid(closedCase, /không còn nhận đặt/);
  await h.db.query('UPDATE courts SET is_active = 1 WHERE id = ?', [w.courtIds[1]]);
  // giữ cho người đăng ký chờ: khách B đã giữ chỗ rồi hủy → ô được mời người chờ khác, khách A (không phải người được mời) không chọn được
  const waitCase = await mk(w.courtIds[1], '19:00');
  const held = await w.b.a.post('/api/bookings', { courtId: w.courtIds[1], date: DAY, start: '19:00' });
  assert.equal(held.status, 201);
  const third = await person('customer', 'Khách C');
  assert.equal((await third.a.post('/api/waitlist', { courtId: w.courtIds[1], date: DAY, start: '19:00' })).status, 201);
  assert.equal((await w.b.a.post(`/api/bookings/${held.body.id}/cancel`, {})).status, 200);
  await expectVoid(waitCase, /giữ cho người đã đăng ký chờ/);
  assert.equal((await bookingsOf(w.a.id)).length, 0);
});

test('chọn: chào giá quá hiệu lực → 409 và expired; nhu cầu đã hủy → 409; nhu cầu đã chốt chọn chào giá khác → 409', async () => {
  const w = await world();
  const rival = await venueOf('Quận 1', { name: 'Đối thủ' });
  const r = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId, validUntil: stamp(DAY, '10:00') });
  const keep = await offerOk(rival.owner, r.id, { courtId: rival.courtIds[0], validUntil: stamp(DAY, '15:00') });
  h.setNow(stamp(DAY, '10:30'));
  // gọi thẳng dịch vụ, không qua sweep của middleware: nhánh "quá hạn" khi sweep chưa kịp chạy
  await assert.rejects(requestOps.acceptOffer(w.a, r.id, { offerId: o.id }), (e) => e.status === 409 && /quá hạn/.test(e.message));
  const expired = await offerRow(o.id);
  assert.equal(expired.status, 'expired');
  assert.match(expired.endReason, /quá hạn hiệu lực/);
  // chọn chào giá còn hạn thành công, rồi chọn chào giá kia thì 409
  assert.equal((await accept(w.a, r.id, keep.id)).status, 200);
  assert.equal((await accept(w.a, r.id, o.id)).status, 409);
  const cancelled = await post(w.b);
  const o3 = await offerOk(rival.owner, cancelled.id, { courtId: rival.courtIds[0], start: '19:00', validUntil: stamp(DAY, '16:00') });
  assert.equal((await w.b.a.del(`/api/requests/${cancelled.id}`)).status, 200);
  const res = await accept(w.b, cancelled.id, o3.id);
  assert.equal(res.status, 409);
  assert.equal((await bookingsOf(w.b.id)).length, 0);
});

/* ---------- Hủy / hết hạn ---------- */

test('khách hủy nhu cầu đang mở: cancelled, chào giá mở thành void, chủ sân được báo; hủy lại 409', async () => {
  const w = await world();
  const r = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId });
  const res = await w.a.a.del(`/api/requests/${r.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  assert.equal(res.body.offers[0].status, 'void');
  const row = await offerRow(o.id);
  assert.equal(row.status, 'void');
  assert.match(row.endReason, /Khách đã hủy/);
  assert.match((await notes(w.owner.id)).at(-1).message, /đã được khách hủy/);
  assert.equal((await w.a.a.del(`/api/requests/${r.id}`)).status, 409);
  assert.equal((await w.a.a.get('/api/owner/requests')).status, 403);
  // chủ sân vẫn thấy tin đã đóng khi có chào giá của mình
  assert.equal((await w.owner.a.get('/api/owner/requests')).body[0].status, 'cancelled');
});

test('hết hạn trong sweep: chào giá quá hiệu lực expired trước, rồi nhu cầu expired kèm các chào giá còn mở; khách và chủ sân được báo', async () => {
  const w = await world();
  const rival = await venueOf('Quận 1', { name: 'Đối thủ' });
  const r = await post(w.a);
  const early = await offerOk(w.owner, r.id, { courtId: w.courtId, validUntil: stamp(DAY, '10:00') });
  const late = await offerOk(rival.owner, r.id, { courtId: rival.courtIds[0], validUntil: stamp(DAY, '15:30') });
  h.setNow(stamp(DAY, '10:30'));
  await sweep();
  assert.equal((await offerRow(early.id)).status, 'expired');
  assert.equal((await offerRow(late.id)).status, 'open');
  assert.equal((await requestRow(r.id)).status, 'open');
  h.setNow(stamp(DAY, '16:05'));
  await sweep();
  const row = await requestRow(r.id);
  assert.equal(row.status, 'expired');
  assert.match(row.endReason, /Quá hạn/);
  const o2 = await offerRow(late.id);
  assert.equal(o2.status, 'expired');
  assert.match(o2.endReason, /quá hạn nhận báo giá/);
  assert.match((await notes(w.a.id)).at(-1).message, /đã quá hạn nhận báo giá, bạn chưa chọn 1 báo giá/);
  assert.match((await notes(rival.owner.id)).at(-1).message, /đã quá hạn/);
  assert.equal((await w.a.a.del(`/api/requests/${r.id}`)).status, 409);
  assert.equal((await accept(w.a, r.id, late.id)).status, 409);
  await sweep(); // chạy lại không báo lần hai
  assert.equal((await notes(w.a.id)).filter((n) => /quá hạn nhận báo giá/.test(n.message)).length, 1);
});

/* ---------- Đua: DB giữ luật một ô một người ---------- */

/** Hai khách, mỗi người một nhu cầu, cùng nhận chào giá của cùng một ô. */
async function twoOffersOnSameSlot(w) {
  const rA = await post(w.a);
  const rB = await post(w.b);
  const oA = await offerOk(w.owner, rA.id, { courtId: w.courtId });
  // cụm sân chỉ chào được một lần cho mỗi nhu cầu nhưng được chào cho nhiều nhu cầu
  const oB = await offerOk(w.owner, rB.id, { courtId: w.courtId });
  return { rA, rB, oA, oB };
}
const settled = (list) => ({ ok: list.filter((x) => x.status === 'fulfilled'), bad: list.filter((x) => x.status === 'rejected') });

test('đua: hai khách cùng chọn chào giá cho đúng một ô, chỉ một người được booking', async () => {
  const w = await world();
  for (let round = 0; round < 3; round += 1) {
    const { rA, rB, oA, oB } = await twoOffersOnSameSlot(w);
    const res = settled(await Promise.allSettled([
      requestOps.acceptOffer(w.a, rA.id, { offerId: oA.id }),
      requestOps.acceptOffer(w.b, rB.id, { offerId: oB.id }),
    ]));
    assert.equal(res.ok.length, 1, 'đúng một người thắng');
    assert.equal(res.bad.length, 1);
    assert.equal(res.bad[0].reason.status, 409);
    const holding = await h.db.query("SELECT * FROM bookings WHERE court_id = ? AND start_at = ? AND status IN ('pending','confirmed','matching')", [w.courtId, stamp(DAY, '18:00:00')]);
    assert.equal(holding.length, 1);
    const winnerId = holding[0].userId;
    const loserReq = winnerId === w.a.id ? rB : rA;
    const loserOffer = winnerId === w.a.id ? oB : oA;
    assert.equal((await requestRow(loserReq.id)).status, 'open', 'người thua vẫn mở nhu cầu');
    assert.equal((await offerRow(loserOffer.id)).status, 'void');
    // dọn cho vòng sau
    await h.db.query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [holding[0].id]);
    await h.db.query('DELETE FROM slot_claims WHERE booking_id = ?', [holding[0].id]);
    await h.db.query("UPDATE requests SET status = 'cancelled' WHERE user_id IN (?, ?)", [w.a.id, w.b.id]);
  }
});

test('đua: chọn chào giá cùng lúc đặt thường vào đúng ô đó, chỉ một bên được', async () => {
  const w = await world();
  const r = await post(w.a);
  const o = await offerOk(w.owner, r.id, { courtId: w.courtId });
  const res = settled(await Promise.allSettled([
    requestOps.acceptOffer(w.a, r.id, { offerId: o.id }),
    createBooking(w.b, { courtId: w.courtId, date: DAY, start: '18:00' }),
  ]));
  assert.equal(res.ok.length, 1);
  assert.equal(res.bad[0].reason.status, 409);
  assert.equal((await h.db.query("SELECT 1 FROM bookings WHERE court_id = ? AND start_at = ? AND status IN ('pending','confirmed')", [w.courtId, stamp(DAY, '18:00:00')])).length, 1);
  const acceptWon = (await bookingsOf(w.a.id)).length === 1;
  assert.equal((await requestRow(r.id)).status, acceptWon ? 'chosen' : 'open');
});

test('đua: một nhu cầu chọn hai chào giá khác ô cùng lúc, chỉ một booking và nhu cầu chốt một chào giá', async () => {
  const w = await world();
  const rival = await venueOf('Quận 1', { name: 'Đối thủ' });
  const r = await post(w.a);
  const o1 = await offerOk(w.owner, r.id, { courtId: w.courtId });
  const o2 = await offerOk(rival.owner, r.id, { courtId: rival.courtIds[0] });
  const res = settled(await Promise.allSettled([
    requestOps.acceptOffer(w.a, r.id, { offerId: o1.id }),
    requestOps.acceptOffer(w.a, r.id, { offerId: o2.id }),
  ]));
  assert.equal(res.ok.length, 1);
  assert.equal(res.bad[0].reason.status, 409);
  assert.equal((await bookingsOf(w.a.id)).length, 1);
  const row = await requestRow(r.id);
  assert.equal(row.status, 'chosen');
  const states = [(await offerRow(o1.id)).status, (await offerRow(o2.id)).status].sort();
  assert.deepEqual(states, ['chosen', 'lost']);
});

/* ---------- Dữ liệu mẫu ---------- */

test('dữ liệu demo: bốn nhu cầu mẫu, chào giá gắn đúng sân, tin đã chốt có booking offer_accept; claim khớp', async () => {
  await h.loadDemo();
  const reqs = await h.db.query('SELECT * FROM requests ORDER BY id');
  assert.deepEqual(reqs.map((x) => x.status), ['open', 'open', 'chosen', 'open']);
  assert.ok((await h.db.query('SELECT 1 FROM offers')).length >= 3);
  const chosen = reqs[2];
  const b = await h.db.one('SELECT * FROM bookings WHERE id = ?', [chosen.bookingId]);
  assert.equal(b.offerId, chosen.chosenOfferId);
  assert.equal(b.discountPercent, 0);
  assert.equal((await h.db.one('SELECT price FROM offers WHERE id = ?', [chosen.chosenOfferId])).price, b.price);
  assert.ok((await h.db.query("SELECT 1 FROM booking_history WHERE booking_id = ? AND action = 'offer_accept'", [b.id])).length);
  // API: khách 4 thấy tin của mình, chủ sân thấy tin phù hợp
  const k = app.agent();
  assert.equal((await k.post('/api/auth/login', { email: (await h.db.one('SELECT email FROM users WHERE id = 4')).email, password: require('../public/mock/users.json').demoPassword })).status, 200);
  const mine = (await k.get('/api/requests/mine')).body;
  assert.equal(mine.length, 3);
});
