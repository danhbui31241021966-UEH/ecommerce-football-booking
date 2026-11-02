// R10: uy tín của khách = số lần bùng sân + hủy sát giờ trong cửa sổ gần đây (tính theo giờ đá của lịch).
const clock = require('../clock');
const { RULES } = require('../rules');
const { msToVn } = require('../lib/time');

async function reliabilityOf(conn, userId) {
  const base = { windowDays: RULES.reliabilityWindowDays, maxViolations: RULES.reliabilityMaxViolations };
  if (userId == null) return { noShows: 0, lateCancels: 0, completed: 0, violations: 0, ...base, restricted: false };
  const from = msToVn(clock.nowMs() - RULES.reliabilityWindowDays * 86400000);
  const r = await conn.one(
    `SELECT COALESCE(SUM(status = 'no_show'), 0) AS no_shows,
            COALESCE(SUM(status = 'cancelled' AND late_cancel = 1), 0) AS late_cancels,
            COALESCE(SUM(status = 'completed'), 0) AS completed
       FROM bookings WHERE user_id = ? AND start_at >= ?`,
    [userId, from],
  );
  const noShows = Number(r.noShows);
  const lateCancels = Number(r.lateCancels);
  const violations = noShows + lateCancels;
  return { noShows, lateCancels, completed: Number(r.completed), violations, ...base, restricted: violations >= RULES.reliabilityMaxViolations };
}

module.exports = { reliabilityOf };
