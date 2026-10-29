import {
  initPage, api, qs, qsa, esc, money, fmtSlot, fmtDateTime, statusBadge, paymentBadge, refundLabel, showBookingDetail, toast,
} from './common.js';

await initPage({ roles: ['customer'] });
let tab = 'upcoming';
let bookings = [];

qsa('#tabs .tab').forEach((btn) => btn.addEventListener('click', () => {
  tab = btn.dataset.tab;
  qsa('#tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
  render();
}));

async function load() {
  try {
    bookings = await api('/bookings/mine');
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render() {
  const now = new Date();
  const isUpcoming = (b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.end_at.replace(' ', 'T')) > now;
  const list = bookings.filter((b) => (tab === 'upcoming' ? isUpcoming(b) : !isUpcoming(b)));
  if (tab === 'upcoming') list.reverse(); // gần nhất lên đầu
  qs('#booking-list').innerHTML = list.map((b) => `
    <div class="card booking-item">
      <div>
        <div class="row"><strong>${esc(b.code)}</strong> ${statusBadge(b.status)} ${paymentBadge(b.payment_status)}
          ${b.refund_status !== 'none' ? `<span class="status status-pending">${esc(refundLabel(b))}</span>` : ''}</div>
        <div><a href="/venue.html?id=${b.venue_id}">${esc(b.venue_name)}</a> – ${esc(b.court_name)} (sân ${esc(b.field_type)})</div>
        <div class="muted small">🕒 ${fmtSlot(b)} · 📞 ${esc(b.venue_phone)}
          ${b.status === 'pending' && b.expires_at ? ` · chờ duyệt đến ${fmtDateTime(b.expires_at)}` : ''}</div>
      </div>
      <div style="text-align:right"><div class="price">${money(b.price)}</div>
        <button class="btn btn-outline btn-sm" data-id="${b.id}">Chi tiết</button></div>
    </div>`).join('') || `<div class="card empty">${tab === 'upcoming'
      ? 'Bạn chưa có booking sắp tới. <a href="/venues.html">Tìm sân ngay</a>'
      : 'Chưa có lịch sử booking.'}</div>`;
  qsa('[data-id]').forEach((btn) => btn.addEventListener('click', () => showBookingDetail(btn.dataset.id, load)));
}

load();
// Cập nhật trạng thái booking chờ duyệt mà không cần tải lại trang.
setInterval(() => { if (!qs('#app-dialog')?.open) load(); }, 20_000);
