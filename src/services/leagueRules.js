// Luật thuần của giải phủi (R18): xoay vòng, trạng thái suy ra, bảng xếp hạng, điều lệ mặc định. Không đụng DB, không đọc chữ.
const WIN = 3;
const DRAW = 1;
const FORFEIT_GOALS = 3; // đội rút thua 0-3

const DEFAULT_RULES = [
  '1. Đá vòng tròn một lượt: mỗi đội gặp mọi đội còn lại đúng một trận.',
  '2. Thắng 3 điểm, hòa 1 điểm, thua 0 điểm.',
  '3. Xếp hạng theo điểm, rồi hiệu số (bàn thắng trừ bàn thua), rồi tổng bàn thắng. Nếu vẫn bằng nhau thì xếp theo tên đội A–Z.',
  '4. Tỉ số do chủ sân nhập. Sửa tỉ số phải ghi lý do và được lưu lại.',
  '5. Đội rút giữa giải: kết quả đã đá giữ nguyên, các trận còn lại của đội đó bị xử thua 0-3, giờ sân các trận này được trả lại. Bảng xếp hạng ghi "Đã rút".',
  '6. Hoãn trận do chủ sân đổi giờ; mọi đội xem giờ mới trên trang giải.',
  '7. Lệ phí do chủ sân thu ngoài web (tiền mặt hoặc chuyển khoản riêng), web chỉ ghi đội đã nộp hay chưa.',
].join('\n');

/** Vòng tròn một lượt (xoay vòng). Số đội lẻ thì mỗi vòng một đội nghỉ. */
function roundRobin(ids) {
  const list = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length;
  const out = [];
  for (let r = 0; r < n - 1; r += 1) {
    for (let i = 0; i < n / 2; i += 1) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a == null || b == null) continue;
      out.push(r % 2 && i === 0 ? { round: r + 1, home: b, away: a } : { round: r + 1, home: a, away: b });
    }
    list.splice(1, 0, list.pop());
  }
  return out;
}

const isDone = (m) => m.homeScore != null;

/** m.startAt đã tới/qua `nowMs`: trận đã đến giờ đá. */
const isStarted = (m, nowMs, vnToMs) => !!m.startAt && vnToMs(m.startAt) <= nowMs;

/** draft → published → ongoing → finished (suy ra). */
function statusOf(league, matches, nowMs, vnToMs) {
  if (!league.publishedAt) return 'draft';
  if (matches.length && matches.every(isDone)) return 'finished';
  if (matches.some(isDone) || matches.some((m) => m.blockId && isStarted(m, nowMs, vnToMs))) return 'ongoing';
  return 'published';
}

/** Điểm, rồi hiệu số, rồi bàn thắng, rồi tên A–Z. Trận xử thua tính 0-3 như tỉ số thật. */
function standingsOf(teams, matches) {
  const rows = new Map(teams.map((t) => [t.id, { teamId: t.id, name: t.name, withdrawn: !!t.withdrawnAt, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
  for (const m of matches) {
    if (!isDone(m)) continue;
    for (const [r, f, g] of [[rows.get(m.homeId), m.homeScore, m.awayScore], [rows.get(m.awayId), m.awayScore, m.homeScore]]) {
      r.played += 1;
      r.gf += f;
      r.ga += g;
      if (f > g) { r.won += 1; r.points += WIN; } else if (f === g) { r.drawn += 1; r.points += DRAW; } else r.lost += 1;
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.gd = r.gf - r.ga;
  out.sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name, 'vi'));
  return out.map((r, i) => ({ rank: i + 1, ...r }));
}

module.exports = { WIN, DRAW, FORFEIT_GOALS, DEFAULT_RULES, roundRobin, isDone, isStarted, statusOf, standingsOf };
