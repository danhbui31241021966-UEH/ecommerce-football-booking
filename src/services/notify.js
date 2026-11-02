// Thông báo cho người dùng và nhật ký thao tác trên lịch đặt. Luôn gọi bên trong transaction của thao tác gây ra chúng,
// để thông báo/nhật ký chỉ tồn tại khi thao tác thành công.
const clock = require('../clock');

const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const shortTs = (ts) => `${ts.slice(11, 16)} ${ts.slice(8, 10)}/${ts.slice(5, 7)}`;

/** userId null (lịch chủ sân thêm tay, khách không có tài khoản) thì không có ai để báo. */
async function notify(tx, userId, message, { bookingId = null, link = '/notifications.html', at = null } = {}) {
  if (userId == null) return;
  await tx.query('INSERT INTO notifications (user_id, booking_id, message, link, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)', [
    userId, bookingId, String(message).slice(0, 300), link, at || clock.now(),
  ]);
}

/** actor: { id, role } của người thao tác, hoặc null khi hệ thống tự làm (hết hạn...). */
async function addHistory(tx, bookingId, action, { from = null, to = null, actor = null, note = '', at = null } = {}) {
  await tx.query(
    'INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [bookingId, action, from, to, actor?.id ?? null, actor?.role ?? 'system', String(note || '').slice(0, 500), at || clock.now()],
  );
}

module.exports = { notify, addHistory, money, shortTs };
