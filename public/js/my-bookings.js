// Màn 6: booking của tôi (Sắp tới / Đã qua / Đang chờ slot), lượt giữ chỗ từ danh sách chờ.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, paymentBadge, redirectToLogin, statusBadge } from '/js/ui/page.js';
import { matchLabel, refundText } from '/js/ui/match.js';
import { dayLabel, mmss, money, secondsLeft, timeOf, vnToMs } from '/js/ui/format.js';

const TABS = [['upcoming', 'Sắp tới'], ['past', 'Đã qua'], ['waiting', 'Đang chờ slot'], ['transfers', 'Nhượng sân'], ['matches', 'Ghép trận']];
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
  return `<article class="card booking-item">
    <div class="top"><div><div class="when">${timeOf(b.startAt)}–${timeOf(b.endAt)} · ${dayLabel(b.startAt.slice(0, 10))}</div>
      <div class="where">${esc(b.venueName)} · ${esc(b.courtName)} (sân ${b.fieldType}) · <b class="num">${money(b.price)}</b></div></div>
      <div class="badges">${statusBadge(b.status)}${['pending', 'confirmed'].includes(b.status) ? paymentBadge(b.paymentStatus) : ''}${['open', 'claimed'].includes(b.transfer?.status) ? '<span class="badge badge-transferred">Đang nhượng</span>' : ''}${b.acquiredByTransfer ? '<span class="badge badge-pending">Nhận nhượng</span>' : ''}</div></div>
    ${pending ? `<span class="countdown" data-cd="${esc(b.expiresAt)}"></span>` : ''}
    <div class="actions"><a class="btn btn-sm${b.status === 'confirmed' && b.paymentStatus === 'unpaid' ? ' btn-lime' : ''}" href="/booking.html?id=${b.id}">${b.status === 'confirmed' && b.paymentStatus === 'unpaid' ? 'Xem mã QR thanh toán' : 'Xem chi tiết'}</a><span class="muted num" style="font-size:var(--fs-sm)">Mã ${esc(b.code)}</span></div>
  </article>`;
}

const TR_STATUS = { open: 'Đang nhượng', claimed: 'Đã có đội nhận', completed: 'Đã đổi chủ', cancelled: 'Đã đóng', expired: 'Hết hạn nhượng' };
const TR_CLASS = { open: 'transferred', claimed: 'pending', completed: 'confirmed', cancelled: 'cancelled', expired: 'expired' };

function transferCard(t) {
  const refund = t.status === 'completed' ? `<p><b>Hoàn tiền cho bạn:</b> ${t.refund?.status === 'done' ? 'Đã hoàn' : 'Chưa hoàn'} <span class="num">${money(t.refund?.amount ?? t.askPrice)}</span><span class="muted"> · đổi chủ và hoàn tiền là hai bước riêng</span></p>` : '';
  return `<article class="card booking-item">
    <div class="top"><div><div class="when">${timeOf(t.startAt)}–${timeOf(t.endAt)} · ${dayLabel(t.startAt.slice(0, 10))}</div>
      <div class="where">${esc(t.venueName)} · ${esc(t.courtName)} (sân ${t.fieldType}) · giá nhượng <b class="num">${money(t.askPrice)}</b></div></div>
      <div class="badges"><span class="badge badge-${TR_CLASS[t.status]}">${TR_STATUS[t.status]}</span></div></div>
    ${refund}
    <div class="actions"><a class="btn btn-sm" href="/transfer.html?id=${t.id}">Xem đăng nhượng</a><a class="btn btn-sm btn-ghost" href="/booking.html?id=${t.bookingId}">Mở booking</a></div>
  </article>`;
}

function matchCard(m) {
  const [label, cls] = matchLabel(m);
  const rf = m.yourPart?.refund ? `<p><b>Hoàn tiền cho đội bạn:</b> ${refundText(m.yourPart.refund)}<span class="muted"> · chưa hoàn nghĩa là chủ sân chưa chuyển lại</span></p>` : '';
  return `<article class="card booking-item">
    <div class="top"><div><div class="when">${timeOf(m.startAt)}–${timeOf(m.endAt)} · ${dayLabel(m.startAt.slice(0, 10))}</div>
      <div class="where">${esc(m.venueName)} · ${esc(m.courtName)} (sân ${m.fieldType}) · phần của bạn <b class="num">${money(m.yourPart?.amount ?? 0)}</b> · ${m.role === 'host' ? 'đội mở trận' : 'đội vào trận'}</div></div>
      <div class="badges"><span class="badge badge-${cls}">${label}</span></div></div>
    ${rf}
    <div class="actions"><a class="btn btn-sm" href="/match.html?id=${m.id}">Xem trận</a></div>
  </article>`;
}

