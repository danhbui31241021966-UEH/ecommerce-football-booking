// Dựng dữ liệu đọc của lịch đặt cho màn hình: chi tiết (kèm lịch sử, mã QR, uy tín khách) và danh sách theo vai trò.
const { db } = require('../db');
const { BANKS } = require('../rules');
const { addDays, isDate } = require('../lib/time');
const { badRequest, notFound } = require('../utils/errors');
const { toBooking, BOOKING_SELECT, findBooking } = require('./bookingCore');
const { reliabilityOf } = require('./reliability');

const LIST_LIMIT = 200;

function vietQr(bank, amount, content) {
  if (!bank?.bin || !bank?.account) return null;
  const q = new URLSearchParams({ amount: String(amount), addInfo: content, accountName: bank.accountName });
  return {
    url: `https://img.vietqr.io/image/${bank.bin}-${bank.account}-compact2.svg?${q}`,
    bankName: BANKS.find((x) => x.bin === bank.bin)?.name || bank.bin,
    account: bank.account,
    accountName: bank.accountName,
    amount,
    content,
  };
}

/** R8: chỉ hiện mã QR khi đã có sân và chưa chuyển khoản; lịch gọi điện thu tiền ngoài web. */
function paymentQr(b) {
  if (b.source === 'phone' || b.status !== 'confirmed' || b.paymentStatus !== 'unpaid') return null;
  return vietQr({ bin: b.bankBin, account: b.bankAccount, accountName: b.bankAccountName }, b.price, b.code);
}

/** viewer: người xem đã qua kiểm quyền. Nhân viên (chủ sân/admin) thấy thêm uy tín của khách. */
async function bookingDetail(id, viewer) {
  const b = await db.one(
    `${BOOKING_SELECT.replace('u.email AS customer_email', 'u.email AS customer_email, v.bank_bin, v.bank_account, v.bank_account_name')} WHERE b.id = ?`,
    [id],
  );
  if (!b) throw notFound('Không tìm thấy lịch đặt');
  const staff = viewer.role !== 'customer';
  const history = await db.query(
    `SELECT h.action, h.from_status, h.to_status, h.note, h.created_at, h.actor_role, u.full_name AS actor_name
       FROM booking_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.booking_id = ? ORDER BY h.id`,
    [id],
  );
  return {
    ...toBooking(b, { admin: staff }),
    customerName: b.customerName ?? b.walkInName ?? '',
    customerPhone: b.customerPhone ?? b.walkInPhone ?? '',
    customerEmail: b.customerEmail ?? '',
    customerNote: b.customerNote,
    rulesSnapshot: b.rulesSnapshot,
    policySnapshot: b.policySnapshot,
    history: history.map((h) => ({
      action: h.action, fromStatus: h.fromStatus, toStatus: h.toStatus,
      actorName: h.actorName || (h.actorRole === 'bank' ? 'Ngân hàng báo' : 'Hệ thống'), note: h.note, createdAt: h.createdAt,
    })),
    paymentQr: paymentQr(b),
    customerReliability: staff && b.source !== 'phone' ? await reliabilityOf(db, b.userId) : null,
  };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Danh sách lịch đặt cho chủ sân (ownerId) hoặc admin (ownerId null), mới nhất theo giờ đá trước, tối đa 200.
 * Lọc theo status, date, venueId, q (tìm trong mã, tên/điện thoại khách, tên cụm sân; chỉ là tìm chuỗi con).
 */
async function listBookings({ ownerId = null, status, date, venueId, q } = {}) {
  const where = [];
  const params = [];
  if (ownerId != null) { where.push('v.owner_id = ?'); params.push(ownerId); }
  if (status) { where.push('b.status = ?'); params.push(String(status)); }
  if (date) {
    if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
    where.push('b.start_at >= ? AND b.start_at < ?');
    params.push(`${date} 00:00:00`, `${addDays(date, 1)} 00:00:00`);
  }
  if (venueId) { where.push('b.venue_id = ?'); params.push(Number(venueId) || 0); }
  if (q) {
    const like = `%${escapeLike(String(q).slice(0, 80))}%`;
    where.push('(b.code LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ? OR v.name LIKE ? OR b.walk_in_name LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const rows = await db.query(
    `${BOOKING_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.start_at DESC, b.id DESC LIMIT ${LIST_LIMIT}`,
    params,
  );
  return rows.map((b) => toBooking(b, { admin: true }));
}

async function myBookings(userId) {
  const rows = await db.query(`${BOOKING_SELECT} WHERE b.user_id = ? ORDER BY b.start_at DESC, b.id DESC LIMIT ${LIST_LIMIT}`, [userId]);
  return rows.map((b) => toBooking(b));
}

module.exports = { bookingDetail, listBookings, myBookings, paymentQr, findBooking, vietQr };
