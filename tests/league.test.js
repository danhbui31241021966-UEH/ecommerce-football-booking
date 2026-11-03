// Giải phủi tại một sân (R18) qua HTTP trên MySQL thật. Mỗi test dựng dữ liệu riêng; claim không được lệch.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { pool } = require('../src/db');
const { addDays } = require('../src/lib/time');
const { createBooking } = require('../src/services/bookingCore');
const leagueOps = require('../src/services/leagueOps');
const rules = require('../src/services/leagueRules');

let app;
let seq = 0;
let TODAY;
let D1;
let D2;
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
  const email = `l${seq}-${Date.now()}@test.local`;
  const u = await h.makeUser({ role, email, fullName: name });
  const a = app.agent();
  const r = await a.post('/api/auth/login', { email, password: 'Matkhau@123' });
  assert.equal(r.status, 200, r.text);
  return { ...u, email, fullName: name, a };
}

/** Một cụm sân (hai sân con loại 5, ô 60 phút, 06:00–23:00) và hai khách; "bây giờ" là 09:00 hôm nay. */
async function world() {
  await h.emptyData();
  TODAY = h.clock.today();
  D1 = h.tomorrow();
  D2 = addDays(D1, 1);
  h.setNow(stamp(TODAY, '09:00'));
  const owner = await person('owner', 'Chủ sân giải');
  const v = await h.makeVenueWithCourt({ ownerId: owner.id, courts: 2 });
  await h.db.query("UPDATE venues SET phone = '0281234567' WHERE id = ?", [v.venueId]);
  const [a, b] = [await person('customer', 'Khách A'), await person('customer', 'Khách B')];
  return { owner, venueId: v.venueId, c1: v.courtIds[0], c2: v.courtIds[1], a, b };
}
const NAMES = ['Đội A', 'Đội B', 'Đội C', 'Đội D'];
const team = (name) => ({ name, contactName: `Liên hệ ${name}`, contactPhone: '0909000111' });
const create = (w, over = {}) => w.owner.a.post('/api/owner/leagues', { venueId: w.venueId, name: 'Giải thử', fieldType: '5', teamCount: 4, teams: NAMES.map(team), ...over });
const made = async (w, over) => {
  const r = await create(w, over);
  assert.equal(r.status, 201, r.text);
  return r.body;
};
const L = (id, rest = '') => `/api/owner/leagues/${id}${rest}`;
const fixtures = async (w, id) => {
  const r = await w.owner.a.post(L(id, '/fixtures'));
  assert.equal(r.status, 200, r.text);
  return r.body;
};
const autoPlan = (w, id, over = {}) => w.owner.a.post(L(id, '/auto-plan'), { courtId: w.c1, date: D1, start: '18:00', perDay: 3, ...over });
const planned = async (w, over) => {
  const l = await made(w, over);
  await fixtures(w, l.id);
  const r = await autoPlan(w, l.id);
  assert.equal(r.status, 200, r.text);
  return r.body;
};
const publish = (w, id) => w.owner.a.post(L(id, '/publish'));
const published = async (w, over) => {
  const l = await planned(w, over);
  const r = await publish(w, l.id);
  assert.equal(r.status, 200, r.text);
  return r.body;
};
const blocksOf = (id) => h.db.query('SELECT * FROM blocks WHERE league_id = ? ORDER BY id', [id]);
const claimCount = () => h.db.one('SELECT COUNT(*) AS n FROM slot_claims').then((r) => Number(r.n));
const err = (r) => r.body.error || r.body.message || '';

/* ---------- Tạo giải, đội, trận ---------- */

test('tạo giải: lưu đúng, điều lệ mặc định, quyền và các nhánh 400/403/404/409', async () => {
  const w = await world();
  const other = await person('owner', 'Chủ khác');
  const o = await h.makeVenueWithCourt({ ownerId: other.id });
  const l = await made(w, { link: 'https://zalo.me/g/abc' });
  assert.deepEqual([l.status, l.name, l.fieldType, l.teamCount, l.link, l.teams.length, l.matches.length], ['draft', 'Giải thử', '5', 4, 'https://zalo.me/g/abc', 4, 0]);
  assert.match(l.rules, /Thắng 3 điểm, hòa 1 điểm, thua 0 điểm/);
  assert.equal(l.teams[0].contactPhone, '0909000111'); // chủ sân thấy liên hệ
  const bad = async (over, status, re) => {
    const r = await create(w, over);
    assert.equal(r.status, status, `${JSON.stringify(over)} → ${r.text}`);
    assert.match(err(r), re);
  };
  await bad({ name: '  ' }, 400, /tên giải/);
  await bad({ fieldType: '11' }, 400, /5 hoặc 7/);
  await bad({ fieldType: '7' }, 400, /chưa có sân con 7/);
  await bad({ teamCount: 3 }, 400, /4 đến 8/);
  await bad({ teamCount: 9 }, 400, /4 đến 8/);
  await bad({ link: 'zalo.me/abc' }, 400, /http/);
  await bad({ teamCount: 4, teams: [...NAMES, 'Đội E'].map(team) }, 400, /chỉ có 4 đội/);
  await bad({ teams: [team('Đội A'), team('đội a')] }, 409, /Đã có đội tên/);
  await bad({ venueId: o.venueId }, 403, /không thuộc/);
  await bad({ venueId: 999999 }, 404, /sân/i);
  assert.equal((await w.a.a.post('/api/owner/leagues', { venueId: w.venueId })).status, 403);
  assert.equal((await other.a.get(L(l.id))).status, 403);
  assert.equal((await other.a.del(L(l.id))).status, 403);
  assert.equal((await w.owner.a.get(L(999999))).status, 404);
  const mine = (await w.owner.a.get(`/api/owner/leagues?venueId=${w.venueId}`)).body;
  assert.deepEqual(mine.map((x) => [x.id, x.teams, x.status]).slice(-1), [[l.id, 4, 'draft']]);
  assert.deepEqual((await other.a.get('/api/owner/leagues')).body, []);
});

