const crypto = require('crypto');
const { pool, withTransaction } = require('../db');
const config = require('../config');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const slots = require('./slots');
const { assertBookableDate, HOLDING_SQL } = require('./schedule');

const STATUS_LABEL = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  rejected: 'Bị từ chối',
  cancelled: 'Đã hủy',
  expired: 'Hết hạn',
};

async function notify(conn, userId, bookingId, message) {
  await conn.query('INSERT INTO notifications (user_id, booking_id, message) VALUES (?, ?, ?)', [
    userId,
    bookingId,
    message.slice(0, 255),
  ]);
}

async function addHistory(conn, bookingId, { action, from = null, to = null, actorId = null, note = null }) {
  await conn.query(
    `INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [bookingId, action, from, to, actorId, note],
  );
}

function newBookingCode(now = new Date()) {
  const ymd = slots.toDateStr(now).replace(/-/g, '').slice(2);
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  return `BK${ymd}${rand}`;
}

function slotLabel(b) {
  return `${b.court_name} - ${b.start_at.slice(11, 16)} ngày ${b.start_at.slice(0, 10).split('-').reverse().join('/')}`;
}

/**
 * Chuyển các booking chờ xác nhận đã quá hạn giữ chỗ sang "Hết hạn" để giải phóng slot.
 * Gọi định kỳ và ngay trước khi tạo booking/duyệt để không phụ thuộc vào chu kỳ chạy nền.
 */
async function expireStale(conn = null, { courtId = null } = {}) {
  if (!conn) return withTransaction((c) => expireStale(c, { courtId }));
  const [rows] = await conn.query(
    `SELECT b.id, b.code, b.customer_id, b.court_name, b.start_at, v.owner_id
     FROM bookings b JOIN venues v ON v.id = b.venue_id
     WHERE b.status = 'pending' AND b.expires_at <= NOW() ${courtId ? 'AND b.court_id = ?' : ''}
     FOR UPDATE OF b`,
    courtId ? [courtId] : [],
  );
  for (const b of rows) {
    await conn.query(`UPDATE bookings SET status = 'expired' WHERE id = ?`, [b.id]);
    await addHistory(conn, b.id, { action: 'expire', from: 'pending', to: 'expired', note: 'Quá hạn giữ chỗ chưa được duyệt' });
    await notify(conn, b.customer_id, b.id, `Booking ${b.code} (${slotLabel(b)}) đã hết hạn do chủ sân chưa duyệt kịp.`);
    await notify(conn, b.owner_id, b.id, `Booking ${b.code} đã hết hạn giữ chỗ.`);
  }
  return rows.length;
}

async function createBooking(customer, input) {
  if (customer.role !== 'customer') throw forbidden('Chỉ tài khoản khách hàng mới được đặt sân');
  const { courtId, date, start, idempotencyKey, note } = input;
  if (!/^[\w-]{8,64}$/.test(idempotencyKey || '')) throw badRequest('Thiếu mã chống gửi lặp');
  assertBookableDate(date);

  return withTransaction(async (conn) => {
    // Gửi lặp cùng một form: trả lại booking đã tạo, không tạo booking mới.
    const [dup] = await conn.query('SELECT id FROM bookings WHERE customer_id = ? AND idempotency_key = ?', [
      customer.id,
      idempotencyKey,
    ]);
    if (dup.length) return { id: dup[0].id, duplicate: true };

    // Khóa dòng sân con: các yêu cầu đặt cùng sân con được xử lý tuần tự.
    const [courtRows] = await conn.query(
      `SELECT c.id AS court_id, c.name AS court_name, c.field_type, c.price, c.peak_price, c.is_active AS court_active,
              v.*, o.is_active AS owner_active
       FROM courts c JOIN venues v ON v.id = c.venue_id JOIN users o ON o.id = v.owner_id
       WHERE c.id = ? FOR UPDATE OF c`,
      [courtId],
    );
    const row = courtRows[0];
    if (!row || !row.court_active || !row.is_active || !row.owner_active) {
      throw notFound('Sân con không tồn tại hoặc đang ngừng hoạt động');
    }

    const slot = slots.generateSlots(row).find((s) => s.start === start);
    if (!slot) throw badRequest('Khung giờ không hợp lệ với cấu hình hiện tại của sân');
    const startAt = `${date} ${slot.start}:00`;
    const endAt = `${date} ${slot.end}:00`;
    if (startAt <= slots.toSqlDateTime(new Date())) throw badRequest('Khung giờ này đã qua');

    await expireStale(conn, { courtId });

    const [taken] = await conn.query(
      `SELECT b.id FROM bookings b WHERE b.court_id = ? AND b.start_at < ? AND b.end_at > ? AND ${HOLDING_SQL}`,
      [courtId, endAt, startAt],
    );
    if (taken.length) throw conflict('Khung giờ này vừa có người đặt, vui lòng chọn khung giờ khác');
    const [blocked] = await conn.query(
      'SELECT id FROM slot_blocks WHERE court_id = ? AND start_at < ? AND end_at > ?',
      [courtId, endAt, startAt],
    );
    if (blocked.length) throw conflict('Khung giờ này không khả dụng');

    // Giá tính lại ở server, không tin giá từ client.
    const price = slots.slotPrice(row, { price: row.price, peak_price: row.peak_price }, slot.start);
    const needsApproval = Boolean(row.requires_approval);
    const status = needsApproval ? 'pending' : 'confirmed';
    const expiresAt = needsApproval
      ? slots.toSqlDateTime(new Date(Date.now() + config.holdMinutes * 60_000))
      : null;

    let id;
    let code;
    for (let attempt = 0; !id; attempt++) {
      code = newBookingCode();
      try {
        const [res] = await conn.query(
          `INSERT INTO bookings (code, customer_id, venue_id, court_id, start_at, end_at, status, expires_at,
             price, venue_name, court_name, field_type, rules_snapshot, policy_snapshot, payment_info_snapshot,
             customer_note, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [code, customer.id, row.id, courtId, startAt, endAt, status, expiresAt, price, row.name, row.court_name,
            row.field_type, row.rules, slots.CANCEL_POLICY_TEXT, row.payment_info, note || null, idempotencyKey],
        );
        id = res.insertId;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        if (err.sqlMessage.includes('uq_booking_slot')) {
          throw conflict('Khung giờ này vừa có người đặt, vui lòng chọn khung giờ khác');
        }
        if (err.sqlMessage.includes('uq_booking_idem')) {
          const [again] = await conn.query('SELECT id FROM bookings WHERE customer_id = ? AND idempotency_key = ?', [
            customer.id,
            idempotencyKey,
          ]);
          return { id: again[0].id, duplicate: true };
        }
        if (attempt >= 3) throw err; // trùng mã booking ngẫu nhiên: thử lại vài lần
      }
    }

    const b = { court_name: row.court_name, start_at: startAt };
    await addHistory(conn, id, { action: 'create', to: status, actorId: customer.id });
    if (needsApproval) {
      await notify(conn, customer.id, id,
        `Booking ${code} (${slotLabel(b)}) đang chờ chủ sân duyệt trong ${config.holdMinutes} phút.`);
      await notify(conn, row.owner_id, id,
        `Booking mới ${code} tại ${row.name} (${slotLabel(b)}) cần duyệt trong ${config.holdMinutes} phút.`);
    } else {
      await notify(conn, customer.id, id, `Đặt sân thành công: ${code} (${slotLabel(b)}).`);
      await notify(conn, row.owner_id, id, `Booking mới ${code} tại ${row.name} (${slotLabel(b)}) đã tự xác nhận.`);
    }
    return { id, duplicate: false };
  });
}

