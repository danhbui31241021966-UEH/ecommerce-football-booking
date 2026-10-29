// Tiện ích chung cho các trang khách: thoát HTML, gắn icon, bắt buộc đăng nhập, nhãn trạng thái.
import { icon } from '/js/ui/icons.js';
import { getUser } from '/js/ui/shell.js';
import { PAYMENT_LABEL, STATUS_LABEL } from '/js/ui/format.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Gắn icon vào mọi phần tử [data-icon] chưa gắn. */
export function decorate(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    el.insertAdjacentHTML(el.childElementCount || el.textContent.trim() ? 'afterbegin' : 'beforeend', icon(el.dataset.icon, el.classList.contains('art') ? 32 : 16));
  });
}

/** Chưa đăng nhập thì chuyển sang trang đăng nhập rồi quay lại đúng URL này. Trả true nếu đã chuyển. */
export function redirectToLogin() {
  location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
}
export const isCustomer = () => getUser()?.role === 'customer';

export const statusBadge = (s) => `<span class="badge badge-${s}">${STATUS_LABEL[s] || s}</span>`;
export const paymentBadge = (p) => `<span class="badge badge-${p}">${PAYMENT_LABEL[p] || p}</span>`;
export const modeTag = (requiresApproval) =>
  requiresApproval
    ? '<span class="tag-mode approval" data-icon="hourglass">Chủ sân duyệt</span>'
    : '<span class="tag-mode" data-icon="bolt">Tự xác nhận</span>';

/** Đếm ngược: gọi mỗi giây, hết giờ thì gọi onEnd một lần. Trả hàm dừng. */
export function countdown(el, seconds, text, onEnd) {
  let left = seconds;
  const paint = () => {
    el.textContent = text(left);
  };
  paint();
  const timer = setInterval(() => {
    left -= 1;
    paint();
    if (left <= 0) {
      clearInterval(timer);
      onEnd?.();
    }
  }, 1000);
  return () => clearInterval(timer);
}
