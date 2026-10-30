// Nhượng sân: danh sách booking đang được nhượng lại. Giá nhượng không vượt giá gốc; tiền vẫn chuyển thẳng chủ sân.
import { api } from '/js/api.js';
import { getUser, mountShell } from '/js/ui/shell.js';
import { $, decorate, esc } from '/js/ui/page.js';
import { addDays, dateOf, dayLabel, money, timeOf } from '/js/ui/format.js';

let meta;
let list = [];
let date = new URLSearchParams(location.search).get('date') || '';

function card(t) {
  const mine = t.role === 'giver';
  return `<article class="card booking-item transfer-item">
    <div class="top"><div><div class="when">${timeOf(t.startAt)}–${timeOf(t.endAt)} · ${dayLabel(dateOf(t.startAt))}</div>
      <div class="where">${esc(t.venueName)} · ${esc(t.courtName)} (sân ${t.fieldType})</div></div>
      <div class="badges"><span class="badge badge-transferred">Đang nhượng</span>${t.priorityLocked ? `<span class="badge badge-pending">Ưu tiên người chờ đến ${timeOf(t.priorityUntil)}</span>` : ''}</div></div>
    <p class="transfer-price"><b class="num">${money(t.askPrice)}</b>${t.askPrice < t.originalPrice ? ` <s class="price-old num">${money(t.originalPrice)}</s> <span class="tag-sale">-${t.discountPercent}%</span>` : ' <span class="muted">giá gốc</span>'}</p>
    <p class="muted" style="font-size:var(--fs-sm)">Nhận trước ${timeOf(t.closesAt)}${mine ? ' · đây là booking của bạn' : ''}</p>
    <div class="actions"><a class="btn btn-sm${t.priorityLocked || mine ? '' : ' btn-lime'}" href="/transfer.html?id=${t.id}">${mine ? 'Xem đăng nhượng' : 'Xem và nhận'}</a></div>
  </article>`;
}

function render() {
  const today = meta.now.slice(0, 10);
  const chips = [['', 'Tất cả'], [today, 'Hôm nay'], [addDays(today, 1), 'Mai'], [addDays(today, 2), dayLabel(addDays(today, 2))]];
  const rows = list.filter((t) => !date || dateOf(t.startAt) === date);
  $('root').innerHTML = `
    <div class="page-head"><h1 class="h1">Nhượng sân</h1><p class="sub">Đội đã đặt và trả tiền nhưng bận sẽ nhượng lại giờ đá. Giá nhượng không cao hơn giá gốc, tiền vẫn chuyển thẳng cho chủ sân.</p></div>
    <div class="chips" role="group" aria-label="Lọc theo ngày">${chips.map(([d, label]) => `<button type="button" class="chip" data-date="${d}" aria-pressed="${date === d}">${esc(label)}</button>`).join('')}</div>
    <div class="booking-list" style="margin-top:var(--sp-4)">${
      rows.length
        ? rows.map(card).join('')
        : '<div class="card empty"><div class="art" data-icon="calendar"></div><p><b style="color:var(--text)">Chưa có booking nào đang nhượng</b><br>Khi một đội đăng nhượng, giờ đá sẽ hiện ở đây. Bạn cũng sẽ được báo nếu đang chờ slot đó.</p><a class="btn btn-lime" href="/venues.html">Tìm sân trống</a></div>'
    }</div>
    ${getUser()?.role === 'customer' ? '<p style="margin-top:var(--sp-5)"><a href="/my-bookings.html?tab=transfers">Xem các lần nhượng của tôi</a></p>' : ''}`;
  decorate();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-date]');
  if (!c) return;
  date = c.dataset.date;
  history.replaceState(null, '', date ? `/transfers.html?date=${date}` : '/transfers.html');
  render();
});

await mountShell();
try {
  [meta, list] = await Promise.all([api.meta(), api.transfers({})]);
  render();
} catch (e) {
  $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không tải được dữ liệu</b><br>${esc(e.message)}</p></div>`;
}
