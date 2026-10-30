// Hàm định dạng và luật tính thuần túy dùng chung cho mọi trang (và cho mock trong api.js).
// Thời điểm trong contract là "YYYY-MM-DD HH:mm:ss" theo giờ Việt Nam (UTC+7), không phụ thuộc múi giờ trình duyệt.

const VN_OFFSET_MS = 7 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD HH:mm:ss" (giờ VN) → mili-giây UTC. Nhận cả "YYYY-MM-DD" và "YYYY-MM-DD HH:mm". */
export function vnToMs(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(str || '');
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - VN_OFFSET_MS;
}
/** mili-giây UTC → "YYYY-MM-DD HH:mm:ss" (giờ VN). */
export function msToVn(ms) {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}
export const dateOf = (ts) => ts.slice(0, 10);
export const timeOf = (ts) => ts.slice(11, 16);
/** Cộng ngày vào "YYYY-MM-DD". */
export function addDays(date, n) {
  return msToVn(vnToMs(date) + n * 86400000).slice(0, 10);
}
/** "HH:mm" → số phút từ 00:00. */
export const hmToMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
export const minToHm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
/** Thứ trong tuần của "YYYY-MM-DD" (0 = Chủ nhật). */
export const weekdayOf = (date) => new Date(vnToMs(date) + VN_OFFSET_MS).getUTCDay();
/** "Thứ 5, 29/10". */
export function dayLabel(date) {
  return `${WEEKDAYS[weekdayOf(date)]}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
/** "Hôm nay, 29/10" · "Mai, 30/10" · "Thứ 7, 31/10", so với ngày today. */
export function relativeDayLabel(date, today) {
  const diff = Math.round((vnToMs(date) - vnToMs(today)) / 86400000);
  const dm = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  if (diff === 0) return `Hôm nay, ${dm}`;
  if (diff === 1) return `Mai, ${dm}`;
  return `${WEEKDAYS[weekdayOf(date)]}, ${dm}`;
}
/** "19:00 30/10". */
export const shortTs = (ts) => `${timeOf(ts)} ${ts.slice(8, 10)}/${ts.slice(5, 7)}`;

/** 450000 → "450.000đ". */
export function money(n) {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}
/** 450000 → "450k" (dùng cho chip chật chỗ). */
export function moneyShort(n) {
  return n % 1000 === 0 ? `${n / 1000}k` : money(n);
}

/** Số giây còn lại đến hạn (≥ 0). */
export function secondsLeft(deadline, nowTs) {
  return Math.max(0, Math.round((vnToMs(deadline) - vnToMs(nowTs)) / 1000));
}
/** 905 → "15:05". */
export function mmss(sec) {
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
}

/** Giá sau giảm giờ chót, làm tròn 1.000đ (R6). */
export function discountedPrice(basePrice, percent) {
  return percent > 0 ? Math.round((basePrice * (1 - percent / 100)) / 1000) * 1000 : basePrice;
}

/**
 * R7: hoàn tiền khi khách tự hủy, tính trên số tiền ĐÃ thanh toán.
 * ≥24h → 100%, 12 – <24h → 50%, <12h → 0%. Chủ sân/admin hủy → 100%.
 * `paid` = booking.paymentStatus === 'paid'. Trả { percent, amount, hoursLeft }.
 */
export function refundFor({ startAt, price, paid }, nowTs, cancelledBy = 'customer') {
  const hoursLeft = (vnToMs(startAt) - vnToMs(nowTs)) / 3600000;
  const percent = cancelledBy !== 'customer' ? 100 : hoursLeft >= 24 ? 100 : hoursLeft >= 12 ? 50 : 0;
  return { percent, amount: paid ? Math.round((price * percent) / 100) : 0, hoursLeft };
}
/** Mốc giờ cụ thể của chính sách hủy (hoàn 100% trước `full`, 50% trước `half`). */
export function cancelDeadlines(startAt) {
  const t = vnToMs(startAt);
  return { full: msToVn(t - 24 * 3600000), half: msToVn(t - 12 * 3600000) };
}

export const STATUS_LABEL = {
  pending: 'Chờ duyệt',
  confirmed: 'Đã xác nhận',
  rejected: 'Bị từ chối',
  cancelled: 'Đã hủy',
  expired: 'Hết hạn',
  completed: 'Đã đá',
  no_show: 'Bùng sân',
  transferred: 'Đã nhượng',
  matching: 'Chờ đủ hai đội',
};
export const PAYMENT_LABEL = { unpaid: 'Chưa thanh toán', paid: 'Đã thanh toán' };
export const REFUND_LABEL = { none: 'Không hoàn', pending: 'Chờ hoàn tiền', done: 'Đã hoàn tiền' };
