// Giải phủi tại một sân (R18). Giờ đá của giải khi công bố = một "chặn giờ" (blocks) gắn league_id + dòng slot_claims của nó, nên ô đó
// có đúng một chủ ở PRIMARY KEY (court_id, start_at): khách đặt thường, lịch điện thoại, ghép kèo đều không đặt trùng được.
// Công bố là một transaction: kiểm cả loạt (đọc) để báo lỗi nào, rồi chiếm từng ô; ô nào bị người khác lấy giữa chừng thì
// ER_DUP_ENTRY → 409 và cả transaction hoàn tác, không ô nào được giữ. Mọi thao tác ghi khóa dòng leagues trước (FOR UPDATE).
// Trạng thái giải và bảng xếp hạng suy ra từ dữ liệu (leagueRules.js). Code chỉ so id, mốc giờ, tỉ số, trạng thái ô; không đọc chữ nào.
const clock = require('../clock');
const { db, withTransaction, isDuplicate } = require('../db');
const { vnToMs, msToVn, isDate, isHm, addDays } = require('../lib/time');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { loadVenue } = require('./venueStore');
const { slotGrid, slotEnd, teamModeAt } = require('./slotGrid');
const { claimBlockSlots } = require('./slotClaims');
const { offerSlot } = require('./waitlist');
const R = require('./leagueRules');

const MAX_AUTO_DAYS = 90;
const LIST_LIMIT = 200;
const ORDER = { ongoing: 0, published: 1, finished: 2 };

const LEAGUE_SELECT = `SELECT l.*, v.name AS venue_name, v.address AS venue_address, v.district AS venue_district, v.phone AS venue_phone,
    v.owner_id, v.slot_minutes, v.data_source
  FROM leagues l JOIN venues v ON v.id = l.venue_id`;

const dateOf = (ts) => ts.slice(0, 10);
const timeOf = (ts) => ts.slice(11, 16);
const dayText = (ts) => `${timeOf(ts)} ${ts.slice(8, 10)}/${ts.slice(5, 7)}`;
const endOfSlot = (l, startAt) => slotEnd({ slotMinutes: l.slotMinutes }, timeOf(startAt));
const actorName = (user) => user.fullName || '';

function idOf(raw, msg) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw notFound(msg);
  return n;
}

/* ---------- Đọc và đổi sang DTO ---------- */

async function loadParts(leagueIds, { events = false } = {}) {
  if (!leagueIds.length) return { teams: [], matches: [], events: [] };
  const teams = await db.query('SELECT * FROM league_teams WHERE league_id IN (?) ORDER BY id', [leagueIds]);
  const matches = await db.query(
    `SELECT m.*, c.name AS court_name FROM league_matches m LEFT JOIN courts c ON c.id = m.court_id WHERE m.league_id IN (?) ORDER BY m.id`,
    [leagueIds],
  );
  const evs = events && matches.length ? await db.query('SELECT * FROM league_events WHERE match_id IN (?) ORDER BY id', [matches.map((m) => m.id)]) : [];
  return { teams, matches, events: evs };
}

const statusOf = (l, matches) => R.statusOf(l, matches, clock.nowMs(), vnToMs);

function matchDto(m, l, teams, events, staff, nowMs) {
  const nameOf = (id) => teams.find((t) => t.id === id)?.name || '';
  const own = events.filter((e) => e.matchId === m.id);
  const status = m.forfeitBy ? 'forfeit' : R.isDone(m) ? 'played' : m.blockId ? 'scheduled' : m.startAt ? 'planned' : 'unscheduled';
  return {
    id: m.id,
    round: m.roundNo,
    homeId: m.homeId,
    awayId: m.awayId,
    homeName: nameOf(m.homeId),
    awayName: nameOf(m.awayId),
    status,
    courtId: m.courtId || null,
    courtName: m.courtName || null,
    date: m.startAt ? dateOf(m.startAt) : null,
    start: m.startAt ? timeOf(m.startAt) : null,
    end: m.startAt ? endOfSlot(l, m.startAt) : null,
    held: !!m.blockId,
    score: R.isDone(m) ? { home: m.homeScore, away: m.awayScore } : null,
    forfeitBy: m.forfeitBy || null,
    rescheduled: own.some((e) => e.kind === 'reschedule'),
    started: R.isStarted(m, nowMs, vnToMs),
    ...(staff ? { history: own.map((e) => ({ id: e.id, kind: e.kind, at: e.at, by: e.byName, from: e.fromText, to: e.toText, note: e.note })) } : {}),
  };
}