test('đội: thêm/sửa/xóa khi còn nháp và chưa tạo trận; tên không trùng; tick lệ phí; số đội tối đa', async () => {
  const w = await world();
  const l = await made(w, { teams: [team('Đội A'), team('Đội B')] });
  const add = (name) => w.owner.a.post(L(l.id, '/teams'), team(name));
  assert.equal((await add('đội a')).status, 409);
  assert.equal((await add('Đội C')).status, 201);
  assert.equal((await add('Đội D')).status, 201);
  const full = await add('Đội E');
  assert.equal(full.status, 400);
  assert.match(err(full), /đủ 4 đội/);
  let d = (await w.owner.a.get(L(l.id))).body;
  const a = d.teams.find((t) => t.name === 'Đội A');
  const pay = await w.owner.a.put(L(l.id, `/teams/${a.id}`), { feePaid: true });
  assert.equal(pay.body.teams.find((t) => t.id === a.id).feePaid, true);
  const ren = await w.owner.a.put(L(l.id, `/teams/${a.id}`), { name: 'Đội A+', contactName: 'Anh Mới' });
  assert.equal(ren.body.teams.find((t) => t.id === a.id).name, 'Đội A+');
  const dup = await w.owner.a.put(L(l.id, `/teams/${a.id}`), { name: 'ĐỘI B' });
  assert.equal(dup.status, 409);
  assert.equal((await w.owner.a.del(L(l.id, `/teams/${d.teams[3].id}`))).status, 200);
  assert.equal((await w.owner.a.del(L(l.id, '/teams/999999'))).status, 404);
  assert.equal((await add('Đội D')).status, 201);
  // đã tạo trận thì không thêm/xóa đội
  await fixtures(w, l.id);
  assert.equal((await w.owner.a.del(L(l.id, `/teams/${a.id}`))).status, 409);
  d = (await w.owner.a.get(L(l.id))).body;
  assert.equal((await w.owner.a.post(L(l.id, '/teams'), team('Đội F'))).status, 409); // đã tạo trận
  assert.equal(d.teams.length, 4);
});

test('tạo các trận: cần đủ đội; vòng tròn mỗi cặp một trận (4 đội 6 trận, 5 đội 10 trận); làm lại được khi còn nháp', async () => {
  const w = await world();
  const few = await made(w, { teams: [team('Đội A'), team('Đội B')] });
  const r0 = await w.owner.a.post(L(few.id, '/fixtures'));
  assert.equal(r0.status, 400);
  assert.match(err(r0), /Cần đủ 4 đội/);
  const l = await made(w);
  const f = await fixtures(w, l.id);
  assert.equal(f.matches.length, 6);
  const pairs = new Set(f.matches.map((m) => [m.homeId, m.awayId].sort().join('-')));
  assert.equal(pairs.size, 6, 'mỗi cặp đúng một trận');
  assert.ok(f.matches.every((m) => m.status === 'unscheduled' && !m.held));
  const again = await fixtures(w, l.id);
  assert.equal(again.matches.length, 6);
  const five = await made(w, { teamCount: 5, teams: [...NAMES, 'Đội E'].map(team) });
  assert.equal((await fixtures(w, five.id)).matches.length, 10);
});

test('lưu giờ ở bước nháp không giữ ô; xóa giờ; xếp tự động theo perDay, bỏ ô đã có lịch', async () => {
  const w = await world();
  const l = await made(w);
  const f = await fixtures(w, l.id);
  const m = f.matches;
  const save = (slots) => w.owner.a.put(L(l.id, '/plan'), { slots });
  const ok = await save([{ matchId: m[0].id, courtId: w.c1, date: D1, start: '18:00' }]);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.matches[0].status, 'planned');
  assert.equal(ok.body.matches[0].held, false);
  assert.equal(await claimCount(), 0, 'nháp chưa giữ ô');
  assert.equal((await save([{ matchId: m[0].id }])).body.matches[0].status, 'unscheduled');
  assert.equal((await save([{ matchId: 999999, courtId: w.c1, date: D1, start: '18:00' }])).status, 404);
  assert.equal((await save([{ matchId: m[0].id, courtId: w.c1, date: 'mai', start: '18:00' }])).status, 400);
  assert.equal((await save([{ matchId: m[0].id, courtId: 999999, date: D1, start: '18:00' }])).status, 400);
  assert.equal((await w.owner.a.put(L(l.id, '/plan'), {})).status, 400);
  // người khác đã đặt 19:00 ngày D1 → xếp tự động bỏ ô đó
  assert.equal((await w.a.a.post('/api/bookings', { courtId: w.c1, date: D1, start: '19:00' })).status, 201);
  const auto = await autoPlan(w, l.id, { perDay: 2 });
  assert.equal(auto.status, 200, auto.text);
  const slots = auto.body.matches.map((x) => `${x.date} ${x.start}`);
  assert.deepEqual(slots, [`${D1} 18:00`, `${D1} 20:00`, `${addDays(D1, 1)} 18:00`, `${addDays(D1, 1)} 19:00`, `${addDays(D1, 2)} 18:00`, `${addDays(D1, 2)} 19:00`]);
  assert.ok(auto.body.matches.every((x) => x.courtId === w.c1 && x.end === `${String(Number(x.start.slice(0, 2)) + 1).padStart(2, '0')}:00`));
  const badAuto = async (over, re) => {
    const r = await autoPlan(w, l.id, over);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.match(err(r), re);
  };
  await badAuto({ perDay: 0 }, /từ 1 đến 8/);
  await badAuto({ perDay: 9 }, /từ 1 đến 8/);
  await badAuto({ date: 'mai' }, /ngày bắt đầu/);
  await badAuto({ courtId: 999999 }, /sân con/);
  await badAuto({ start: '23:30' }, /Không có giờ nào/);
  assert.equal((await w.owner.a.post(L(l.id, '/auto-plan'), { courtId: w.c1, date: D1, start: '18:00', perDay: 3 })).status, 200, 'không còn trận chưa có giờ thì không đổi gì');
  assert.equal(await claimCount(), 1, 'chỉ ô của khách; xếp nháp không giữ ô');
});

