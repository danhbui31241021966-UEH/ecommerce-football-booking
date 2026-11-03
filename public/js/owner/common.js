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
  pending: 'Chờ chủ sân đồng ý',
  confirmed: 'Đã xác nhận',
  rejected: 'Chủ sân từ chối',
  cancelled: 'Đã hủy',
  expired: 'Quá hạn',
  completed: 'Đã đá',
  no_show: 'Bùng sân',
  transferred: 'Đã pass',
  matching: 'Đang tìm đội đá cùng',
};
export const badge = (status, label = STATUS_LABEL[status]) => `<span class="badge badge-${status}">${esc(label)}</span>`;
export const sourceBadge = (b) => (b.source === 'phone' ? '<span class="badge badge-phone">Đặt qua điện thoại</span>' : '');
export const payBadge = (b) =>
  ['confirmed', 'completed', 'no_show'].includes(b.status) || b.paymentStatus === 'paid'
    ? badge(b.paymentStatus, b.paymentStatus === 'paid' ? 'Đã nhận tiền' : 'Chưa nhận tiền') + (b.paidVia === 'bank' ? '<span class="badge badge-phone">Ngân hàng báo' + (api.proto ? ' (mô phỏng)' : '') + '</span>' : '')
    : '';
export const refundBadge = (b) =>
  b.refundStatus === 'pending'
    ? `<span class="badge badge-pending">Chờ trả lại tiền ${money(b.refundAmount)}</span>`
    : b.refundStatus === 'done'
      ? `<span class="badge badge-paid">Đã trả lại ${money(b.refundAmount)}</span>`
      : '';

export function reliabilityHtml(r) {
  if (!r) return '<span class="rel rel-new">Khách mới, chưa có lịch sử</span>';
  const cls = r.restricted || r.violations >= r.maxViolations ? 'bad' : r.violations > 0 ? 'warn' : 'ok';
  const head = r.restricted ? 'Cần bạn đồng ý trước' : r.violations > 0 ? 'Cần lưu ý' : 'Uy tín tốt';
  return `<span class="rel rel-${cls}"><b>${head}</b> · ${r.noShows} bùng, ${r.lateCancels} hủy sát giờ trong ${r.windowDays} ngày · ${r.completed} lần đã đá</span>`;
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
      el.textContent = `${el.dataset.pre || ''}Còn ${p2(Math.floor(left / 60))}:${p2(left % 60)}`;
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
/** R3: đơn đã có sân chưa trả tiền còn hạn chuyển khoản (expiresAt của bước đang chờ), khác hạn chủ sân đồng ý của đơn pending. */
export const payByHtml = (b) =>
  b.status === 'confirmed' && b.paymentStatus === 'unpaid' && b.expiresAt
    ? `<span class="countdown-sm" data-expires="${esc(b.expiresAt)}" data-pre="Đang giữ sân · chuyển khoản trước ${esc(b.expiresAt.slice(11, 16))} · ">Đang giữ sân · chuyển khoản trước ${esc(b.expiresAt.slice(11, 16))} · Còn --:--</span>`
    : '';

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

// ---------- thao tác booking (dùng ở Tổng quan, Lịch, Quản lý lịch đặt) ----------
export function actionsFor(b) {
  const a = [];
  if (b.status === 'pending') {
    a.push({ k: 'approve', label: 'Đồng ý', cls: 'btn-lime' }, { k: 'reject', label: 'Từ chối', cls: 'btn-danger' });
  }
  if (b.status === 'confirmed') {
    if (b.paymentStatus === 'unpaid') a.push({ k: 'paid', label: 'Đã nhận tiền', cls: 'btn-primary' });
    if (b.source === 'phone') a.push({ k: 'edit', label: 'Sửa', cls: 'btn' });
    if (hasStarted(b)) {
      a.push({ k: 'completed', label: 'Đã đá', cls: 'btn' }, { k: 'no_show', label: 'Bùng sân', cls: 'btn-danger' });
    } else {
      a.push({ k: 'cancel', label: 'Hủy', cls: 'btn-danger' });
    }
  }
  if (b.status === 'completed' && b.paymentStatus === 'unpaid') a.push({ k: 'paid', label: 'Đã nhận tiền', cls: 'btn-primary' });
  if (b.refundStatus === 'pending' && !b.match) a.push({ k: 'refund', label: `Đã chuyển lại ${money(b.refundAmount)}`, cls: 'btn-lime' });
  return a;
}
export const actionButtons = (b, size = 'btn-sm') =>
  actionsFor(b)
    .map((x) => `<button type="button" class="btn ${x.cls} ${size}" data-act="${x.k}" data-id="${b.id}">${esc(x.label)}</button>`)
    .join('');

const who = (b) => `<p class="dlg-ref"><b>${esc(b.customerName || 'Khách')}</b> · ${esc(b.courtName)} · ${hhmm(b.startAt)}–${hhmm(b.endAt)} ${dm(b.startAt)} · ${esc(b.code)}</p>`;
const noteField = (label, ph, req = false) =>
  `<div class="field"><label for="f-note">${label}</label><textarea class="textarea" id="f-note" name="note" rows="3" placeholder="${ph}" ${req ? `required data-label="${label.toLowerCase()}"` : ''}></textarea></div>`;

// Hộp thoại có form tự gửi: lỗi từ server hiện ngay trong hộp, không đóng hộp, không mất những gì đã nhập.
function formDialog({ title, body, saveLabel, save, onOpen }) {
  return dialog({
    title,
    body,
    hideConfirm: true,
    extraFoot: `<button class="btn btn-primary" type="button" data-save>${esc(saveLabel)}</button>`,
    onOpen(dlg) {
      const form = dlg.querySelector('form');
      const btn = dlg.querySelector('[data-save]');
      const err = dlg.querySelector('.form-error');
      const run = async () => {
        err.hidden = true;
        btn.disabled = true;
        try {
          dlg.finish(await save(form));
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
          btn.disabled = false;
        }
      };
      btn.addEventListener('click', run);
      form.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); run(); }, true);
      onOpen?.(dlg, form);
    },
  });
}

