// Màn 5: chi tiết booking, QR thanh toán, hạn duyệt, hủy kèm số tiền hoàn, lịch sử.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, paymentBadge, policyStepsHtml, qrHtml, redirectToLogin, statusBadge } from '/js/ui/page.js';
import { dayLabel, mmss, money, refundFor, REFUND_LABEL, STATUS_LABEL, secondsLeft, shortTs, timeOf, vnToMs, msToVn } from '/js/ui/format.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let b;
let meta;

const ACTION = {
  create: 'Tạo booking', approve: 'Chủ sân duyệt', reject: 'Chủ sân từ chối', cancel: 'Hủy booking', expire: 'Hết hạn chưa duyệt',
  paid: 'Xác nhận đã thanh toán', refund: 'Xác nhận đã hoàn tiền', attendance: 'Điểm danh',
  transfer_open: 'Đăng nhượng', transfer_withdraw: 'Đóng đăng nhượng', transfer_claim: 'Có đội nhận nhượng', transfer_release: 'Mở lại đăng nhượng',
  transfer_reject: 'Chủ sân từ chối đội nhận', transfer_expire: 'Hết hạn nhượng', transfer_done: 'Đã nhượng cho đội khác',
};
const BY = { customer: 'bạn', owner: 'chủ sân', admin: 'quản trị viên' };

const at = (ts) => `${timeOf(ts)} ${dayLabel(ts.slice(0, 10))}`;
const claimed = () => b.transfer?.status === 'claimed';
const canCancel = () => ['pending', 'confirmed'].includes(b.status) && secondsLeft(b.startAt, meta.now) > 0 && !claimed();

const policyHtml = () => `<div class="policy">${policyStepsHtml(b.startAt, meta.now)}</div>`;

function refundNote() {
  if (b.status === 'transferred') {
    const done = b.refundStatus === 'done';
    return `<div class="refund-box"><b>${done ? 'Đã hoàn' : 'Chưa hoàn'}</b> · khoản hoàn cho đội nhượng <b class="num">${money(b.refundAmount)}</b>. ${done ? 'Chủ sân đã chuyển khoản lại cho bạn.' : 'Booking đã chuyển cho đội khác nhưng chủ sân chưa chuyển khoản lại cho bạn; khi xong, chủ sân sẽ ghi nhận ở đây.'}</div>`;
  }
  if (b.status !== 'cancelled' && b.status !== 'rejected' && b.status !== 'expired') return '';
  if (b.paymentStatus !== 'paid') return `<div class="refund-box">Booking này chưa thanh toán nên không phát sinh hoàn tiền.</div>`;
  return `<div class="refund-box"><b>${REFUND_LABEL[b.refundStatus] || ''}</b> · hoàn ${b.refundPercent}% = <b class="num">${money(b.refundAmount)}</b>. Chủ sân chuyển khoản lại cho bạn.</div>`;
}

// Nhượng booking: chỉ booking đã xác nhận và đã thanh toán, đăng trước giờ đá transferCloseMinutes phút.
function transferBox() {
  const t = b.transfer;
  if (b.status === 'transferred') return `<div class="card card-pad stack"><h2 class="h3">Đã nhượng cho đội khác</h2><p class="muted" style="font-size:var(--fs-sm)">Chủ sân đã xác nhận nhận tiền của đội nhận, booking này không còn thuộc về bạn. Việc đổi chủ và việc hoàn tiền là hai bước riêng: xem khoản hoàn ở trên.</p></div>`;
  if (b.status !== 'confirmed') return '';
  if (t && ['open', 'claimed'].includes(t.status)) {
    const lines = t.status === 'claimed'
      ? `<div class="notice warn" role="status"><div><b>Đã có đội nhận.</b> Chờ chủ sân xác nhận đã nhận tiền của đội đó (còn <span id="tr-cd"></span>). Trước khi xác nhận, booking vẫn của bạn và chưa có khoản hoàn nào; bạn chưa hủy hay rút được lúc này.</div></div>`
      : `<div class="notice" role="status"><div><b>Đang đăng nhượng ${money(t.askPrice)}</b> (giá bạn đã trả ${money(b.price)}). Đội khác nhận được đến ${timeOf(t.closesAt)}. Không ai nhận thì booking vẫn của bạn.</div></div>`;
    return `<div class="card card-pad stack"><h2 class="h3">Nhượng booking</h2>${lines}<div class="row"><a class="btn btn-sm" href="/transfer.html?id=${t.id}">Xem trang nhượng</a>${t.status === 'open' ? '<button type="button" class="btn btn-sm btn-ghost" id="withdraw-transfer">Rút đăng nhượng</button>' : ''}</div></div>`;
  }
  const closes = secondsLeft(b.startAt, meta.now) - meta.transferCloseMinutes * 60;
  if (b.paymentStatus !== 'paid') return `<div class="card card-pad stack"><h2 class="h3">Nhượng booking</h2><p class="muted" style="font-size:var(--fs-sm)">Chỉ nhượng được booking đã thanh toán: khoản hoàn cho bạn lấy từ tiền đội nhận trả.</p></div>`;
  if (closes <= 0) return `<div class="card card-pad stack"><h2 class="h3">Nhượng booking</h2><p class="muted" style="font-size:var(--fs-sm)">Đã quá hạn nhượng (phải đăng trước giờ đá ${meta.transferCloseMinutes} phút).</p></div>`;
  return `<form class="card card-pad stack" id="transfer-form">
    <h2 class="h3">Bận không đá được? Nhượng lại</h2>
    <p class="muted" style="font-size:var(--fs-sm)">Đội khác nhận và chuyển tiền thẳng chủ sân; chủ sân xác nhận xong thì booking chuyển sang họ, bạn không bị tính hủy muộn hay bùng sân. Bạn được hoàn đúng số tiền đội nhận trả, chủ sân chuyển lại sau.</p>
    <div class="field"><label for="ask-price">Giá nhượng (không vượt ${money(b.price)})</label><input class="input num" id="ask-price" type="number" inputmode="numeric" min="1000" max="${b.price}" step="1000" value="${b.price}" required></div>
    <p class="dlg-error" id="transfer-error" role="alert" hidden></p>
    <div class="row"><button type="submit" class="btn btn-primary">Đăng nhượng</button><span class="muted" style="font-size:var(--fs-sm)">Hạn nhận: trước ${timeOf(msToVn(vnToMs(b.startAt) - meta.transferCloseMinutes * 60000))}</span></div>
  </form>`;
}

