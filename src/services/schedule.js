// Đọc trạng thái ô giờ cho API công khai (lưới giờ, giờ trống trên thẻ sân, tìm theo giờ).
// Trạng thái ô suy ra từ slot_claims (ai đang giữ ô) + danh sách chờ đang được giữ quyền; ô "past" suy từ đồng hồ.
const { db } = require('../db');
const clock = require('../clock');
const { RULES } = require('../rules');
const { vnToMs, addDays, discountedPrice } = require('../lib/time');
const { slotGrid, slotEnd, isPeak, basePriceOf, teamModeAt } = require('./slotGrid');

/** Ai đang giữ các ô trong ngày `date` của các sân con `courtIds`. Trả Map khóa `${courtId} ${HH:mm}`. */
async function loadOccupancy(courtIds, date, conn = db) {
  const occ = { claims: new Map(), waits: new Map() };
  if (!courtIds.length) return occ;
  const from = `${date} 00:00:00`;
  const to = `${addDays(date, 1)} 00:00:00`;
  const claims = await conn.query(
    `SELECT sc.court_id, sc.start_at, sc.kind, b.status AS booking_status, b.user_id AS booking_user_id,
            b.match_id, mt.status AS match_status, mt.host_paid_at AS match_host_paid_at, mt.closes_at AS match_closes_at,
            b.price AS booking_price, t.id AS transfer_id, t.ask_price AS transfer_ask_price,
            t.status AS transfer_status, bl.reason AS block_reason, bl.league_id AS block_league_id, lg.name AS block_league_name
       FROM slot_claims sc
       LEFT JOIN bookings b ON b.id = sc.booking_id
       LEFT JOIN matches mt ON mt.id = b.match_id
       LEFT JOIN transfers t ON t.booking_id = b.id AND t.status = 'open'
       LEFT JOIN blocks bl ON bl.id = sc.block_id
       LEFT JOIN leagues lg ON lg.id = bl.league_id
      WHERE sc.court_id IN (?) AND sc.start_at >= ? AND sc.start_at < ?`,
    [courtIds, from, to],
  );
  for (const c of claims) occ.claims.set(`${c.courtId} ${c.startAt.slice(11, 16)}`, c);
  const waits = await conn.query(
    `SELECT id, user_id, court_id, start_at, status, offer_expires_at FROM waitlist
      WHERE court_id IN (?) AND start_at >= ? AND start_at < ? ORDER BY id`,
    [courtIds, from, to],
  );
  for (const w of waits) {
    const key = `${w.courtId} ${w.startAt.slice(11, 16)}`;
    if (!occ.waits.has(key)) occ.waits.set(key, []);
    occ.waits.get(key).push(w);
  }
  return occ;
}

/**
 * Một ô giờ. viewer = người xem (hoặc null). Thứ tự ưu tiên trạng thái: past > blocked > booked/held > offered > available.
 * Các thuộc tính của tính năng chưa làm (transfer, league) sẽ được thêm ở đây khi bảng tương ứng có.
 */
function slotInfo(venue, court, date, start, occ, viewer, nowMs = clock.nowMs()) {
  const end = slotEnd(venue, start);
  const peak = isPeak(venue, start);
  const basePrice = basePriceOf(venue, court, start);
  const startMs = vnToMs(`${date} ${start}`);
  const slot = { start, end, basePrice, discountPercent: 0, price: basePrice, peak, status: 'available' };

  const key = `${court.id} ${start}`;
  const claim = occ.claims.get(key);
  const waits = occ.waits.get(key) || [];
  const activeOffer = waits.find((w) => w.status === 'offered' && w.offerExpiresAt && vnToMs(w.offerExpiresAt) > nowMs);

  if (startMs <= nowMs) slot.status = 'past';
  else if (claim?.kind === 'block') slot.status = 'blocked';
  else if (claim?.kind === 'booking') slot.status = claim.bookingStatus === 'confirmed' ? 'booked' : 'held';
  else if (activeOffer) slot.status = 'offered';

  if (claim?.kind === 'booking' && claim.transferId && claim.transferStatus === 'open') {
    slot.transfer = { id: claim.transferId, askPrice: claim.transferAskPrice, originalPrice: claim.bookingPrice };
  }

  if (viewer) {
    if (waits.some((w) => w.userId === viewer.id)) slot.onWaitlist = true;
    if (activeOffer && activeOffer.userId === viewer.id) {
      slot.offeredToYou = true;
      slot.offerExpiresAt = activeOffer.offerExpiresAt;
    }
    if (claim?.kind === 'booking' && claim.bookingUserId === viewer.id) slot.mine = true;
  }
  if (claim?.kind === 'block' && claim.blockLeagueId != null) slot.league = { id: claim.blockLeagueId, name: claim.blockLeagueName || '' }; // giờ giữ cho giải (R18)
  const teamMode = teamModeAt(court, start);
  if (claim?.kind === 'booking' && claim.matchId != null) {
    // Ô đang giữ cho một trận (R13): nhận đội thứ hai khi chủ sân đã xác nhận phần đội mở, còn hạn, và người xem không phải đội mở.
    const joinable = claim.matchStatus === 'open' && !!claim.matchHostPaidAt && vnToMs(claim.matchClosesAt) > nowMs && !slot.mine;
    slot.match = { id: claim.matchId, status: claim.matchStatus, joinable };
  } else if (teamMode && slot.status === 'available') slot.teamMode = true;

  // R6: giảm giờ chót; giờ ghép kèo luôn giá gốc.
  const bookable = (slot.status === 'available' || slot.offeredToYou) && !slot.teamMode;
  const hoursAhead = (startMs - nowMs) / 3600000;
  if (bookable && hoursAhead > 0 && hoursAhead <= RULES.lastMinuteHours && venue.lastMinutePercent > 0) {
    slot.discountPercent = venue.lastMinutePercent;
    slot.price = discountedPrice(basePrice, venue.lastMinutePercent);
  }
  return slot;
}

/** Lịch một ngày của cụm sân (chỉ sân con đang hoạt động). */
async function scheduleOf(venue, date, viewer, { enforceBookingWindow = false } = {}) {
  const courts = venue.courts.filter((c) => c.isActive);
  const occ = await loadOccupancy(courts.map((c) => c.id), date);
  return {
    date,
    slotMinutes: venue.slotMinutes,
    courts: courts.map((c) => ({
      id: c.id,
      name: c.name,
      fieldType: c.fieldType,
      slots: slotGrid(venue).map((s) => {
        const slot = slotInfo(venue, c, date, s, occ, viewer);
        if (enforceBookingWindow && slot.status === 'available' &&
            (date < clock.today() || date > addDays(clock.today(), RULES.bookingWindowDays - 1))) {
          slot.status = 'unavailable';
          slot.discountPercent = 0;
          slot.price = slot.basePrice;
          delete slot.teamMode;
        }
        return slot;
      }),
    })),
  };
}

module.exports = { loadOccupancy, slotInfo, scheduleOf };
