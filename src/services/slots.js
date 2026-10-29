// Các hàm thuần (không đụng DB) cho khung giờ, giá và chính sách hoàn tiền.

const pad = (n) => String(n).padStart(2, '0');

function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

// 'YYYY-MM-DD HH:MM:SS' theo giờ địa phương (process TZ = Asia/Ho_Chi_Minh).
function toSqlDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toDateStr(d) {
  return toSqlDateTime(d).slice(0, 10);
}

function parseSqlDateTime(s) {
  return new Date(String(s).replace(' ', 'T'));
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

// Sinh các slot cố định trong ngày; slot cuối phải kết thúc trước hoặc đúng giờ đóng cửa.
function generateSlots(venue) {
  const open = timeToMinutes(venue.open_time);
  const close = timeToMinutes(venue.close_time);
  const len = Number(venue.slot_minutes);
  const slots = [];
  if (!len || len <= 0) return slots;
  for (let start = open; start + len <= close; start += len) {
    slots.push({ start: minutesToTime(start), end: minutesToTime(start + len) });
  }
  return slots;
}

function isPeak(venue, slotStart) {
  if (!venue.peak_start || !venue.peak_end) return false;
  const s = timeToMinutes(slotStart);
  return s >= timeToMinutes(venue.peak_start) && s < timeToMinutes(venue.peak_end);
}

function slotPrice(venue, court, slotStart) {
  return isPeak(venue, slotStart) ? Number(court.peak_price) : Number(court.price);
}

// Chính sách hủy của khách: >=24h hoàn 100%, 12h đến <24h hoàn 50%, <12h không hoàn.
function customerRefundPercent(startAt, now = new Date()) {
  const hours = (startAt.getTime() - now.getTime()) / 3_600_000;
  if (hours >= 24) return 100;
  if (hours >= 12) return 50;
  return 0;
}

// Tiền hoàn chỉ tính trên số tiền khách đã thanh toán.
function refundAmount(price, paymentStatus, percent) {
  if (paymentStatus !== 'paid') return 0;
  return Math.round((Number(price) * percent) / 100);
}

const CANCEL_POLICY_TEXT =
  'Khách hủy trước giờ đá ít nhất 24 giờ: hoàn 100%. Từ 12 đến dưới 24 giờ: hoàn 50%. ' +
  'Dưới 12 giờ: không hoàn. Chủ sân hủy: hoàn 100%. Tiền hoàn tính trên số tiền đã thanh toán và được hoàn thủ công.';

module.exports = {
  timeToMinutes,
  minutesToTime,
  toSqlDateTime,
  toDateStr,
  parseSqlDateTime,
  addDays,
  generateSlots,
  isPeak,
  slotPrice,
  customerRefundPercent,
  refundAmount,
  CANCEL_POLICY_TEXT,
};