function render() {
  const hasQr = !!b.paymentQr;
  const pendingReason = b.history.find((h) => h.action === 'create')?.note || '';
  const pending = b.status === 'pending';
  const priceRows = b.discountPercent
    ? `<div><dt>Giá gốc</dt><dd class="num price-old">${money(b.basePrice)}</dd></div><div><dt>Giảm giờ chót</dt><dd class="num" style="color:var(--sale-text)">-${money(b.basePrice - b.price)} (${b.discountPercent}%)</dd></div>`
    : '';
  const cancelInfo = ['cancelled', 'rejected', 'expired'].includes(b.status)
    ? `<div><dt>${b.status === 'cancelled' ? 'Hủy bởi' : 'Kết thúc'}</dt><dd>${b.status === 'cancelled' ? BY[b.cancelledBy] || '' : STATUS_TEXT(b.status)}${b.cancelReason ? ` · ${esc(b.cancelReason)}` : ''}</dd></div>`
    : '';
  $('root').innerHTML = `
    <p class="crumb"><a href="/my-bookings.html">Booking của tôi</a> / ${esc(b.code)}</p>
    <div class="booking-layout${hasQr ? ' has-side' : ''}" style="margin-top:var(--sp-3)">
      <div class="area-sum">
        <div class="card card-pad stack">
          <div class="row"><h1 class="booking-code">${esc(b.code)}</h1><span class="spacer"></span>${statusBadge(b.status)}${paymentBadge(b.paymentStatus)}</div>
          ${pending ? `<div class="notice warn" role="status"><div><span class="countdown" id="cd"></span></div></div>${pendingReason ? `<p class="muted" style="font-size:var(--fs-sm)">${esc(pendingReason)}</p>` : ''}` : ''}
          ${b.status === 'confirmed' && b.paymentStatus === 'unpaid' && !hasQr ? '<div class="notice">Booking đã được xác nhận. Sân này chưa cấu hình VietQR, vui lòng liên hệ chủ sân để thanh toán.</div>' : ''}
          ${b.status === 'confirmed' && b.paymentStatus === 'paid' ? '<div class="notice">Chủ sân đã nhận tiền. Hẹn gặp bạn trên sân.</div>' : ''}
          <dl class="kv">
            <div><dt>Sân</dt><dd><a href="/venue.html?id=${b.venueId}">${esc(b.venueName)}</a> · ${esc(b.courtName)} (sân ${b.fieldType})</dd></div>
            <div><dt>Thời gian</dt><dd class="num">${timeOf(b.startAt)}–${timeOf(b.endAt)}, ${dayLabel(b.startAt.slice(0, 10))}</dd></div>
            ${priceRows}
            <div class="total"><dt>Tổng</dt><dd class="num">${money(b.price)}</dd></div>
            ${b.customerNote ? `<div><dt>Ghi chú</dt><dd>${esc(b.customerNote)}</dd></div>` : ''}
            ${cancelInfo}
          </dl>
          ${refundNote()}
          ${canCancel() ? `<div class="row"><button type="button" class="btn btn-danger" id="open-cancel">Hủy booking</button></div>` : ''}
        </div>
      </div>
      ${hasQr ? qrHtml(b.paymentQr) : ''}
      <div class="stack area-rest">
        ${transferBox()}
        ${canCancel() ? `<div class="card card-pad stack">
          <h2 class="h3">Chính sách hủy</h2>
          ${policyHtml()}
          ${b.rulesSnapshot ? `<h2 class="h3" style="margin-top:var(--sp-4)">Nội quy sân</h2><p class="muted" style="font-size:var(--fs-sm)">${esc(b.rulesSnapshot)}</p>` : ''}
        </div>` : ''}
        <div class="card card-pad">
          <h2 class="h3" style="margin-bottom:var(--sp-2)">Lịch sử trạng thái</h2>
          <ul class="history">${b.history
            .map((h) => `<li><time>${shortTs(h.createdAt)}</time><span><b>${esc(ACTION[h.action] || h.action)}</b>${h.toStatus ? ` → ${esc(STATUS_TEXT(h.toStatus))}` : ''}<small>${esc(h.actorName || '')}${h.note ? ` · ${esc(h.note)}` : ''}</small></span></li>`)
            .join('')}</ul>
        </div>
      </div>
    </div>`;
  document.title = `${b.code} – SânNhanh`;
  decorate();
  if (claimed()) countdown($('tr-cd'), secondsLeft(b.transfer.claimExpiresAt, meta.now), (n) => (n > 0 ? mmss(n) : 'hết hạn'), load);
  if (pending) {
    countdown($('cd'), secondsLeft(b.expiresAt, meta.now), (n) => (n > 0 ? `Chờ chủ sân duyệt · còn ${mmss(n)}` : 'Đã hết thời gian chờ duyệt'), load);
  }
}
const STATUS_TEXT = (s) => STATUS_LABEL[s] || s;