async function lockBooking(conn, id) {
  const [rows] = await conn.query(
    `SELECT b.*, v.owner_id FROM bookings b JOIN venues v ON v.id = b.venue_id WHERE b.id = ? FOR UPDATE OF b`,
    [id],
  );
  if (!rows.length) throw notFound('Không tìm thấy booking');
  return rows[0];
}

function canAccess(actor, booking) {
  if (actor.role === 'admin') return true;
  if (actor.role === 'owner') return booking.owner_id === actor.id;
  return booking.customer_id === actor.id;
}

function assertAccess(actor, booking) {
  // Trả 404 thay vì 403 để không lộ sự tồn tại của booking người khác.
  if (!canAccess(actor, booking)) throw notFound('Không tìm thấy booking');
}

function assertStatus(booking, allowed) {
  if (!allowed.includes(booking.status)) {
    throw conflict(`Không thể thực hiện khi booking đang ở trạng thái "${STATUS_LABEL[booking.status]}"`);
  }
}

async function approve(actor, id) {
  if (actor.role !== 'owner') throw forbidden();
  await expireStale();
  return withTransaction(async (conn) => {
    const b = await lockBooking(conn, id);
    assertAccess(actor, b);
    assertStatus(b, ['pending']);
    await conn.query(`UPDATE bookings SET status = 'confirmed', expires_at = NULL WHERE id = ?`, [id]);
    await addHistory(conn, id, { action: 'approve', from: 'pending', to: 'confirmed', actorId: actor.id });
    await notify(conn, b.customer_id, id, `Booking ${b.code} (${slotLabel(b)}) đã được chủ sân xác nhận.`);
  });
}

