// Trang Tài khoản: thông tin cơ bản và (ở bản mock) email nhận thông báo đặt sân: trạng thái xác nhận, thêm/đổi email, gửi lại mail.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, esc, redirectToLogin } from '/js/ui/page.js';
import { isTemporary, mailErrorText } from '/js/mail.js';

let st = null; // { email, verified, requestId } khi có xác minh email
let notice = '';

const ROLE = { customer: 'Khách hàng', owner: 'Chủ sân', admin: 'Quản trị viên' };

function emailCard(user) {
  if (!api.email || user.role !== 'customer') {
    return `<section class="card card-pad" id="email-card"><h2 class="h3">Email</h2><p>${user.email ? esc(user.email) : '<span class="muted">Chưa có email</span>'}</p></section>`;
  }
  const form = (label, value) => `<form id="email-form" class="account-email-form" novalidate>
      <div class="field"><label for="email">${label}</label><input class="input" id="email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(value)}" required></div>
      <button class="btn btn-dark" type="submit">${st.email ? 'Lưu email và gửi mail xác nhận' : 'Thêm email và gửi mail xác nhận'}</button></form>`;
  if (!st.email) {
    return `<section class="card card-pad" id="email-card"><h2 class="h3">Email</h2>
      <p>Tài khoản này chưa có email. Thêm email để nhận mail khi giữ chỗ, thanh toán hoặc hủy sân.</p>${form('Email', '')}<p class="note" id="email-msg" role="status" ${notice ? '' : 'hidden'}>${esc(notice)}</p></section>`;
  }
  return `<section class="card card-pad" id="email-card"><h2 class="h3">Email</h2>
    <p><b id="email-value">${esc(st.email)}</b></p>
    ${st.verified
      ? '<p><span class="badge badge-paid" id="email-status">Email đã xác nhận</span></p><p class="muted">Bạn sẽ nhận mail khi giữ chỗ, thanh toán và hủy sân.</p>'
      : `<p><span class="badge badge-pending" id="email-status">Email chưa xác nhận</span></p>
         <p class="muted">Mở mail xác nhận và bấm vào liên kết. Nếu đã bấm ở trình duyệt khác, trang này sẽ tự cập nhật khi bạn quay lại.</p>
         <button class="btn" type="button" id="resend">Gửi lại mail xác nhận</button>`}
    <details class="account-change"><summary>Đổi email</summary>${form('Email mới', st.email)}</details>
    <p class="note" id="email-msg" role="status" ${notice ? '' : 'hidden'}>${esc(notice)}</p></section>`;
}

function render() {
  const user = getUser();
  $('root').innerHTML = `<div class="page-head"><h1 class="h1">Tài khoản</h1></div>
    <section class="card card-pad" id="account-info"><h2 class="h3">${esc(user.fullName)}</h2><p class="muted">${ROLE[user.role] || ''}${user.phone ? ` · ${esc(user.phone)}` : ''}</p></section>
    ${emailCard(user)}`;
}

async function refresh({ quiet = false } = {}) {
  if (!api.email || getUser().role !== 'customer') return render();
  try { st = await api.email.check(); } catch { st ??= await api.email.state(); } // service mail lỗi: vẫn hiện trạng thái đã lưu
  if (!quiet) notice = '';
  render();
}

// Chạy một việc gửi mail rồi báo kết quả bằng câu trung tính; email đã lưu dù mail không đi được.
async function run(task, okText) {
  try {
    await task();
    notice = okText;
  } catch (e) {
    notice = isTemporary(e) || e.name === 'MailError' ? mailErrorText(e) : e.message;
  }
  st = await api.email.state();
  render();
  document.getElementById('email-msg')?.focus?.();
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'email-form') return;
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  await run(() => api.email.set(e.target.elements.email.value), 'Đã gửi mail xác nhận. Bạn mở mail và bấm vào liên kết nhé.');
});
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#resend')) return;
  e.target.closest('#resend').disabled = true;
  await run(() => api.email.sendVerify(), 'Đã gửi lại mail xác nhận.');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && st && !st.verified) void refresh({ quiet: true }); });

await mountShell();
if (!getUser()) redirectToLogin();
else await refresh();
