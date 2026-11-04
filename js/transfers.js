// Pass sân: danh sách lịch đặt đang được pass lại. Giá pass không vượt giá gốc; tiền vẫn chuyển thẳng chủ sân.
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
      <div class="badges"><span class="badge badge-transferred">Đang pass</span>${t.priorityLocked ? `<span class="badge badge-pending">Ưu tiên người đang chờ đến ${timeOf(t.priorityUntil)}</span>` : ''}</div></div>
    <p class="transfer-price"><b class="num">${money(t.askPrice)}</b>${t.askPrice < t.originalPrice ? ` <s class="price-old num">${money(t.originalPrice)}</s> <span class="tag-sale">-${t.discountPercent}%</span>` : ' <span class="muted">giá thường</span>'}</p>
    <p class="muted" style="font-size:var(--fs-sm)">Nhận sân trước ${timeOf(t.closesAt)}${mine ? ' · đây là sân của bạn' : ''}</p>
    <div class="actions"><a class="btn btn-sm${t.priorityLocked || mine ? '' : ' btn-lime'}" href="/transfer.html?id=${t.id}">${mine ? 'Xem đăng pass' : 'Xem và nhận'}</a></div>
  </article>`;
}

function render() {
  const today = meta.now.slice(0, 10);
  const chips = [['', 'Tất cả'], [today, 'Hôm nay'], [addDays(today, 1), 'Mai'], [addDays(today, 2), dayLabel(addDays(today, 2))]];
  const rows = list.filter((t) => !date || dateOf(t.startAt) === date);
  $('root').innerHTML = `
    <div class="page-head"><h1 class="h1">Pass sân</h1><p class="sub">Đội đã đặt sân mà bận không đá được sẽ pass lại cho đội khác. Bạn nhận sân thì chuyển khoản cho chủ sân qua mã QR.</p></div>
    <div class="chips" role="group" aria-label="Lọc theo ngày">${chips.map(([d, label]) => `<button type="button" class="chip" data-date="${d}" aria-pressed="${date === d}">${esc(label)}</button>`).join('')}</div>
    <div class="booking-list" style="margin-top:var(--sp-4)">${
      rows.length
        ? rows.map(card).join('')
        : '<div class="card empty"><div class="art" data-icon="calendar"></div><p><b style="color:var(--text)">Chưa có sân nào đang pass</b><br>Khi có đội pass sân, giờ đá sẽ hiện ở đây. Nếu bạn đang chờ giờ đó, bạn sẽ được báo.</p><a class="btn btn-lime" href="/products.html">Tìm sân trống</a></div>'
    }</div>
    ${getUser()?.role === 'customer' ? '<p style="margin-top:var(--sp-5)"><a href="/my-bookings.html?tab=transfers">Xem các lần pass của tôi</a></p>' : ''}`;
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
