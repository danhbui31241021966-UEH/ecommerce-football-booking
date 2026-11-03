// Tạo lịch đặt (R1–R6, R9, R10) và dựng dữ liệu lịch đặt theo contract. Chống đặt trùng do DB (db/schema.sql:
// uq_booking_slot + slot_claims), ở đây chỉ chuyển lỗi trùng khóa thành 409. Đổi trạng thái về sau dùng
// services/bookingState.js (xem bookingOps.js cho hủy/duyệt/hoàn tiền/hết hạn).
// Ghép kèo (R13) nằm ở matchOps.js; ở đây chỉ dựng tóm tắt `match`. Chưa làm: nhượng (R12), báo giá (R14).
const crypto = require('crypto');
const { withTransaction, db, isDuplicate } = require('../db');
const clock = require('../clock');
const { RULES, CANCEL_POLICY_TEXT } = require('../rules');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { isDate, isHm, addDays, vnToMs, msToVn } = require('../lib/time');
const { loadCourt } = require('./venueStore');
const { slotGrid, slotEndAt } = require('./slotGrid');
const { isHolding, claimForBooking, payByFor, TAKEN } = require('./bookingState');
const { loadOccupancy, slotInfo } = require('./schedule');
const { reliabilityOf } = require('./reliability');
const { notify, addHistory, shortTs } = require('./notify');

const bookingCode = (id) => `SN${String(id).padStart(5, '0')}`;

/** Tóm tắt trận của booking ghép kèo (null nếu không phải). Chủ sân/admin thấy thêm các khoản trả lại từng đội. */
function matchBrief(b, staff) {
  if (b.matchId == null) return null;
  const out = { id: b.matchId, status: b.matchStatus, closesAt: b.matchClosesAt };
  if (staff) {
    const list = typeof b.matchRefunds === 'string' ? JSON.parse(b.matchRefunds) : b.matchRefunds || [];
    out.refunds = [...list].sort((x, y) => (x.part === y.part ? 0 : x.part === 'host' ? -1 : 1));
  }
  return out;
}

/** Booking theo contract (PRD mục 7). Dựng từ hàng bookings JOIN venues/courts (xem BOOKING_SELECT). */
function toBooking(b, { admin = false } = {}) {
  const out = {
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
    transfer: b.transferId == null ? null : {
      id: b.transferId,
      status: b.transferStatus,
      askPrice: b.transferAskPrice,
      closesAt: b.transferClosesAt,
      claimExpiresAt: b.transferStatus === 'claimed' ? b.transferClaimExpiresAt : null,
      ...(admin && b.transferToUserId ? { claimerName: b.transferClaimerName } : {}),
    },
    match: matchBrief(b, admin),
    fromOffer: b.offerId != null,
    source: b.source,
    paidVia: b.paymentStatus === 'paid' ? b.paidVia || null : null,
  };
  if (admin) {
    out.customerName = b.customerName ?? b.walkInName ?? '';
    out.customerPhone = b.customerPhone ?? b.walkInPhone ?? '';
  }
  return out;
}

const BOOKING_SELECT = `SELECT b.*, v.name AS venue_name, v.owner_id, c.name AS court_name, c.field_type,
    u.full_name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
    mt.status AS match_status, mt.closes_at AS match_closes_at,
    (SELECT JSON_ARRAYAGG(JSON_OBJECT('part', r.part, 'name', IF(r.part = 'host', hu.full_name, gu.full_name), 'amount', r.amount, 'status', r.status))
       FROM match_refunds r JOIN users hu ON hu.id = mt.host_id LEFT JOIN users gu ON gu.id = mt.guest_id WHERE r.match_id = b.match_id) AS match_refunds,
    tr.id AS transfer_id, tr.status AS transfer_status, tr.ask_price AS transfer_ask_price,
    tr.closes_at AS transfer_closes_at, tr.claim_expires_at AS transfer_claim_expires_at,
    tr.to_user_id AS transfer_to_user_id, tu.full_name AS transfer_claimer_name
  FROM bookings b
  JOIN venues v ON v.id = b.venue_id
  JOIN courts c ON c.id = b.court_id
  LEFT JOIN users u ON u.id = b.user_id
  LEFT JOIN matches mt ON mt.id = b.match_id
  LEFT JOIN transfers tr ON tr.id = (SELECT MAX(t.id) FROM transfers t WHERE t.booking_id = b.id)
  LEFT JOIN users tu ON tu.id = tr.to_user_id`;

const findBooking = (id, conn = db) => conn.one(`${BOOKING_SELECT} WHERE b.id = ?`, [id]);

/**
 * opts.offer = { id, price }: đặt theo chào giá đã chọn (R14): giá lưu = giá chào, không giảm giờ chót, ghi offer_id.
 * opts.inTx(tx, bookingId): chạy trong CÙNG transaction sau khi chèn lịch (chốt nhu cầu/chào giá cùng lúc tạo lịch).
 * Mọi kiểm tra và chống trùng ô vẫn là của luồng đặt thường.
 */
