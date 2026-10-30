// Trận đủ hai đội: nhãn trạng thái và dòng mô tả dùng chung cho danh sách, chi tiết, booking, Booking của tôi.
import { money } from './format.js';

/** [chữ hiển thị, lớp badge]. Trạng thái luôn có chữ, không chỉ màu. */
export function matchLabel(m) {
  if (m.status === 'open') return m.hostPaid ? ['Chờ đội thứ hai', 'matching'] : ['Chờ chủ sân xác nhận phần đội mở', 'pending'];
  if (m.status === 'joined') return ['Chờ đội vào trả tiền', 'pending'];
  if (m.status === 'confirmed') return ['Đã chốt', 'confirmed'];
  if (m.status === 'expired') return ['Hết hạn, trận không thành', 'expired'];
  return ['Đã hủy', 'cancelled'];
}

/** Tình trạng phần tiền của từng đội, theo những gì chủ sân đã xác nhận. */
export function partsHtml(m) {
  const hostState = m.hostPaid ? `Chủ sân đã nhận ${money(m.hostAmount)}` : m.status === 'open' ? `Chưa trả ${money(m.hostAmount)}` : `Không được ghi nhận ${money(m.hostAmount)}`;
  const guestState = m.guestPaid ? `Chủ sân đã nhận ${money(m.guestAmount)}` : m.hasGuest ? `Đã vào, chưa được ghi nhận ${money(m.guestAmount)}` : `Chưa có đội · phần ${money(m.guestAmount)}`;
  return `<ul class="match-parts">
    <li class="${m.hostPaid ? 'on' : ''}"><b>Đội mở trận</b><span>${hostState}</span></li>
    <li class="${m.guestPaid ? 'on' : ''}"><b>Đội vào trận</b><span>${guestState}</span></li>
  </ul>`;
}

/** Ô giờ đủ hai đội trong kết quả tìm: dẫn tới trận đang chờ đội thứ hai hoặc trang mở trận. Trả null nếu là ô đặt thường. */
export function teamSlotHref(venueId, date, s) {
  if (s.match) return `/match.html?id=${s.match.id}`;
  if (s.teamMode) return `/match-new.html?venue=${venueId}&court=${s.courtId}&date=${date}&start=${s.start}`;
  return null;
}
export const teamSlotLabel = (s) => (s.match ? 'Ghép trận · vào trận' : s.teamMode ? 'Ghép trận · mở trận' : '');

export const refundText = (r) => (r ? `${r.status === 'done' ? 'Đã hoàn' : 'Chưa hoàn'} ${money(r.amount)}` : '');
