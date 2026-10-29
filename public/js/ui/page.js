// Tiện ích chung cho các trang khách: thoát HTML, gắn icon, bắt buộc đăng nhập, nhãn trạng thái.
import { icon } from '/js/ui/icons.js';
import { getUser } from '/js/ui/shell.js';
import { cancelDeadlines, dayLabel, PAYMENT_LABEL, refundFor, STATUS_LABEL, vnToMs } from '/js/ui/format.js';

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

/** Chính sách hủy theo mốc giờ còn hiệu lực tại nowTs; mốc đã qua không hiện, thay bằng dòng "hiện tại hoàn bao nhiêu". */
export function policyStepsHtml(startAt, nowTs) {
  const d = cancelDeadlines(startAt);
  const at = (ts) => `${ts.slice(11, 16)} ${dayLabel(ts.slice(0, 10))}`;
  const now = vnToMs(nowTs);
  const { percent } = refundFor({ startAt, price: 0, paid: false }, nowTs);
  const steps = [];
  if (vnToMs(d.full) > now) steps.push(`<div class="step"><b>100%</b><span>nếu hủy trước <b>${at(d.full)}</b></span></div>`);
  if (vnToMs(d.half) > now) steps.push(`<div class="step"><b>50%</b><span>nếu hủy trước <b>${at(d.half)}</b>${vnToMs(d.full) <= now ? ' (mốc 100% đã qua)' : ''}</span></div>`);
  steps.push(`<div class="step"><b>0%</b><span>${vnToMs(d.half) > now ? 'nếu hủy sau đó' : 'mốc hoàn 100% và 50% đều đã qua, hủy bây giờ không được hoàn'} (tính vào độ tin cậy của bạn)</span></div>`);
  return `<p class="muted" style="font-size:var(--fs-sm);margin-bottom:8px">Nếu hủy ngay bây giờ: hoàn <b>${percent}%</b>.</p>${steps.join('')}`;
}
