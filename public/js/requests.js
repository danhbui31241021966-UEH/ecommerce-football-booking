// Nhu cầu của tôi: các nhu cầu đã đăng, số chào giá và trạng thái.
import { api } from '/js/api.js';
import { getUser, mountShell } from '/js/ui/shell.js';
import { $, decorate, esc, redirectToLogin } from '/js/ui/page.js';
import { money, shortTs } from '/js/ui/format.js';
import { budgetText, requestLabel, requestTitle, requestWhen } from '/js/ui/request.js';

function card(r) {
  const [label, cls] = requestLabel(r);
  const open = r.offers.filter((o) => o.status === 'open');
  const best = open.reduce((m, o) => Math.min(m, o.price), Infinity);
  const chosen = r.offers.find((o) => o.status === 'chosen');
  const line = r.status === 'chosen' && chosen
    ? `Đã chốt: <b>${esc(chosen.venueName)}</b> · ${esc(chosen.courtName)} lúc ${chosen.startAt.slice(11, 16)} với giá <b class="num">${money(chosen.price)}</b>.`
    : r.status === 'open'
      ? open.length ? `<b>${open.length} chào giá</b> đang chờ bạn chọn, rẻ nhất <b class="num">${money(best)}</b>. Nhận chào giá đến ${shortTs(r.closesAt)}.` : `Chưa có sân nào chào giá. Nhận chào giá đến ${shortTs(r.closesAt)}.`
      : esc(r.endReason || 'Nhu cầu đã kết thúc.');
  return `<article class="card booking-item">
    <div class="top"><div><div class="when">${esc(requestWhen(r))}</div><div class="where">${esc(requestTitle(r))} · ${esc(budgetText(r))}</div></div>
      <div class="badges"><span class="badge badge-${cls}">${label}</span></div></div>
    <p class="muted" style="font-size:var(--fs-sm)">${line}</p>
    <div class="actions"><a class="btn btn-sm ${r.status === 'open' && open.length ? 'btn-lime' : ''}" href="/request.html?id=${r.id}">${r.status === 'open' ? (open.length ? 'Xem và chọn chào giá' : 'Xem nhu cầu') : 'Xem chi tiết'}</a>${r.bookingId ? `<a class="btn btn-sm" href="/booking.html?id=${r.bookingId}">Mở booking</a>` : ''}</div>
  </article>`;
}

async function main() {
  await mountShell();
  if (!getUser()) return redirectToLogin();
  if (getUser().role !== 'customer') {
    $('root').innerHTML = '<div class="card empty"><p><b style="color:var(--text)">Chỉ tài khoản khách có nhu cầu</b></p></div>';
    return undefined;
  }
  try {
    const list = await api.myRequests();
    $('root').innerHTML = `
      <div class="page-head"><h1 class="h1">Nhu cầu của tôi</h1><p class="sub">Đăng quận, ngày, khung giờ và ngân sách; các sân phù hợp gửi chào giá để bạn chọn. Chào giá không giữ sân cho đến khi bạn chọn và đặt.</p></div>
      <p><a class="btn btn-lime" href="/request-new.html">Đăng nhu cầu mới</a></p>
      <div class="booking-list" style="margin-top:var(--sp-4)">${
        list.length
          ? list.map(card).join('')
          : '<div class="card empty"><div class="art" data-icon="calendar"></div><p><b style="color:var(--text)">Bạn chưa đăng nhu cầu nào</b><br>Không thấy giờ hợp ý ở trang tìm sân? Đăng nhu cầu để sân chào giá.</p></div>'
      }</div>`;
    decorate();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không tải được dữ liệu</b><br>${esc(e.message)}</p></div>`;
  }
  return undefined;
}
main();