const SLOT_WHY = { booked: 'đã có lịch đặt', held: 'đang chờ chủ sân đồng ý', blocked: 'đang bị chặn', past: 'đã qua', offered: 'giữ cho người đang chờ' };

// Chủ sân thêm lịch cho khách gọi điện/Zalo. Trả về lịch vừa tạo, hoặc null nếu đóng hộp.
export async function openAddBooking({ venues, venueId, date = todayStr(), courtId = null, start = '' }) {
  const venue = venues.find((v) => v.id === venueId);
  const courts = venue.courts.filter((c) => c.isActive);
  const cache = new Map();
  const scheduleOf = async (d) => {
    if (!cache.has(d)) cache.set(d, await api.owner.schedule(venue.id, d));
    return cache.get(d);
  };
  const body = `<p class="muted">Dùng khi khách gọi điện hoặc nhắn Zalo đặt sân. Lịch này giữ giờ như lịch đặt thật nên khách đặt trên web không đặt trùng được. GGO không tạo tài khoản và không nhắn tin cho khách.</p>
    <div class="field"><label for="pb-name">Tên khách</label><input class="input" id="pb-name" name="customerName" maxlength="80" autocomplete="off" placeholder="Ví dụ: Anh Tùng"></div>
    <div class="field"><label for="pb-phone">Số điện thoại (không bắt buộc)</label><input class="input" id="pb-phone" name="customerPhone" type="tel" inputmode="tel" autocomplete="off"></div>
    <div class="field"><label for="pb-date">Ngày</label><input class="input" id="pb-date" name="date" type="date" min="${todayStr()}" value="${esc(date)}"></div>
    <div class="field"><label for="pb-court">Sân</label><select class="select" id="pb-court" name="courtId">${courts.map((c) => `<option value="${c.id}" ${c.id === courtId ? 'selected' : ''}>${esc(c.name)} · sân ${esc(c.fieldType)} người</option>`).join('')}</select></div>
    <div class="field"><label for="pb-start">Giờ</label><select class="select" id="pb-start" name="start"><option value="">Đang tải giờ...</option></select><span class="hint" id="pb-slot-hint"></span></div>
    <div class="field"><label for="pb-price">Giá</label><input class="input" id="pb-price" name="price" type="number" inputmode="numeric" min="0" step="1000"><span class="hint">Mặc định là giá thường của giờ đó, bạn sửa được.</span></div>
    <fieldset class="field"><legend>Tiền</legend>
      <label class="check"><input type="radio" name="paid" value="0" checked> Chưa nhận tiền</label>
      <label class="check"><input type="radio" name="paid" value="1"> Đã nhận tiền</label></fieldset>
    <div class="field"><label for="pb-note">Ghi chú (không bắt buộc)</label><textarea class="textarea" id="pb-note" name="note" rows="2" maxlength="300" placeholder="Ví dụ: đá hằng tuần, mang theo áo bib"></textarea></div>`;
  return formDialog({
    title: 'Thêm lịch đặt',
    saveLabel: 'Thêm lịch đặt',
    body,
    async onOpen(dlg) {
      const el = (id) => dlg.querySelector(id);
      let priceTouched = false;
      el('#pb-price').addEventListener('input', () => { priceTouched = true; });
      const refresh = async () => {
        const sel = el('#pb-start');
        const keep = sel.value || start;
        try {
          const sc = await scheduleOf(el('#pb-date').value || todayStr());
          const court = sc.courts.find((c) => c.id === Number(el('#pb-court').value));
          sel.innerHTML = `<option value="">Chọn giờ</option>${court.slots
            .map((s) => {
              const why = s.teamMode && s.status === 'available' ? 'chỉ nhận ghép kèo' : s.status === 'available' ? '' : SLOT_WHY[s.status] || s.status;
              return `<option value="${s.start}" data-price="${s.basePrice}" ${why ? 'disabled' : ''} ${s.start === keep && !why ? 'selected' : ''}>${s.start}–${s.end}${why ? ` · ${why}` : ` · ${money(s.basePrice)}`}</option>`;
            })
            .join('')}`;
          el('#pb-slot-hint').textContent = court.slots.some((s) => s.status === 'available' && !s.teamMode) ? '' : 'Ngày này không còn giờ trống để thêm lịch.';
        } catch (e) {
          sel.innerHTML = '<option value="">Không tải được giờ</option>';
          el('#pb-slot-hint').textContent = e.message;
        }
        const opt = sel.selectedOptions[0];
        if (!priceTouched) el('#pb-price').value = opt?.dataset.price || '';
      };
      el('#pb-date').addEventListener('change', refresh);
      el('#pb-court').addEventListener('change', refresh);
      el('#pb-start').addEventListener('change', () => { if (!priceTouched) el('#pb-price').value = el('#pb-start').selectedOptions[0]?.dataset.price || ''; });
      await refresh();
    },
    async save(form) {
      const f = form.elements;
      const name = f.customerName.value.trim();
      if (!name) { f.customerName.focus(); throw new Error('Vui lòng nhập tên khách.'); }
      if (!f.start.value) throw new Error('Vui lòng chọn giờ.');
      return api.owner.addBooking({
        courtId: Number(f.courtId.value), date: f.date.value, start: f.start.value, customerName: name, customerPhone: f.customerPhone.value.trim(),
        price: f.price.value === '' ? undefined : Number(f.price.value), paid: f.paid.value === '1', note: f.note.value.trim(),
      });
    },
  });
}

