// R16: chủ sân tự ghi lịch của khách gọi điện/nhắn Zalo. Lịch không có tài khoản (user_id NULL, source 'phone'), chiếm ô
// bằng đúng cơ chế claim của lịch web nên đặt trùng bị DB chặn; không thông báo ai, không vào uy tín (R10 chỉ đếm theo user_id).
const crypto = require('crypto');
const { db, withTransaction, isDuplicate } = require('../db');
const clock = require('../clock');
const { CANCEL_POLICY_TEXT } = require('../rules');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { isDate, isHm } = require('../lib/time');
const { loadCourt } = require('./venueStore');
const { slotGrid, slotEndAt } = require('./slotGrid');
const { loadOccupancy, slotInfo } = require('./schedule');
const { claimForBooking } = require('./bookingState');
const { addHistory, money } = require('./notify');
const { bookingCode, findBooking, toBooking } = require('./bookingCore');
const { assertAccess } = require('./bookingOps');

const PHONE_RE = /^[0-9+().\s-]{6,20}$/;
const MAX_PRICE = 100000000;

function cleanName(v) {
  const name = String(v ?? '').trim();
  if (name.length < 1 || name.length > 80) throw badRequest('Vui lòng nhập tên khách');
  return name;
}
function cleanPhone(v) {
  const phone = String(v ?? '').trim();
  if (phone && !PHONE_RE.test(phone)) throw badRequest('Số điện thoại chưa đúng');
  return phone;
}
function cleanPrice(v) {
  const price = Number(v);
  if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE) throw badRequest('Giá phải là số tiền từ 0đ');
  return price;
}
const describe = (name, phone, price, paid) =>
  `Đặt qua điện thoại cho ${name}${phone ? ` (${phone})` : ''}, giá ${money(price)}, ${paid ? 'đã nhận tiền' : 'chưa nhận tiền'}`;

async function createPhoneBooking(owner, body = {}) {
  const courtId = Number(body.courtId);
  const found = Number.isInteger(courtId) && courtId > 0 ? await loadCourt(courtId, { activeOnly: false }) : null;
  if (!found) throw notFound('Không tìm thấy sân');
  const { venue, court } = found;
  if (venue.ownerId !== owner.id) throw forbidden('Sân này không thuộc tài khoản của bạn');
  if (!court.isActive) throw conflict('Sân này đang tắt, bạn bật lại ở Cài đặt sân');
  const { date, start } = body;
  if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
  if (!isHm(start) || !slotGrid(venue).includes(start)) throw badRequest('Giờ bắt đầu không khớp lịch của sân');
  const name = cleanName(body.customerName);
  const phone = cleanPhone(body.customerPhone);
  const slot = slotInfo(venue, court, date, start, await loadOccupancy([court.id], date), null);
  const price = body.price == null || body.price === '' ? slot.basePrice : cleanPrice(body.price);
  if (slot.status === 'past') throw badRequest('Giờ này đã qua, không thêm lịch được');
  if (slot.status === 'blocked') throw conflict('Giờ này đang bị chặn, bạn bỏ chặn trước nhé');
  if (slot.status === 'booked' || slot.status === 'held') throw conflict('Giờ này đã có lịch đặt');
  if (slot.status === 'offered') throw conflict('Giờ này đang giữ cho người đã đăng ký chờ, chờ họ đặt hoặc hết hạn rồi thêm lịch');
  if (slot.teamMode) throw conflict('Giờ này đang ở chế độ Chỉ nhận ghép kèo. Bạn tắt chế độ này ở Cài đặt sân nếu muốn nhận khách đặt riêng');

  const paid = !!body.paid;
  const now = clock.now();
  const startAt = `${date} ${start}:00`;
  try {
    const id = await withTransaction(async (tx) => {
      const r = await tx.query(
        `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, walk_in_name, walk_in_phone, price, base_price,
           discount_percent, payment_status, paid_at, paid_via, customer_note, rules_snapshot, policy_snapshot, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, 'confirmed', 'phone', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`T${crypto.randomBytes(8).toString('hex')}`, venue.id, court.id, startAt, slotEndAt(venue, date, start), name, phone || null, price, slot.basePrice,
          paid ? 'paid' : 'unpaid', paid ? now : null, paid ? 'owner' : null, String(body.note ?? '').slice(0, 300), venue.rules, CANCEL_POLICY_TEXT, now, now],
      );
      await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [bookingCode(r.insertId), r.insertId]);
      await claimForBooking(tx, { id: r.insertId, courtId: court.id, startAt });
      await addHistory(tx, r.insertId, 'phone_create', { to: 'confirmed', actor: { id: owner.id, role: 'owner' }, note: describe(name, phone, price, paid), at: now });
      return r.insertId;
    });
    return toBooking(await findBooking(id), { admin: true });
  } catch (err) {
    if (isDuplicate(err)) throw conflict('Giờ này đã có lịch đặt'); // có người đặt giữa lúc kiểm và lúc ghi
    throw err;
  }
}

/** Giờ và sân không sửa được (hủy rồi thêm lại để ô và người chờ luôn đúng). */
async function updatePhoneBooking(owner, id, body = {}) {
  await assertAccess(owner, id);
  await withTransaction(async (tx) => {
    const b = await tx.one('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [id]);
    if (b.source !== 'phone') throw conflict('Chỉ sửa được lịch đặt qua điện thoại');
    if (b.status !== 'confirmed') throw conflict('Lịch đặt này không sửa được nữa');
    const name = body.customerName === undefined ? b.walkInName : cleanName(body.customerName);
    const phone = body.customerPhone === undefined ? b.walkInPhone || '' : cleanPhone(body.customerPhone);
    let price = b.price;
    if (body.price !== undefined && Number(body.price) !== b.price) {
      const next = cleanPrice(body.price);
      if (b.paymentStatus === 'paid') throw conflict('Đã nhận tiền rồi nên không đổi giá nữa');
      price = next;
    }
    const note = body.note === undefined ? b.customerNote : String(body.note).slice(0, 300);
    await tx.query('UPDATE bookings SET walk_in_name = ?, walk_in_phone = ?, price = ?, customer_note = ?, updated_at = ? WHERE id = ?',
      [name, phone || null, price, note, clock.now(), id]);
    await addHistory(tx, id, 'phone_update', { actor: { id: owner.id, role: 'owner' }, note: `Sửa thông tin lịch qua điện thoại, giá ${money(price)}` });
  });
  return toBooking(await findBooking(id), { admin: true });
}

module.exports = { createPhoneBooking, updatePhoneBooking, describe };
