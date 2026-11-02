// LÕI TỐI THIỂU của việc đặt sân: tạo một lịch đặt và giữ ô giờ. Chống đặt trùng do DB (db/schema.sql: uq_booking_slot +
// slot_claims), ở đây chỉ chuyển lỗi trùng khóa thành 409. Đổi trạng thái về sau dùng services/bookingState.js.
// Chưa làm (việc của phần đặt sân đầy đủ): uy tín R10 khi chọn trạng thái, thông báo, duyệt/hủy/hoàn tiền, hết hạn,
// danh sách chờ (xóa lượt chờ của người đặt, báo người chờ), nhượng/ghép kèo/báo giá.
const crypto = require('crypto');
const { withTransaction, db, isDuplicate } = require('../db');
const clock = require('../clock');
const { RULES, CANCEL_POLICY_TEXT } = require('../rules');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { isDate, isHm, addDays, vnToMs, msToVn } = require('../lib/time');
const { loadCourt } = require('./venueStore');
const { slotGrid } = require('./slotGrid');
const { isHolding, claimForBooking, TAKEN } = require('./bookingState');
const { loadOccupancy, slotInfo } = require('./schedule');

const bookingCode = (id) => `SN${String(id).padStart(5, '0')}`;

/** Booking theo contract (PRD mục 7). Dựng từ hàng bookings JOIN venues/courts (xem BOOKING_SELECT). */
function toBooking(b) {
  return {
    id: b.id,
    code: b.code,
    venueId: b.venueId,
    venueName: b.venueName,
    courtId: b.courtId,
    courtName: b.courtName,
    fieldType: b.fieldType,
    startAt: b.startAt,
    endAt: b.endAt,
    status: b.status,
    expiresAt: b.expiresAt,
    price: b.price,
    basePrice: b.basePrice,
    discountPercent: b.discountPercent,
    paymentStatus: b.paymentStatus,
    refundStatus: b.refundStatus,
    refundPercent: b.refundPercent,
    refundAmount: b.refundAmount,
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt,
    acquiredByTransfer: b.transferFromBookingId != null,
    transfer: null,
    match: null,
    fromOffer: b.offerId != null,
    source: b.source,
    paidVia: b.paymentStatus === 'paid' ? b.paidVia || null : null,
  };
}

const BOOKING_SELECT = `SELECT b.*, v.name AS venue_name, c.name AS court_name, c.field_type
  FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN courts c ON c.id = b.court_id`;

const findBooking = (id, conn = db) => conn.one(`${BOOKING_SELECT} WHERE b.id = ?`, [id]);

async function createBooking(user, body = {}) {
  const courtId = Number(body.courtId);
  const { date, start } = body;
  const note = String(body.note || '').slice(0, 300);
  const key = body.idempotencyKey == null || body.idempotencyKey === '' ? null : String(body.idempotencyKey).slice(0, 64);
  if (!Number.isInteger(courtId) || courtId < 1) throw badRequest('Thiếu sân cần đặt');
  if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
  if (!isHm(start)) throw badRequest('Giờ không hợp lệ');

  // Bấm lặp cùng một yêu cầu trả đúng lịch cũ.
  if (key) {
    const dup = await db.one(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.idempotency_key = ?`, [user.id, key]);
    if (dup) return { booking: toBooking(dup), created: false };
  }

  const found = await loadCourt(courtId);
  if (!found) throw notFound('Không tìm thấy sân');
  const { venue, court } = found;
  if (!slotGrid(venue).includes(start)) throw badRequest('Giờ bắt đầu không khớp lịch của sân');
  const today = clock.today();
  if (date < today || date > addDays(today, RULES.bookingWindowDays - 1)) {
    throw badRequest(`Chỉ đặt trước tối đa ${RULES.bookingWindowDays} ngày`);
  }

  const occ = await loadOccupancy([court.id], date);
  const slot = slotInfo(venue, court, date, start, occ, user);
  if (slot.status === 'past') throw badRequest('Giờ này đã qua giờ bắt đầu');
  if (slot.status === 'blocked') throw conflict('Giờ này chủ sân đang chặn');
  if (slot.status === 'booked' || slot.status === 'held') throw conflict('Giờ này vừa có người khác đặt, bạn chọn giờ khác nhé');
  if (slot.status === 'offered' && !slot.offeredToYou) throw conflict('Giờ này đang giữ cho người đã đăng ký chờ');
  if (slot.teamMode) throw conflict('Giờ này chỉ nhận ghép kèo: hãy mở kèo hoặc vào một kèo có sẵn');

  const now = clock.now();
  const pending = venue.requiresApproval; // R3 (R10 do phần đặt sân đầy đủ bổ sung)
  const status = pending ? 'pending' : 'confirmed';
  const expiresAt = pending ? msToVn(vnToMs(now) + RULES.holdMinutes * 60000) : null;
  try {
    const id = await withTransaction(async (tx) => {
      const r = await tx.query(
        `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, expires_at,
           price, base_price, discount_percent, customer_note, rules_snapshot, policy_snapshot, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`T${crypto.randomBytes(8).toString('hex')}`, user.id, venue.id, court.id, `${date} ${start}:00`, `${date} ${slot.end}:00`,
          status, expiresAt, slot.price, slot.basePrice, slot.discountPercent, note, venue.rules, CANCEL_POLICY_TEXT, key, now, now],
      );
      await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [bookingCode(r.insertId), r.insertId]);
      if (isHolding(status)) await claimForBooking(tx, { id: r.insertId, courtId: court.id, startAt: `${date} ${start}:00` });
      await tx.query(
        "INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note, created_at) VALUES (?, 'create', NULL, ?, ?, 'customer', '', ?)",
        [r.insertId, status, user.id, now],
      );
      return r.insertId;
    });
    return { booking: toBooking(await findBooking(id)), created: true };
  } catch (err) {
    if (isDuplicate(err)) {
      // Cùng khóa gửi đồng thời: bên đến sau bị chặn tới khi bên trước commit, rồi nhận lỗi trùng (khóa idem hoặc ô
      // tùy index nào bị kiểm trước). Nếu lịch của chính khóa này đã có thì đó là bấm lặp, trả lại lịch đó.
      const dup = key && (await db.one(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.idempotency_key = ?`, [user.id, key]));
      if (dup) return { booking: toBooking(dup), created: false };
      // Ô vừa bị người khác lấy giữa lúc kiểm và lúc ghi (uq_booking_slot; trùng chặn giờ được claimForBooking đổi thành 409).
      throw conflict(TAKEN);
    }
    throw err;
  }
}

module.exports = { createBooking, toBooking, findBooking, BOOKING_SELECT, bookingCode };
