// Đăng nhập / đăng ký: gọi api.login / api.register rồi chuyển về trang đích theo vai trò.
import { api } from '/js/api.js';
import { mountShell, getUser } from '/js/ui/shell.js';

const form = document.getElementById('auth-form');
const errorBox = document.getElementById('form-error');
const next = new URLSearchParams(location.search).get('next');
const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
const HOME = { customer: '/', owner: '/owner.html', admin: '/admin.html' };

async function showBookingContext() {
  const box = document.getElementById('booking-context');
  if (!box || !safeNext) return;
  try {
    const target = new URL(safeNext, location.origin);
    if (target.origin !== location.origin || !['/venue', '/venue.html'].includes(target.pathname)) return;
    const params = target.searchParams;
    const id = params.get('id');
    const date = params.get('date') || '';
    const slot = params.get('slot') || '';
    const courtId = params.get('court');
    if (!/^\d+$/.test(id || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot) || !/^\d+$/.test(courtId || '') || params.get('book') !== '1') return;
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day));
    if (dateObj.getUTCFullYear() !== year || dateObj.getUTCMonth() !== month - 1 || dateObj.getUTCDate() !== day) return;
    const venue = await api.venue(id);
    const court = venue.courts?.find((item) => String(item.id) === courtId);
    if (!venue.name || !court?.name) return;
    const dateLabel = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(dateObj);
    box.textContent = `Đang đặt ${venue.name} · ${court.name} · ${dateLabel} lúc ${slot}.`;
    box.hidden = false;
  } catch {
    // Thiếu sân hoặc API không truy cập được: giữ nguyên trang đăng nhập/đăng ký.
  }
}
void showBookingContext();

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
