// Hàm thuần cho thời gian. Mọi chuỗi thời gian là giờ TP.HCM: ngày 'YYYY-MM-DD', giờ 'HH:mm', mốc 'YYYY-MM-DD HH:mm:ss'.
// Dùng UTC+7 cố định (Việt Nam không có giờ mùa hè) nên không phụ thuộc múi giờ của máy chạy.
const VN_OFFSET_MS = 7 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD HH:mm[:ss]' (giờ VN) -> mili giây epoch. */
function vnToMs(str) {
  const s = String(str).replace(' ', 'T');
  const full = s.length === 16 ? `${s}:00` : s.length === 10 ? `${s}T00:00:00` : s;
  return Date.parse(`${full}+07:00`);
}

/** mili giây epoch -> 'YYYY-MM-DD HH:mm:ss' giờ VN. */
function msToVn(ms) {
  const d = new Date(ms + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const dateOf = (ts) => ts.slice(0, 10);
const timeOf = (ts) => ts.slice(11, 16);
const hmToMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const minToHm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const hm = (t) => (t == null ? null : String(t).slice(0, 5)); // 'HH:mm:ss' của MySQL TIME -> 'HH:mm'

function addDays(date, n) {
  return msToVn(vnToMs(date) + n * 86400000).slice(0, 10);
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && msToVn(vnToMs(s)).slice(0, 10) === s;
const isHm = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** R6: giá sau giảm giờ chót, làm tròn 1.000đ. */
function discountedPrice(basePrice, percent) {
  return percent > 0 ? Math.round((basePrice * (1 - percent / 100)) / 1000) * 1000 : basePrice;
}

module.exports = { vnToMs, msToVn, dateOf, timeOf, hmToMin, minToHm, hm, addDays, isDate, isHm, discountedPrice };