function editPhoneBooking(b) {
  const paid = b.paymentStatus === 'paid';
  return formDialog({
    title: 'Sửa lịch đặt qua điện thoại',
    saveLabel: 'Lưu',
    body: `${who(b)}<p class="muted">Giờ và sân không sửa được. Cần đổi giờ thì hủy lịch này rồi thêm lịch mới.</p>
      <div class="field"><label for="pe-name">Tên khách</label><input class="input" id="pe-name" name="customerName" maxlength="80" value="${esc(b.customerName)}"></div>
      <div class="field"><label for="pe-phone">Số điện thoại (không bắt buộc)</label><input class="input" id="pe-phone" name="customerPhone" type="tel" inputmode="tel" value="${esc(b.customerPhone || '')}"></div>
      <div class="field"><label for="pe-price">Giá</label><input class="input" id="pe-price" name="price" type="number" inputmode="numeric" min="0" step="1000" value="${b.price}" ${paid ? 'disabled' : ''}>${paid ? '<span class="hint">Đã nhận tiền nên không đổi giá nữa.</span>' : ''}</div>
      <div class="field"><label for="pe-note">Ghi chú</label><textarea class="textarea" id="pe-note" name="note" rows="2" maxlength="300">${esc(b.customerNote || '')}</textarea></div>`,
    save(form) {
      const f = form.elements;
      if (!f.customerName.value.trim()) throw new Error('Vui lòng nhập tên khách.');
      return api.owner.updateBooking(b.id, { customerName: f.customerName.value.trim(), customerPhone: f.customerPhone.value.trim(), ...(paid ? {} : { price: Number(f.price.value) }), note: f.note.value.trim() });
    },
  }).then((r) => !!r);
}

