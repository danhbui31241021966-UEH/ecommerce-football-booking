// Màn 6: lịch đặt của tôi (Sắp tới / Đã qua / Đang chờ giờ), lượt giữ chỗ từ danh sách chờ.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, paymentBadge, redirectToLogin, statusBadge } from '/js/ui/page.js';
import { matchLabel, refundText, stakeText } from '/js/ui/match.js';
import { dayLabel, mmss, money, secondsLeft, timeOf, vnToMs } from '/js/ui/format.js';

const TABS = [['upcoming', 'Sắp tới'], ['past', 'Đã qua'], ['waiting', 'Đang chờ giờ'], ['transfers', 'Pass sân'], ['matches', 'Ghép kèo']];
let meta;
let bookings = [];
let waits = [];
let transfers = [];
let matches = [];
let tab = new URLSearchParams(location.search).get('tab') || 'upcoming';
let stops = [];

const isUpcoming = (b) => ['pending', 'confirmed', 'matching'].includes(b.status) && vnToMs(b.endAt) > vnToMs(meta.now);
const offerOf = (w) => w.status === 'offered' && w.offerActive;
const venueLink = (w) => `/venue.html?id=${w.venueId}&date=${w.startAt.slice(0, 10)}&slot=${timeOf(w.startAt)}&court=${w.courtId}`;

function bookingCard(b) {
  const pending = b.status === 'pending';
  const awaitingPay = b.status === 'confirmed' && b.paymentStatus === 'unpaid' && !!b.expiresAt;
  return `<article class="card booking-item">
    <div class="top"><div><div class="when">${timeOf(b.startAt)}–${timeOf(b.endAt)} · ${dayLabel(b.startAt.slice(0, 10))}</div>
      <div class="where">${esc(b.venueName)} · ${esc(b.courtName)} (sân ${b.fieldType}) · <b class="num">${money(b.price)}</b></div></div>
      <div class="badges">${statusBadge(b.status)}${['pending', 'confirmed'].includes(b.status) ? paymentBadge(b.paymentStatus) : ''}${['open', 'claimed'].includes(b.transfer?.status) ? '<span class="badge badge-transferred">Đang pass</span>' : ''}${b.acquiredByTransfer ? '<span class="badge badge-pending">Nhận pass</span>' : ''}</div></div>
    ${pending ? `<span class="countdown" data-cd="${esc(b.expiresAt)}"></span>` : ''}
    ${awaitingPay ? `<span class="countdown" data-cd="${esc(b.expiresAt)}" data-pay-by="${esc(b.expiresAt.slice(11, 16))}"></span>` : ''}
    <div class="actions"><a class="btn btn-sm${b.status === 'confirmed' && b.paymentStatus === 'unpaid' ? ' btn-lime' : ''}" href="/booking.html?id=${b.id}">${b.status === 'confirmed' && b.paymentStatus === 'unpaid' ? 'Xem mã QR chuyển khoản' : 'Xem chi tiết'}</a><span class="muted num" style="font-size:var(--fs-sm)">Mã ${esc(b.code)}</span></div>
  </article>`;
}

const TR_STATUS = { open: 'Đang pass', claimed: 'Đã có đội nhận', completed: 'Đã sang đội khác', cancelled: 'Đã đóng', expired: 'Quá hạn pass' };
const TR_CLASS = { open: 'transferred', claimed: 'pending', completed: 'confirmed', cancelled: 'cancelled', expired: 'expired' };

function transferCard(t) {
  const refund = t.status === 'completed' ? `<p><b>Trả lại tiền cho bạn:</b> ${t.refund?.status === 'done' ? 'Đã trả lại' : 'Chưa trả lại'} <span class="num">${money(t.refund?.amount ?? t.askPrice)}</span><span class="muted"> · sân đã sang đội khác, tiền do chủ sân chuyển lại</span></p>` : '';
  return `<article class="card booking-item">
    <div class="top"><div><div class="when">${timeOf(t.startAt)}–${timeOf(t.endAt)} · ${dayLabel(t.startAt.slice(0, 10))}</div>
      <div class="where">${esc(t.venueName)} · ${esc(t.courtName)} (sân ${t.fieldType}) · giá pass <b class="num">${money(t.askPrice)}</b></div></div>
      <div class="badges"><span class="badge badge-${TR_CLASS[t.status]}">${TR_STATUS[t.status]}</span></div></div>
    ${refund}
    <div class="actions"><a class="btn btn-sm" href="/transfer.html?id=${t.id}">Xem đăng pass</a><a class="btn btn-sm btn-ghost" href="/booking.html?id=${t.bookingId}">Mở lịch đặt</a></div>
  </article>`;
}

