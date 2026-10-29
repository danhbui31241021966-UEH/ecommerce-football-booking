// Màn 5: chi tiết booking, QR thanh toán, hạn duyệt, hủy kèm số tiền hoàn, lịch sử.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, paymentBadge, redirectToLogin, statusBadge } from '/js/ui/page.js';
import { cancelDeadlines, dayLabel, mmss, money, refundFor, REFUND_LABEL, STATUS_LABEL, secondsLeft, shortTs, timeOf } from '/js/ui/format.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let b;
let meta;

const ACTION = {
  create: 'Tạo booking', approve: 'Chủ sân duyệt', reject: 'Chủ sân từ chối', cancel: 'Hủy booking', expire: 'Hết hạn chưa duyệt',
  paid: 'Xác nhận đã thanh toán', refund: 'Xác nhận đã hoàn tiền', completed: 'Đã đá xong', no_show: 'Ghi nhận bùng sân', attendance: 'Điểm danh',
};
const BY = { customer: 'bạn', owner: 'chủ sân', admin: 'quản trị viên' };

const at = (ts) => `${timeOf(ts)} ${dayLabel(ts.slice(0, 10))}`;
const canCancel = () => ['pending', 'confirmed'].includes(b.status) && secondsLeft(b.startAt, meta.now) > 0;

function policyHtml() {
  const d = cancelDeadlines(b.startAt);
  return `<div class="policy"><div class="step"><b>100%</b><span>nếu hủy trước <b>${at(d.full)}</b></span></div>
    <div class="step"><b>50%</b><span>nếu hủy trước <b>${at(d.half)}</b></span></div>
    <div class="step"><b>0%</b><span>nếu hủy sau đó</span></div></div>`;
}

function refundNote() {
  if (b.status !== 'cancelled' && b.status !== 'rejected' && b.status !== 'expired') return '';
  if (b.paymentStatus !== 'paid') return `<div class="refund-box">Booking này chưa thanh toán nên không phát sinh hoàn tiền.</div>`;
  return `<div class="refund-box"><b>${REFUND_LABEL[b.refundStatus] || ''}</b> · hoàn ${b.refundPercent}% = <b class="num">${money(b.refundAmount)}</b>. Chủ sân chuyển khoản lại cho bạn.</div>`;
}

function qrHtml(q) {
  const row = (k, v, copy) => `<div class="copy-row"><div><div class="k">${k}</div><div class="v">${esc(v)}</div></div>${copy ? `<button type="button" data-copy="${esc(copy)}" aria-label="Sao chép ${k.toLowerCase()}">Sao chép</button>` : ''}</div>`;
  return `<aside class="qr-card" aria-labelledby="qr-title">
    <div class="row"><span class="h3" id="qr-title">Chuyển khoản để giữ sân</span><span class="spacer"></span><span class="badge badge-unpaid">Chưa thanh toán</span></div>
    <img class="qr" alt="Mã VietQR chuyển khoản ${money(q.amount)}, nội dung ${esc(q.content)}" src="${esc(q.url)}" width="260" height="260">
    <p class="amount num">${money(q.amount)}</p>
    ${row('Ngân hàng', q.bankName)}
    ${row('Số tài khoản', q.account, q.account)}
    ${row('Chủ tài khoản', q.accountName)}
    ${row('Số tiền', String(q.amount), String(q.amount))}
    ${row('Nội dung', q.content, q.content)}
    <p style="font-size:12px;color:var(--on-dark-muted)">Tiền vào thẳng tài khoản chủ sân. Chủ sân xác nhận đã nhận tiền trên SânNhanh, SânNhanh không giữ tiền của bạn.</p>
  </aside>`;
}

function render() {
  const hasQr = !!b.paymentQr;
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
      <div class="stack">
        <div class="card card-pad stack">
          <div class="row"><h1 class="booking-code">${esc(b.code)}</h1><span class="spacer"></span>${statusBadge(b.status)}${paymentBadge(b.paymentStatus)}</div>
          ${pending ? `<div class="notice warn" role="status"><span class="countdown" id="cd"></span></div>` : ''}
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
        <div class="card card-pad stack">
          <h2 class="h3">Chính sách hủy</h2>
          ${policyHtml()}
          ${b.rulesSnapshot ? `<h2 class="h3" style="margin-top:var(--sp-4)">Nội quy sân</h2><p class="muted" style="font-size:var(--fs-sm)">${esc(b.rulesSnapshot)}</p>` : ''}
        </div>
        <div class="card card-pad">
          <h2 class="h3" style="margin-bottom:var(--sp-2)">Lịch sử trạng thái</h2>
          <ul class="history">${b.history
            .map((h) => `<li><time>${shortTs(h.createdAt)}</time><span><b>${esc(ACTION[h.action] || h.action)}</b>${h.toStatus ? ` → ${esc(STATUS_TEXT(h.toStatus))}` : ''}<small>${esc(h.actorName || '')}${h.note ? ` · ${esc(h.note)}` : ''}</small></span></li>`)
            .join('')}</ul>
        </div>
      </div>
      ${hasQr ? qrHtml(b.paymentQr) : ''}
    </div>`;
  document.title = `${b.code} – SânNhanh`;
  decorate();
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
  if (e.target.closest('[data-close]')) $('cancel-dialog').close();
});
$('do-cancel').addEventListener('click', doCancel);

await mountShell();
if (!getUser()) redirectToLogin();
else await load();
