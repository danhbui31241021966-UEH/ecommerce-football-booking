// Màn 5: chi tiết booking, QR chuyển khoản, hạn đồng ý, hủy kèm số tiền trả lại, lịch sử.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, paymentBadge, policyStepsHtml, qrHtml, redirectToLogin, statusBadge } from '/js/ui/page.js';
import { matchLabel, partsHtml } from '/js/ui/match.js';
import { dayLabel, mmss, money, refundFor, REFUND_LABEL, STATUS_LABEL, secondsLeft, shortTs, timeOf, vnToMs, msToVn } from '/js/ui/format.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let b;
let meta;
let match = null;

const ACTION = {
  create: 'Khách đặt sân', approve: 'Chủ sân đồng ý', reject: 'Chủ sân từ chối', cancel: 'Hủy đặt sân', expire: 'Quá hạn, chủ sân chưa trả lời',
  paid: 'Ghi nhận đã chuyển khoản', bank_paid: 'Ngân hàng báo đã nhận tiền (mô phỏng)', bank_unmatched: 'Ngân hàng báo tiền nhưng chưa khớp đơn', bank_resolved: 'Chủ sân đã xử lý khoản tiền lệch', refund: 'Ghi nhận đã trả lại tiền', attendance: 'Ghi nhận đã đá hoặc bùng',
  match_part_paid: 'Đã nhận tiền của một đội', match_join: 'Có đội vào kèo', match_release: 'Đội vào kèo đã rút', match_confirm: 'Đủ hai đội, chốt sân', match_expire: 'Quá hạn, kèo không đủ đội', match_cancel: 'Hủy kèo', phone_create: 'Chủ sân thêm lịch đặt qua điện thoại', phone_update: 'Chủ sân sửa lịch đặt qua điện thoại', match_report: 'Đội báo kết quả', match_result: 'Chốt kết quả kèo', match_result_dispute: 'Cần chủ sân chốt kết quả', match_topup: 'Đội thắng đã nhận phần chênh', offer_accept: 'Đặt theo báo giá của sân',
  transfer_open: 'Đăng pass sân', transfer_withdraw: 'Rút đăng pass', transfer_claim: 'Có đội nhận pass', transfer_release: 'Mở lại đăng pass',
  transfer_reject: 'Chủ sân từ chối đội nhận', transfer_expire: 'Quá hạn pass', transfer_done: 'Đã pass cho đội khác',
};
const BY = { customer: 'bạn', owner: 'chủ sân', admin: 'quản trị viên' };

const at = (ts) => `${timeOf(ts)} ${dayLabel(ts.slice(0, 10))}`;
const claimed = () => b.transfer?.status === 'claimed';
const canCancel = () => !b.match && ['pending', 'confirmed'].includes(b.status) && secondsLeft(b.startAt, meta.now) > 0 && !claimed();

const policyHtml = () => `<div class="policy">${policyStepsHtml(b.startAt, meta.now)}</div>`;

function refundNote() {
  if (b.match) return '';
  if (b.status === 'transferred') {
    const done = b.refundStatus === 'done';
    return `<div class="refund-box"><b>${done ? 'Đã trả lại' : 'Chưa trả lại'}</b> · tiền bạn được nhận lại <b class="num">${money(b.refundAmount)}</b>. ${done ? 'Chủ sân đã chuyển lại tiền cho bạn.' : 'Sân đã sang đội khác, nhưng chủ sân chưa chuyển lại tiền cho bạn. Chuyển xong, chủ sân sẽ ghi nhận ở đây.'}</div>`;
  }
  if (b.status !== 'cancelled' && b.status !== 'rejected' && b.status !== 'expired') return '';
  if (b.paymentStatus !== 'paid') return `<div class="refund-box">Bạn chưa chuyển khoản nên không có tiền để trả lại.</div>`;
  return `<div class="refund-box"><b>${REFUND_LABEL[b.refundStatus] || ''}</b> · trả lại ${b.refundPercent}% = <b class="num">${money(b.refundAmount)}</b>. ${b.refundStatus === 'done' ? 'Chủ sân đã chuyển lại tiền cho bạn.' : 'Chủ sân sẽ chuyển lại tiền cho bạn.'}</div>`;
}

// Pass sân: chỉ lịch đặt đã xác nhận và đã chuyển khoản, đăng trước giờ đá transferCloseMinutes phút.
function matchBox() {
  if (!b.match || !match) return '';
  const [label, cls] = matchLabel(match);
  const rf = match.yourPart?.refund ? `<div class="refund-box"><b>${match.yourPart.refund.status === 'done' ? 'Đã trả lại' : 'Chưa trả lại'}</b> · tiền đội bạn được nhận lại <b class="num">${money(match.yourPart.refund.amount)}</b>.</div>` : '';
  return `<div class="card card-pad stack"><div class="row"><h2 class="h3">Ghép kèo</h2><span class="spacer"></span><span class="badge badge-${cls}">${label}</span></div>${partsHtml(match)}${rf}<div class="row"><a class="btn btn-sm" href="/match.html?id=${match.id}">Mở trang kèo</a></div></div>`;
}