// Chạy một thao tác; trả về true nếu đã ghi xong (trang gọi lại tải dữ liệu).
export async function runAction(kind, b) {
  const call = (fn) => fn().then(() => true);
  switch (kind) {
    case 'approve': {
      const r = await dialog({
        title: 'Đồng ý lịch đặt?',
        confirm: 'Đồng ý',
        body: `${who(b)}<p>Khách sẽ nhận thông báo và mã QR để chuyển ${money(b.price)} cho bạn.</p>`,
      });
      return r && call(() => api.owner.approve(b.id));
    }
    case 'reject': {
      const r = await dialog({
        title: 'Từ chối lịch đặt',
        confirm: 'Từ chối',
        danger: true,
        body: `${who(b)}<p>Giờ sẽ trống lại ngay. Lý do được gửi cho khách.</p>${noteField('Lý do', 'Ví dụ: sân bảo trì giờ này', true)}`,
      });
      return r && call(() => api.owner.reject(b.id, r.note.trim()));
    }
    case 'cancel': {
      const r = await dialog({
        title: 'Hủy đặt sân',
        confirm: 'Hủy đặt sân',
        danger: true,
        body: b.source === 'phone' ? `${who(b)}<p>Giờ sẽ trống lại ngay. Lịch này đặt qua điện thoại nên GGO không ghi trả lại tiền${b.paymentStatus === 'paid' ? `: nếu bạn đã nhận ${money(b.price)}, bạn tự trả lại cho khách ngoài web` : ''}.</p>${noteField('Lý do (không bắt buộc)', 'Ví dụ: khách báo đổi lịch')}` : `${who(b)}<p>Nếu bạn hủy, khách được trả lại 100%${b.paymentStatus === 'paid' ? ` (${money(b.price)} bạn đã nhận)` : '. Bạn chưa nhận tiền nên không có tiền để trả lại'}.</p>${noteField('Lý do', 'Gửi cho khách', true)}`,
      });
      return r && call(() => api.owner.cancel(b.id, (r.note || '').trim()));
    }
    case 'paid': {
      const r = await dialog({
        title: 'Ghi nhận đã nhận tiền',
        confirm: `Đã nhận ${money(b.price)}`,
        body: `${who(b)}<p>Chỉ bấm khi tiền đã vào tài khoản của bạn. GGO không giữ tiền.</p>${noteField('Ghi chú (không bắt buộc)', 'Ví dụ: nhận lúc 18:40, nội dung ' + b.code)}`,
      });
      return r && call(() => api.owner.markPaid(b.id, r.note.trim()));
    }
    case 'refund': {
      const r = await dialog({
        title: 'Ghi nhận đã trả lại tiền',
        confirm: `Đã chuyển lại ${money(b.refundAmount)}`,
        body: `${who(b)}<p>${b.status === 'transferred' ? `Sân đã pass cho đội khác. Chuyển lại <b>${money(b.refundAmount)}</b> (số tiền đội nhận đã trả) cho đội pass` : `Chuyển lại <b>${money(b.refundAmount)}</b> (${b.refundPercent}%) cho khách`} bằng chuyển khoản, rồi bấm ghi nhận ở đây.</p>${noteField('Ghi chú (không bắt buộc)', 'Ví dụ: mã giao dịch')}`,
      });
      return r && call(() => api.owner.markRefunded(b.id, r.note.trim()));
    }
    case 'edit':
      return editPhoneBooking(b);
    case 'completed':
      return call(() => api.owner.attendance(b.id, 'completed'));
    case 'no_show': {
      const r = await dialog({
        title: 'Đánh dấu bùng sân?',
        confirm: 'Đánh dấu bùng',
        danger: true,
        body: `${who(b)}<p>Khách không đến. Bùng sân hoặc hủy sát giờ 2 lần trong 60 ngày thì các lần đặt sau của khách này phải chờ bạn đồng ý. Bấm rồi không sửa lại được.</p>`,
      });
      return r && call(() => api.owner.attendance(b.id, 'no_show'));
    }
  }
}