async function createBooking(user, body = {}, opts = {}) {
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
  if (slot.status === 'booked' || slot.status === 'held') {
    // Cùng khóa gửi đồng thời: bên kia có thể đã ghi xong sau lần kiểm khóa ở trên, nên ô "đã đặt" chính là lịch của khóa này.
    const dup = key && (await db.one(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.idempotency_key = ?`, [user.id, key]));
    if (dup) return { booking: toBooking(dup), created: false };
    throw conflict('Giờ này vừa có người khác đặt, bạn chọn giờ khác nhé');
  }
  if (slot.status === 'offered' && !slot.offeredToYou) throw conflict('Giờ này đang giữ cho người đã đăng ký chờ');
  if (slot.teamMode) throw conflict('Giờ này chỉ nhận ghép kèo: hãy mở kèo hoặc vào một kèo có sẵn');

  const now = clock.now();
  const rel = await reliabilityOf(db, user.id);
  const pending = venue.requiresApproval || rel.restricted; // R3, R10: khách uy tín thấp luôn phải chờ chủ sân đồng ý
  const status = pending ? 'pending' : 'confirmed';
  // expires_at là hạn của bước đang chờ: chủ sân đồng ý (pending) hoặc khách chuyển khoản (confirmed, R3).
  const expiresAt = pending
    ? msToVn(vnToMs(now) + RULES.holdMinutes * 60000)
    : payByFor({ source: 'web', startAt: `${date} ${start}:00`, hasQr: !!(venue.bank?.bin && venue.bank?.account) });
  try {
    const id = await withTransaction(async (tx) => {
      const r = await tx.query(
        `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, expires_at,
           price, base_price, discount_percent, offer_id, customer_note, rules_snapshot, policy_snapshot, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`T${crypto.randomBytes(8).toString('hex')}`, user.id, venue.id, court.id, `${date} ${start}:00`, slotEndAt(venue, date, start),
          status, expiresAt, opts.offer ? opts.offer.price : slot.price, slot.basePrice, opts.offer ? 0 : slot.discountPercent, opts.offer?.id ?? null, note, venue.rules, CANCEL_POLICY_TEXT, key, now, now],
      );
      await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [bookingCode(r.insertId), r.insertId]);
      if (isHolding(status)) await claimForBooking(tx, { id: r.insertId, courtId: court.id, startAt: `${date} ${start}:00` });
      // Người đặt được giữ quyền (hoặc đang chờ) thì lượt chờ của chính họ coi như hoàn tất.
      await tx.query('DELETE FROM waitlist WHERE user_id = ? AND court_id = ? AND start_at = ?', [user.id, court.id, `${date} ${start}:00`]);
      const code = bookingCode(r.insertId);
      await addHistory(tx, r.insertId, 'create', {
        to: status, actor: { id: user.id, role: 'customer' }, at: now,
        note: rel.restricted && !venue.requiresApproval ? 'Chờ chủ sân đồng ý do uy tín của khách' : '',
      });
      const startAt = `${date} ${start}:00`;
      if (pending) {
        await notify(tx, venue.ownerId, `${user.fullName} vừa đặt sân (mã ${code}) và đang chờ bạn đồng ý, còn ${RULES.holdMinutes} phút.`, { bookingId: r.insertId, link: `/owner-bookings.html?id=${r.insertId}` });
        await notify(tx, user.id, `Bạn đã đặt ${court.name} lúc ${shortTs(startAt)}. Chủ sân có ${RULES.holdMinutes} phút để đồng ý.`, { bookingId: r.insertId, link: `/booking.html?id=${r.insertId}` });
      } else {
        await notify(tx, user.id, `Bạn đã có sân (mã ${code}). Hãy chuyển khoản bằng mã QR${expiresAt ? ` trước ${expiresAt.slice(11, 16)}, quá giờ đơn tự hết hạn` : ''}.`, { bookingId: r.insertId, link: `/booking.html?id=${r.insertId}` });
      }
      if (opts.inTx) await opts.inTx(tx, r.insertId);
      return r.insertId;
    });
    return { booking: toBooking(await findBooking(id)), created: true };
  } catch (err) {
    // claimForBooking đổi lỗi trùng ô thành 409 ngay trong giao dịch, nên bấm lặp đồng thời có thể tới đây dưới dạng 409.
    if (isDuplicate(err) || err.status === 409) {
      // Cùng khóa gửi đồng thời: bên đến sau bị chặn tới khi bên trước commit, rồi nhận lỗi trùng (khóa idem hoặc ô
      // tùy index nào bị kiểm trước). Nếu lịch của chính khóa này đã có thì đó là bấm lặp, trả lại lịch đó.
      const dup = key && (await db.one(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.idempotency_key = ?`, [user.id, key]));
      if (dup) return { booking: toBooking(dup), created: false };
      // Ô vừa bị người khác lấy giữa lúc kiểm và lúc ghi (uq_booking_slot; trùng chặn giờ được claimForBooking đổi thành 409).
      if (err.status === 409) throw err;
      throw conflict(TAKEN);
    }
    throw err;
  }
}

module.exports = { createBooking, toBooking, findBooking, BOOKING_SELECT, bookingCode };