/* ---------- Công bố ---------- */

test('công bố: kiểm cả loạt, có lỗi thì không giữ ô nào và nói rõ lỗi nào (đã đặt, bị chặn, giữ cho người chờ, đã qua, sai loại, ghép kèo, trùng giờ)', async () => {
  const w = await world();
  const l = await planned(w);
  const noGo = async (re) => {
    const before = await claimCount();
    const r = await publish(w, l.id);
    assert.equal(r.status, 409, r.text);
    assert.match(err(r), re);
    assert.equal((await blocksOf(l.id)).length, 0, 'không giữ ô nào');
    assert.equal(await claimCount(), before);
    assert.equal((await w.owner.a.get(L(l.id))).body.status, 'draft');
  };
  const slotOf = async (i) => (await w.owner.a.get(L(l.id))).body.matches[i];
  // đã có lịch đặt
  const m0 = await slotOf(0);
  const bk = await w.a.a.post('/api/bookings', { courtId: m0.courtId, date: m0.date, start: m0.start });
  assert.equal(bk.status, 201);
  await noGo(/đã có lịch đặt SN\d+/);
  await w.a.a.post(`/api/bookings/${bk.body.id}/cancel`, {});
  // bị chặn (thường và của giải khác)
  const m1 = await slotOf(1);
  const blk = await w.owner.a.post('/api/owner/blocks', { courtId: m1.courtId, date: m1.date, start: m1.start, end: m1.end, reason: 'Sửa sân' });
  assert.equal(blk.status, 201);
  await noGo(/đang bị chặn/);
  assert.equal((await w.owner.a.del(`/api/owner/blocks/${blk.body.id}`)).status, 204);
  // giữ cho người chờ (đang được mời)
  const m2 = await slotOf(2);
  await h.db.query("INSERT INTO waitlist (user_id, court_id, start_at, status, offer_expires_at, created_at) VALUES (?, ?, ?, 'offered', ?, ?)", [w.b.id, m2.courtId, stamp(m2.date, `${m2.start}:00`), stamp(TODAY, '23:00:00'), stamp(TODAY, '08:00:00')]);
  await noGo(/giữ cho người chờ/);
  await h.db.query('DELETE FROM waitlist');
  // giờ ghép kèo
  await h.db.query("UPDATE courts SET team_mode_enabled = 1, team_mode_from = '18:00', team_mode_to = '19:00' WHERE id = ?", [w.c1]);
  await noGo(/chỉ nhận ghép kèo/);
  await h.db.query('UPDATE courts SET team_mode_enabled = 0 WHERE id = ?', [w.c1]);
  // giờ đã qua
  h.setNow(stamp(D1, '18:30'));
  await noGo(/giờ đã qua/);
  h.setNow(stamp(TODAY, '09:00'));
  // sân con sai loại
  await h.db.query("UPDATE courts SET field_type = '7' WHERE id = ?", [w.c1]);
  await noGo(/là sân 7 người, giải đá sân 5/);
  await h.db.query("UPDATE courts SET field_type = '5' WHERE id = ?", [w.c1]);
  // hai trận trùng giờ trên cùng sân con; một đội hai trận cùng giờ ở hai sân con
  const d = (await w.owner.a.get(L(l.id))).body;
  const [x, y] = d.matches;
  const save = (slots) => w.owner.a.put(L(l.id, '/plan'), { slots });
  await save([{ matchId: y.id, courtId: x.courtId, date: x.date, start: x.start }]);
  await noGo(/trùng giờ với trận/);
  const sameTeam = d.matches.find((m) => m.id !== x.id && [m.homeId, m.awayId].some((t) => [x.homeId, x.awayId].includes(t)));
  await save([{ matchId: y.id, courtId: y.courtId, date: y.date, start: y.start }, { matchId: sameTeam.id, courtId: w.c2, date: x.date, start: x.start }]);
  await noGo(/một đội phải đá hai trận cùng giờ/);
  // chưa chọn giờ
  await save([{ matchId: sameTeam.id }]);
  await noGo(/chưa chọn giờ/);
  const many = await w.owner.a.put(L(l.id, '/plan'), { slots: d.matches.map((m) => ({ matchId: m.id })) });
  assert.equal(many.status, 200);
  const r = await publish(w, l.id);
  assert.equal(r.status, 409);
  assert.match(err(r), /và 3 lỗi nữa/, 'chỉ nêu 3 lỗi đầu rồi đếm phần còn lại');
});