function leagueDto(l, parts, staff) {
  const nowMs = clock.nowMs();
  const teams = parts.teams.filter((t) => t.leagueId === l.id);
  const ms = parts.matches.filter((m) => m.leagueId === l.id);
  return {
    id: l.id,
    venueId: l.venueId,
    venueName: l.venueName,
    venueAddress: l.venueAddress,
    venueDistrict: l.venueDistrict,
    venuePhone: l.venuePhone || '',
    indexable: l.dataSource != null,
    name: l.name,
    fieldType: l.fieldType,
    teamCount: l.teamCount,
    rules: l.rules,
    link: l.link || '',
    status: statusOf(l, ms),
    publishedAt: l.publishedAt || null,
    createdAt: l.createdAt,
    teams: teams.map((t) => ({
      id: t.id, name: t.name, withdrawn: !!t.withdrawnAt,
      ...(staff ? { contactName: t.contactName, contactPhone: t.contactPhone, feePaid: !!t.feePaid } : {}),
    })),
    matches: ms.map((m) => matchDto(m, l, teams, parts.events, staff, nowMs)),
    standings: R.standingsOf(teams, ms),
    counts: { matches: ms.length, done: ms.filter(R.isDone).length, held: ms.filter((m) => m.blockId).length, planned: ms.filter((m) => m.startAt).length },
  };
}

async function present(id, staff) {
  const l = await db.one(`${LEAGUE_SELECT} WHERE l.id = ?`, [id]);
  return leagueDto(l, await loadParts([id], { events: staff }), staff);
}

/* ---------- Công khai ---------- */

async function getPublic(rawId) {
  const l = await db.one(`${LEAGUE_SELECT} WHERE l.id = ?`, [idOf(rawId, 'Không tìm thấy giải')]);
  if (!l || !l.publishedAt) throw notFound('Không tìm thấy giải');
  return leagueDto(l, await loadParts([l.id], { events: true }), false);
}

async function publicRows(where = '', params = []) {
  const rows = await db.query(`${LEAGUE_SELECT} WHERE l.published_at IS NOT NULL ${where} ORDER BY l.published_at DESC, l.id DESC LIMIT ?`, [...params, LIST_LIMIT]);
  const parts = await loadParts(rows.map((l) => l.id));
  return rows.map((l) => leagueDto(l, parts, false));
}