function transferBox() {
  if (b.match) return '';
  const t = b.transfer;
  if (b.status === 'transferred') return `<div class="card card-pad stack"><h2 class="h3">Đã pass cho đội khác</h2><p class="muted" style="font-size:var(--fs-sm)">Sân này đã sang đội khác, không còn là của bạn. Tiền bạn được nhận lại do chủ sân chuyển, xem ở khung phía trên.</p></div>`;
  if (b.status !== 'confirmed') return '';
  if (t && ['open', 'claimed'].includes(t.status)) {
    const lines = t.status === 'claimed'
      ? `<div class="notice warn" role="status"><div><b>Đã có đội nhận.</b> Đang chờ chủ sân xác nhận đã nhận tiền của đội đó (còn <span id="tr-cd"></span>). Lúc này sân vẫn là của bạn, nhưng bạn chưa hủy hay rút được.</div></div>`
      : `<div class="notice" role="status"><div><b>Đang đăng pass ${money(t.askPrice)}</b> (giá bạn đã trả ${money(b.price)}). Đội khác nhận được đến ${timeOf(t.closesAt)}. Không ai nhận thì sân vẫn là của bạn.</div></div>`;
    return `<div class="card card-pad stack"><h2 class="h3">Pass sân</h2>${lines}<div class="row"><a class="btn btn-sm" href="/transfer.html?id=${t.id}">Xem trang pass</a>${t.status === 'open' ? '<button type="button" class="btn btn-sm btn-ghost" id="withdraw-transfer">Rút đăng pass</button>' : ''}</div></div>`;
  }
  const closes = secondsLeft(b.startAt, meta.now) - meta.transferCloseMinutes * 60;
  if (b.paymentStatus !== 'paid') return `<div class="card card-pad stack"><h2 class="h3">Pass sân</h2><p class="muted" style="font-size:var(--fs-sm)">Chỉ pass được sân đã chuyển khoản. Tiền bạn được nhận lại lấy từ tiền đội nhận trả.</p></div>`;
  if (closes <= 0) return `<div class="card card-pad stack"><h2 class="h3">Pass sân</h2><p class="muted" style="font-size:var(--fs-sm)">Đã hết thời gian pass sân (phải đăng trước giờ đá ${meta.transferCloseMinutes} phút).</p></div>`;
  return `<form class="card card-pad stack" id="transfer-form">
    <h2 class="h3">Bận không đá được? Pass lại</h2>
    <p class="muted" style="font-size:var(--fs-sm)">Đội khác nhận sân và chuyển khoản cho chủ sân. Chủ sân ghi nhận xong, sân sang tên họ, bạn không bị tính hủy sát giờ hay bùng sân. Bạn nhận lại đúng số tiền đội đó trả.</p>
    <div class="field"><label for="ask-price">Giá pass (không vượt ${money(b.price)})</label><input class="input num" id="ask-price" type="number" inputmode="numeric" min="1000" max="${b.price}" step="1000" value="${b.price}" required></div>
    <p class="dlg-error" id="transfer-error" role="alert" hidden></p>
    <div class="row"><button type="submit" class="btn btn-primary">Đăng pass</button><span class="muted" style="font-size:var(--fs-sm)">Hạn nhận: trước ${timeOf(msToVn(vnToMs(b.startAt) - meta.transferCloseMinutes * 60000))}</span></div>
  </form>`;
}

