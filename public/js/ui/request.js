// Tin nhờ báo giá và báo giá (R14): nhãn trạng thái dùng chung cho các trang khách và chủ sân. Trạng thái luôn có chữ, không chỉ màu.
import { dayLabel, money } from './format.js';

/** [chữ hiển thị, lớp badge] của một tin nhờ báo giá. */
export function requestLabel(r) {
  if (r.status === 'open') return r.offers.some((o) => o.status === 'open') ? ['Có báo giá, chờ bạn chọn', 'matching'] : ['Đang chờ sân báo giá', 'pending'];
  if (r.status === 'chosen') return ['Đã chọn sân và đặt xong', 'confirmed'];
  if (r.status === 'expired') return ['Quá hạn, bạn chưa chọn báo giá nào', 'expired'];
  return ['Đã hủy', 'cancelled'];
}

/** [chữ hiển thị, lớp badge] của một báo giá. */
export function offerLabel(o) {
  if (o.status === 'open') return o.usable ? ['Đang chờ khách chọn', 'matching'] : ['Không dùng được nữa', 'expired'];
  return {
    chosen: ['Khách đã chọn', 'confirmed'],
    lost: ['Khách chọn báo giá khác', 'expired'],
    withdrawn: ['Sân đã rút', 'cancelled'],
    expired: ['Quá hạn', 'expired'],
    void: ['Không dùng được nữa', 'expired'],
  }[o.status] || [o.status, 'expired'];
}

export const requestTitle = (r) => `${r.district} · sân ${r.fieldType}`;
export const requestWhen = (r) => `${dayLabel(r.date)}, ${r.from}–${r.to}`;
export const budgetText = (r) => `Bạn muốn ${money(r.budget)}/giờ`;