/** Đang đá, rồi sắp đá, rồi đã kết thúc. Giải nháp không bao giờ có mặt. */
async function listPublic(query = {}) {
  const district = String(query.district || '');
  const dtos = await publicRows(district ? 'AND v.district = ?' : '', district ? [district] : []);
  return dtos
    .map((o) => {
      const lead = o.standings[0]?.played > 0 ? o.standings[0] : null;
      const next = o.matches.filter((m) => !m.score && m.date).map((m) => `${m.date} ${m.start}`).sort()[0] || null;
      return {
        id: o.id, name: o.name, venueId: o.venueId, venueName: o.venueName, venueDistrict: o.venueDistrict, venuePhone: o.venuePhone,
        indexable: o.indexable, fieldType: o.fieldType, link: o.link, status: o.status, teamCount: o.teams.length,
        matches: o.counts.matches, done: o.counts.done, nextAt: next,
        leader: lead ? { teamId: lead.teamId, name: lead.name, points: lead.points, played: lead.played } : null,
        publishedAt: o.publishedAt,
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'finished' ? 0 : (a.nextAt || '9').localeCompare(b.nextAt || '9')) || b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id);
}

/** Giải đã công bố, chưa kết thúc, của một sân (VenueDetail.leagues). */
async function venueLeagues(venueId) {
  const dtos = await publicRows('AND l.venue_id = ?', [venueId]);
  return dtos.filter((o) => o.status !== 'finished').map((o) => ({ id: o.id, name: o.name, fieldType: o.fieldType, status: o.status }));
}

/* ---------- Chủ sân: giải của mình ---------- */

async function ownRow(user, rawId, conn = db, { lock = false } = {}) {
  const id = idOf(rawId, 'Không tìm thấy giải');
  const l = await conn.one(`${LEAGUE_SELECT} WHERE l.id = ?${lock ? ' FOR UPDATE OF l' : ''}`, [id]);
  if (!l) throw notFound('Không tìm thấy giải');
  if (l.ownerId !== user.id) throw forbidden('Giải này không thuộc sân của bạn');
  return l;
}

const draftOnly = (l, what) => {
  if (l.publishedAt) throw conflict(`Giải đã công bố, không ${what} được nữa`);
};

function cleanFields(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) {
    out.name = String(b.name || '').trim().slice(0, 80);
    if (!out.name) throw badRequest('Nhập tên giải');
  }
  if (b.rules !== undefined) {
    out.rules = String(b.rules).trim().slice(0, 3000);
    if (!out.rules) throw badRequest('Điều lệ không được để trống');
  }
  if (b.link !== undefined) {
    out.link = String(b.link || '').trim().slice(0, 300);
    if (out.link && !/^https?:\/\//i.test(out.link)) throw badRequest('Link nhóm Zalo hoặc fanpage phải bắt đầu bằng http:// hoặc https://');
  }
  return out;
}

function cleanTeam(t) {
  const name = String(t?.name || '').trim().slice(0, 40);
  if (!name) throw badRequest('Nhập tên đội');
  return { name, contactName: String(t.contactName || '').trim().slice(0, 60), contactPhone: String(t.contactPhone || '').trim().slice(0, 20) };
}

async function insertTeam(tx, leagueId, t) {
  const c = cleanTeam(t);
  try {
    const r = await tx.query('INSERT INTO league_teams (league_id, name, contact_name, contact_phone, fee_paid, created_at) VALUES (?, ?, ?, ?, 0, ?)', [leagueId, c.name, c.contactName, c.contactPhone, clock.now()]);
    return r.insertId;
  } catch (err) {
    if (isDuplicate(err, 'uq_lteam_name')) throw conflict(`Đã có đội tên "${c.name}"`);
    throw err;
  }
}

async function createLeague(user, body = {}) {
  const venueId = Number(body.venueId);
  const venue = Number.isInteger(venueId) && venueId > 0 ? await loadVenue(venueId, { activeOnly: false }) : null;
  if (!venue) throw notFound('Không tìm thấy sân');
  if (venue.ownerId !== user.id) throw forbidden('Sân này không thuộc tài khoản của bạn');
  const fieldType = String(body.fieldType || '');
  if (!['5', '7'].includes(fieldType)) throw badRequest('Chọn sân 5 hoặc 7 người');
  if (!venue.courts.some((c) => c.isActive && c.fieldType === fieldType)) throw badRequest(`Sân của bạn chưa có sân con ${fieldType} người`);
  const teamCount = Number(body.teamCount);
  if (!Number.isInteger(teamCount) || teamCount < 4 || teamCount > 8) throw badRequest('Giải có từ 4 đến 8 đội');
  const f = cleanFields({ ...body, rules: body.rules || R.DEFAULT_RULES });
  const names = Array.isArray(body.teams) ? body.teams : [];
  if (names.length > teamCount) throw badRequest(`Giải chỉ có ${teamCount} đội`);
  const id = await withTransaction(async (tx) => {
    const r = await tx.query(
      'INSERT INTO leagues (venue_id, name, field_type, team_count, rules, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [venue.id, f.name, fieldType, teamCount, f.rules, f.link || '', clock.now()],
    );
    for (const t of names) await insertTeam(tx, r.insertId, t);
    return r.insertId;
  });
  return present(id, true);
}

async function listOwn(user, query = {}) {
  const vid = query.venueId ? Number(query.venueId) : null;
  const rows = await db.query(
    `${LEAGUE_SELECT} WHERE v.owner_id = ?${vid ? ' AND l.venue_id = ?' : ''} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
    vid ? [user.id, vid, LIST_LIMIT] : [user.id, LIST_LIMIT],
  );
  const parts = await loadParts(rows.map((l) => l.id));
  return rows.map((l) => {
    const o = leagueDto(l, parts, true);
    return { id: o.id, venueId: o.venueId, name: o.name, fieldType: o.fieldType, teamCount: o.teamCount, teams: o.teams.length, status: o.status, matches: o.counts.matches, done: o.counts.done };
  });
}

async function getOwn(user, rawId) {
  const l = await ownRow(user, rawId);
  return present(l.id, true);
}

/** Chạy một thao tác ghi trên giải của mình: khóa dòng giải rồi gọi fn(tx, l); trả DTO chủ sân sau khi xong. */
async function mutate(user, rawId, fn) {
  const id = (await ownRow(user, rawId)).id;
  await withTransaction(async (tx) => {
    const l = await ownRow(user, id, tx, { lock: true });
    await fn(tx, l);
  });
  return present(id, true);
}

const matchesOf = (tx, l) => tx.query('SELECT * FROM league_matches WHERE league_id = ? ORDER BY id', [l.id]);
const teamsOf = (tx, l) => tx.query('SELECT * FROM league_teams WHERE league_id = ? ORDER BY id', [l.id]);

async function updateLeague(user, rawId, body = {}) {
  return mutate(user, rawId, async (tx, l) => {
    const f = cleanFields(body, true);
    const sets = Object.keys(f);
    if (sets.length) await tx.query(`UPDATE leagues SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...sets.map((k) => f[k]), l.id]);
    if (f.name) await tx.query('UPDATE blocks SET reason = ? WHERE league_id = ?', [`Giải: ${f.name}`, l.id]);
  });
}