function matchCard(m) {
  const [label, cls] = matchLabel(m);
  const rf = m.yourPart?.refund ? `<p><b>Trả lại tiền cho đội bạn:</b> ${refundText(m.yourPart.refund)}<span class="muted"> · chưa trả lại nghĩa là chủ sân chưa chuyển lại</span></p>` : '';
  return `<article class="card booking-item">
    <div class="top"><div><div class="when">${timeOf(m.startAt)}–${timeOf(m.endAt)} · ${dayLabel(m.startAt.slice(0, 10))}</div>
      <div class="where">${esc(m.venueName)} · ${esc(m.courtName)} (sân ${m.fieldType}) · kèo ${stakeText(m.loserPercent)} · trả trước <b class="num">${money(m.yourPart?.amount ?? 0)}</b> · ${m.role === 'host' ? 'đội mở kèo' : 'đội vào kèo'}</div></div>
      <div class="badges"><span class="badge badge-${cls}">${label}</span></div></div>
    ${rf}
    <div class="actions"><a class="btn btn-sm" href="/match.html?id=${m.id}">Xem kèo</a></div>
  </article>`;
}

function waitCard(w) {
  const offer = offerOf(w);
  return `<article class="card booking-item${offer ? ' offer' : ''}">
    <div class="top"><div><div class="when">${timeOf(w.startAt)}–${timeOf(w.endAt)} · ${dayLabel(w.startAt.slice(0, 10))}</div>
      <div class="where">${esc(w.venueName)} · ${esc(w.courtName)} (sân ${w.fieldType})</div></div>
      <div class="badges">${offer ? '<span class="badge badge-offered">Đang giữ cho bạn</span>' : '<span class="badge badge-pending">Đang chờ giờ</span>'}</div></div>
    ${offer ? `<p><b>Giờ bạn chờ vừa trống, đang giữ cho bạn.</b> <span class="countdown" data-cd="${esc(w.offerExpiresAt)}" data-pre="Còn "></span></p>` : '<p class="muted">Nếu người đang đặt giờ này hủy, bạn sẽ được báo và có 10 phút để đặt trước người khác.</p>'}
    <div class="actions">${offer ? `<a class="btn btn-lime" href="${venueLink(w)}">Đặt ngay</a>` : `<a class="btn btn-sm" href="${venueLink(w)}">Xem sân</a>`}<button type="button" class="btn btn-sm btn-ghost" data-leave="${w.id}">Thôi không chờ</button></div>
  </article>`;
}

