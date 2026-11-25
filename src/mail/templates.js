// Mẫu thư cố định. Dữ liệu do client gửi chỉ điền vào chỗ trống và luôn được escape trong HTML.
const { esc } = require('./validate');

const vnd = (n) => `${n.toLocaleString('vi-VN')}đ`;
const when = (s) => { const [d, t] = s.split('T'); const [y, m, day] = d.split('-'); return `${t} ngày ${day}/${m}/${y}`; };

function layout(title, lines, button) {
  const body = lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join('');
  const btn = button ? `<p style="margin:18px 0"><a href="${esc(button.url)}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(button.label)}</a></p>` : '';
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:520px"><h2 style="margin:0 0 14px">${esc(title)}</h2>${body}${btn}<p style="color:#666;font-size:12px;margin-top:20px">GGO – đặt sân bóng đá mini. Thư tự động, vui lòng không trả lời.</p></div>`;
}

function render(parts) {
  const text = [parts.title, '', ...parts.rows.map(([a, b]) => (b === undefined ? a : `${a}: ${b}`)), parts.url ? `\n${parts.buttonLabel}: ${parts.url}` : ''].join('\n').trim();
  const lines = parts.rows.map(([a, b]) => (b === undefined ? esc(a) : `${esc(a)}: <b>${esc(b)}</b>`));
  return { subject: parts.subject, text, html: layout(parts.title, lines, parts.url ? { url: parts.url, label: parts.buttonLabel } : null) };
}

function verifyEmail({ name, url }) {
  return render({
    subject: 'Xác nhận email đăng ký GGO',
    title: 'Xác nhận email của bạn',
    rows: [[`Chào ${name},`], ['Bấm nút bên dưới để xác nhận email đăng ký tài khoản GGO. Liên kết có hiệu lực 24 giờ.'], ['Nếu không phải bạn đăng ký, hãy bỏ qua thư này.']],
    url, buttonLabel: 'Xác nhận email',
  });
}

function booking(type, d, url) {
  const base = [['Chào ' + d.name + ','], ['Mã đặt sân', d.bookingCode], ['Sân', `${d.venueName} – ${d.courtName}`], ['Giờ đá', when(d.startAt)]];
  if (type === 'booking_held') {
    return render({
      subject: `Đã giữ chỗ ${d.bookingCode}`, title: 'Sân đã được giữ chỗ',
      rows: [...base, ['Số tiền', vnd(d.amount)], ...(d.deadline ? [['Thanh toán trước', d.deadline]] : [])],
      url, buttonLabel: 'Xem đặt sân',
    });
  }
  if (type === 'booking_paid') {
    return render({ subject: `Đã thanh toán ${d.bookingCode}`, title: 'Thanh toán thành công', rows: [...base, ['Đã thanh toán', vnd(d.amount)]], url, buttonLabel: 'Xem đặt sân' });
  }
  return render({
    subject: `Đã hủy đặt sân ${d.bookingCode}`, title: 'Đặt sân đã bị hủy',
    rows: [...base, ...(d.refund !== undefined ? [['Hoàn lại', vnd(d.refund)]] : [])],
    url, buttonLabel: 'Xem đặt sân',
  });
}

module.exports = { verifyEmail, booking };
