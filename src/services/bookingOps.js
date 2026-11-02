// Thao tác trạng thái trên lịch đặt: hủy (R7, R10), duyệt/từ chối (R3), ghi nhận thanh toán, hoàn tiền, điểm danh,
// và hết hạn theo thời gian (R3 giữ chỗ 15 phút, R9 lượt giữ quyền đặt của người chờ).
// Mọi đổi status đi qua bookingState.setStatus; mỗi thao tác là một transaction, khóa dòng lịch trước khi kiểm trạng thái
// nên hai thao tác đồng thời trên một lịch (ví dụ chủ sân duyệt đúng lúc hết hạn) tuần tự hóa và bên sau nhận 409.
const clock = require('../clock');
const { db, withTransaction } = require('../db');
const { vnToMs } = require('../lib/time');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { setStatus } = require('./bookingState');
const { notify, addHistory, money } = require('./notify');
const { offerSlot } = require('./waitlist');
const { reliabilityOf } = require('./reliability');
const { findBooking, toBooking } = require('./bookingCore');

const actorOf = (user) => ({ id: user.id, role: user.role });
const link = (id) => `/booking.html?id=${id}`;

/** Quyền thao tác trên một lịch: admin mọi lịch; chủ sân lịch của cụm sân mình (403); khách lịch của mình (404 nếu không phải). */
async function assertAccess(user, id) {
  const b = await db.one('SELECT b.id, b.user_id, v.owner_id FROM bookings b JOIN venues v ON v.id = b.venue_id WHERE b.id = ?', [id]);
  if (!b) throw notFound('Không tìm thấy lịch đặt');
  if (user.role === 'admin') return;
  if (user.role === 'owner') {
    if (b.ownerId !== user.id) throw forbidden('Lịch đặt này không thuộc sân của bạn');
    return;
  }
  if (b.userId !== user.id) throw notFound('Không tìm thấy lịch đặt');
}

