// Ghép kèo: nhãn trạng thái và dòng mô tả dùng chung cho danh sách, chi tiết, booking, Lịch đặt của tôi.
import { money } from './format.js';

/** [chữ hiển thị, lớp badge]. Trạng thái luôn có chữ, không chỉ màu. */
export const STAKES = [[50, '5-5', 'Hòa vốn'], [60, '6-4', 'Thua chịu 60%'], [70, '7-3', 'Thua chịu 70%'], [100, 'Thua bao sân', 'Thua trả cả sân']];
export const stakeText = (p) => (p >= 100 ? 'thua bao sân' : `${p / 10}-${10 - p / 10}`);
export const winnerWord = (m, w) => (w === 'draw' ? 'Hòa' : w === m.role ? 'Đội bạn thắng' : m.role === 'host' || m.role === 'guest' ? 'Đội kia thắng' : w === 'host' ? 'Đội mở kèo thắng' : 'Đội vào kèo thắng');

export function matchLabel(m) {
  const r = m.result;
  if (m.status === 'confirmed' && r) {
    if (r.status === 'awaiting') return ['Đá xong, chờ báo kết quả', 'pending'];
    if (r.status === 'needs_owner') return ['Chờ chủ sân chốt kết quả', 'pending'];
    if (r.topUp?.status === 'unpaid') return ['Đội thua chưa trả thêm', 'pending'];
    return [r.winner === 'draw' ? 'Hòa, xong kèo' : 'Xong kèo', 'confirmed'];
  }
  if (m.status === 'open') return m.hostPaid ? ['Cần thêm một đội', 'matching'] : ['Chờ chủ sân nhận tiền đội mở kèo', 'pending'];
  if (m.status === 'joined') return ['Chờ đội vào kèo chuyển khoản', 'pending'];
  if (m.status === 'confirmed') return ['Đã chốt', 'confirmed'];
  if (m.status === 'expired') return ['Quá hạn, kèo không thành', 'expired'];
  return ['Đã hủy', 'cancelled'];
}

/** Tình trạng phần tiền của từng đội, theo những gì chủ sân đã xác nhận. */
export function partsHtml(m) {
  const hostState = m.hostPaid ? `Đã chuyển khoản ${money(m.hostAmount)}` : m.status === 'open' ? `Chưa chuyển khoản ${money(m.hostAmount)}` : `Chủ sân không nhận được ${money(m.hostAmount)}`;
  const guestState = m.guestPaid ? `Đã chuyển khoản ${money(m.guestAmount)}` : m.hasGuest ? `Đã vào kèo, chưa chuyển khoản ${money(m.guestAmount)}` : `Chưa có đội · phần ${money(m.guestAmount)}`;
  return `<ul class="match-parts">
    <li class="${m.hostPaid ? 'on' : ''}"><b>Đội mở kèo</b><span>${hostState}</span></li>
    <li class="${m.guestPaid ? 'on' : ''}"><b>Đội vào kèo</b><span>${guestState}</span></li>
  </ul>`;
}

/** Ô giờ đủ hai đội trong kết quả tìm: dẫn tới trận đang chờ đội thứ hai hoặc trang mở kèo. Trả null nếu là ô đặt thường. */
export function teamSlotHref(venueId, date, s) {
  if (s.match) return `/match.html?id=${s.match.id}`;
  if (s.teamMode) return `/match-new.html?venue=${venueId}&court=${s.courtId}&date=${date}&start=${s.start}`;
  return null;
}
export const teamSlotLabel = (s) => (s.match ? 'Ghép kèo · vào kèo' : s.teamMode ? 'Ghép kèo · mở kèo' : '');

export const refundText = (r) => (r ? `${r.status === 'done' ? 'Đã trả lại' : 'Chưa trả lại'} ${money(r.amount)}` : '');
