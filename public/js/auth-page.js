// Đăng nhập / đăng ký: gọi api.login / api.register rồi chuyển về trang đích theo vai trò.
import { api } from '/js/api.js';
import { mountShell, getUser } from '/js/ui/shell.js';

const form = document.getElementById('auth-form');
const errorBox = document.getElementById('form-error');
const next = new URLSearchParams(location.search).get('next');
const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
const HOME = { customer: '/', owner: '/owner.html', admin: '/admin.html' };

// Giữ ?next= khi chuyển qua lại giữa hai trang
if (safeNext) {
  const alt = document.getElementById('alt-link');
  alt.href += `?next=${encodeURIComponent(safeNext)}`;
}

const showError = (msg) => {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
};

(async () => {
  await mountShell();
  if (getUser()) location.replace(safeNext || HOME[getUser().role] || '/');
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const body = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('button[type=submit]');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang xử lý…';
  try {
    const { user } = await (form.dataset.mode === 'register' ? api.register(body) : api.login(body));
    location.href = safeNext || HOME[user.role] || '/';
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = label;
    form.querySelector('input').focus();
  }
});

// Đường tắt cho prototype: điền sẵn tài khoản demo
const demo = document.getElementById('demo-accounts');
if (demo && api.proto) {
  demo.hidden = false;
  demo.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-email]');
    if (!b) return;
    form.email.value = b.dataset.email;
    form.password.value = 'Matkhau@123';
    form.requestSubmit();
  });
}