test('công bố thành công: giữ hết bằng chặn giờ gắn mã giải; ô hiện "Giải: tên"; khách, lịch điện thoại, ghép kèo không đặt trùng; chủ sân không bỏ chặn tay', async () => {
  const w = await world();
  const l = await published(w, { name: 'Giải Mùa Thu' });
  assert.equal(l.status, 'published');
  assert.ok(l.publishedAt);
  assert.equal(l.counts.held, 6);
  assert.ok(l.matches.every((m) => m.held && m.status === 'scheduled'));
  const blocks = await blocksOf(l.id);
  assert.equal(blocks.length, 6);
  assert.ok(blocks.every((b) => b.reason === 'Giải: Giải Mùa Thu' && b.leagueMatchId != null));
  assert.equal(await claimCount(), 6);
  // lưới khách: blocked kèm league {id,name}
  const first = l.matches[0];
  const sched = (await w.a.a.get(`/api/venues/${w.venueId}/schedule?date=${first.date}`)).body;
  const cell = sched.courts.find((c) => c.id === first.courtId).slots.find((s) => s.start === first.start);
  assert.equal(cell.status, 'blocked');
  assert.deepEqual(cell.league, { id: l.id, name: 'Giải Mùa Thu' });
  // lưới chủ sân
  const os = (await w.owner.a.get(`/api/owner/venues/${w.venueId}/schedule?date=${first.date}`)).body;
  const oc = os.courts.find((c) => c.id === first.courtId).slots.find((s) => s.start === first.start);
  assert.equal(oc.block.leagueId, l.id);
  assert.match(oc.block.reason, /^Giải: /);
  // trang chi tiết sân liệt kê giải chưa kết thúc
  const vd = (await w.a.a.get(`/api/venues/${w.venueId}`)).body;
  assert.deepEqual(vd.leagues, [{ id: l.id, name: 'Giải Mùa Thu', fieldType: '5', status: 'published' }]);
  // không đặt trùng: khách, điện thoại, ghép kèo, danh sách chờ; không bị giới hạn cửa sổ 3 ngày (ô D1+2 vẫn giữ được)
  assert.equal((await w.a.a.post('/api/bookings', { courtId: first.courtId, date: first.date, start: first.start })).status, 409);
  const ph = await w.owner.a.post('/api/owner/bookings', { courtId: first.courtId, date: first.date, start: first.start, customerName: 'Anh Tùng' });
  assert.equal(ph.status, 409);
  await h.db.query("UPDATE courts SET team_mode_enabled = 1 WHERE id = ?", [first.courtId]);
  assert.equal((await w.a.a.post('/api/matches', { courtId: first.courtId, date: first.date, start: first.start, loserPercent: 50, closesAt: stamp(first.date, '16:00') })).status, 409);
  await h.db.query("UPDATE courts SET team_mode_enabled = 0 WHERE id = ?", [first.courtId]);
  // bỏ chặn tay một block của giải: 409, block và claim còn nguyên
  const del = await w.owner.a.del(`/api/owner/blocks/${blocks[0].id}`);
  assert.equal(del.status, 409);
  assert.match(err(del), /đang giữ cho giải "Giải Mùa Thu"/);
  assert.equal((await blocksOf(l.id)).length, 6);
  assert.equal(await claimCount(), 6);
  // công bố lại, thêm đội, tạo lại trận: 409
  assert.equal((await publish(w, l.id)).status, 409);
  assert.equal((await w.owner.a.post(L(l.id, '/fixtures'))).status, 409);
  assert.equal((await w.owner.a.post(L(l.id, '/teams'), team('Đội Z'))).status, 409);
  assert.equal((await w.owner.a.put(L(l.id, '/plan'), { slots: [] })).status, 409);
  // sửa tên giải đổi lý do của các block
  assert.equal((await w.owner.a.put(L(l.id), { name: 'Giải Đổi Tên', link: 'https://facebook.com/x' })).status, 200);
  assert.ok((await blocksOf(l.id)).every((b) => b.reason === 'Giải: Giải Đổi Tên'));
});

test('công khai: danh sách và chi tiết chỉ giải đã công bố, không lộ liên hệ/lệ phí/lịch sử; lọc theo quận; giải nháp 404', async () => {
  const w = await world();
  const draft = await made(w, { name: 'Giải nháp' });
  const l = await published(w, { name: 'Giải công bố', link: 'https://zalo.me/g/x' });
  const anon = app.agent();
  const list = await anon.get('/api/leagues');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((x) => x.name), ['Giải công bố']);
  const item = list.body[0];
  assert.deepEqual([item.status, item.teamCount, item.matches, item.done, item.nextAt, item.leader, item.venueDistrict, item.venuePhone, item.indexable, item.link],
    ['published', 4, 6, 0, l.matches.map((m) => `${m.date} ${m.start}`).sort()[0], null, 'Quận 1', '0281234567', false, 'https://zalo.me/g/x']);
  assert.equal((await anon.get(`/api/leagues?district=${encodeURIComponent('Quận 7')}`)).body.length, 0);
  assert.equal((await anon.get(`/api/leagues?district=${encodeURIComponent('Quận 1')}`)).body.length, 1);
  assert.equal((await anon.get(`/api/leagues/${draft.id}`)).status, 404);
  assert.equal((await anon.get('/api/leagues/999999')).status, 404);
  const pub = (await anon.get(`/api/leagues/${l.id}`)).body;
  assert.equal(pub.name, 'Giải công bố');
  assert.ok(pub.rules && pub.standings.length === 4 && pub.matches.length === 6);
  const text = JSON.stringify(pub);
  assert.ok(!/contactName|contactPhone|feePaid|history|0909000111/.test(text), 'không lộ liên hệ, lệ phí, lịch sử');
  const mv = await w.owner.a.post(L(l.id, `/matches/${l.matches[0].id}/reschedule`), { courtId: w.c2, date: D2, start: '22:00', note: 'Mưa' });
  assert.equal(mv.status, 200, mv.text);
  const after = (await anon.get(`/api/leagues/${l.id}`)).body.matches;
  assert.equal(after.find((x) => x.id === l.matches[0].id).rescheduled, true, 'trang công khai biết trận đã hoãn');
  assert.ok(after.every((x) => !('history' in x)));
  // sân có dataSource (sân thật) thì indexable
  await h.db.query("UPDATE venues SET data_source = JSON_OBJECT('name', 'OSM') WHERE id = ?", [w.venueId]);
  assert.equal((await anon.get('/api/leagues')).body[0].indexable, true);
});