function waitCard(w) {
  const offer = offerOf(w);
  return `<article class="card booking-item${offer ? ' offer' : ''}">
    <div class="top"><div><div class="when">${timeOf(w.startAt)}–${timeOf(w.endAt)} · ${dayLabel(w.startAt.slice(0, 10))}</div>
      <div class="where">${esc(w.venueName)} · ${esc(w.courtName)} (sân ${w.fieldType})</div></div>
      <div class="badges">${offer ? '<span class="badge badge-offered">Đang giữ cho bạn</span>' : '<span class="badge badge-pending">Đang chờ slot</span>'}</div></div>
    ${offer ? `<p><b>Slot vừa trống và đang giữ cho bạn.</b> <span class="countdown" data-cd="${esc(w.offerExpiresAt)}" data-pre="Còn "></span></p>` : '<p class="muted">Khi người đang giữ slot hủy, bạn sẽ được báo và có 10 phút để đặt trước người khác.</p>'}
    <div class="actions">${offer ? `<a class="btn btn-lime" href="${venueLink(w)}">Đặt ngay</a>` : `<a class="btn btn-sm" href="${venueLink(w)}">Xem sân</a>`}<button type="button" class="btn btn-sm btn-ghost" data-leave="${w.id}">Rời hàng chờ</button></div>
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
    upcoming: ['Chưa có booking sắp tới', 'Tìm một sân trống và đặt thử nhé.', '/venues.html', 'Tìm sân'],
    past: ['Chưa có booking đã qua', 'Các booking đã đá, đã hủy hoặc hết hạn sẽ nằm ở đây.', '/venues.html', 'Tìm sân'],
    transfers: ['Bạn chưa nhượng booking nào', 'Booking đã xác nhận mà bạn không đá được có thể nhượng lại cho đội khác thay vì hủy. Mở booking và chọn “Nhượng lại”.', '/transfers.html', 'Xem booking đang nhượng'],
    matches: ['Bạn chưa có trận ghép nào', 'Ở sân bật chế độ đủ hai đội, bạn mở trận hoặc vào một trận đang chờ đội thứ hai.', '/matches.html', 'Xem trận đang chờ'],
    waiting: ['Bạn không chờ slot nào', 'Ở slot đang có người giữ, bấm “Báo tôi khi trống” để xếp hàng chờ.', '/venues.html', 'Tìm sân'],
  }[tab];
  $('root').innerHTML = `
    <div class="page-head"><h1 class="h1">Booking của tôi</h1><p class="sub">Xin chào ${esc(getUser().fullName)}.</p></div>
    ${offers
      .map((w) => `<div class="card card-pad offer-banner stack" role="status"><div class="row"><span class="badge badge-offered">Đang giữ cho bạn</span><b>${esc(w.venueName)} · ${esc(w.courtName)} · ${timeOf(w.startAt)} ${dayLabel(w.startAt.slice(0, 10))}</b></div><p>Slot bạn đang chờ vừa trống. Đặt trước khi hết hạn: <span class="countdown" data-cd="${esc(w.offerExpiresAt)}" data-pre="còn "></span></p><div class="row"><a class="btn btn-lime" href="${venueLink(w)}">Đặt ngay</a></div></div>`)
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
    const pending = !el.dataset.pre;
    stops.push(countdown(el, secondsLeft(el.dataset.cd, meta.now), (n) => (n > 0 ? (pending ? `Chờ chủ sân duyệt · còn ${mmss(n)}` : `${pre}${mmss(n)}`) : 'Đã hết hạn'), load));
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
else if (getUser().role !== 'customer') $('root').innerHTML = '<div class="card empty"><p><b style="color:var(--text)">Trang này dành cho tài khoản khách</b><br>Chủ sân và admin xem booking trong khu quản lý của mình.</p></div>';
else await load();
