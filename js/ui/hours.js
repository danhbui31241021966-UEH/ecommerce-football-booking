// Danh sách "Giờ đá" cho ô lọc: hôm nay (theo giờ mock) không cho chọn giờ đã qua.
import { addDays, dateOf, hmToMin, minToHm } from '/js/ui/format.js';

const FIRST_HOUR = 6;
const LAST_HOUR = 22;

/** Các giờ chọn được của `date`; riêng ngày hôm nay bỏ những giờ đã qua so với nowTs. */
export function hoursFor(date, nowTs) {
  const nowMin = date === dateOf(nowTs) ? hmToMin(nowTs.slice(11, 16)) : -1;
  const out = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) if (h * 60 >= nowMin) out.push(minToHm(h * 60));
  return out;
}

/** Giờ chọn được gần nhất sắp tới (>= at); at rỗng giữ nguyên ("cả ngày"). */
export function nearestHour(list, at) {
  if (!at || list.includes(at)) return at;
  return list.find((h) => h >= at) || list.at(-1) || '';
}

/** Đưa lựa chọn { date, at } về giá trị hợp lệ: ngày không trước hôm nay, giờ không đã qua; hôm nay hết giờ thì sang ngày kế (trong cửa sổ đặt). */
export function settleChoice({ date, at }, nowTs, windowDays) {
  const today = dateOf(nowTs);
  const last = addDays(today, windowDays - 1);
  if (!date || date < today) date = today;
  while (date < last && !hoursFor(date, nowTs).length) date = addDays(date, 1);
  return { date, at: nearestHour(hoursFor(date, nowTs), at) };
}
