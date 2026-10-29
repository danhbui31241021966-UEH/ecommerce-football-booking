// Tiện ích dùng chung cho mọi trang: gọi API, header, định dạng, dialog, chi tiết booking.

let csrfToken = '';
export let currentUser = null;

export const STATUS_LABEL = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  rejected: 'Bị từ chối',
  cancelled: 'Đã hủy',
  expired: 'Hết hạn',
};
export const ROLE_LABEL = { customer: 'Khách hàng', owner: 'Chủ sân', admin: 'Quản trị viên' };

// ---------- API ----------

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (data.csrfToken) csrfToken = data.csrfToken;
  if (!res.ok) {
    const err = new Error(data.error || `Lỗi ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Định dạng & escape ----------

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const money = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

const pad = (n) => String(n).padStart(2, '0');
export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 'YYYY-MM-DD' -> 'dd/mm/yyyy'
export const fmtDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
// 'YYYY-MM-DD HH:MM:SS' -> 'HH:MM dd/mm/yyyy'
export const fmtDateTime = (s) => (s ? `${s.slice(11, 16)} ${fmtDate(s)}` : '');
export const fmtSlot = (b) => `${b.start_at.slice(11, 16)}–${b.end_at.slice(11, 16)}, ${fmtDate(b.start_at)}`;

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const weekday = (dateStr) => WEEKDAYS[new Date(`${dateStr}T00:00:00`).getDay()];

export const statusBadge = (s) => `<span class="status status-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
export const paymentBadge = (s) =>
  `<span class="status status-${s === 'paid' ? 'paid' : 'unpaid'}">${s === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán'}</span>`;
export const refundLabel = (b) =>
  b.refund_status === 'pending' ? `Chưa hoàn ${money(b.refund_amount)}` : b.refund_status === 'done' ? `Đã hoàn ${money(b.refund_amount)}` : '';

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
export const params = () => new URLSearchParams(location.search);

// ---------- Toast & dialog ----------

export function toast(message, type = 'info') {
  let box = qs('#toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), 3500);
}

export function openDialog(title, html) {
  let dlg = qs('#app-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'app-dialog';
    dlg.innerHTML = `<div class="dialog-head"><h3></h3><button class="close-btn" aria-label="Đóng">×</button></div><div class="dialog-body"></div>`;
    qs('.close-btn', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
  }
  qs('h3', dlg).textContent = title;
  qs('.dialog-body', dlg).innerHTML = html;
  if (!dlg.open) dlg.showModal();
  return qs('.dialog-body', dlg);
}

export const closeDialog = () => qs('#app-dialog')?.close();

// Hỏi lý do/ghi chú bằng dialog thay cho prompt() để hoạt động ổn trên mobile.
export function askText(title, { label = 'Lý do', required = true, placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const body = openDialog(title, `
      <form class="stack">
        <div><label>${esc(label)}${required ? ' *' : ''}</label>
        <textarea rows="3" maxlength="255" placeholder="${esc(placeholder)}" ${required ? 'required' : ''}></textarea></div>
        <div class="row"><button class="btn" type="submit">Xác nhận</button>
        <button class="btn btn-outline" type="button" data-cancel>Hủy bỏ</button></div>
      </form>`);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    qs('form', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const value = qs('textarea', body).value.trim();
      closeDialog();
      finish(value);
    });
    qs('[data-cancel]', body).addEventListener('click', () => { closeDialog(); finish(null); });
    qs('#app-dialog').addEventListener('close', () => finish(null), { once: true });
  });
}

// ---------- Header / phiên đăng nhập ----------

export async function initPage({ roles } = {}) {
  try {
    const me = await api('/auth/me');
    currentUser = me.user;
  } catch {
    currentUser = null;
  }
  renderHeader();
  renderFooter();
  if (roles && (!currentUser || !roles.includes(currentUser.role))) {
    if (!currentUser) location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    else location.href = '/';
    throw new Error('redirect');
  }
  if (currentUser) {
    refreshNotifCount();
    setInterval(refreshNotifCount, 30_000);
  }
  return currentUser;
}

function renderHeader() {
  const header = document.createElement('header');
  header.className = 'site-header';
  const u = currentUser;
  const links = [`<a href="/venues.html">Tìm sân</a>`];
  if (u?.role === 'customer') links.push(`<a href="/my-bookings.html">Đơn của tôi</a>`);
  if (u?.role === 'owner') links.push(`<a href="/owner.html">Quản lý sân</a>`);
  if (u?.role === 'admin') links.push(`<a href="/admin.html">Quản trị</a>`);
  if (u) {
    links.push(`<a href="/notifications.html" class="bell">🔔 Thông báo<span class="badge-count hidden" id="notif-count"></span></a>`);
    links.push(`<span class="muted small">${esc(u.fullName)} · ${esc(ROLE_LABEL[u.role])}</span>`);
    links.push(`<a href="#" id="logout-link">Đăng xuất</a>`);
  } else {
    links.push(`<a href="/login.html">Đăng nhập</a>`, `<a class="btn btn-sm" href="/register.html">Đăng ký</a>`);
  }
  header.innerHTML = `<div class="container">
    <a class="logo" href="/">⚽ SânNhanh</a>
    <button class="nav-toggle" aria-label="Mở menu">☰</button>
    <nav class="nav">${links.join('')}</nav></div>`;
  document.body.prepend(header);
  qs('.nav-toggle', header).addEventListener('click', () => qs('.nav', header).classList.toggle('open'));
  qs('#logout-link', header)?.addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });
}

