import { initPage, api, qs, qsa, esc, fmtDateTime, showBookingDetail, toast } from './common.js';

await initPage({ roles: ['customer', 'owner', 'admin'] });

try {
  const { items } = await api('/notifications');
  qs('#notif-list').innerHTML = items.map((n) => `
    <div class="notif-item${n.is_read ? '' : ' unread'}">
      <div>${esc(n.message)}</div>
      <div class="muted small">${fmtDateTime(n.created_at)}
        ${n.booking_id ? ` · <a href="#" data-booking="${n.booking_id}">Xem booking</a>` : ''}</div>
    </div>`).join('') || '<p class="empty">Chưa có thông báo.</p>';
  qsa('[data-booking]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    showBookingDetail(a.dataset.booking);
  }));
  if (items.some((n) => !n.is_read)) {
    await api('/notifications/read-all', { method: 'POST' });
    qs('#notif-count')?.classList.add('hidden');
  }
} catch (err) {
  toast(err.message, 'error');
}
