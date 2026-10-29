// Phần dùng chung của bốn màn chủ sân: khung trang, chọn cụm sân, định dạng, hộp thoại, thao tác booking.
import { mountShell, toast } from '/js/ui/shell.js';
import { icon } from '/js/ui/icons.js';
import { api } from '/js/api.js';
import { vnToMs, msToVn, secondsLeft } from '/js/ui/format.js';

export { toast, icon, api };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const money = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const p2 = (n) => String(n).padStart(2, '0');
// Thời điểm trong contract là giờ Việt Nam; đổi qua format.js để không phụ thuộc múi giờ máy.
// Giờ hiện tại lấy từ meta().now (mock có thể tua đồng hồ), không dùng giờ máy.
let clockOffset = 0;
export const nowMs = () => Date.now() + clockOffset;
export async function syncClock() {
  const m = await api.meta();
  if (m.now) clockOffset = vnToMs(m.now) - Date.now();
  return m;
}
export const todayStr = (plus = 0) => msToVn(nowMs() + plus * 86400000).slice(0, 10);
export const parseAt = (s) => new Date(vnToMs(s));
export const hhmm = (s) => String(s).slice(11, 16);
export const dm = (s) => `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}`;
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const dowOf = (dateStr) => DOW[new Date(vnToMs(dateStr) + 7 * 3600000).getUTCDay()];
export const dayLabel = (dateStr) => {
  if (dateStr === todayStr()) return 'Hôm nay';
  if (dateStr === todayStr(1)) return 'Mai';
  if (dateStr === todayStr(-1)) return 'Hôm qua';
  return `${dowOf(dateStr)} ${dm(dateStr)}`;
};
export const startsAt = (b) => parseAt(b.startAt);
export const hasStarted = (b) => startsAt(b).getTime() <= nowMs();

export const STATUS_LABEL = {
  pending: 'Chờ duyệt',
  confirmed: 'Đã xác nhận',
  rejected: 'Từ chối',
  cancelled: 'Đã hủy',
  expired: 'Hết hạn',
  completed: 'Đã đá',
  no_show: 'Bùng sân',
};
export const badge = (status, label = STATUS_LABEL[status]) => `<span class="badge badge-${status}">${esc(label)}</span>`;
export const payBadge = (b) =>
  ['confirmed', 'completed', 'no_show'].includes(b.status) || b.paymentStatus === 'paid'
    ? badge(b.paymentStatus, b.paymentStatus === 'paid' ? 'Đã thu tiền' : 'Chưa thu tiền')
    : '';
export const refundBadge = (b) =>
  b.refundStatus === 'pending'
    ? `<span class="badge badge-pending">Chờ hoàn ${money(b.refundAmount)}</span>`
    : b.refundStatus === 'done'
      ? `<span class="badge badge-paid">Đã hoàn ${money(b.refundAmount)}</span>`
      : '';

export function reliabilityHtml(r) {
  if (!r) return '<span class="rel rel-new">Khách mới, chưa có lịch sử</span>';
  const cls = r.restricted || r.violations >= r.maxViolations ? 'bad' : r.violations > 0 ? 'warn' : 'ok';
  const head = r.restricted ? 'Buộc chờ duyệt' : r.violations > 0 ? 'Cần lưu ý' : 'Tin cậy tốt';
  return `<span class="rel rel-${cls}"><b>${head}</b> · ${r.noShows} bùng, ${r.lateCancels} hủy muộn trong ${r.windowDays} ngày · ${r.completed} lần đã đá</span>`;
}

