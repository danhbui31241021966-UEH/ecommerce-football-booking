// Giải phủi mẫu (R18) từ public/mock/bookings.json (league + moreLeagues), cùng nguồn với prototype. Chỉ ở sân demo (hư cấu),
// không có thông tin nào về sân thật. Trận đã đá có tỉ số và lịch sử; trận chưa đá chiếm ô trống gần nhất bằng chặn giờ (như khi công bố).
const clock = require('../clock');
const { msToVn, addDays, hmToMin } = require('../lib/time');
const { loadVenue } = require('../services/venueStore');
const { slotGrid, teamModeAt } = require('../services/slotGrid');
const { holdSlot } = require('../services/leagueOps');
const { DEFAULT_RULES, roundRobin } = require('../services/leagueRules');
const { readMock } = require('./core');

async function seedOne(tx, cfg) {
  const venue = await loadVenue(cfg.venueId, { activeOnly: false, conn: tx });
  if (!venue) return 0;
  const courts = venue.courts.filter((c) => c.fieldType === cfg.fieldType && c.isActive);
  const court = courts[0];
  if (!court) return 0;
  const owner = await tx.one('SELECT full_name FROM users WHERE id = ?', [venue.ownerId]);
  const nowMs = clock.nowMs();
  const today = clock.today();
  const publishedAt = msToVn(nowMs - cfg.publishedDaysAgo * 86400000);
  const createdAt = msToVn(nowMs - (cfg.publishedDaysAgo + 1) * 86400000);
  const lr = await tx.query(
    'INSERT INTO leagues (venue_id, name, field_type, team_count, rules, link, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [venue.id, cfg.name, cfg.fieldType, cfg.teams.length, DEFAULT_RULES, cfg.link || '', publishedAt, createdAt],
  );
  const league = { id: lr.insertId, name: cfg.name, ownerId: venue.ownerId, slotMinutes: venue.slotMinutes };
  const teamIds = [];
  for (const t of cfg.teams) {
    const r = await tx.query('INSERT INTO league_teams (league_id, name, contact_name, contact_phone, fee_paid, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [league.id, t.name, t.contact || '', t.phone || '', t.feePaid ? 1 : 0, createdAt]);
    teamIds.push(r.insertId);
  }
  const event = (matchId, at, from, to, note) =>
    tx.query("INSERT INTO league_events (match_id, kind, at, by_name, from_text, to_text, note) VALUES (?, 'score', ?, ?, ?, ?, ?)", [matchId, at, owner.fullName, from, to, note]);
  const taken = async (courtId, startAt) => !!(await tx.one('SELECT 1 AS x FROM slot_claims WHERE court_id = ? AND start_at = ?', [courtId, startAt]));

  let futureDay = 1;
  const pairs = roundRobin(teamIds);
  for (const [i, p] of pairs.entries()) {
    const res = cfg.results[i];
    let startAt = null;
    let useCourt = court;
    let score = null;
    if (res) {
      startAt = `${addDays(today, -res.daysAgo)} ${res.start}:00`;
      score = res.fix ? [res.fix[0], res.fix[1]] : [res.home, res.away];
    } else {
      // Trận còn lại: ô trống gần giờ ưu tiên nhất của ngày gần nhất còn ô (sân đúng loại, không phải giờ đủ hai đội).
      const want = hmToMin(cfg.futureStart);
      const cands = [];
      for (let d = futureDay; d <= futureDay + 20 && !cands.length; d += 1) {
        const date = addDays(today, d);
        for (const c of courts) {
          for (const s of slotGrid(venue)) {
            const at = `${date} ${s}:00`;
            if (teamModeAt(c, s) || (await taken(c.id, at))) continue;
            cands.push({ c, at, s, key: Math.abs(hmToMin(s) - want) * 10 + courts.indexOf(c) });
          }
        }
        if (cands.length) futureDay = d;
      }
      cands.sort((a, b) => a.key - b.key || a.s.localeCompare(b.s));
      if (cands[0]) {
        startAt = cands[0].at;
        useCourt = cands[0].c;
      }
    }
    const m = await tx.query(
      'INSERT INTO league_matches (league_id, round_no, home_id, away_id, court_id, start_at, home_score, away_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [league.id, p.round, p.home, p.away, null, null, score?.[0] ?? null, score?.[1] ?? null],
    );
    if (res) {
      const date = startAt.slice(0, 10);
      await event(m.insertId, `${date} 22:00:00`, null, `${res.home}-${res.away}`, '');
      if (res.fix) await event(m.insertId, `${date} 23:10:00`, `${res.home}-${res.away}`, `${res.fix[0]}-${res.fix[1]}`, res.fix[2]);
    }
    if (startAt) {
      // Giờ mẫu của trận đã đá có thể lệch lưới giờ của sân (vd. 20:00 ở sân ô 90 phút): chỉ giữ ô khi đúng lưới và còn trống.
      if (slotGrid(venue).includes(startAt.slice(11, 16)) && !(await taken(useCourt.id, startAt))) await holdSlot(tx, league, venue, { id: m.insertId }, useCourt.id, startAt);
      else await tx.query('UPDATE league_matches SET court_id = ?, start_at = ? WHERE id = ?', [useCourt.id, startAt, m.insertId]);
    }
  }
  return pairs.length;
}

async function seedLeagues(tx) {
  const spec = readMock('bookings');
  let leagues = 0;
  let matches = 0;
  for (const cfg of [spec.league, ...(spec.moreLeagues || [])]) {
    if (!cfg) continue;
    matches += await seedOne(tx, cfg);
    leagues += 1;
  }
  return { leagues, matches };
}

module.exports = { seedLeagues };
