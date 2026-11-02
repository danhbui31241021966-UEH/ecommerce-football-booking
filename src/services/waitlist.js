// R9: danh sách chờ. Người chờ không chiếm slot_claims; khi ô được nhả thì người chờ sớm nhất được giữ quyền đặt
// `waitlistOfferMinutes` phút (không quá giờ bắt đầu). Gọi trong transaction của thao tác nhả ô.
const clock = require('../clock');
const { RULES } = require('../rules');
const { vnToMs, msToVn } = require('../lib/time');
const { notify } = require('./notify');

/** Mời người chờ kế tiếp của ô (courtId, startAt 'YYYY-MM-DD HH:mm:ss') nếu ô đang trống và chưa có lời mời còn hạn. */
async function offerSlot(tx, courtId, startAt) {
  const startMs = vnToMs(startAt);
  const nowMs = clock.nowMs();
  if (startMs <= nowMs) return null;
  // Khóa các dòng chờ của ô để hai thao tác nhả ô đồng thời không mời hai người.
  const waiters = await tx.query('SELECT id, user_id, status, offer_expires_at FROM waitlist WHERE court_id = ? AND start_at = ? ORDER BY id FOR UPDATE', [courtId, startAt]);
  if (!waiters.length) return null;
  if (await tx.one('SELECT 1 AS x FROM slot_claims WHERE court_id = ? AND start_at = ?', [courtId, startAt])) return null;
  if (waiters.some((w) => w.status === 'offered' && w.offerExpiresAt && vnToMs(w.offerExpiresAt) > nowMs)) return null;
  const next = waiters.find((w) => w.status === 'waiting');
  if (!next) return null;
  const until = msToVn(Math.min(nowMs + RULES.waitlistOfferMinutes * 60000, startMs));
  await tx.query("UPDATE waitlist SET status = 'offered', offer_expires_at = ? WHERE id = ?", [until, next.id]);
  const info = await tx.one('SELECT v.id AS venue_id, v.name AS venue_name, c.name AS court_name FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ?', [courtId]);
  const date = startAt.slice(0, 10);
  const start = startAt.slice(11, 16);
  await notify(tx, next.userId, `Giờ ${start} ngày ${date.slice(8, 10)}/${date.slice(5, 7)} tại ${info.venueName} · ${info.courtName} đang giữ cho bạn đến ${until.slice(11, 16)}.`, {
    link: `/venue.html?id=${info.venueId}&date=${date}&slot=${start}&court=${courtId}`,
  });
  return next.userId;
}

module.exports = { offerSlot };