function renderFooter() {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="container row space-between">
    <span>SânNhanh – Đặt sân bóng đá mini 5/7 người tại TP.HCM</span>
    <span>Đồ án môn Phát triển ứng dụng TMĐT – Nhóm 8</span></div>`;
  document.body.append(footer);
}

async function refreshNotifCount() {
  try {
    const { unread } = await api('/notifications');
    const el = qs('#notif-count');
    if (!el) return;
    el.textContent = unread;
    el.classList.toggle('hidden', !unread);
  } catch { /* bỏ qua lỗi mạng tạm thời */ }
}

export function loginRedirect() {
  location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
}

// ---------- Chi tiết booking (dùng chung cho khách, chủ sân, admin) ----------

const ACTION_LABEL = {
  create: 'Tạo booking', approve: 'Chủ sân duyệt', reject: 'Chủ sân từ chối', cancel: 'Hủy booking',
  expire: 'Hết hạn giữ chỗ', paid: 'Ghi nhận đã thanh toán', refund: 'Ghi nhận đã hoàn tiền',
};

export function historyHtml(history) {
  return `<ul class="timeline">${history.map((h) => `
    <li><strong>${esc(ACTION_LABEL[h.action] || h.action)}</strong>
      ${h.to_status ? ` → ${esc(STATUS_LABEL[h.to_status])}` : ''}
      <div class="muted">${fmtDateTime(h.created_at)} · ${esc(h.actor_name || 'Hệ thống')}${h.note ? ` · ${esc(h.note)}` : ''}</div>
    </li>`).join('')}</ul>`;
}

/**
 * Mở dialog chi tiết booking với các nút thao tác phù hợp vai trò.
 * onChange được gọi sau mỗi thao tác thành công để trang tải lại dữ liệu.
 */
export async function showBookingDetail(id, onChange = () => {}) {
  let b;
  try {
    b = await api(`/bookings/${id}`);
  } catch (err) {
    return toast(err.message, 'error');
  }
  const role = currentUser.role;
  const base = role === 'owner' ? `/owner/bookings/${id}` : role === 'admin' ? `/admin/bookings/${id}` : `/bookings/${id}`;
  const actions = [];
  if (role === 'customer' && b.cancelPreview) actions.push(`<button class="btn btn-danger" data-act="customer-cancel">Hủy booking</button>`);
  if (role === 'owner' && b.status === 'pending') {
    actions.push(`<button class="btn" data-act="approve">Duyệt</button>`, `<button class="btn btn-outline" data-act="reject">Từ chối</button>`);
  }
  if (['owner', 'admin'].includes(role) && ['pending', 'confirmed'].includes(b.status)) {
    actions.push(`<button class="btn btn-danger" data-act="cancel">Hủy (hoàn 100%)</button>`);
  }
  if (['owner', 'admin'].includes(role) && b.status === 'confirmed' && b.payment_status === 'unpaid') {
    actions.push(`<button class="btn btn-outline" data-act="paid">Xác nhận đã nhận tiền</button>`);
  }
  if (['owner', 'admin'].includes(role) && b.refund_status === 'pending') {
    actions.push(`<button class="btn btn-outline" data-act="refund">Đánh dấu đã hoàn tiền</button>`);
  }

  const body = openDialog(`Booking ${b.code}`, `
    <div class="row" style="margin-bottom:12px">${statusBadge(b.status)} ${paymentBadge(b.payment_status)}
      ${b.refund_status !== 'none' ? `<span class="status status-pending">${esc(refundLabel(b))}</span>` : ''}</div>
    ${b.status === 'pending' && b.expires_at ? `<div class="alert alert-warn">Đang giữ chỗ chờ chủ sân duyệt đến ${fmtDateTime(b.expires_at)}.</div>` : ''}
    <dl class="kv">
      <dt>Sân</dt><dd>${esc(b.venue_name)} – ${esc(b.court_name)} (sân ${esc(b.field_type)})</dd>
      <dt>Địa chỉ</dt><dd>${esc(b.venue_address)}, ${esc(b.venue_district)}</dd>
      <dt>Khung giờ</dt><dd>${fmtSlot(b)}</dd>
      <dt>Giá đã chốt</dt><dd class="price">${money(b.price)}</dd>
      <dt>Khách hàng</dt><dd>${esc(b.customer_name)} · ${esc(b.customer_phone)}</dd>
      <dt>SĐT sân</dt><dd>${esc(b.venue_phone)}</dd>
      ${b.customer_note ? `<dt>Ghi chú</dt><dd>${esc(b.customer_note)}</dd>` : ''}
      ${b.cancel_reason ? `<dt>Lý do hủy/từ chối</dt><dd>${esc(b.cancel_reason)}</dd>` : ''}
      ${b.refund_percent !== null ? `<dt>Mức hoàn</dt><dd>${b.refund_percent}% – ${money(b.refund_amount)}${b.refund_note ? ` (${esc(b.refund_note)})` : ''}</dd>` : ''}
      <dt>Đặt lúc</dt><dd>${fmtDateTime(b.created_at)}</dd>
    </dl>
    ${b.payment_info_snapshot ? `<div class="alert alert-info" style="margin-top:12px"><strong>Hướng dẫn thanh toán:</strong> ${esc(b.payment_info_snapshot)}</div>` : ''}
    <details style="margin-top:8px"><summary>Điều kiện sử dụng & chính sách hủy (đã chốt khi đặt)</summary>
      <p class="small">${esc(b.rules_snapshot || '')}</p><p class="small">${esc(b.policy_snapshot || '')}</p></details>
    ${b.cancelPreview ? `<p class="small muted">Nếu hủy bây giờ: hoàn ${b.cancelPreview.percent}% (${money(b.cancelPreview.amount)}${b.payment_status === 'unpaid' ? ' – chưa thanh toán nên không phát sinh hoàn tiền' : ''}).</p>` : ''}
    <h4 style="margin:16px 0 6px">Lịch sử</h4>${historyHtml(b.history)}
    ${actions.length ? `<div class="row" style="margin-top:16px">${actions.join('')}</div>` : ''}`);

  qsa('[data-act]', body).forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    try {
      if (act === 'customer-cancel') {
        if (!confirm(`Hủy booking ${b.code}? Mức hoàn: ${b.cancelPreview.percent}% (${money(b.cancelPreview.amount)}).`)) return;
        await api(`${base}/cancel`, { method: 'POST' });
      } else if (act === 'approve') {
        await api(`${base}/approve`, { method: 'POST' });
      } else if (act === 'reject') {
        const reason = await askText('Từ chối booking', { required: false, label: 'Lý do (không bắt buộc)' });
        if (reason === null) return;
        await api(`${base}/reject`, { method: 'POST', body: { reason } });
      } else if (act === 'cancel') {
        const reason = await askText('Hủy booking – khách được hoàn 100%', { label: 'Lý do hủy' });
        if (!reason) return;
        await api(`${base}/cancel`, { method: 'POST', body: { reason } });
      } else if (act === 'paid') {
        if (!confirm('Xác nhận đã nhận đủ tiền cho booking này?')) return;
        await api(`${base}/paid`, { method: 'POST' });
      } else if (act === 'refund') {
        const note = await askText('Đánh dấu đã hoàn tiền', { required: false, label: 'Ghi chú (hình thức, mã giao dịch…)' });
        if (note === null) return;
        await api(`${base}/refund`, { method: 'POST', body: { note } });
      }
      toast('Đã cập nhật', 'success');
      closeDialog();
      onChange();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}