// ---------- khung trang ----------
export async function initPage() {
  let user = null;
  try {
    [{ user }] = await Promise.all([api.me(), syncClock()]);
  } catch {
    /* coi như chưa đăng nhập */
  }
  await mountShell();
  $$('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, 16)));
  if (user?.role !== 'owner') {
    $('#content').innerHTML = `<div class="empty"><p>Màn này dành cho chủ sân. ${user ? 'Tài khoản hiện tại không phải chủ sân.' : 'Bạn chưa đăng nhập.'}</p>
      ${api.proto ? '<button class="btn btn-primary" id="to-owner" type="button">Vào bằng tài khoản chủ sân demo</button>' : '<a class="btn btn-primary" href="/login.html">Đăng nhập</a>'}</div>`;
    const b = $('#to-owner');
    if (b)
      b.onclick = async () => {
        await api.proto.quickLogin('owner');
        location.reload();
      };
    return false;
  }
  return true;
}

const VENUE_KEY = 'sannhanh.ownerVenue';
export async function loadVenues() {
  const venues = await api.owner.venues();
  let id = Number(sessionStorage.getItem(VENUE_KEY));
  if (!venues.some((v) => v.id === id)) id = venues[0]?.id;
  return { venues, id };
}
export function rememberVenue(id) {
  sessionStorage.setItem(VENUE_KEY, String(id));
}
export function venueSelect(el, venues, id, onChange) {
  el.innerHTML = venues.map((v) => `<option value="${v.id}" ${v.id === id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  el.onchange = () => {
    rememberVenue(Number(el.value));
    onChange(Number(el.value));
  };
}

export function errorBox(target, err, retry) {
  target.innerHTML = `<div class="empty"><p>${esc(err.message || 'Không tải được dữ liệu')}</p>${
    retry ? '<button class="btn" type="button" data-retry>Thử lại</button>' : ''
  }</div>`;
  if (retry) target.querySelector('[data-retry]').onclick = retry;
}

// ---------- đếm ngược giữ chỗ ----------
let timer;
export function tickCountdowns(onExpire) {
  clearInterval(timer);
  const run = () => {
    let expired = false;
    $$('[data-expires]').forEach((el) => {
      const left = Math.floor((parseAt(el.dataset.expires) - nowMs()) / 1000);
      if (left <= 0) {
        el.textContent = 'Hết hạn giữ chỗ';
        el.classList.add('late');
        expired = true;
        return;
      }
      el.textContent = `Còn ${p2(Math.floor(left / 60))}:${p2(left % 60)}`;
      el.classList.toggle('soon', left < 180);
    });
    if (expired && onExpire) {
      clearInterval(timer);
      onExpire();
    }
  };
  run();
  timer = setInterval(run, 1000);
}
export const countdownHtml = (b) =>
  b.expiresAt ? `<span class="countdown-sm" data-expires="${esc(b.expiresAt)}">Còn --:--</span>` : '';

// ---------- hộp thoại ----------
// Trả về Promise<object|null>: null khi huỷ; ngược lại là giá trị các ô có name trong form.
export function dialog({ title, body, confirm = 'Xác nhận', danger = false, hideConfirm = false, extraFoot = '', onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="modal-head"><h2 class="h2">${esc(title)}</h2><span class="spacer"></span>
        <button class="icon-btn" type="button" data-close aria-label="Đóng" style="color:var(--text)">${icon('close')}</button></div>
      <div class="modal-body">${body}<p class="form-error" role="alert" hidden></p></div>
      <div class="modal-foot">${extraFoot}<button class="btn btn-ghost" type="button" data-close>Để sau</button>
        ${hideConfirm ? '' : `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(confirm)}</button>`}</div>
    </form>`;
    document.body.append(dlg);
    const form = dlg.firstElementChild;
    let result = null;
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const missing = [...form.querySelectorAll('[required]')].find((i) => !String(i.value).trim());
      if (missing) {
        const err = form.querySelector('.form-error');
        err.textContent = `Vui lòng nhập ${missing.dataset.label || 'thông tin còn thiếu'}.`;
        err.hidden = false;
        missing.focus();
        return;
      }
      result = data;
      dlg.close();
    });
    dlg.showModal();
    // Hộp thoại "action" cho phép trang chèn nút riêng (vd. Bỏ chặn) đóng hộp với giá trị tuỳ chọn.
    dlg.finish = (value) => {
      result = value;
      dlg.close();
    };
    onOpen?.(dlg);
    (form.querySelector('[autofocus],textarea,input,select') || form.querySelector('.btn-primary,.btn-danger'))?.focus();
  });
}