async function reject(actor, id, reason) {
  if (actor.role !== 'owner') throw forbidden();
  await expireStale();
  return withTransaction(async (conn) => {
    const b = await lockBooking(conn, id);
    assertAccess(actor, b);
    assertStatus(b, ['pending']);
    await conn.query(`UPDATE bookings SET status = 'rejected', expires_at = NULL, cancel_reason = ? WHERE id = ?`, [
      reason,
      id,
    ]);
    await addHistory(conn, id, { action: 'reject', from: 'pending', to: 'rejected', actorId: actor.id, note: reason });
    await notify(conn, b.customer_id, id,
      `Booking ${b.code} (${slotLabel(b)}) bị từ chối${reason ? `: ${reason}` : '.'}`);
  });
}

// Mức hoàn nếu khách hủy ngay bây giờ (để hiển thị trước khi hủy).
function customerCancelPreview(b, now = new Date()) {
  if (!['pending', 'confirmed'].includes(b.status)) return null;
  const startAt = slots.parseSqlDateTime(b.start_at);
  if (startAt <= now) return null;
  const percent = b.status === 'pending' ? 0 : slots.customerRefundPercent(startAt, now);
  return { percent, amount: slots.refundAmount(b.price, b.payment_status, percent) };
}

async function cancelByCustomer(actor, id) {
  if (actor.role !== 'customer') throw forbidden();
  return withTransaction(async (conn) => {
    const b = await lockBooking(conn, id);
    assertAccess(actor, b);
    assertStatus(b, ['pending', 'confirmed']);
    const preview = customerCancelPreview(b);
    if (!preview) throw conflict('Không thể hủy booking đã đến giờ đá');
    await applyCancel(conn, b, { actor, by: 'customer', percent: preview.percent, reason: 'Khách hủy' });
    await notify(conn, b.owner_id, id, `Khách đã hủy booking ${b.code} (${slotLabel(b)}).`);
    return preview;
  });
}

// Chủ sân (hoặc Admin khi xử lý tranh chấp/sự cố) hủy: bắt buộc lý do, hoàn 100%.
async function cancelByStaff(actor, id, reason) {
  if (!['owner', 'admin'].includes(actor.role)) throw forbidden();
  if (!reason) throw badRequest('Bắt buộc nhập lý do hủy');
  return withTransaction(async (conn) => {
    const b = await lockBooking(conn, id);
    assertAccess(actor, b);
    assertStatus(b, ['pending', 'confirmed']);
    if (actor.role === 'owner' && slots.parseSqlDateTime(b.start_at) <= new Date()) {
      throw conflict('Không thể hủy booking đã đến giờ đá; liên hệ Admin nếu có sự cố');
    }
    await applyCancel(conn, b, { actor, by: actor.role, percent: 100, reason });
    await notify(conn, b.customer_id, id, `Booking ${b.code} (${slotLabel(b)}) đã bị hủy bởi ${
      actor.role === 'admin' ? 'quản trị viên' : 'chủ sân'}: ${reason}`);
    if (actor.role === 'admin') await notify(conn, b.owner_id, id, `Admin đã hủy booking ${b.code}: ${reason}`);
  });
}

async function applyCancel(conn, b, { actor, by, percent, reason }) {
  const amount = slots.refundAmount(b.price, b.payment_status, percent);
  await conn.query(
    `UPDATE bookings SET status = 'cancelled', expires_at = NULL, cancelled_by = ?, cancel_reason = ?,
       refund_percent = ?, refund_amount = ?, refund_status = ?
     WHERE id = ?`,
    [by, reason, percent, amount, amount > 0 ? 'pending' : 'none', b.id],
  );
  await addHistory(conn, b.id, {
    action: 'cancel',
    from: b.status,
    to: 'cancelled',
    actorId: actor.id,
    note: `${reason} | Hoàn ${percent}% = ${amount.toLocaleString('vi-VN')}đ`,
  });
}

