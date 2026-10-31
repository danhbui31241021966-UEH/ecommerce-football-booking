// Tiện ích chung cho các trang khách: thoát HTML, gắn icon, bắt buộc đăng nhập, nhãn trạng thái.
import { icon } from '/js/ui/icons.js';
import { getUser } from '/js/ui/shell.js';
import { api } from '/js/api.js';
import { cancelDeadlines, dayLabel, money, PAYMENT_LABEL, refundFor, STATUS_LABEL, vnToMs } from '/js/ui/format.js';

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
    : '<span class="tag-mode" data-icon="bolt">Đặt là chốt</span>';

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

/** Chính sách hủy theo mốc giờ còn hiệu lực tại nowTs; mốc đã qua không hiện, thay bằng dòng "hiện tại trả lại bao nhiêu". */
export function policyStepsHtml(startAt, nowTs) {
  const d = cancelDeadlines(startAt);
  const at = (ts) => `${ts.slice(11, 16)} ${dayLabel(ts.slice(0, 10))}`;
  const now = vnToMs(nowTs);
  const { percent } = refundFor({ startAt, price: 0, paid: false }, nowTs);
  const steps = [];
  if (vnToMs(d.full) > now) steps.push(`<div class="step"><b>100%</b><span>nếu hủy trước <b>${at(d.full)}</b></span></div>`);
  if (vnToMs(d.half) > now) steps.push(`<div class="step"><b>50%</b><span>nếu hủy trước <b>${at(d.half)}</b>${vnToMs(d.full) <= now ? ' (mốc 100% đã qua)' : ''}</span></div>`);
  steps.push(`<div class="step"><b>0%</b><span>${vnToMs(d.half) > now ? 'nếu hủy sau đó' : 'mốc trả lại 100% và 50% đều đã qua, hủy bây giờ không được trả lại'} (tính vào uy tín của bạn)</span></div>`);
  return `<p class="muted" style="font-size:var(--fs-sm);margin-bottom:8px">Nếu hủy ngay bây giờ: trả lại <b>${percent}%</b>.</p>${steps.join('')}`;
}

// Chỉ có ở prototype: thay cho việc chuyển tiền thật. Bản thật không có khối này, ngân hàng (SePay) báo về server.
function simulateHtml(q) {
  const d = `data-sim-content="${esc(q.content)}" data-sim-amount="${q.amount}" data-sim-account="${esc(q.account)}"`;
  return `<div class="sim-box" data-sim>
    <button type="button" class="btn btn-sm" data-sim-go="ok" ${d}>Tôi đã chuyển khoản (mô phỏng)</button>
    <details><summary>Thử chuyển sai</summary><div class="sim-wrong">
      <button type="button" class="btn btn-sm" data-sim-go="short" ${d}>Chuyển thiếu 10.000đ</button>
      <button type="button" class="btn btn-sm" data-sim-go="over" ${d}>Chuyển thừa 10.000đ</button>
      <button type="button" class="btn btn-sm" data-sim-go="nocode" ${d}>Ghi sai nội dung</button>
    </div></details>
    <p class="sim-note" role="status" data-sim-note>Đây là chế độ mô phỏng: vài giây sau, "ngân hàng" sẽ báo đã nhận tiền như SePay sẽ làm ở bản thật.</p>
  </div>`;
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-sim-go]');
  if (!btn) return;
  const kind = btn.dataset.simGo;
  const amount = Number(btn.dataset.simAmount) + (kind === 'short' ? -10000 : kind === 'over' ? 10000 : 0);
  const content = kind === 'nocode' ? 'chuyen tien san' : btn.dataset.simContent;
  const note = btn.closest('[data-sim]').querySelector('[data-sim-note]');
  btn.closest('[data-sim]').querySelectorAll('button').forEach((x) => { x.disabled = true; });
  try {
    const r = await api.proto.simulateTransfer({ content, amount, account: btn.dataset.simAccount });
    note.textContent = `Đang chờ ngân hàng báo có tiền (mô phỏng), khoảng ${Math.round(r.delayMs / 1000)} giây…`;
    setTimeout(() => location.reload(), r.delayMs + 400);
  } catch (err) {
    note.textContent = err.message;
  }
});

/** Khung mã QR dùng ở chi tiết lịch đặt và chi tiết pass: tiền vào thẳng tài khoản chủ sân. */
export function qrHtml(q, title = 'Chuyển khoản để giữ sân', note = 'Tiền vào thẳng tài khoản chủ sân. Ngân hàng báo đã nhận thì đơn tự chuyển sang "Đã nhận tiền" (nếu chưa tự được, chủ sân xác nhận tay). SânNhanh không giữ tiền của bạn.', { simulate = true } = {}) {
  const row = (k, v, copy) => `<div class="copy-row"><div><div class="k">${k}</div><div class="v">${esc(v)}</div></div>${copy ? `<button type="button" data-copy="${esc(copy)}" aria-label="Sao chép ${k.toLowerCase()}">Sao chép</button>` : ''}</div>`;
  return `<aside class="qr-card" aria-labelledby="qr-title">
    <div class="row"><span class="h3" id="qr-title">${esc(title)}</span></div>
    <img class="qr" alt="Mã QR chuyển khoản ${money(q.amount)}, nội dung ${esc(q.content)}" src="${esc(q.url)}" width="260" height="260">
    <p class="amount num">${money(q.amount)}</p>
    ${row('Ngân hàng', q.bankName)}
    ${row('Số tài khoản', q.account, q.account)}
    ${row('Chủ tài khoản', q.accountName)}
    ${row('Số tiền', String(q.amount), String(q.amount))}
    ${row('Nội dung', q.content, q.content)}
    <p style="font-size:12px;color:var(--on-dark-muted)">${esc(note)}</p>
    ${simulate && api.proto ? simulateHtml(q) : ''}
  </aside>`;
}