export async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message || 'Có lỗi xảy ra', { error: true });
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- thao tác booking (dùng ở Tổng quan, Lịch, Quản lý booking) ----------
export function actionsFor(b) {
  const a = [];
  if (b.status === 'pending') {
    a.push({ k: 'approve', label: 'Duyệt', cls: 'btn-lime' }, { k: 'reject', label: 'Từ chối', cls: 'btn-danger' });
  }
  if (b.status === 'confirmed') {
    if (b.paymentStatus === 'unpaid') a.push({ k: 'paid', label: 'Đã thu tiền', cls: 'btn-primary' });
    if (hasStarted(b)) {
      a.push({ k: 'completed', label: 'Đã đá', cls: 'btn' }, { k: 'no_show', label: 'Bùng sân', cls: 'btn-danger' });
    } else {
      a.push({ k: 'cancel', label: 'Hủy', cls: 'btn-danger' });
    }
  }
  if (b.status === 'completed' && b.paymentStatus === 'unpaid') a.push({ k: 'paid', label: 'Đã thu tiền', cls: 'btn-primary' });
  if (b.refundStatus === 'pending') a.push({ k: 'refund', label: `Đã hoàn ${money(b.refundAmount)}`, cls: 'btn-lime' });
  return a;
}
export const actionButtons = (b, size = 'btn-sm') =>
  actionsFor(b)
    .map((x) => `<button type="button" class="btn ${x.cls} ${size}" data-act="${x.k}" data-id="${b.id}">${esc(x.label)}</button>`)
    .join('');

const who = (b) => `<p class="dlg-ref"><b>${esc(b.customerName || 'Khách')}</b> · ${esc(b.courtName)} · ${hhmm(b.startAt)}–${hhmm(b.endAt)} ${dm(b.startAt)} · ${esc(b.code)}</p>`;
const noteField = (label, ph, req = false) =>
  `<div class="field"><label for="f-note">${label}</label><textarea class="textarea" id="f-note" name="note" rows="3" placeholder="${ph}" ${req ? `required data-label="${label.toLowerCase()}"` : ''}></textarea></div>`;

// Chạy một thao tác; trả về true nếu đã ghi xong (trang gọi lại tải dữ liệu).
export async function runAction(kind, b) {
  const call = (fn) => fn().then(() => true);
  switch (kind) {
    case 'approve': {
      const r = await dialog({
        title: 'Duyệt booking?',
        confirm: 'Duyệt',
        body: `${who(b)}<p>Khách sẽ nhận thông báo và mã VietQR để chuyển khoản ${money(b.price)}.</p>`,
      });
      return r && call(() => api.owner.approve(b.id));
    }
    case 'reject': {
      const r = await dialog({
        title: 'Từ chối booking',
        confirm: 'Từ chối',
        danger: true,
        body: `${who(b)}<p>Slot sẽ trống lại ngay. Lý do được gửi cho khách.</p>${noteField('Lý do', 'Ví dụ: sân bảo trì giờ này', true)}`,
      });
      return r && call(() => api.owner.reject(b.id, r.note.trim()));
    }
    case 'cancel': {
      const r = await dialog({
        title: 'Hủy booking',
        confirm: 'Hủy booking',
        danger: true,
        body: `${who(b)}<p>Chủ sân hủy thì khách được hoàn 100%${b.paymentStatus === 'paid' ? ` (${money(b.price)} đã thu)` : ', booking này chưa thu tiền nên không cần hoàn'}.</p>${noteField('Lý do', 'Gửi cho khách', true)}`,
      });
      return r && call(() => api.owner.cancel(b.id, r.note.trim()));
    }
    case 'paid': {
      const r = await dialog({
        title: 'Ghi nhận đã thu tiền',
        confirm: `Đã nhận ${money(b.price)}`,
        body: `${who(b)}<p>Chỉ ghi nhận sau khi tiền đã vào tài khoản của bạn. SânNhanh không giữ tiền.</p>${noteField('Ghi chú (không bắt buộc)', 'Ví dụ: nhận lúc 18:40, nội dung ' + b.code)}`,
      });
      return r && call(() => api.owner.markPaid(b.id, r.note.trim()));
    }
    case 'refund': {
      const r = await dialog({
        title: 'Ghi nhận đã hoàn tiền',
        confirm: `Đã hoàn ${money(b.refundAmount)}`,
        body: `${who(b)}<p>Hoàn <b>${money(b.refundAmount)}</b> (${b.refundPercent}%) cho khách bằng chuyển khoản, rồi ghi nhận ở đây.</p>${noteField('Ghi chú (không bắt buộc)', 'Ví dụ: mã giao dịch')}`,
      });
      return r && call(() => api.owner.markRefunded(b.id, r.note.trim()));
    }
    case 'completed':
      return call(() => api.owner.attendance(b.id, 'completed'));
    case 'no_show': {
      const r = await dialog({
        title: 'Đánh dấu bùng sân?',
        confirm: 'Đánh dấu bùng',
        danger: true,
        body: `${who(b)}<p>Khách không đến. Từ 2 lần bùng hoặc hủy muộn trong 60 ngày, mọi booking mới của khách này sẽ phải chờ bạn duyệt. Không hoàn tác được trên màn này.</p>`,
      });
      return r && call(() => api.owner.attendance(b.id, 'no_show'));
    }
  }
}

