import {
  initPage, api, qs, qsa, esc, money, fmtSlot, fmtDateTime, statusBadge, paymentBadge, refundLabel,
  showBookingDetail, toast, STATUS_LABEL,
} from './common.js';

await initPage({ roles: ['admin'] });
let tab = 'owners';
const content = qs('#tab-content');

qsa('#tabs .tab').forEach((btn) => btn.addEventListener('click', () => {
  tab = btn.dataset.tab;
  qsa('#tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
  render();
}));

function render() {
  ({ owners: renderOwners, customers: () => renderUsers('customer'), bookings: renderBookings, logs: renderLogs })[tab]();
}

function userTable(users) {
  return `<div class="card table-wrap" style="padding:0"><table>
    <thead><tr><th>Họ tên</th><th>Email</th><th>SĐT</th><th>Ngày tạo</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${users.map((u) => `<tr>
      <td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td>${fmtDateTime(u.created_at)}</td>
      <td>${u.is_active ? '<span class="status status-confirmed">Hoạt động</span>' : '<span class="status status-cancelled">Đã khóa</span>'}</td>
      <td><button class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-outline'}" data-user="${u.id}" data-active="${u.is_active ? 0 : 1}">
        ${u.is_active ? 'Khóa' : 'Mở khóa'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Chưa có tài khoản.</td></tr>'}
    </tbody></table></div>`;
}

function bindLockButtons(reload) {
  qsa('[data-user]', content).forEach((btn) => btn.addEventListener('click', async () => {
    const lock = btn.dataset.active === '0';
    if (lock && !confirm('Khóa tài khoản này? Người dùng sẽ bị đăng xuất và không đăng nhập được.')) return;
    try {
      await api(`/admin/users/${btn.dataset.user}/active`, { method: 'POST', body: { active: !lock } });
      toast('Đã cập nhật tài khoản', 'success');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

// F14: cấp tài khoản chủ sân
async function renderOwners() {
  content.innerHTML = `
    <form class="card" id="owner-form">
      <h2>Cấp tài khoản chủ sân</h2>
      <div class="form-grid">
        <div><label>Họ tên *</label><input name="fullName" required></div>
        <div><label>Email *</label><input name="email" type="email" required></div>
        <div><label>SĐT *</label><input name="phone" required placeholder="0901234567"></div>
        <div><label>Mật khẩu ban đầu *</label><input name="password" type="text" minlength="8" required></div>
      </div>
      <button class="btn" style="margin-top:12px" type="submit">Tạo tài khoản</button>
    </form>
    <h2 style="margin-top:24px">Danh sách chủ sân</h2><div id="owner-list"><p class="muted">Đang tải…</p></div>`;
  qs('#owner-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/admin/owners', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Đã tạo tài khoản chủ sân', 'success');
      renderOwners();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  try {
    qs('#owner-list').innerHTML = userTable(await api('/admin/users?role=owner'));
    bindLockButtons(renderOwners);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renderUsers(role) {
  content.innerHTML = '<p class="muted">Đang tải…</p>';
  try {
    content.innerHTML = userTable(await api(`/admin/users?role=${role}`));
    bindLockButtons(() => renderUsers(role));
  } catch (err) {
    toast(err.message, 'error');
  }
}

// F15: Admin chỉ can thiệp khi có tranh chấp/sự cố; mọi thao tác yêu cầu lý do và được ghi lịch sử.
let bookingQuery = { q: '', status: '' };
async function renderBookings() {
  content.innerHTML = `
    <div class="alert alert-info">Chỉ can thiệp booking khi có tranh chấp, sự cố hoặc yêu cầu hỗ trợ. Mọi thao tác đều được lưu lịch sử.</div>
    <form class="row" id="admin-booking-filter">
      <input name="q" placeholder="Mã booking, tên/SĐT khách, tên sân" value="${esc(bookingQuery.q)}" style="width:auto;min-width:260px">
      <select name="status" style="width:auto"><option value="">Mọi trạng thái</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${bookingQuery.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="btn btn-sm" type="submit">Tìm</button>
    </form>
    <div class="card table-wrap" style="margin-top:12px;padding:0"><table>
      <thead><tr><th>Mã</th><th>Sân</th><th>Khách</th><th>Giờ</th><th>Giá</th><th>Trạng thái</th><th>Thanh toán</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="8" class="muted">Đang tải…</td></tr></tbody></table></div>`;
  qs('#admin-booking-filter').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    bookingQuery = { q: f.get('q').trim(), status: f.get('status') };
    renderBookings();
  });
  const query = new URLSearchParams(bookingQuery);
  for (const [k, v] of [...query]) if (!v) query.delete(k);
  try {
    const rows = await api(`/admin/bookings?${query}`);
    qs('#rows').innerHTML = rows.map((b) => `<tr>
      <td><strong>${esc(b.code)}</strong></td><td>${esc(b.venue_name)}<div class="muted small">${esc(b.court_name)}</div></td>
      <td>${esc(b.customer_name)}<div class="muted small">${esc(b.customer_phone)}</div></td>
      <td class="small">${fmtSlot(b)}</td><td>${money(b.price)}</td><td>${statusBadge(b.status)}</td>
      <td>${paymentBadge(b.payment_status)}${b.refund_status !== 'none' ? `<div class="small">${esc(refundLabel(b))}</div>` : ''}</td>
      <td><button class="btn btn-outline btn-sm" data-id="${b.id}">Chi tiết</button></td></tr>`).join('') ||
      '<tr><td colspan="8" class="empty">Không có booking phù hợp.</td></tr>';
    qsa('[data-id]', content).forEach((btn) => btn.addEventListener('click', () => showBookingDetail(btn.dataset.id, renderBookings)));
  } catch (err) {
    toast(err.message, 'error');
  }
}

const ACTION = { create: 'Tạo', approve: 'Duyệt', reject: 'Từ chối', cancel: 'Hủy', expire: 'Hết hạn', paid: 'Thanh toán', refund: 'Hoàn tiền' };
async function renderLogs() {
  content.innerHTML = '<p class="muted">Đang tải…</p>';
  try {
    const logs = await api('/admin/logs');
    content.innerHTML = `<div class="card table-wrap" style="padding:0"><table>
      <thead><tr><th>Thời gian</th><th>Booking</th><th>Hành động</th><th>Trạng thái</th><th>Người thực hiện</th><th>Ghi chú</th></tr></thead>
      <tbody>${logs.map((l) => `<tr>
        <td class="small">${fmtDateTime(l.created_at)}</td>
        <td><a href="#" data-id="${l.booking_id}">${esc(l.code)}</a></td>
        <td>${esc(ACTION[l.action] || l.action)}</td>
        <td class="small">${l.to_status ? `${esc(STATUS_LABEL[l.from_status] || '—')} → ${esc(STATUS_LABEL[l.to_status])}` : ''}</td>
        <td class="small">${esc(l.actor_name || 'Hệ thống')}</td><td class="small">${esc(l.note || '')}</td></tr>`).join('')}</tbody>
    </table></div>`;
    qsa('[data-id]', content).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      showBookingDetail(a.dataset.id, renderLogs);
    }));
  } catch (err) {
    toast(err.message, 'error');
  }
}

render();