/* ---------- Giữ / trả giờ ---------- */

async function holdSlot(tx, l, venue, match, courtId, startAt) {
  const endAt = msToVn(vnToMs(startAt) + l.slotMinutes * 60000);
  const r = await tx.query(
    'INSERT INTO blocks (court_id, start_at, end_at, reason, created_by, league_id, league_match_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [courtId, startAt, endAt, `Giải: ${l.name}`, l.ownerId, l.id, match.id, clock.now()],
  );
  await claimBlockSlots(tx, { blockId: r.insertId, courtId, venue, startAt, endAt });
  await tx.query('UPDATE league_matches SET court_id = ?, start_at = ?, block_id = ? WHERE id = ?', [courtId, startAt, r.insertId, match.id]);
}

/** Trả giờ của một trận: bỏ block (claim theo CASCADE) rồi mời người đang chờ ô đó (R9). Giờ vẫn ghi ở trận (giờ dự kiến). */
async function releaseSlot(tx, match) {
  if (!match.blockId) return;
  await tx.query('UPDATE league_matches SET block_id = NULL WHERE id = ?', [match.id]);
  await tx.query('DELETE FROM blocks WHERE id = ?', [match.blockId]);
  await offerSlot(tx, match.courtId, match.startAt);
}

/** Ai đang giữ ô nào trong khoảng ngày (đọc một lần cho cả loạt). */
async function loadOcc(conn, courtIds, fromDate, toDate) {
  const occ = { claims: new Map(), offered: new Set() };
  if (!courtIds.length) return occ;
  const from = `${fromDate} 00:00:00`;
  const to = `${addDays(toDate, 1)} 00:00:00`;
  const claims = await conn.query(
    `SELECT sc.court_id, sc.start_at, sc.kind, sc.block_id, b.code, bl.league_id
       FROM slot_claims sc LEFT JOIN bookings b ON b.id = sc.booking_id LEFT JOIN blocks bl ON bl.id = sc.block_id
      WHERE sc.court_id IN (?) AND sc.start_at >= ? AND sc.start_at < ?`,
    [courtIds, from, to],
  );
  for (const c of claims) occ.claims.set(`${c.courtId} ${c.startAt}`, c);
  const now = clock.now();
  const offers = await conn.query("SELECT court_id, start_at FROM waitlist WHERE court_id IN (?) AND start_at >= ? AND start_at < ? AND status = 'offered' AND offer_expires_at > ?", [courtIds, from, to, now]);
  for (const o of offers) occ.offered.add(`${o.courtId} ${o.startAt}`);
  return occ;
}

/** Lý do một ô không giữ được cho giải (null nếu giữ được). ownBlockId: ô đang giữ của chính trận này thì bỏ qua. */
function slotProblem(l, venue, occ, courtId, startAt, ownBlockId = null) {
  const court = venue.courts.find((c) => c.id === Number(courtId));
  if (!court || !court.isActive) return 'sân con không thuộc sân này';
  if (court.fieldType !== l.fieldType) return `${court.name} là sân ${court.fieldType} người, giải đá sân ${l.fieldType}`;
  if (!startAt || !isDate(dateOf(startAt)) || !slotGrid(venue).includes(timeOf(startAt))) return 'giờ không khớp lịch của sân';
  if (vnToMs(startAt) <= clock.nowMs()) return 'giờ đã qua';
  if (teamModeAt(court, timeOf(startAt))) return `${court.name} giờ này chỉ nhận ghép kèo`;
  const key = `${court.id} ${startAt}`;
  const claim = occ.claims.get(key);
  if (claim?.kind === 'booking') return `${court.name} đã có lịch đặt ${claim.code}`;
  if (claim && claim.blockId !== ownBlockId) return `${court.name} đang bị chặn${claim.leagueId ? ' cho giải khác' : ''}`;
  if (occ.offered.has(key)) return `${court.name} đang giữ cho người chờ giờ này`;
  return null;
}