function render() {
  const hasQr = !!b.paymentQr;
  const pendingReason = b.history.find((h) => h.action === 'create')?.note || '';
  const pending = b.status === 'pending';
  const priceRows = b.discountPercent
    ? `<div><dt>Giá thường</dt><dd class="num price-old">${money(b.basePrice)}</dd></div><div><dt>Giảm giờ chót</dt><dd class="num" style="color:var(--sale-text)">-${money(b.basePrice - b.price)} (${b.discountPercent}%)</dd></div>`
    : '';
  const offerRow = b.fromOffer ? `<div><dt>Nguồn giá</dt><dd>Sân báo giá cho bạn${b.basePrice > b.price ? ` (giá thường ${money(b.basePrice)})` : ''}</dd></div>` : '';
  const cancelInfo = ['cancelled', 'rejected', 'expired'].includes(b.status)
    ? `<div><dt>${b.status === 'cancelled' ? 'Hủy bởi' : 'Kết thúc'}</dt><dd>${b.status === 'cancelled' ? BY[b.cancelledBy] || '' : STATUS_TEXT(b.status)}${b.cancelReason ? ` · ${esc(b.cancelReason)}` : ''}</dd></div>`
    : '';
  $('root').innerHTML = `
    <p class="crumb"><a href="/my-bookings.html">Lịch đặt của tôi</a> / ${esc(b.code)}</p>
    <div class="booking-layout${hasQr ? ' has-side' : ''}" style="margin-top:var(--sp-3)">
      <div class="area-sum">
        <div class="card card-pad stack">
          <div class="row"><h1 class="booking-code">${esc(b.code)}</h1><span class="spacer"></span>${statusBadge(b.status)}${paymentBadge(b.paymentStatus)}</div>
          ${pending ? `<div class="notice warn" role="status"><div><span class="countdown" id="cd"></span></div></div>${pendingReason ? `<p class="muted" style="font-size:var(--fs-sm)">${esc(pendingReason)}</p>` : ''}` : ''}
          ${b.status === 'confirmed' && b.paymentStatus === 'unpaid' && !hasQr ? '<div class="notice">Bạn đã có sân. Sân này chưa có mã QR, hãy nhắn chủ sân để biết cách chuyển khoản.</div>' : ''}
          ${b.status === 'confirmed' && b.paymentStatus === 'paid' ? `<div class="notice" role="status">${b.paidVia === 'bank' ? 'Ngân hàng báo đã nhận tiền (mô phỏng). Hẹn gặp bạn trên sân.' : 'Chủ sân đã nhận tiền. Hẹn gặp bạn trên sân.'}</div>` : ''}
          <dl class="kv">
            <div><dt>Sân</dt><dd><a href="/venue.html?id=${b.venueId}">${esc(b.venueName)}</a> · ${esc(b.courtName)} (sân ${b.fieldType})</dd></div>
            <div><dt>Thời gian</dt><dd class="num">${timeOf(b.startAt)}–${timeOf(b.endAt)}, ${dayLabel(b.startAt.slice(0, 10))}</dd></div>
            ${priceRows}${offerRow}
            <div class="total"><dt>Tổng</dt><dd class="num">${money(b.price)}</dd></div>
            ${b.customerNote ? `<div><dt>Ghi chú</dt><dd>${esc(b.customerNote)}</dd></div>` : ''}
            ${cancelInfo}
          </dl>
          ${refundNote()}
          ${canCancel() ? `<div class="row"><button type="button" class="btn btn-danger" id="open-cancel">Hủy đặt sân</button></div>` : ''}
        </div>
      </div>
      ${hasQr ? qrHtml(b.paymentQr) : ''}
      <div class="stack area-rest">
        ${matchBox()}
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
    countdown($('cd'), secondsLeft(b.expiresAt, meta.now), (n) => (n > 0 ? `Chờ chủ sân đồng ý · còn ${mmss(n)}` : 'Đã hết thời gian chờ chủ sân đồng ý'), load);
  }
}
const STATUS_TEXT = (s) => STATUS_LABEL[s] || s;

function openCancel() {
  const paid = b.paymentStatus === 'paid';
  const r = refundFor({ startAt: b.startAt, price: b.price, paid }, meta.now);
  const late = r.hoursLeft < 12;
  $('cancel-refund').innerHTML = `<p>Còn <b>${r.hoursLeft >= 1 ? `${Math.floor(r.hoursLeft)} giờ` : 'dưới 1 giờ'}</b> tới giờ đá nên được trả lại <b>${r.percent}%</b>.</p>
    <p style="margin-top:6px">${paid ? `Bạn đã chuyển khoản ${money(b.price)}, tiền trả lại là <b class="num">${money(r.amount)}</b>.` : `Bạn chưa chuyển khoản nên không có tiền để trả lại.`}</p>
    ${late ? '<p style="margin-top:6px">Hủy khi còn dưới 12 giờ bị tính là <b>hủy sát giờ</b>. Hủy sát giờ hoặc bùng sân 2 lần trong 60 ngày thì lần đặt sau phải chờ chủ sân đồng ý.</p>' : ''}`;
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
    toast(b.refundAmount ? `Đã hủy đặt sân. Bạn được trả lại ${b.refundPercent}% = ${money(b.refundAmount)}.` : 'Đã hủy đặt sân.');
  } catch (e) {
    $('cancel-error').textContent = e.message;
    $('cancel-error').hidden = false;
    $('do-cancel').disabled = false;
  }
}

async function load() {
  try {
    [meta, b] = await Promise.all([api.meta(), api.booking(id)]);
    match = b.match && getUser()?.role === 'customer' ? await api.match(b.match.id).catch(() => null) : null;
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy lịch đặt' : 'Không tải được lịch đặt'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/my-bookings.html">Lịch đặt của tôi</a></div>`;
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
      toast('Đã rút đăng pass.');
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
    toast('Đã đăng pass. Bạn sẽ được báo khi có đội nhận.');
    await load();
  } catch (err) {
    $('transfer-error').textContent = err.message;
    $('transfer-error').hidden = false;
  }
});

await mountShell();
if (!getUser()) redirectToLogin();
else await load();