async function markPaid(actor, id) {
  if (!['owner', 'admin'].includes(actor.role)) throw forbidden();
  return withTransaction(async (conn) => {
    const b = await lockBooking(conn, id);
    assertAccess(actor, b);
    assertStatus(b, ['confirmed']);
    if (b.payment_status === 'paid') throw conflict('Booking đã được ghi nhận thanh toán');
    await conn.query(`UPDATE bookings SET payment_status = 'paid', paid_at = NOW() WHERE id = ?`, [id]);
    await addHistory(conn, id, { action: 'paid', actorId: actor.id, note: 'Xác nhận đã nhận tiền' });
  });
}

async function markRefunded(actor, id, note) {
  if (!['owner', 'admin'].includes(actor.role)) throw forbidden();
  return withTransaction(async (conn) => {
    const b = await lockBooking(conn, id);
    assertAccess(actor, b);
    if (b.refund_status !== 'pending') throw conflict('Booking không có khoản hoàn tiền đang chờ');
    await conn.query(`UPDATE bookings SET refund_status = 'done', refunded_at = NOW(), refund_note = ? WHERE id = ?`, [
      note,
      id,
    ]);
    await addHistory(conn, id, { action: 'refund', actorId: actor.id, note: note || 'Đã hoàn tiền' });
    await notify(conn, b.customer_id, id,
      `Đã hoàn ${b.refund_amount.toLocaleString('vi-VN')}đ cho booking ${b.code}.`);
  });
}

const DETAIL_SQL = `
  SELECT b.*, v.owner_id, v.address AS venue_address, v.district AS venue_district, v.phone AS venue_phone,
         u.full_name AS customer_name, u.phone AS customer_phone, u.email AS customer_email
  FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN users u ON u.id = b.customer_id`;

async function getDetail(actor, id) {
  const [rows] = await pool.query(`${DETAIL_SQL} WHERE b.id = ?`, [id]);
  if (!rows.length) throw notFound('Không tìm thấy booking');
  const b = rows[0];
  assertAccess(actor, b);
  const [history] = await pool.query(
    `SELECT h.action, h.from_status, h.to_status, h.note, h.created_at, u.full_name AS actor_name, u.role AS actor_role
     FROM booking_history h LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.booking_id = ? ORDER BY h.id`,
    [id],
  );
  const { idempotency_key, slot_lock, ...safe } = b;
  return {
    ...safe,
    history,
    cancelPreview: actor.role === 'customer' ? customerCancelPreview(b) : null,
  };
}

async function list({ customerId, ownerId, status, date, venueId, q }, limit = 200) {
  const where = [];
  const params = [];
  const add = (clause, ...values) => {
    where.push(clause);
    params.push(...values);
  };
  if (customerId) add('b.customer_id = ?', customerId);
  if (ownerId) add('v.owner_id = ?', ownerId);
  if (venueId) add('b.venue_id = ?', venueId);
  if (status) add('b.status = ?', status);
  if (date) add('b.start_at >= ? AND b.start_at < ?', `${date} 00:00:00`, `${slots.addDays(date, 1)} 00:00:00`);
  if (q) {
    add('(b.code LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ? OR b.venue_name LIKE ?)', ...Array(4).fill(`%${q}%`));
  }
  const [rows] = await pool.query(
    `SELECT b.id, b.code, b.venue_id, b.venue_name, b.court_name, b.field_type, b.start_at, b.end_at, b.status,
            b.expires_at, b.price, b.payment_status, b.refund_status, b.refund_amount, b.created_at,
            u.full_name AS customer_name, u.phone AS customer_phone, v.phone AS venue_phone
     FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN users u ON u.id = b.customer_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY b.start_at DESC LIMIT ?`,
    [...params, limit],
  );
  return rows;
}

module.exports = {
  STATUS_LABEL,
  expireStale,
  createBooking,
  approve,
  reject,
  cancelByCustomer,
  cancelByStaff,
  markPaid,
  markRefunded,
  getDetail,
  list,
  customerCancelPreview,
};