/* ---------- Hoãn, tỉ số, rút, xóa ---------- */

test('hoãn trận: giờ cũ được trả và mời người chờ, giờ mới được giữ, ghi lịch sử; các nhánh 409/400; thất bại không mất giờ cũ', async () => {
  const w = await world();
  const l = await published(w);
  const m = l.matches[0];
  const oldAt = stamp(m.date, `${m.start}:00`);
  await h.db.query("INSERT INTO waitlist (user_id, court_id, start_at, status, created_at) VALUES (?, ?, ?, 'waiting', ?)", [w.b.id, m.courtId, oldAt, stamp(TODAY, '08:00:00')]);
  const resched = (mid, body) => w.owner.a.post(L(l.id, `/matches/${mid}/reschedule`), body);
  // thất bại: ô mới đã có người đặt → 409, giờ cũ vẫn giữ
  assert.equal((await w.a.a.post('/api/bookings', { courtId: w.c2, date: D2, start: '21:00' })).status, 201);
  const taken = await resched(m.id, { courtId: w.c2, date: D2, start: '21:00' });
  assert.equal(taken.status, 409);
  assert.match(err(taken), /Giờ mới không giữ được: .*đã có lịch đặt/);
  assert.equal((await blocksOf(l.id)).length, 6);
  assert.equal((await h.db.one('SELECT status FROM waitlist WHERE user_id = ?', [w.b.id])).status, 'waiting');
  // trùng giờ cũ, đội đã có trận cùng giờ, giờ sai lưới
  assert.match(err(await resched(m.id, { courtId: m.courtId, date: m.date, start: m.start })), /trùng giờ cũ/);
  const clash = l.matches.find((x) => x.id !== m.id && [x.homeId, x.awayId].some((t) => [m.homeId, m.awayId].includes(t)));
  assert.match(err(await resched(m.id, { courtId: w.c2, date: clash.date, start: clash.start })), /đã có trận khác cùng giờ/);
  assert.equal((await resched(m.id, { courtId: w.c2, date: D2, start: '05:00' })).status, 409);
  assert.equal((await resched(m.id, {})).status, 409);
  assert.equal((await resched(999999, { courtId: w.c2, date: D2, start: '22:00' })).status, 404);
  // thành công
  const ok = await resched(m.id, { courtId: w.c2, date: D2, start: '22:00', note: 'Sân bị ướt' });
  assert.equal(ok.status, 200, ok.text);
  const moved = ok.body.matches.find((x) => x.id === m.id);
  assert.deepEqual([moved.courtId, moved.date, moved.start, moved.held, moved.rescheduled], [w.c2, D2, '22:00', true, true]);
  assert.equal(moved.history.length, 1);
  assert.deepEqual([moved.history[0].kind, moved.history[0].by, moved.history[0].note], ['reschedule', 'Chủ sân giải', 'Sân bị ướt']);
  assert.match(moved.history[0].from, /18:00/);
  assert.equal((await blocksOf(l.id)).length, 6);
  assert.equal(await h.db.one('SELECT 1 AS x FROM slot_claims WHERE court_id = ? AND start_at = ?', [m.courtId, oldAt]), null, 'giờ cũ đã được trả');
  const w1 = await h.db.one('SELECT status FROM waitlist WHERE user_id = ?', [w.b.id]);
  assert.equal(w1.status, 'offered', 'người chờ giờ cũ được mời');
  assert.equal((await w.b.a.post('/api/bookings', { courtId: m.courtId, date: m.date, start: m.start })).status, 201);
  // chưa công bố thì không hoãn; trận đã có kết quả không hoãn
  const draft = await planned(w, { name: 'Nháp' });
  assert.equal((await w.owner.a.post(L(draft.id, `/matches/${draft.matches[0].id}/reschedule`), { courtId: w.c2, date: D2, start: '20:00' })).status, 400);
  h.setNow(stamp(D2, '23:00'));
  const sc = await w.owner.a.post(L(l.id, `/matches/${l.matches[1].id}/score`), { home: 1, away: 0 });
  assert.equal(sc.status, 200, sc.text);
  const done = await resched(l.matches[1].id, { courtId: w.c2, date: addDays(D2, 1), start: '20:00' });
  assert.equal(done.status, 409);
  assert.match(err(done), /đã có kết quả/);
});