function openCancel() {
  const paid = b.paymentStatus === 'paid';
  const r = refundFor({ startAt: b.startAt, price: b.price, paid }, meta.now);
  const late = r.hoursLeft < 12;
  $('cancel-refund').innerHTML = `<p>Còn <b>${r.hoursLeft >= 1 ? `${Math.floor(r.hoursLeft)} giờ` : 'dưới 1 giờ'}</b> tới giờ đá nên được hoàn <b>${r.percent}%</b>.</p>
    <p style="margin-top:6px">${paid ? `Bạn đã thanh toán ${money(b.price)}, tiền hoàn là <b class="num">${money(r.amount)}</b>.` : `Bạn chưa thanh toán nên không có khoản nào cần hoàn (mức hoàn ${r.percent}% áp dụng trên số tiền đã trả).`}</p>
    ${late ? '<p style="margin-top:6px"><b>Hủy dưới 12 giờ</b> được tính là hủy muộn và cộng vào độ tin cậy của bạn (2 lần trong 60 ngày thì booking mới phải chờ chủ sân duyệt).</p>' : ''}`;
  $('cancel-error').hidden = true;
  $('do-cancel').disabled = false;
  $('cancel-dialog').showModal();
}

async function doCancel() {
  $('do-cancel').disabled = true;
  try {
    b = await api.cancelBooking(id, $('cancel-reason').value.trim());
    $('cancel-dialog').close();
    meta = await api.meta();
    render();
    toast(b.refundAmount ? `Đã hủy booking. Hoàn ${b.refundPercent}% = ${money(b.refundAmount)}.` : 'Đã hủy booking.');
  } catch (e) {
    $('cancel-error').textContent = e.message;
    $('cancel-error').hidden = false;
    $('do-cancel').disabled = false;
  }
}

async function load() {
  try {
    [meta, b] = await Promise.all([api.meta(), api.booking(id)]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy booking' : 'Không tải được booking'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/my-bookings.html">Booking của tôi</a></div>`;
    decorate();
  }
}

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
    toast(`Đã sao chép ${copy.dataset.copy}`);
  }
  if (e.target.closest('#open-cancel')) openCancel();
  if (e.target.closest('#withdraw-transfer')) {
    try {
      await api.withdrawTransfer(b.transfer.id);
      toast('Đã rút đăng nhượng.');
      await load();
    } catch (err) {
      toast(err.message, { error: true });
    }
  }
  if (e.target.closest('[data-close]')) $('cancel-dialog').close();
});
$('do-cancel').addEventListener('click', doCancel);
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'transfer-form') return;
  e.preventDefault();
  try {
    await api.offerTransfer(id, { askPrice: Number($('ask-price').value) });
    toast('Đã đăng nhượng. Bạn sẽ được báo khi có đội nhận.');
    await load();
  } catch (err) {
    $('transfer-error').textContent = err.message;
    $('transfer-error').hidden = false;
  }
});

await mountShell();
if (!getUser()) redirectToLogin();
else await load();