const DONE_TOAST = {
  approve: 'Đã duyệt, khách đã được báo',
  reject: 'Đã từ chối booking',
  cancel: 'Đã hủy booking, chờ bạn hoàn tiền nếu đã thu',
  paid: 'Đã ghi nhận thu tiền',
  refund: 'Đã ghi nhận hoàn tiền',
  completed: 'Đã ghi nhận: khách đã đá',
  no_show: 'Đã ghi nhận: khách bùng sân',
};

// Gắn một lần cho vùng chứa: mọi nút [data-act] bên trong chạy thao tác rồi gọi reload().
export function wireActions(root, getBooking, reload) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = getBooking(Number(btn.dataset.id));
    if (!b) return;
    guard(btn, async () => {
      const done = await runAction(btn.dataset.act, b);
      if (done) {
        toast(DONE_TOAST[btn.dataset.act]);
        await reload();
      }
    });
  });
}

// Danh sách chờ duyệt cần độ tin cậy: lấy chi tiết từng booking (list không có). Lỗi một dòng không làm hỏng cả danh sách.
export async function withDetail(bookings) {
  return Promise.all(
    bookings.map(async (b) => {
      try {
        const d = await api.booking(b.id);
        return { ...b, customerNote: d.customerNote, customerReliability: d.customerReliability, customerEmail: d.customerEmail };
      } catch {
        return b;
      }
    }),
  );
}


// Một dòng booking: thẻ trên mobile, hàng lưới trên desktop (CSS .bk-table). compact = ẩn cột phụ khi đặt trong cột hẹp.
export function bookingRow(b, { showDate = true } = {}) {
  const sale = b.discountPercent ? `<span class="tag-sale">-${b.discountPercent}%</span>` : '';
  const dateLine = showDate ? `<span class="d">${esc(dayLabel(b.startAt.slice(0, 10)))}</span>` : '';
  return `<li class="bk" data-id="${b.id}" data-status="${b.status}">
    <div class="bk-time"><span class="t">${hhmm(b.startAt)}–${hhmm(b.endAt)}</span>${dateLine}</div>
    <div class="bk-who"><b>${esc(b.customerName || 'Khách')}</b>${
      b.customerPhone ? ` <a class="phone" href="tel:${esc(b.customerPhone)}">${esc(b.customerPhone)}</a>` : ''
    }${b.customerNote ? `<p class="note">“${esc(b.customerNote)}”</p>` : ''}${
      b.status === 'pending' || b.customerReliability ? `<p>${reliabilityHtml(b.customerReliability)}</p>` : ''
    }</div>
    <div class="bk-court"><span>${esc(b.courtName)} · Sân ${esc(b.fieldType)}</span><span class="code">${esc(b.code)}</span></div>
    <div class="bk-state">${badge(b.status)}${payBadge(b)}${refundBadge(b)}${b.status === 'pending' ? countdownHtml(b) : ''}</div>
    <div class="bk-money"><span class="price">${money(b.price)}</span>${sale}</div>
    <div class="bk-actions">${actionButtons(b)}</div>
  </li>`;
}
