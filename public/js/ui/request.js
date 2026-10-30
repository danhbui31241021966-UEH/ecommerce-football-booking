// Nhu cầu và chào giá (R14): nhãn trạng thái dùng chung cho các trang khách và chủ sân. Trạng thái luôn có chữ, không chỉ màu.
import { dayLabel, money } from './format.js';

/** [chữ hiển thị, lớp badge] của một nhu cầu. */
export function requestLabel(r) {
  if (r.status === 'open') return r.offers.some((o) => o.status === 'open') ? ['Có chào giá, chờ bạn chọn', 'matching'] : ['Đang chờ sân chào giá', 'pending'];
  if (r.status === 'chosen') return ['Đã chốt thành booking', 'confirmed'];
  if (r.status === 'expired') return ['Hết hạn, chưa chọn chào giá nào', 'expired'];
  return ['Đã hủy', 'cancelled'];
}

/** [chữ hiển thị, lớp badge] của một chào giá. */
export function offerLabel(o) {
  if (o.status === 'open') return o.usable ? ['Đang chờ khách chọn', 'matching'] : ['Không dùng được', 'expired'];
  return {
    chosen: ['Khách đã chọn', 'confirmed'],
    lost: ['Khách chọn chào giá khác', 'expired'],
    withdrawn: ['Sân đã rút', 'cancelled'],
    expired: ['Hết hạn', 'expired'],
    void: ['Không dùng được', 'expired'],
  }[o.status] || [o.status, 'expired'];
}

export const requestTitle = (r) => `${r.district} · sân ${r.fieldType}`;
export const requestWhen = (r) => `${dayLabel(r.date)}, ${r.from}–${r.to}`;
export const budgetText = (r) => `Ngân sách ${money(r.budget)}`;