async function lock(tx, id) {
  const b = await tx.one('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [id]);
  if (!b) throw notFound('Không tìm thấy lịch đặt');
  return b;
}
async function context(tx, b) {
  const row = await tx.one(
    `SELECT v.name AS venue_name, v.owner_id, c.name AS court_name FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ?`,
    [b.courtId],
  );
  const customer = b.userId == null ? null : await tx.one('SELECT full_name FROM users WHERE id = ?', [b.userId]);
  return { ...row, customerName: customer?.fullName ?? b.walkInName ?? '' };
}

/** R7 theo giờ còn lại: khách hủy >= 24h hoàn 100%, 12–24h hoàn 50%, < 12h không hoàn; chủ sân/admin hủy luôn hoàn 100%. */
function refundTier(startAt, now, by) {
  const hoursLeft = (vnToMs(startAt) - vnToMs(now)) / 3600000;
  const percent = by !== 'customer' ? 100 : hoursLeft >= 24 ? 100 : hoursLeft >= 12 ? 50 : 0;
  return { percent, hoursLeft };
}

/** Hủy: dùng chung cho khách (by='customer'), chủ sân ('owner') và admin ('admin'). */
async function cancelBooking(user, id, reason, by) {
  await assertAccess(user, id);
  await withTransaction(async (tx) => {
    const b = await lock(tx, id);
    if (!['pending', 'confirmed'].includes(b.status)) throw conflict('Lịch đặt này không hủy được nữa');
    const now = clock.now();
    const paid = b.paymentStatus === 'paid';
    const walkIn = b.source === 'phone'; // tiền của khách gọi điện xử lý ngoài web
    const { percent, hoursLeft } = refundTier(b.startAt, now, by);
    const refundPercent = walkIn ? 0 : percent;
    const refundAmount = walkIn || !paid ? 0 : Math.round((b.price * percent) / 100);
    const why = typeof reason === 'string' ? reason.slice(0, 255) || null : null;
    await setStatus(tx, id, 'cancelled', {
      cancelled_by: by, cancel_reason: why, cancelled_at: now, expires_at: null,
      refund_percent: refundPercent, refund_amount: refundAmount, refund_status: refundAmount > 0 ? 'pending' : 'none',
      late_cancel: !walkIn && by === 'customer' && b.status === 'confirmed' && hoursLeft < 12 ? 1 : 0,
    });
    await addHistory(tx, id, 'cancel', { from: b.status, to: 'cancelled', actor: actorOf(user), note: why || '' });
    const ctx = await context(tx, b);
    if (by === 'customer') {
      await notify(tx, ctx.ownerId, `Khách ${ctx.customerName} đã hủy lịch đặt ${b.code}.${refundAmount ? ` Bạn cần chuyển lại ${money(refundAmount)} cho khách.` : ''}`, { bookingId: id, link: `/owner-bookings.html?id=${id}` });
    } else {
      await notify(tx, b.userId, `Lịch đặt ${b.code} đã bị ${by === 'owner' ? 'chủ sân' : 'quản trị viên'} hủy${why ? `: ${why}` : '.'}${refundAmount ? ` Bạn sẽ được trả lại ${money(refundAmount)}.` : ''}`, { bookingId: id, link: link(id) });
    }
    await offerSlot(tx, b.courtId, b.startAt);
  });
}

async function approveBooking(user, id) {
  await assertAccess(user, id);
  await withTransaction(async (tx) => {
    const b = await lock(tx, id);
    if (b.status !== 'pending') throw conflict('Chỉ đồng ý được lịch đặt đang chờ chủ sân đồng ý');
    if (b.expiresAt && vnToMs(b.expiresAt) <= clock.nowMs()) throw conflict('Lịch đặt đã quá hạn giữ chỗ');
    await setStatus(tx, id, 'confirmed', { expires_at: null });
    await addHistory(tx, id, 'approve', { from: 'pending', to: 'confirmed', actor: actorOf(user) });
    await notify(tx, b.userId, `Chủ sân đã đồng ý lịch đặt ${b.code}. Hãy chuyển khoản bằng mã QR.`, { bookingId: id, link: link(id) });
  });
}

async function rejectBooking(user, id, reason) {
  await assertAccess(user, id);
  const why = String(reason ?? '').trim();
  if (!why) throw badRequest('Vui lòng nhập lý do từ chối');
  await withTransaction(async (tx) => {
    const b = await lock(tx, id);
    if (b.status !== 'pending') throw conflict('Chỉ từ chối được lịch đặt đang chờ chủ sân đồng ý');
    const text = why.slice(0, 255);
    await setStatus(tx, id, 'rejected', { expires_at: null, cancel_reason: text });
    await addHistory(tx, id, 'reject', { from: 'pending', to: 'rejected', actor: actorOf(user), note: text });
    await notify(tx, b.userId, `Chủ sân từ chối lịch đặt ${b.code}: ${text}`, { bookingId: id, link: link(id) });
    await offerSlot(tx, b.courtId, b.startAt);
  });
}

async function markPaid(user, id, note) {
  await assertAccess(user, id);
  await withTransaction(async (tx) => {
    const b = await lock(tx, id);
    if (b.status !== 'confirmed' && b.status !== 'completed') throw conflict('Chỉ ghi nhận được cho lịch đặt đã có sân');
    if (b.paymentStatus === 'paid') throw conflict('Lịch đặt đã được ghi nhận chuyển khoản');
    const now = clock.now();
    await tx.query("UPDATE bookings SET payment_status = 'paid', paid_at = ?, paid_via = 'owner', updated_at = ? WHERE id = ?", [now, now, id]);
    await addHistory(tx, id, 'paid', { actor: actorOf(user), note: typeof note === 'string' ? note : '' });
    await notify(tx, b.userId, `Chủ sân đã nhận tiền của lịch đặt ${b.code}.`, { bookingId: id, link: link(id) });
  });
}

async function markRefunded(user, id, note) {
  await assertAccess(user, id);
  await withTransaction(async (tx) => {
    const b = await lock(tx, id);
    if (b.refundStatus !== 'pending') throw conflict('Lịch đặt này không có khoản cần chuyển lại');
    const now = clock.now();
    const text = typeof note === 'string' ? note.slice(0, 255) : '';
    await tx.query("UPDATE bookings SET refund_status = 'done', refunded_at = ?, refund_note = ?, updated_at = ? WHERE id = ?", [now, text || null, now, id]);
    await addHistory(tx, id, 'refund', { actor: actorOf(user), note: text });
    await notify(tx, b.userId, `Chủ sân đã chuyển lại ${money(b.refundAmount)} cho lịch đặt ${b.code}.`, { bookingId: id, link: link(id) });
  });
}

async function markAttendance(user, id, result) {
  if (!['completed', 'no_show'].includes(result)) throw badRequest('Kết quả phải là completed hoặc no_show');
  await assertAccess(user, id);
  await withTransaction(async (tx) => {
    const b = await lock(tx, id);
    if (b.status !== 'confirmed') throw conflict('Chỉ ghi nhận được cho lịch đặt đã có sân');
    if (vnToMs(b.startAt) > clock.nowMs()) throw badRequest('Chưa tới giờ đá nên chưa đánh dấu được');
    await setStatus(tx, id, result);
    await addHistory(tx, id, 'attendance', { from: 'confirmed', to: result, actor: actorOf(user), note: result === 'no_show' ? 'Không đến sân' : '' });
    if (result === 'no_show') {
      const r = await reliabilityOf(tx, b.userId);
      await notify(tx, b.userId, `Bạn bị ghi nhận bùng sân ở lịch đặt ${b.code}. ${r.restricted ? 'Các lần đặt sau của bạn sẽ phải chờ chủ sân đồng ý.' : `Bạn đã vi phạm ${r.violations}/${r.maxViolations} lần trong ${r.windowDays} ngày.`}`, { bookingId: id, link: link(id) });
    }
  });
}

/* ---------- Hết hạn theo thời gian ---------- */

/** R3: lịch chờ duyệt quá hạn giữ chỗ thì hết hạn, nhả ô, mời người chờ. Bỏ qua nếu lịch đã đổi trạng thái. */
async function expireBooking(id) {
  await withTransaction(async (tx) => {
    const b = await lock(tx, id);
    if (b.status !== 'pending' || !b.expiresAt || vnToMs(b.expiresAt) > clock.nowMs()) return;
    await setStatus(tx, id, 'expired');
    await addHistory(tx, id, 'expire', { from: 'pending', to: 'expired', note: 'Quá hạn giữ chỗ chưa được đồng ý', at: b.expiresAt });
    await notify(tx, b.userId, `Lịch đặt ${b.code} đã quá hạn vì chủ sân chưa kịp đồng ý.`, { bookingId: id, link: link(id) });
    await offerSlot(tx, b.courtId, b.startAt);
  });
}

/** R9: lượt giữ quyền đặt hết hạn thì bỏ lượt chờ đó, báo người chờ và mời người kế tiếp. */
async function expireOffer(id) {
  await withTransaction(async (tx) => {
    const w = await tx.one('SELECT * FROM waitlist WHERE id = ? FOR UPDATE', [id]);
    if (!w || w.status !== 'offered' || !w.offerExpiresAt || vnToMs(w.offerExpiresAt) > clock.nowMs()) return;
    await tx.query('DELETE FROM waitlist WHERE id = ?', [id]);
    const info = await tx.one('SELECT v.name AS venue_name FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ?', [w.courtId]);
    await notify(tx, w.userId, `Bạn không đặt kịp giờ ${w.startAt.slice(11, 16)} tại ${info.venueName}, giờ này đã mở lại cho người khác.`);
    await offerSlot(tx, w.courtId, w.startAt);
  });
}

let running = null;
/** Xử lý mọi thứ đã đến hạn theo đồng hồ hệ thống. Gọi đầu mỗi request (middleware) và định kỳ (server.js). */
function sweep() {
  if (running) return running;
  running = (async () => {
    const now = clock.now();
    for (const r of await db.query("SELECT id FROM bookings WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY id", [now])) {
      await expireBooking(r.id);
    }
    await db.query('DELETE FROM waitlist WHERE start_at <= ?', [now]);
    for (const r of await db.query("SELECT id FROM waitlist WHERE status = 'offered' AND offer_expires_at <= ? ORDER BY id", [now])) {
      await expireOffer(r.id);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Chi tiết một lịch cho màn hình (đã kiểm quyền ở assertAccess). */
async function reloadBooking(id, opts) {
  return toBooking(await findBooking(id), opts);
}

module.exports = {
  assertAccess, refundTier, cancelBooking, approveBooking, rejectBooking, markPaid, markRefunded, markAttendance,
  expireBooking, expireOffer, sweep, reloadBooking,
};
