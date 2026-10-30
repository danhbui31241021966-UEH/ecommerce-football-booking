// Chi tiết một lần nhượng: người xem là đội đăng, đội nhận, hay khách khác. Đội nhận thấy VietQR sau khi bấm nhận.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, qrHtml, redirectToLogin } from '/js/ui/page.js';
import { dateOf, dayLabel, mmss, money, secondsLeft, shortTs, timeOf } from '/js/ui/format.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let t;
let meta;

const STATUS = {
  open: ['Đang nhượng', 'transferred'],
  claimed: ['Đã có đội nhận', 'pending'],
  completed: ['Đã đổi chủ', 'confirmed'],
  cancelled: ['Đã đóng', 'cancelled'],
  expired: ['Hết hạn nhượng', 'expired'],
};

function steps() {
  const s = (n, text, on) => `<li class="${on ? 'on' : ''}"><b>${n}</b><span>${text}</span></li>`;
  const claimed = ['claimed', 'completed'].includes(t.status);
  return `<ol class="transfer-steps">
    ${s(1, 'Đội đặt đăng nhượng, giá không vượt giá gốc.', true)}
    ${s(2, 'Đội nhận bấm nhận và chuyển khoản thẳng cho chủ sân qua VietQR.', claimed)}
    ${s(3, 'Chủ sân xác nhận đã nhận tiền: booking chuyển sang đội nhận trong một bước, slot không bị trống.', t.status === 'completed')}
    ${s(4, 'Chủ sân chuyển lại tiền cho đội cũ và ghi nhận. Đây là bước riêng, đổi chủ chưa có nghĩa là đã hoàn.', t.refund?.status === 'done')}
  </ol>`;
}

function action() {
  const user = getUser();
  if (t.status === 'open') {
    if (t.role === 'giver') return `<div class="notice"><div>Đây là booking của bạn. <a href="/booking.html?id=${t.bookingId}">Mở booking để rút đăng nhượng</a>.</div></div>`;
    if (!user) return `<a class="btn btn-lime" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Đăng nhập để nhận</a>`;
    if (user.role !== 'customer') return '<div class="notice">Chỉ tài khoản khách nhận được booking nhượng.</div>';
    if (t.priorityLocked) return `<div class="notice warn" role="status">Đang ưu tiên cho người chờ slot này đến ${timeOf(t.priorityUntil)}. Quay lại sau giờ đó nếu vẫn còn.</div><button type="button" class="btn" disabled>Nhận booking này</button>`;
    return `<button type="button" class="btn btn-lime" id="claim">Nhận booking này · ${money(t.askPrice)}</button>
      <p class="muted" style="font-size:var(--fs-sm)">Bấm nhận để lấy mã VietQR. Bạn giữ chỗ ${meta.holdMinutes} phút để chuyển khoản; chủ sân xác nhận đã nhận tiền thì booking mới thuộc về bạn.</p>`;
  }
  if (t.status === 'claimed') {
    if (t.role === 'claimer') return `<div class="notice warn" role="status"><div><b>Chuyển ${money(t.askPrice)} cho chủ sân</b> theo mã bên cạnh, nội dung đúng như hiển thị. Còn <span id="cd"></span> để chủ sân xác nhận. Booking chưa thuộc về bạn cho đến khi chủ sân xác nhận.</div></div>`;
    if (t.role === 'giver') return `<div class="notice" role="status"><div>Đã có đội nhận, chờ chủ sân xác nhận đã nhận tiền (còn <span id="cd"></span>). Booking vẫn của bạn và chưa có khoản hoàn nào. <a href="/booking.html?id=${t.bookingId}">Mở booking</a></div></div>`;
    return '<div class="notice">Đã có đội khác nhận booking này.</div>';
  }
  if (t.status === 'completed') {
    if (t.role === 'claimer') return `<div class="notice"><div>Chủ sân đã xác nhận nhận tiền. <a href="/booking.html?id=${t.newBookingId}">Mở booking của bạn</a>.</div></div>`;
    if (t.role === 'giver') return `<div class="notice"><div>Booking đã chuyển cho đội khác. Khoản hoàn cho bạn: <b>${t.refund?.status === 'done' ? 'Đã hoàn' : 'Chưa hoàn'}</b> ${money(t.refund?.amount || t.askPrice)}. <a href="/booking.html?id=${t.bookingId}">Mở booking</a></div></div>`;
    return '<div class="notice">Booking này đã có chủ mới.</div>';
  }
  return `<div class="notice">${esc(t.endReason || 'Đăng nhượng này không còn mở.')}</div><a class="btn btn-lime" href="/transfers.html">Xem booking đang nhượng</a>`;
}

function render() {
  const [label, cls] = STATUS[t.status] || [t.status, 'pending'];
  const qr = t.paymentQr;
  $('root').innerHTML = `
    <p class="crumb"><a href="/transfers.html">Nhượng sân</a> / #${t.id}</p>
    <div class="booking-layout${qr ? ' has-side' : ''}" style="margin-top:var(--sp-3)">
      <div class="area-sum"><div class="card card-pad stack">
        <div class="row"><h1 class="booking-code">${timeOf(t.startAt)}–${timeOf(t.endAt)} · ${dayLabel(dateOf(t.startAt))}</h1><span class="spacer"></span><span class="badge badge-${cls}">${label}</span></div>
        <dl class="kv">
          <div><dt>Sân</dt><dd><a href="/venue.html?id=${t.venueId}">${esc(t.venueName)}</a> · ${esc(t.courtName)} (sân ${t.fieldType})</dd></div>
          <div><dt>Giá gốc</dt><dd class="num ${t.askPrice < t.originalPrice ? 'price-old' : ''}">${money(t.originalPrice)}</dd></div>
          <div class="total"><dt>Giá nhượng</dt><dd class="num">${money(t.askPrice)}${t.askPrice < t.originalPrice ? ` <span class="tag-sale">-${t.discountPercent}%</span>` : ''}</dd></div>
          <div><dt>Nhận trước</dt><dd class="num">${shortTs(t.closesAt)}</dd></div>
        </dl>
        ${action()}
      </div></div>
      ${qr ? qrHtml(qr, 'Chuyển khoản cho chủ sân') : ''}
      <div class="stack area-rest"><div class="card card-pad"><h2 class="h3" style="margin-bottom:var(--sp-2)">Cách nhượng hoạt động</h2>${steps()}</div></div>
    </div>`;
  document.title = `Nhượng ${timeOf(t.startAt)} – SânNhanh`;
  decorate();
  if (t.status === 'claimed' && $('cd')) countdown($('cd'), secondsLeft(t.claimExpiresAt, meta.now), (n) => (n > 0 ? mmss(n) : 'đã hết hạn'), load);
}

async function load() {
  try {
    [meta, t] = await Promise.all([api.meta(), api.transfer(id)]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy đăng nhượng' : 'Không tải được'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/transfers.html">Booking đang nhượng</a></div>`;
    decorate();
  }
}

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
    toast(`Đã sao chép ${copy.dataset.copy}`);
  }
  if (e.target.closest('#claim')) {
    e.target.closest('#claim').disabled = true;
    try {
      t = await api.claimTransfer(id);
      meta = await api.meta();
      render();
    } catch (err) {
      toast(err.message, { error: true });
      await load();
    }
  }
});

await mountShell();
await load();
