// Ghép kèo: trận đủ hai đội đang chờ đội thứ hai. Mỗi đội chuyển phần của mình thẳng cho chủ sân.
import { api } from '/js/api.js';
import { getUser, mountShell } from '/js/ui/shell.js';
import { $, decorate, esc } from '/js/ui/page.js';
import { addDays, dateOf, dayLabel, money, timeOf } from '/js/ui/format.js';

let meta;
let list = [];
let date = new URLSearchParams(location.search).get('date') || '';

function card(m) {
  return `<article class="card booking-item match-item">
    <div class="top"><div><div class="when">${timeOf(m.startAt)}–${timeOf(m.endAt)} · ${dayLabel(dateOf(m.startAt))}</div>
      <div class="where">${esc(m.venueName)} · ${esc(m.courtName)} (sân ${m.fieldType})</div></div>
      <div class="badges"><span class="badge badge-matching">Cần thêm một đội</span></div></div>
    <p class="transfer-price"><b class="num">${money(m.guestAmount)}</b> <span class="muted">phần của đội vào kèo · cả sân ${money(m.price)}</span></p>
    <p class="muted" style="font-size:var(--fs-sm)">Vào kèo trước ${timeOf(m.closesAt)}. Đội mở kèo đã chuyển khoản ${money(m.hostAmount)}.</p>
    <div class="actions"><a class="btn btn-sm btn-lime" href="/match.html?id=${m.id}">Xem và vào kèo</a></div>
  </article>`;
}

function render() {
  const today = meta.now.slice(0, 10);
  const chips = [['', 'Tất cả'], [today, 'Hôm nay'], [addDays(today, 1), 'Mai'], [addDays(today, 2), dayLabel(addDays(today, 2))]];
  const rows = list.filter((m) => !date || dateOf(m.startAt) === date);
  $('root').innerHTML = `
    <div class="page-head"><h1 class="h1">Ghép kèo</h1><p class="sub">Tìm đội đá cùng và chia đôi tiền sân. Chọn một kèo bên dưới để vào, hoặc tự mở kèo mới ở sân có nhãn “Ghép kèo”.</p></div>
    <div class="chips" role="group" aria-label="Lọc theo ngày">${chips.map(([d, label]) => `<button type="button" class="chip" data-date="${d}" aria-pressed="${date === d}">${esc(label)}</button>`).join('')}</div>
    <div class="booking-list" style="margin-top:var(--sp-4)">${
      rows.length
        ? rows.map(card).join('')
        : '<div class="card empty"><div class="art" data-icon="calendar"></div><p><b style="color:var(--text)">Chưa có kèo nào đang tìm đội</b><br>Bạn có thể tự mở kèo ở sân có nhãn “Đủ hai đội” trong lưới giờ.</p><a class="btn btn-lime" href="/venues.html">Tìm sân</a></div>'
    }</div>
    ${getUser()?.role === 'customer' ? '<p style="margin-top:var(--sp-5)"><a href="/my-bookings.html?tab=matches">Xem các kèo của tôi</a></p>' : ''}`;
  decorate();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-date]');
  if (!c) return;
  date = c.dataset.date;
  history.replaceState(null, '', date ? `/matches.html?date=${date}` : '/matches.html');
  render();
});

await mountShell();
try {
  [meta, list] = await Promise.all([api.meta(), api.matches({})]);
  render();
} catch (e) {
  $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không tải được dữ liệu</b><br>${esc(e.message)}</p></div>`;
}
