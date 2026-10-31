// Chi tiết một lần pass: người xem là đội đăng, đội nhận, hay khách khác. Đội nhận thấy mã QR sau khi bấm nhận.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, qrHtml, redirectToLogin } from '/js/ui/page.js';
import { dateOf, dayLabel, mmss, money, secondsLeft, shortTs, timeOf } from '/js/ui/format.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let t;
let meta;

const STATUS = {
  open: ['Đang pass', 'transferred'],
  claimed: ['Đã có đội nhận', 'pending'],
  completed: ['Đã sang đội khác', 'confirmed'],
  cancelled: ['Đã đóng', 'cancelled'],
  expired: ['Quá hạn pass', 'expired'],
};

function steps() {
  const s = (n, text, on) => `<li class="${on ? 'on' : ''}"><b>${n}</b><span>${text}</span></li>`;
  const claimed = ['claimed', 'completed'].includes(t.status);
  return `<ol class="transfer-steps">
    ${s(1, 'Đội đã đặt sân đăng pass, giá không cao hơn số tiền họ đã trả.', true)}
    ${s(2, 'Đội nhận bấm nhận sân và chuyển khoản cho chủ sân bằng mã QR.', claimed)}
    ${s(3, 'Chủ sân ghi nhận đã nhận tiền thì sân sang tên đội nhận. Chủ sân chuyển lại tiền cho đội pass.', t.status === 'completed')}
  </ol>`;
}

function action() {
  const user = getUser();
  if (t.status === 'open') {
    if (t.role === 'giver') return `<div class="notice"><div>Đây là sân của bạn. <a href="/booking.html?id=${t.bookingId}">Mở lịch đặt để rút đăng pass</a>.</div></div>`;
    if (!user) return `<a class="btn btn-lime" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Đăng nhập để nhận</a>`;
    if (user.role !== 'customer') return '<div class="notice">Chỉ tài khoản khách mới nhận pass được.</div>';
    if (t.priorityLocked) return `<div class="notice warn" role="status">Đang ưu tiên cho người chờ giờ này đến ${timeOf(t.priorityUntil)}. Quay lại sau giờ đó nếu vẫn còn.</div><button type="button" class="btn" disabled>Nhận sân này</button>`;
    return `<button type="button" class="btn btn-lime" id="claim">Nhận sân này · ${money(t.askPrice)}</button>
      <p class="muted" style="font-size:var(--fs-sm)">Bấm nhận để lấy mã QR. Bạn có ${meta.holdMinutes} phút để chuyển khoản. Chủ sân nhận được tiền thì sân mới là của bạn.</p>`;
  }
  if (t.status === 'claimed') {
    if (t.role === 'claimer') return `<div class="notice warn" role="status"><div><b>Chuyển ${money(t.askPrice)} cho chủ sân</b> bằng mã QR bên cạnh, giữ nguyên nội dung chuyển khoản. Bạn còn <span id="cd"></span> để chủ sân nhận tiền. Sân chỉ là của bạn sau khi chủ sân nhận tiền.</div></div>`;
    if (t.role === 'giver') return `<div class="notice" role="status"><div>Đã có đội nhận, đang chờ chủ sân nhận tiền của họ (còn <span id="cd"></span>). Lúc này sân vẫn là của bạn. <a href="/booking.html?id=${t.bookingId}">Mở lịch đặt</a></div></div>`;
    return '<div class="notice">Đã có đội khác nhận sân này.</div>';
  }
  if (t.status === 'completed') {
    if (t.role === 'claimer') return `<div class="notice"><div>Chủ sân đã nhận tiền. <a href="/booking.html?id=${t.newBookingId}">Mở lịch đặt của bạn</a>.</div></div>`;
    if (t.role === 'giver') return `<div class="notice"><div>Sân đã sang đội khác. Tiền bạn được nhận lại: <b>${t.refund?.status === 'done' ? 'Đã trả lại' : 'Chưa trả lại'}</b> ${money(t.refund?.amount || t.askPrice)}. <a href="/booking.html?id=${t.bookingId}">Mở lịch đặt</a></div></div>`;
    return '<div class="notice">Sân này đã sang đội khác.</div>';
  }
  return `<div class="notice">${esc(t.endReason || 'Đăng pass này không còn mở.')}</div><a class="btn btn-lime" href="/transfers.html">Xem sân đang pass</a>`;
}

function render() {
  const [label, cls] = STATUS[t.status] || [t.status, 'pending'];
  const qr = t.paymentQr;
  $('root').innerHTML = `
    <p class="crumb"><a href="/transfers.html">Pass sân</a> / #${t.id}</p>
    <div class="booking-layout${qr ? ' has-side' : ''}" style="margin-top:var(--sp-3)">
      <div class="area-sum"><div class="card card-pad stack">
        <div class="row"><h1 class="booking-code">${timeOf(t.startAt)}–${timeOf(t.endAt)} · ${dayLabel(dateOf(t.startAt))}</h1><span class="spacer"></span><span class="badge badge-${cls}">${label}</span></div>
        <dl class="kv">
          <div><dt>Sân</dt><dd><a href="/venue.html?id=${t.venueId}">${esc(t.venueName)}</a> · ${esc(t.courtName)} (sân ${t.fieldType})</dd></div>
          <div><dt>Giá thường</dt><dd class="num ${t.askPrice < t.originalPrice ? 'price-old' : ''}">${money(t.originalPrice)}</dd></div>
          <div class="total"><dt>Giá pass</dt><dd class="num">${money(t.askPrice)}${t.askPrice < t.originalPrice ? ` <span class="tag-sale">-${t.discountPercent}%</span>` : ''}</dd></div>
          <div><dt>Nhận sân trước</dt><dd class="num">${shortTs(t.closesAt)}</dd></div>
        </dl>
        ${action()}
      </div></div>
      ${qr ? qrHtml(qr, 'Chuyển khoản cho chủ sân') : ''}
      <div class="stack area-rest"><div class="card card-pad"><h2 class="h3" style="margin-bottom:var(--sp-2)">Pass sân hoạt động thế nào</h2>${steps()}</div></div>
    </div>`;
  document.title = `Pass ${timeOf(t.startAt)} – SânNhanh`;
  decorate();
  if (t.status === 'claimed' && $('cd')) countdown($('cd'), secondsLeft(t.claimExpiresAt, meta.now), (n) => (n > 0 ? mmss(n) : 'đã hết hạn'), load);
}

async function load() {
  try {
    [meta, t] = await Promise.all([api.meta(), api.transfer(id)]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy sân pass này' : 'Không tải được'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/transfers.html">Xem sân đang pass</a></div>`;
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