const problemText = (ps) => `${ps.slice(0, 3).join('; ')}${ps.length > 3 ? `; và ${ps.length - 3} lỗi nữa` : ''}`;

/** Kiểm cả loạt: ô tự trùng nhau, đội đá hai trận cùng giờ, ô đã có lịch/chặn/giữ cho người chờ. */
function planProblems(l, venue, occ, matches, teams) {
  const nameOf = (id) => teams.find((t) => t.id === id)?.name;
  const label = (m) => `${nameOf(m.homeId)} – ${nameOf(m.awayId)}`;
  const problems = [];
  const seen = new Map();
  const teamAt = new Map();
  for (const m of matches) {
    const head = `Trận ${label(m)}`;
    if (!m.startAt) { problems.push(`${head}: chưa chọn giờ`); continue; }
    const why = slotProblem(l, venue, occ, m.courtId, m.startAt, m.blockId);
    if (why) problems.push(`${head} (${dayText(m.startAt)}): ${why}`);
    const key = `${m.courtId} ${m.startAt}`;
    if (seen.has(key)) problems.push(`${head} (${dayText(m.startAt)}): trùng giờ với trận ${label(seen.get(key))}`);
    else seen.set(key, m);
    for (const tid of [m.homeId, m.awayId]) {
      const tk = `${tid} ${m.startAt}`;
      if (teamAt.has(tk) && teamAt.get(tk) !== m) problems.push(`${head} (${dayText(m.startAt)}): một đội phải đá hai trận cùng giờ`);
      teamAt.set(tk, m);
    }
  }
  return problems;
}

/* ---------- Đội ---------- */

async function addTeam(user, rawId, body) {
  return mutate(user, rawId, async (tx, l) => {
    draftOnly(l, 'thêm đội');
    if ((await matchesOf(tx, l)).length) throw conflict('Đã tạo các trận, không thêm đội được. Làm lại các trận nếu cần đổi đội');
    if ((await teamsOf(tx, l)).length >= l.teamCount) throw badRequest(`Giải đã đủ ${l.teamCount} đội`);
    await insertTeam(tx, l.id, body);
  });
}

async function updateTeam(user, rawId, rawTid, body = {}) {
  return mutate(user, rawId, async (tx, l) => {
    const t = await tx.one('SELECT * FROM league_teams WHERE id = ? AND league_id = ?', [idOf(rawTid, 'Không tìm thấy đội'), l.id]);
    if (!t) throw notFound('Không tìm thấy đội');
    if (body.feePaid !== undefined) await tx.query('UPDATE league_teams SET fee_paid = ? WHERE id = ?', [body.feePaid ? 1 : 0, t.id]);
    if (body.name !== undefined || body.contactName !== undefined || body.contactPhone !== undefined) {
      const c = cleanTeam({ name: body.name ?? t.name, contactName: body.contactName ?? t.contactName, contactPhone: body.contactPhone ?? t.contactPhone });
      try {
        await tx.query('UPDATE league_teams SET name = ?, contact_name = ?, contact_phone = ? WHERE id = ?', [c.name, c.contactName, c.contactPhone, t.id]);
      } catch (err) {
        if (isDuplicate(err, 'uq_lteam_name')) throw conflict(`Đã có đội tên "${c.name}"`);
        throw err;
      }
    }
  });
}

async function deleteTeam(user, rawId, rawTid) {
  return mutate(user, rawId, async (tx, l) => {
    draftOnly(l, 'xóa đội');
    if ((await matchesOf(tx, l)).length) throw conflict('Đã tạo các trận, không xóa đội được. Làm lại các trận nếu cần đổi đội');
    const t = await tx.one('SELECT id FROM league_teams WHERE id = ? AND league_id = ?', [idOf(rawTid, 'Không tìm thấy đội'), l.id]);
    if (!t) throw notFound('Không tìm thấy đội');
    await tx.query('DELETE FROM league_teams WHERE id = ?', [t.id]);
  });
}