function render() {
  stops.forEach((f) => f());
  stops = [];
  const upcoming = bookings.filter(isUpcoming).sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
  const past = bookings.filter((b) => !isUpcoming(b));
  const waiting = waits.filter((w) => ['waiting', 'offered'].includes(w.status));
  const offers = waiting.filter(offerOf);
  const counts = { upcoming: upcoming.length, past: past.length, waiting: waiting.length, transfers: transfers.length, matches: matches.length };
  const lists = { upcoming, past, waiting, transfers, matches };
  const empty = {
    upcoming: ['Chưa có lịch đặt sắp tới', 'Tìm một sân trống và đặt thử nhé.', '/venues.html', 'Tìm sân'],
    past: ['Chưa có lịch đặt đã qua', 'Các lịch đặt đã đá, đã hủy hoặc hết hạn sẽ nằm ở đây.', '/venues.html', 'Tìm sân'],
    transfers: ['Bạn chưa pass sân nào', 'Có sân rồi mà không đá được? Pass lại cho đội khác thay vì hủy. Mở lịch đặt đó rồi bấm “Đăng pass”.', '/transfers.html', 'Xem sân đang pass'],
    matches: ['Bạn chưa có kèo nào', 'Bạn có thể mở kèo mới hoặc vào một kèo đang cần thêm đội.', '/matches.html', 'Xem các kèo đang mở'],
    waiting: ['Bạn không chờ giờ nào', 'Ở giờ đang có người đặt, bấm “Báo tôi khi trống” để được báo khi giờ đó trống.', '/venues.html', 'Tìm sân'],
  }[tab];
  $('root').innerHTML = `
    <div class="page-head"><h1 class="h1">Lịch đặt của tôi</h1><p class="sub">Xin chào ${esc(getUser().fullName)}.</p></div>
    ${offers
      .map((w) => `<div class="card card-pad offer-banner stack" role="status"><div class="row"><span class="badge badge-offered">Đang giữ cho bạn</span><b>${esc(w.venueName)} · ${esc(w.courtName)} · ${timeOf(w.startAt)} ${dayLabel(w.startAt.slice(0, 10))}</b></div><p>Giờ bạn chờ vừa trống. Đặt ngay trước khi hết hạn: <span class="countdown" data-cd="${esc(w.offerExpiresAt)}" data-pre="còn "></span></p><div class="row"><a class="btn btn-lime" href="${venueLink(w)}">Đặt ngay</a></div></div>`)
      .join('')}
    <div class="tabs" role="tablist" style="margin-top:var(--sp-5)">${TABS.map(([k, label]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${label}${counts[k] ? `<span class="count">${counts[k]}</span>` : ''}</button>`).join('')}</div>
    <div class="booking-list" role="tabpanel">${
      lists[tab].length
        ? lists[tab].map(tab === 'waiting' ? waitCard : tab === 'transfers' ? transferCard : tab === 'matches' ? matchCard : bookingCard).join('')
        : `<div class="card empty"><div class="art" data-icon="calendar"></div><p><b style="color:var(--text)">${empty[0]}</b><br>${empty[1]}</p><a class="btn btn-lime" href="${empty[2]}">${empty[3]}</a></div>`
    }</div>`;
  decorate();
  document.querySelectorAll('[data-cd]').forEach((el) => {
    const pre = el.dataset.pre || '';
    const payBy = el.dataset.payBy; // hạn chuyển khoản của đơn đã có sân (R3); không có thì là đơn chờ chủ sân đồng ý hoặc lượt giữ cho người chờ
    const pending = !el.dataset.pre && !payBy;
    const label = (n) => (payBy ? `Chuyển khoản trước ${payBy} · còn ${mmss(n)}` : pending ? `Chờ chủ sân đồng ý · còn ${mmss(n)}` : `${pre}${mmss(n)}`);
    stops.push(countdown(el, secondsLeft(el.dataset.cd, meta.now), (n) => (n > 0 ? label(n) : 'Đã hết hạn'), load));
  });
}

async function load() {
  try {
    [meta, bookings, waits, transfers, matches] = await Promise.all([api.meta(), api.myBookings(), api.myWaitlist(), api.myTransfers(), api.myMatches()]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không tải được dữ liệu</b><br>${esc(e.message)}</p></div>`;
  }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) {
    tab = t.dataset.tab;
    history.replaceState(null, '', `/my-bookings.html?tab=${tab}`);
    render();
    return;
  }
  const leave = e.target.closest('[data-leave]');
  if (leave) {
    leave.disabled = true;
    try {
      await api.leaveWaitlist(Number(leave.dataset.leave));
      toast('Đã rời hàng chờ.');
      await load();
    } catch (err) {
      toast(err.message, { error: true });
      leave.disabled = false;
    }
  }
});

await mountShell();
if (!getUser()) redirectToLogin();
else if (getUser().role !== 'customer') $('root').innerHTML = '<div class="card empty"><p><b style="color:var(--text)">Trang này dành cho tài khoản khách</b><br>Chủ sân và admin xem lịch đặt trong khu quản lý của mình.</p></div>';
else await load();
