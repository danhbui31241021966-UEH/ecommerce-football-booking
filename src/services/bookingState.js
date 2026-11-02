// MỌI thay đổi trạng thái của lịch đặt đi qua đây (duyệt, từ chối, hủy, hết hạn, nhượng, ghép kèo...), trong một
// transaction của caller. Hàm giữ dòng slot_claims khớp với status: vào trạng thái giữ ô thì chiếm ô, ra thì nhả.
// Lịch đặt trùng ô với lịch khác (uq_booking_slot) hoặc với chặn giờ (slot_claims) ném 409.
const { isDuplicate } = require('../db');
const clock = require('../clock');
const { conflict } = require('../utils/errors');

const HOLDING = ['pending', 'confirmed', 'matching']; // R4: các trạng thái đang giữ ô
const isHolding = (status) => HOLDING.includes(status);

const TAKEN = 'Giờ này vừa có người khác đặt, bạn chọn giờ khác nhé';

/** Chiếm ô cho lịch vừa chèn (đang ở trạng thái giữ ô). */
async function claimForBooking(tx, { id, courtId, startAt }) {
  try {
    await tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [courtId, startAt, id]);
  } catch (err) {
    if (isDuplicate(err)) throw conflict(TAKEN);
    throw err;
  }
}

/**
 * Đổi status của lịch `id` sang `to`, kèm các cột khác (khóa snake_case, ví dụ { cancelled_by: 'owner' }).
 * Trả { from, to }. Khóa dòng lịch (FOR UPDATE) để hai thao tác đồng thời trên cùng lịch tuần tự hóa.
 */
async function setStatus(tx, id, to, extra = {}) {
  const row = await tx.one('SELECT id, court_id, start_at, status FROM bookings WHERE id = ? FOR UPDATE', [id]);
  if (!row) throw new Error(`Không có lịch đặt ${id}`);
  const cols = { status: to, updated_at: clock.now(), ...extra };
  const names = Object.keys(cols);
  try {
    await tx.query(`UPDATE bookings SET ${names.map((n) => `\`${n}\` = ?`).join(', ')} WHERE id = ?`, [...names.map((n) => cols[n]), id]);
  } catch (err) {
    if (isDuplicate(err)) throw conflict(TAKEN);
    throw err;
  }
  if (isHolding(row.status) && !isHolding(to)) await tx.query('DELETE FROM slot_claims WHERE booking_id = ?', [id]);
  else if (!isHolding(row.status) && isHolding(to)) await claimForBooking(tx, { id, courtId: row.courtId, startAt: row.startAt });
  return { from: row.status, to };
}

/** Lệch giữa trạng thái lịch và slot_claims (nên luôn rỗng): lịch giữ ô thiếu claim, claim của lịch không giữ ô. */
async function findClaimDrift(conn) {
  const missing = await conn.query(
    `SELECT b.id, b.status FROM bookings b LEFT JOIN slot_claims sc ON sc.booking_id = b.id
      WHERE b.status IN ('pending','confirmed','matching') AND sc.booking_id IS NULL`,
  );
  const stale = await conn.query(
    `SELECT b.id, b.status FROM slot_claims sc JOIN bookings b ON b.id = sc.booking_id
      WHERE b.status NOT IN ('pending','confirmed','matching')`,
  );
  return { missing, stale };
}

module.exports = { HOLDING, isHolding, claimForBooking, setStatus, findClaimDrift, TAKEN };