async function withdrawTeam(user, rawId, rawTid, body = {}) {
  return mutate(user, rawId, async (tx, l) => {
    const t = await tx.one('SELECT * FROM league_teams WHERE id = ? AND league_id = ?', [idOf(rawTid, 'Không tìm thấy đội'), l.id]);
    if (!t) throw notFound('Không tìm thấy đội');
    if (!l.publishedAt) throw badRequest('Giải chưa công bố: xóa đội thay vì cho rút');
    if (t.withdrawnAt) throw conflict('Đội này đã rút');
    const note = String(body.note || '').trim().slice(0, 300);
    const now = clock.now();
    await tx.query('UPDATE league_teams SET withdrawn_at = ? WHERE id = ?', [now, t.id]);
    for (const m of await matchesOf(tx, l)) {
      if (R.isDone(m) || m.forfeitBy || (m.homeId !== t.id && m.awayId !== t.id)) continue;
      await releaseSlot(tx, m);
      const home = m.homeId === t.id ? 0 : R.FORFEIT_GOALS;
      const away = m.homeId === t.id ? R.FORFEIT_GOALS : 0;
      await tx.query('UPDATE league_matches SET forfeit_by = ?, home_score = ?, away_score = ? WHERE id = ?', [t.id, home, away, m.id]);
      await tx.query("INSERT INTO league_events (match_id, kind, at, by_name, from_text, to_text, note) VALUES (?, 'forfeit', ?, ?, NULL, ?, ?)",
        [m.id, now, actorName(user), `${home}-${away}`, `${t.name} rút khỏi giải, xử thua 0-3${note ? `. ${note}` : ''}`.slice(0, 500)]);
    }
  });
}

/* ---------- Các trận và xếp giờ (bước nháp) ---------- */

async function makeFixtures(user, rawId) {
  return mutate(user, rawId, async (tx, l) => {
    draftOnly(l, 'tạo lại trận');
    const teams = await teamsOf(tx, l);
    if (teams.length !== l.teamCount) throw badRequest(`Cần đủ ${l.teamCount} đội trước khi tạo các trận (đang có ${teams.length})`);
    await tx.query('DELETE FROM league_events WHERE match_id IN (SELECT id FROM league_matches WHERE league_id = ?)', [l.id]);
    await tx.query('DELETE FROM league_matches WHERE league_id = ?', [l.id]);
    for (const p of R.roundRobin(teams.map((t) => t.id))) {
      await tx.query('INSERT INTO league_matches (league_id, round_no, home_id, away_id) VALUES (?, ?, ?, ?)', [l.id, p.round, p.home, p.away]);
    }
  });
}

async function savePlan(user, rawId, body = {}) {
  return mutate(user, rawId, async (tx, l) => {
    draftOnly(l, 'xếp lại giờ ở bước nháp');
    const ms = await matchesOf(tx, l);
    if (!ms.length) throw badRequest('Hãy tạo các trận trước');
    if (!Array.isArray(body.slots)) throw badRequest('Thiếu danh sách giờ');
    for (const s of body.slots) {
      const m = ms.find((x) => x.id === Number(s?.matchId));
      if (!m) throw notFound('Không tìm thấy trận');
      if (!s.courtId && !s.date && !s.start) {
        await tx.query('UPDATE league_matches SET court_id = NULL, start_at = NULL WHERE id = ?', [m.id]);
        continue;
      }
      const court = await tx.one('SELECT id FROM courts WHERE id = ?', [Number(s.courtId)]);
      if (!court) throw badRequest('Chọn sân con');
      if (!isDate(s.date) || !isHm(s.start)) throw badRequest('Chọn ngày và giờ');
      await tx.query('UPDATE league_matches SET court_id = ?, start_at = ? WHERE id = ?', [court.id, `${s.date} ${s.start}:00`, m.id]);
    }
  });
}