test('tỉ số: chỉ khi trận đã đến giờ; sửa phải có lý do; lưu lịch sử; chỉ chủ sân của giải; bảng xếp hạng điểm → hiệu số → bàn thắng → tên', async () => {
  const w = await world();
  const other = await person('owner', 'Chủ khác');
  const l = await published(w);
  const m = l.matches;
  const score = (i, body, who = w.owner) => who.a.post(L(l.id, `/matches/${m[i].id}/score`), body);
  const early = await score(0, { home: 1, away: 0 });
  assert.equal(early.status, 409);
  assert.match(err(early), /chưa đến giờ đá/);
  h.setNow(stamp(D2, '23:30')); // mọi trận (D1, D2) đã đến giờ
  assert.equal((await score(0, { home: 1, away: 0 }, other)).status, 403);
  assert.equal((await score(0, { home: 1, away: 0 }, w.a)).status, 403);
  assert.equal((await score(0, { home: -1, away: 0 })).status, 400);
  assert.equal((await score(0, { home: 1.5, away: 0 })).status, 400);
  assert.equal((await score(0, { home: 100, away: 0 })).status, 400);
  assert.equal((await score(0, { home: 'x', away: 0 })).status, 400);
  assert.equal((await w.owner.a.post(L(l.id, '/matches/999999/score'), { home: 1, away: 0 })).status, 404);
  const first = await score(0, { home: 2, away: 1 });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.status, 'ongoing');
  const edit = await score(0, { home: 1, away: 1 });
  assert.equal(edit.status, 400);
  assert.match(err(edit), /lý do/);
  assert.equal((await score(0, { home: 2, away: 1, note: 'ghi nhầm' })).status, 409);
  const fixed = await score(0, { home: 1, away: 1, note: 'Nhập nhầm' });
  assert.equal(fixed.status, 200);
  const hist = fixed.body.matches[0].history;
  assert.deepEqual(hist.map((e) => [e.kind, e.from, e.to, e.note, e.by]), [['score', null, '2-1', '', 'Chủ sân giải'], ['score', '2-1', '1-1', 'Nhập nhầm', 'Chủ sân giải']]);
  assert.ok(hist.every((e) => e.at));
  // bảng xếp hạng: A thắng B 2-0, A hòa C 1-1, D thắng A 3-0, B hòa C 2-2, B thắng D 1-0, C thắng D 4-0
  const results = { 'Đội A|Đội B': [2, 0], 'Đội A|Đội C': [1, 1], 'Đội D|Đội A': [3, 0], 'Đội B|Đội C': [2, 2], 'Đội B|Đội D': [1, 0], 'Đội C|Đội D': [4, 0] };
  for (const [i, x] of m.entries()) {
    const key = `${x.homeName}|${x.awayName}`;
    const rev = `${x.awayName}|${x.homeName}`;
    const [a, b] = results[key] || [...results[rev]].reverse();
    const r = await score(i, { home: a, away: b, note: i === 0 ? 'Sửa lại' : '' });
    assert.equal(r.status, 200, `${key}: ${r.text}`);
  }
  const fin = (await w.owner.a.get(L(l.id))).body;
  assert.equal(fin.status, 'finished');
  assert.deepEqual(fin.standings.map((s) => [s.rank, s.name, s.points, s.gd, s.gf, s.played]), [
    [1, 'Đội C', 5, 4, 7, 3], [2, 'Đội A', 4, -1, 3, 3], [3, 'Đội B', 4, -1, 3, 3], [4, 'Đội D', 3, -2, 3, 3],
  ]);
  assert.equal(fin.counts.done, 6);
  const pub = (await app.agent().get(`/api/leagues/${l.id}`)).body;
  assert.equal(pub.status, 'finished');
  assert.deepEqual((await app.agent().get('/api/leagues')).body[0].leader, { teamId: fin.standings[0].teamId, name: 'Đội C', points: 5, played: 3 });
  assert.deepEqual((await w.a.a.get(`/api/venues/${w.venueId}`)).body.leagues, [], 'giải đã kết thúc không còn trong trang sân');
});

test('bảng xếp hạng thuần: điểm, rồi hiệu số, rồi bàn thắng, rồi tên A–Z; đội rút ghi withdrawn', () => {
  const teams = ['Zeta', 'Alpha', 'Beta', 'Gamma'].map((name, i) => ({ id: i + 1, name, withdrawnAt: name === 'Gamma' ? '2026-01-01 00:00:00' : null }));
  const m = (home, away, a, b) => ({ homeId: home, awayId: away, homeScore: a, awayScore: b });
  // Zeta 6đ (+2 gf 3), Alpha 6đ (+2 gf 4): bằng điểm, bằng hiệu số, Alpha nhiều bàn hơn; Beta/Gamma 0đ cùng hiệu số kém, tên A–Z
  const rows = rules.standingsOf(teams, [m(1, 3, 3, 1), m(2, 4, 4, 2), m(1, 4, 1, 0), m(2, 3, 1, 0)]);
  assert.deepEqual(rows.map((r) => r.name), ['Alpha', 'Zeta', 'Gamma', 'Beta']);
  assert.equal(rows[2].withdrawn, true);
  // bằng hết điểm, hiệu số, bàn thắng: xếp tên A–Z
  const tie = rules.standingsOf(teams.slice(0, 3), []);
  assert.deepEqual(tie.map((r) => r.name), ['Alpha', 'Beta', 'Zeta']);
  // hiệu số đứng trước bàn thắng
  const r2 = rules.standingsOf(teams.slice(0, 2), [m(1, 2, 5, 3)]);
  assert.equal(r2[0].name, 'Zeta');
  assert.deepEqual(rules.roundRobin([1, 2, 3, 4]).length, 6);
});

