// Trang đích của link trong mail xác nhận: đổi token lấy proof và báo kết quả bằng câu trung tính (không nói email có tồn tại hay không).
import { api } from '/js/api.js';
import { mountShell } from '/js/ui/shell.js';
import { $, esc } from '/js/ui/page.js';
import { MailError, mailErrorText } from '/js/mail.js';

const show = (title, text, ok) => {
  $('root').innerHTML = `<section class="card card-pad verify-result" role="status"><h1 class="h2" id="verify-title">${esc(title)}</h1><p>${esc(text)}</p>
    <a class="btn btn-dark" href="${ok ? '/my-bookings.html' : '/account.html'}">${ok ? 'Xem lịch đặt của tôi' : 'Đến trang Tài khoản'}</a></section>`;
};

await mountShell();
// Không tự confirm khi tải trang: bộ quét link chạy JS sẽ kích hoạt được. Người dùng bấm nút thì mới gọi confirm.
const t = new URLSearchParams(location.search).get('t');
history.replaceState(null, '', location.pathname); // token không nằm lại trong thanh địa chỉ, chỉ giữ trong bộ nhớ cho nút
if (!api.email) show('Tính năng chưa bật', 'Xác nhận email chưa dùng được ở bản này.', false);
else if (!t) show('Liên kết không hợp lệ', mailErrorText(new MailError('invalid')), false);
else {
  $('root').innerHTML = `<section class="card card-pad verify-result"><h1 class="h2" id="verify-title">Xác nhận email của bạn</h1><p>Bấm nút bên dưới để xác nhận email đăng ký tài khoản GGO.</p>
    <button class="btn btn-dark" type="button" id="verify-go">Xác nhận email</button></section>`;
  $('verify-go').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api.email.confirm(t);
      show('Email đã được xác nhận', 'Cảm ơn bạn. Mail thông báo đặt sân sẽ được gửi tới email này.', true);
    } catch (err) {
      show('Chưa xác nhận được email', mailErrorText(err), false);
    }
  });
}