/** Xếp tự động: lần lượt các trận chưa có giờ vào ô trống kế tiếp của một sân con, tối đa perDay trận mỗi ngày, từ giờ start trở đi. */
async function autoPlan(user, rawId, body = {}) {
  return mutate(user, rawId, async (tx, l) => {
    draftOnly(l, 'xếp lại giờ ở bước nháp');
    const venue = await loadVenue(l.venueId, { activeOnly: false, conn: tx });
    const court = venue.courts.find((c) => c.id === Number(body.courtId));
    if (!court) throw badRequest('Chọn sân con');
    if (!isDate(body.date)) throw badRequest('Chọn ngày bắt đầu');
    const perDay = Number(body.perDay);
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 8) throw badRequest('Số trận mỗi ngày từ 1 đến 8');
    const ms = await matchesOf(tx, l);
    if (!ms.length) throw badRequest('Hãy tạo các trận trước');
    const from = body.start == null || body.start === '' ? '00:00' : body.start;
    if (!isHm(from)) throw badRequest('Giờ bắt đầu không hợp lệ');
    const grid = slotGrid(venue).filter((s) => s >= from);
    if (!grid.length) throw badRequest('Không có giờ nào từ giờ đó trở đi');
    const occ = await loadOcc(tx, [court.id], body.date, addDays(body.date, MAX_AUTO_DAYS));
    const todo = ms.filter((m) => !m.startAt);
    const used = new Set(ms.filter((m) => m.startAt).map((m) => `${m.courtId} ${m.startAt}`));
    let d = body.date;
    for (let day = 0; todo.length && day < MAX_AUTO_DAYS; day += 1, d = addDays(d, 1)) {
      let n = 0;
      for (const s of grid) {
        if (!todo.length || n >= perDay) break;
        const startAt = `${d} ${s}:00`;
        if (used.has(`${court.id} ${startAt}`) || slotProblem(l, venue, occ, court.id, startAt)) continue;
        const m = todo.shift();
        m.courtId = court.id;
        m.startAt = startAt;
        used.add(`${court.id} ${startAt}`);
        n += 1;
      }
    }
    if (todo.length) throw conflict('Không đủ giờ trống trong 90 ngày để xếp hết các trận');
    for (const m of ms.filter((x) => x.startAt && !x.blockId)) await tx.query('UPDATE league_matches SET court_id = ?, start_at = ? WHERE id = ?', [m.courtId, m.startAt, m.id]);
  });
}

/* ---------- Công bố, hoãn, tỉ số, xóa ---------- */

async function publish(user, rawId) {
  return mutate(user, rawId, async (tx, l) => {
    draftOnly(l, 'công bố lại');
    const ms = await matchesOf(tx, l);
    if (!ms.length) throw badRequest('Hãy tạo các trận trước');
    const teams = await teamsOf(tx, l);
    const venue = await loadVenue(l.venueId, { activeOnly: false, conn: tx });
    const dates = ms.filter((m) => m.startAt).map((m) => dateOf(m.startAt)).sort();
    const occ = await loadOcc(tx, venue.courts.map((c) => c.id), dates[0] || clock.today(), dates.at(-1) || clock.today());
    const problems = planProblems(l, venue, occ, ms, teams);
    if (problems.length) throw conflict(`Chưa giữ được giờ nên chưa công bố: ${problemText(problems)}`);
    for (const m of ms) {
      try {
        await holdSlot(tx, l, venue, m, m.courtId, m.startAt);
      } catch (err) {
        // Ô vừa bị người khác lấy giữa lúc kiểm và lúc giữ (PRIMARY KEY slot_claims): hoàn tác cả loạt.
        if (err.status === 409) {
          const name = (id) => teams.find((t) => t.id === id)?.name;
          throw conflict(`Chưa giữ được giờ nên chưa công bố: Trận ${name(m.homeId)} – ${name(m.awayId)} (${dayText(m.startAt)}): ô này vừa có người khác lấy`);
        }
        throw err;
      }
    }
    await tx.query('UPDATE leagues SET published_at = ? WHERE id = ?', [clock.now(), l.id]);
  });
}