test('đội rút (sau công bố): trận đã đá giữ nguyên, trận chưa đá xử thua 0-3, giờ giữ được trả và mời người chờ; không hoàn tác; trước công bố thì xóa đội', async () => {
  const w = await world();
  const draft = await planned(w, { name: 'Nháp' });
  const early = await w.owner.a.post(L(draft.id, `/teams/${draft.teams[0].id}/withdraw`), {});
  assert.equal(early.status, 400);
  const l = await published(w);
  const tD = l.teams.find((t) => t.name === 'Đội D');
  const dMatches = l.matches.filter((x) => x.homeId === tD.id || x.awayId === tD.id);
  assert.equal(dMatches.length, 3);
  h.setNow(stamp(D1, '23:00')); // các trận ngày D1 đã đá
  const playedMatch = dMatches.find((x) => x.date === D1);
  assert.equal((await w.owner.a.post(L(l.id, `/matches/${playedMatch.id}/score`), { home: 2, away: 2 })).status, 200);
  const free = dMatches.filter((x) => x.id !== playedMatch.id);
  await h.db.query("INSERT INTO waitlist (user_id, court_id, start_at, status, created_at) VALUES (?, ?, ?, 'waiting', ?)", [w.b.id, free[0].courtId, stamp(free[0].date, `${free[0].start}:00`), stamp(TODAY, '08:00:00')]);
  const wd = await w.owner.a.post(L(l.id, `/teams/${tD.id}/withdraw`), { note: 'Thiếu người' });
  assert.equal(wd.status, 200, wd.text);
  const after = wd.body;
  assert.equal(after.teams.find((t) => t.id === tD.id).withdrawn, true);
  const keep = after.matches.find((x) => x.id === playedMatch.id);
  assert.deepEqual([keep.status, keep.score.home + keep.score.away], ['played', 4], 'kết quả đã đá giữ nguyên');
  for (const f of free) {
    const x = after.matches.find((y) => y.id === f.id);
    assert.equal(x.status, 'forfeit');
    assert.equal(x.forfeitBy, tD.id);
    assert.equal(x.held, false);
    assert.deepEqual(x.score, x.homeId === tD.id ? { home: 0, away: 3 } : { home: 3, away: 0 });
    assert.match(x.history.at(-1).note, /rút khỏi giải, xử thua 0-3\. Thiếu người/);
    assert.equal(await h.db.one('SELECT 1 AS x FROM slot_claims WHERE court_id = ? AND start_at = ?', [f.courtId, stamp(f.date, `${f.start}:00`)]), null);
  }
  assert.equal((await blocksOf(l.id)).length, 6 - free.length);
  assert.equal((await h.db.one('SELECT status FROM waitlist WHERE user_id = ?', [w.b.id])).status, 'offered');
  assert.equal(after.standings.find((s) => s.name === 'Đội D').withdrawn, true);
  assert.equal(after.standings.find((s) => s.name === 'Đội D').played, 3);
  assert.equal((await w.owner.a.post(L(l.id, `/teams/${tD.id}/withdraw`), {})).status, 409, 'không hoàn tác / không rút hai lần');
  assert.equal((await w.owner.a.post(L(l.id, `/matches/${free[0].id}/score`), { home: 1, away: 0 })).status, 409, 'trận xử thua không nhập tỉ số');
  assert.equal((await w.owner.a.post(L(l.id, '/teams/999999/withdraw'), {})).status, 404);
});

test('xóa giải: trả mọi giờ (mời người chờ), xóa đội, trận, kết quả; giải của người khác 403', async () => {
  const w = await world();
  const other = await person('owner', 'Chủ khác');
  const l = await published(w);
  const m = l.matches[0];
  await h.db.query("INSERT INTO waitlist (user_id, court_id, start_at, status, created_at) VALUES (?, ?, ?, 'waiting', ?)", [w.b.id, m.courtId, stamp(m.date, `${m.start}:00`), stamp(TODAY, '08:00:00')]);
  assert.equal((await other.a.del(L(l.id))).status, 403);
  assert.equal(await claimCount(), 6);
  const r = await w.owner.a.del(L(l.id));
  assert.equal(r.status, 200, r.text);
  assert.equal(await claimCount(), 0);
  for (const t of ['leagues', 'league_teams', 'league_matches', 'league_events', 'blocks']) assert.equal((await h.db.query(`SELECT 1 FROM ${t}`)).length, 0, t);
  assert.equal((await h.db.one('SELECT status FROM waitlist WHERE user_id = ?', [w.b.id])).status, 'offered');
  assert.equal((await app.agent().get(`/api/leagues/${l.id}`)).status, 404);
  assert.equal((await w.b.a.post('/api/bookings', { courtId: m.courtId, date: m.date, start: m.start })).status, 201);
});

/* ---------- Tranh chấp: DB giữ luật một ô một chủ ---------- */

