import { initPage, api, qs, params } from './common.js';

const user = await initPage();

// Chỉ chuyển hướng trong cùng website để tránh open redirect.
function nextUrl(role) {
  const next = params().get('next');
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next;
  return { owner: '/owner.html', admin: '/admin.html' }[role] || '/';
}

if (user) location.href = nextUrl(user.role);

const next = params().get('next');
for (const id of ['#register-link', '#login-link']) {
  const a = qs(id);
  if (a && next) a.href += `?next=${encodeURIComponent(next)}`;
}

function showError(msg) {
  const box = qs('#form-error');
  box.textContent = msg;
  box.classList.toggle('hidden', !msg);
}

async function submit(form, path, body) {
  const btn = qs('button[type=submit]', form);
  btn.disabled = true;
  try {
    const { user: u } = await api(path, { method: 'POST', body });
    location.href = nextUrl(u.role);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
  }
}

qs('#login-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.email.value || !f.password.value) return showError('Vui lòng nhập email và mật khẩu');
  submit(f, '/auth/login', { email: f.email.value, password: f.password.value });
});

qs('#register-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  // Kiểm tra phía client để báo lỗi sớm; server vẫn kiểm tra lại toàn bộ.
  if (f.fullName.value.trim().length < 2) return showError('Họ tên phải có ít nhất 2 ký tự');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value)) return showError('Email không đúng định dạng');
  if (!/^0\d{9}$/.test(f.phone.value.replace(/[\s.]/g, ''))) return showError('Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0');
  if (f.password.value.length < 8) return showError('Mật khẩu phải có ít nhất 8 ký tự');
  if (f.password.value !== f.password2.value) return showError('Mật khẩu nhập lại không khớp');
  submit(f, '/auth/register', {
    fullName: f.fullName.value, email: f.email.value, phone: f.phone.value, password: f.password.value,
  });
});