async function reschedule(user, rawId, rawMid, body = {}) {
  return mutate(user, rawId, async (tx, l) => {
    const m = await tx.one('SELECT * FROM league_matches WHERE id = ? AND league_id = ? FOR UPDATE', [idOf(rawMid, 'Không tìm thấy trận'), l.id]);
    if (!m) throw notFound('Không tìm thấy trận');
    if (!l.publishedAt) throw badRequest('Giải chưa công bố: đổi giờ ở bước xếp lịch');
    if (R.isDone(m) || m.forfeitBy) throw conflict('Trận này đã có kết quả, không hoãn được');
    const courtId = Number(body.courtId);
    const note = String(body.note || '').trim().slice(0, 300);
    const startAt = isDate(body.date) && isHm(body.start) ? `${body.date} ${body.start}:00` : null;
    const venue = await loadVenue(l.venueId, { activeOnly: false, conn: tx });
    const why = startAt
      ? slotProblem(l, venue, await loadOcc(tx, venue.courts.map((c) => c.id), body.date, body.date), courtId, startAt, m.blockId)
      : 'giờ không khớp lịch của sân';
    if (why) throw conflict(`Giờ mới không giữ được: ${why}`);
    if (m.courtId === courtId && m.startAt === startAt) throw conflict('Giờ mới trùng giờ cũ');
    const others = (await matchesOf(tx, l)).filter((x) => x.id !== m.id && x.startAt === startAt && !x.forfeitBy && [m.homeId, m.awayId].some((t) => [x.homeId, x.awayId].includes(t)));
    if (others.length) throw conflict('Một trong hai đội đã có trận khác cùng giờ đó');
    const courtName = (id) => venue.courts.find((c) => c.id === id)?.name;
    const from = `${courtName(m.courtId)} ${dayText(m.startAt)}`;
    const old = { ...m };
    await tx.query('UPDATE league_matches SET block_id = NULL WHERE id = ?', [m.id]);
    await tx.query('DELETE FROM blocks WHERE id = ?', [old.blockId]);
    await holdSlot(tx, l, venue, m, courtId, startAt); // ô mới bị lấy giữa chừng thì 409 và hoàn tác cả hoãn
    await offerSlot(tx, old.courtId, old.startAt);
    await tx.query("INSERT INTO league_events (match_id, kind, at, by_name, from_text, to_text, note) VALUES (?, 'reschedule', ?, ?, ?, ?, ?)",
      [m.id, clock.now(), actorName(user), from, `${courtName(courtId)} ${dayText(startAt)}`, note]);
  });
}

async function score(user, rawId, rawMid, body = {}) {
  return mutate(user, rawId, async (tx, l) => {
    const m = await tx.one('SELECT * FROM league_matches WHERE id = ? AND league_id = ? FOR UPDATE', [idOf(rawMid, 'Không tìm thấy trận'), l.id]);
    if (!m) throw notFound('Không tìm thấy trận');
    if (!l.publishedAt) throw badRequest('Giải chưa công bố');
    if (m.forfeitBy) throw conflict('Trận này đã xử thua do đội rút');
    if (!R.isStarted(m, clock.nowMs(), vnToMs)) throw conflict('Trận chưa đến giờ đá nên chưa nhập tỉ số được');
    const home = Number(body.home);
    const away = Number(body.away);
    const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 99;
    if (!ok(home) || !ok(away)) throw badRequest('Tỉ số mỗi đội là số nguyên từ 0 đến 99');
    const note = String(body.note || '').trim().slice(0, 300);
    if (R.isDone(m)) {
      if (!note) throw badRequest('Sửa tỉ số phải ghi lý do');
      if (m.homeScore === home && m.awayScore === away) throw conflict('Tỉ số mới giống tỉ số cũ');
    }
    await tx.query('UPDATE league_matches SET home_score = ?, away_score = ? WHERE id = ?', [home, away, m.id]);
    await tx.query("INSERT INTO league_events (match_id, kind, at, by_name, from_text, to_text, note) VALUES (?, 'score', ?, ?, ?, ?, ?)",
      [m.id, clock.now(), actorName(user), R.isDone(m) ? `${m.homeScore}-${m.awayScore}` : null, `${home}-${away}`, note]);
  });
}

async function deleteLeague(user, rawId) {
  const id = (await ownRow(user, rawId)).id;
  await withTransaction(async (tx) => {
    const l = await ownRow(user, id, tx, { lock: true });
    const ms = await matchesOf(tx, l);
    for (const m of ms) await releaseSlot(tx, m);
    await tx.query('DELETE FROM league_events WHERE match_id IN (SELECT id FROM league_matches WHERE league_id = ?)', [l.id]);
    await tx.query('DELETE FROM league_matches WHERE league_id = ?', [l.id]);
    await tx.query('DELETE FROM league_teams WHERE league_id = ?', [l.id]);
    await tx.query('DELETE FROM leagues WHERE id = ?', [l.id]);
  });
  return { ok: true };
}

module.exports = {
  getPublic, listPublic, venueLeagues, listOwn, getOwn, createLeague, updateLeague, deleteLeague,
  addTeam, updateTeam, deleteTeam, withdrawTeam, makeFixtures, savePlan, autoPlan, publish, reschedule, score,
  holdSlot,
};