test('đua: một người đặt thường một ô trong loạt ngay lúc công bố, chỉ một bên được và giải thua thì không giữ ô nào (DB chặn, không phải kiểm rồi mới ghi)', async () => {
  const w = await world();
  const l = await planned(w);
  const target = l.matches[3];
  const startAt = stamp(target.date, `${target.start}:00`);
  // Bên kia đã chiếm ô nhưng chưa commit: bước kiểm của công bố (đọc) không thấy, nên chỉ DB mới chặn được.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, price, base_price, rules_snapshot, policy_snapshot, created_at, updated_at)
       VALUES ('RACE1', ?, ?, ?, ?, ?, 'confirmed', 'web', 1000, 1000, '', '', ?, ?)`,
      [w.a.id, w.venueId, target.courtId, startAt, stamp(target.date, `${String(Number(target.start.slice(0, 2)) + 1).padStart(2, '0')}:00:00`), stamp(TODAY, '09:00:00'), stamp(TODAY, '09:00:00')],
    );
    const [[{ id }]] = await conn.query("SELECT id FROM bookings WHERE code = 'RACE1'");
    await conn.query('INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, ?, ?)', [target.courtId, startAt, 'booking', id]);
    const pub = publish(w, l.id); // kiểm xong, đang chờ khóa ô của bên kia
    await new Promise((resolve) => setTimeout(resolve, 400));
    await conn.commit();
    const r = await pub;
    assert.equal(r.status, 409, r.text);
    assert.match(err(r), /Chưa giữ được giờ nên chưa công bố/);
  } finally {
    conn.release();
  }
  assert.equal((await blocksOf(l.id)).length, 0, 'giải thua: không giữ ô nào');
  assert.equal(await claimCount(), 1, 'chỉ ô của người đặt thường');
  assert.equal((await w.owner.a.get(L(l.id))).body.status, 'draft');
  assert.ok((await w.owner.a.get(L(l.id))).body.matches.every((x) => !x.held));
  // bên kia hoàn tác thì giải thắng và giữ đủ cả loạt
  await h.db.query("UPDATE bookings SET status = 'cancelled' WHERE code = 'RACE1'");
  await h.db.query('DELETE FROM slot_claims');
  const conn2 = await pool.getConnection();
  try {
    await conn2.beginTransaction();
    await conn2.query("INSERT INTO blocks (court_id, start_at, end_at, reason, created_by, created_at) VALUES (?, ?, ?, 'x', ?, ?)", [target.courtId, startAt, stamp(target.date, `${String(Number(target.start.slice(0, 2)) + 1).padStart(2, '0')}:00:00`), w.owner.id, stamp(TODAY, '09:00:00')]);
    const [[{ bid }]] = await conn2.query('SELECT LAST_INSERT_ID() AS bid');
    await conn2.query("INSERT INTO slot_claims (court_id, start_at, kind, block_id) VALUES (?, ?, 'block', ?)", [target.courtId, startAt, bid]);
    const pub = publish(w, l.id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await conn2.rollback();
    const r = await pub;
    assert.equal(r.status, 200, r.text);
  } finally {
    conn2.release();
  }
  assert.equal((await blocksOf(l.id)).length, 6);
  assert.equal(await claimCount(), 6);
});

test('đua: công bố và đặt thường cùng lúc qua dịch vụ, mọi kết quả đều nhất quán (một chủ mỗi ô, giải hoặc giữ đủ hoặc không giữ gì)', async () => {
  const w = await world();
  for (let round = 0; round < 4; round += 1) {
    const l = await planned(w, { name: `Giải đua ${round}` });
    const target = l.matches[round % 6];
    const res = await Promise.allSettled([
      leagueOps.publish(w.owner, l.id),
      createBooking(w.a, { courtId: target.courtId, date: target.date, start: target.start }),
    ]);
    const pubOk = res[0].status === 'fulfilled';
    const bkOk = res[1].status === 'fulfilled';
    assert.ok(!(pubOk && bkOk), 'không thể cùng thắng một ô');
    if (pubOk) assert.equal((await blocksOf(l.id)).length, 6);
    else {
      assert.equal(res[0].reason.status, 409);
      assert.equal((await blocksOf(l.id)).length, 0);
    }
    if (!bkOk) assert.equal(res[1].reason.status, 409);
    // dọn cho vòng sau
    await leagueOps.deleteLeague(w.owner, l.id);
    await h.db.query("UPDATE bookings SET status = 'cancelled'");
    await h.db.query('DELETE FROM slot_claims');
    await h.db.query('DELETE FROM waitlist');
  }
});

/* ---------- Dữ liệu mẫu ---------- */

test('dữ liệu demo: ba giải mẫu ở sân demo, trạng thái và bảng xếp hạng đúng, ô giữ cho trận chưa đá; claim khớp', async () => {
  await h.loadDemo();
  const list = (await app.agent().get('/api/leagues')).body;
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((x) => x.status), ['ongoing', 'published', 'finished']);
  const tp = list.find((x) => /Thành Phát/.test(x.name));
  assert.deepEqual([tp.status, tp.done, tp.matches, tp.teamCount, tp.venueId, tp.indexable], ['ongoing', 4, 6, 4, 1, false]);
  assert.ok(list.every((x) => x.venueId <= 6), 'chỉ sân demo, không đụng sân thật');
  const detail = (await app.agent().get(`/api/leagues/${tp.id}`)).body;
  // kết quả sửa: trận thứ 3 nhập 1-2 rồi sửa 1-3
  assert.equal(detail.standings.length, 4);
  assert.equal(detail.standings.reduce((n, s) => n + s.played, 0), 8);
  assert.ok(detail.matches.filter((m) => !m.score).every((m) => m.held && m.status === 'scheduled'));
  const owner = app.agent();
  const ownerRow = await h.db.one('SELECT email FROM users WHERE id = (SELECT owner_id FROM venues WHERE id = 1)');
  assert.equal((await owner.post('/api/auth/login', { email: ownerRow.email, password: require('../public/mock/users.json').demoPassword })).status, 200);
  const staff = (await owner.get(`/api/owner/leagues/${tp.id}`)).body;
  assert.ok(staff.matches.some((m) => m.history.some((e) => e.note === 'Nhập nhầm bàn thắng, đã xem lại biên bản')));
  assert.equal(staff.teams.find((t) => t.name === 'Hẻm 62').feePaid, true);
  assert.equal(staff.teams.find((t) => t.name === 'Gò Vấp United').feePaid, false);
  const vd = (await app.agent().get('/api/venues/1')).body;
  assert.deepEqual(vd.leagues.map((x) => x.name), [tp.name]);
  assert.deepEqual(await h.findClaimDrift(h.db), { missing: [], stale: [] });
});