const DONE_TOAST = {
  approve: 'Đã đồng ý, khách đã được báo',
  reject: 'Đã từ chối lịch đặt',
  cancel: 'Đã hủy lịch đặt. Nếu khách đã chuyển khoản, bạn cần chuyển lại tiền',
  paid: 'Đã ghi nhận: đã nhận tiền',
  refund: 'Đã ghi nhận trả lại tiền',
  completed: 'Đã ghi nhận: khách đã đá',
  no_show: 'Đã ghi nhận: khách bùng sân',
  edit: 'Đã lưu thông tin lịch đặt',
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

// Danh sách chờ chủ sân đồng ý cần uy tín: lấy chi tiết từng booking (list không có). Lỗi một dòng không làm hỏng cả danh sách.
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
      b.source !== 'phone' && (b.status === 'pending' || b.customerReliability) ? `<p>${reliabilityHtml(b.customerReliability)}</p>` : ''
    }</div>
    <div class="bk-court"><span>${esc(b.courtName)} · sân ${esc(b.fieldType)} người</span><span class="code">${esc(b.code)}</span></div>
    <div class="bk-state">${b.status === 'confirmed' ? badge(b.status, b.paymentStatus === 'paid' ? 'Đã có sân' : b.expiresAt ? `Đang giữ sân · chuyển khoản trước ${esc(b.expiresAt.slice(11, 16))}` : 'Đã có sân · chưa chuyển khoản') : badge(b.status)}${sourceBadge(b)}${payBadge(b)}${refundBadge(b)}${b.status === 'pending' ? countdownHtml(b) : payByHtml(b)}</div>
    <div class="bk-money"><span class="price">${money(b.price)}</span>${sale}</div>
    <div class="bk-actions">${actionButtons(b)}</div>
  </li>`;
}

// Chuyển giữa hai cách xem của "Lịch sân": lưới theo giờ và danh sách. Hai trang cùng một mục menu.
export function mountViewSwitch(active) {
  const keep = new URLSearchParams(location.search);
  const grid = new URLSearchParams(); if (keep.get('date')) grid.set('date', keep.get('date'));
  const el = document.createElement('div');
  el.className = 'view-switch';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Cách xem lịch sân');
  el.innerHTML = `<a href="/owner-schedule.html${grid.size ? `?${grid}` : ''}" ${active === 'grid' ? 'aria-current="page"' : ''}>Lưới theo giờ</a><a href="/owner-bookings.html" ${active === 'list' ? 'aria-current="page"' : ''}>Danh sách</a><a href="/owner-leagues.html" ${active === 'leagues' ? 'aria-current="page"' : ''}>Giải đấu</a>`;
  $('#content').insertAdjacentElement('beforebegin', el);
}
