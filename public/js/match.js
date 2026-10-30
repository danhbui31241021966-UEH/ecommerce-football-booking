// Chi tiết một trận đủ hai đội: người xem là đội mở trận, đội vào trận hoặc khách khác. Mỗi đội thấy QR của phần mình.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, qrHtml } from '/js/ui/page.js';
import { dateOf, dayLabel, mmss, money, secondsLeft, shortTs, timeOf } from '/js/ui/format.js';
import { matchLabel, partsHtml, refundText } from '/js/ui/match.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let m;
let meta;
let confirmingWithdraw = false;

function steps() {
  const s = (n, text, on) => `<li class="${on ? 'on' : ''}"><b>${n}</b><span>${text}</span></li>`;
  return `<ol class="transfer-steps">
    ${s(1, 'Đội mở trận chọn giờ, cách chia tiền và hạn chót, rồi chuyển phần của mình thẳng cho chủ sân.', true)}
    ${s(2, 'Chủ sân xác nhận đã nhận phần của đội mở trận: trận hiện cho đội khác, slot được giữ đến hạn chót.', m.hostPaid)}
    ${s(3, 'Đội thứ hai vào trận và chuyển phần còn lại. Chủ sân xác nhận từng phần riêng.', m.guestPaid)}
    ${s(4, 'Đủ hai phần thì sân được chốt. Đến hạn mà thiếu một đội thì slot được nhả; tiền đội nào chủ sân đã nhận sẽ ở trạng thái <strong>chưa hoàn</strong> cho đến khi chủ sân chuyển lại và ghi nhận.', m.status === 'confirmed')}
  </ol>`;
}

function refundBox() {
  const r = m.yourPart?.refund;
  if (!r) return m.yourPart && ['expired', 'cancelled'].includes(m.status) ? '<div class="refund-box">Chủ sân chưa ghi nhận khoản nào của đội bạn nên không có khoản hoàn.</div>' : '';
  return `<div class="refund-box"><b>${r.status === 'done' ? 'Đã hoàn' : 'Chưa hoàn'}</b> · khoản hoàn cho đội bạn <b class="num">${money(r.amount)}</b>. ${r.status === 'done' ? 'Chủ sân đã chuyển khoản lại cho bạn.' : 'Chủ sân chưa chuyển khoản lại cho bạn; khi xong, chủ sân sẽ ghi nhận ở đây.'}</div>`;
}

function action() {
  const user = getUser();
  const link = `${location.origin}/match.html?id=${m.id}`;
  if (m.role === 'host') {
    if (m.status === 'open' && !m.hostPaid) return `<div class="notice warn" role="status"><div><b>Chuyển ${money(m.hostAmount)} cho chủ sân</b> theo mã bên cạnh, nội dung đúng như hiển thị. Còn <span id="cd"></span> để chủ sân xác nhận, sau đó slot được nhả. Trận chưa hiện cho đội khác cho đến khi chủ sân xác nhận.</div></div>${withdrawHtml()}`;
    if (m.status === 'open') return `<div class="notice" role="status"><div>Chủ sân đã nhận ${money(m.hostAmount)} của bạn. Slot được giữ đến ${shortTs(m.closesAt)} để chờ đội thứ hai. Gửi link này cho đội bạn muốn ghép: <button type="button" class="btn btn-sm" data-copy="${esc(link)}">Sao chép link</button></div></div>${withdrawHtml()}`;
    if (m.status === 'joined') return `<div class="notice" role="status"><div>Đã có đội vào trận. Trận chốt khi họ chuyển ${money(m.guestAmount)} và chủ sân xác nhận (còn <span id="cd"></span>). Chưa chốt thì chưa có gì thay đổi với phần bạn đã trả.</div></div>${withdrawHtml()}`;
    if (m.status === 'confirmed') return `<div class="notice" role="status"><div>Trận đã chốt: chủ sân đã nhận đủ hai phần. <a href="/booking.html?id=${m.bookingId}">Mở booking</a>.</div></div>`;
    return `<div class="notice"><div>${esc(m.endReason || 'Trận đã kết thúc.')}</div></div>${refundBox()}`;
  }
  if (m.role === 'guest') {
    if (m.status === 'joined') return `<div class="notice warn" role="status"><div><b>Chuyển ${money(m.guestAmount)} cho chủ sân</b> theo mã bên cạnh, nội dung đúng như hiển thị. Còn <span id="cd"></span> để chủ sân xác nhận. Trận chưa chốt cho đến khi chủ sân xác nhận phần của bạn.</div></div>`;
    if (m.status === 'confirmed') return '<div class="notice"><div>Trận đã chốt: chủ sân đã nhận đủ hai phần. Hẹn gặp bạn trên sân.</div></div>';
    return `<div class="notice"><div>${esc(m.endReason || 'Bạn không còn trong trận này.')}</div></div>${refundBox()}`;
  }
  if (m.role === 'staff') return '<div class="notice"><div>Quản lý trận này ở mục Quản lý booking.</div></div>';
  if (m.status === 'open' && m.joinable) {
    if (!user) return `<a class="btn btn-lime" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Đăng nhập để vào trận</a>`;
    if (user.role !== 'customer') return '<div class="notice"><div>Chỉ tài khoản khách vào được trận.</div></div>';
    return `<button type="button" class="btn btn-lime" id="join">Vào trận · trả ${money(m.guestAmount)}</button>
      <p class="muted" style="font-size:var(--fs-sm)">Bấm vào để lấy mã VietQR. Bạn giữ chỗ ${meta.holdMinutes} phút để chuyển ${money(m.guestAmount)} cho chủ sân; chủ sân xác nhận thì trận chốt. Mỗi trận chỉ nhận một đội thứ hai, đội vào trước được giữ chỗ.</p>`;
  }
  if (m.status === 'open') return '<div class="notice"><div>Trận chưa nhận đội thứ hai: chủ sân chưa xác nhận phần của đội mở trận.</div></div>';
  if (m.status === 'joined') return '<div class="notice"><div>Đã có đội khác vào trận này.</div></div>';
  if (m.status === 'confirmed') return '<div class="notice"><div>Trận này đã chốt đủ hai đội.</div></div>';
  return `<div class="notice"><div>${esc(m.endReason || 'Trận này không còn mở.')}</div></div><a class="btn btn-lime" href="/matches.html">Xem trận đang chờ</a>`;
}

function withdrawHtml() {
  const withGuest = m.status === 'joined';
  if (!confirmingWithdraw) return '<div class="row"><button type="button" class="btn btn-danger btn-sm" id="withdraw">Rút trận</button></div>';
  return `<div class="notice warn" role="alert"><div><b>Rút trận?</b> ${withGuest
    ? 'Đã có đội vào trận nên đây tính như hủy: phần bạn đã trả được hoàn theo chính sách hủy (có thể không hoàn đủ) và hủy dưới 12 giờ trước giờ đá tính là hủy muộn. Khoản hoàn là <b>chưa hoàn</b> cho đến khi chủ sân chuyển lại và ghi nhận.'
    : `Chưa có đội vào nên không mất phí và không bị tính hủy muộn. ${m.hostPaid ? 'Phần bạn đã trả được ghi vào hoàn tiền: <b>chưa hoàn</b> cho đến khi chủ sân chuyển lại và ghi nhận.' : 'Bạn chưa trả gì nên không có khoản hoàn.'}`} Slot được nhả ngay.</div></div>
    <div class="row"><button type="button" class="btn btn-danger btn-sm" id="withdraw-ok">Xác nhận rút trận</button><button type="button" class="btn btn-ghost btn-sm" id="withdraw-no">Giữ trận</button></div>`;
}

function render() {
  const [label, cls] = matchLabel(m);
  const qr = m.paymentQr;
  $('root').innerHTML = `
    <p class="crumb"><a href="/matches.html">Ghép trận</a> / #${m.id}</p>
    <div class="booking-layout${qr ? ' has-side' : ''}" style="margin-top:var(--sp-3)">
      <div class="area-sum"><div class="card card-pad stack">
        <div class="row"><h1 class="booking-code">${timeOf(m.startAt)}–${timeOf(m.endAt)} · ${dayLabel(dateOf(m.startAt))}</h1><span class="spacer"></span><span class="badge badge-${cls}">${label}</span></div>
        <dl class="kv">
          <div><dt>Sân</dt><dd><a href="/venue.html?id=${m.venueId}">${esc(m.venueName)}</a> · ${esc(m.courtName)} (sân ${m.fieldType})</dd></div>
          <div class="total"><dt>Giá sân</dt><dd class="num">${money(m.price)}</dd></div>
          <div><dt>Phần đội mở trận</dt><dd class="num">${money(m.hostAmount)} (${m.hostPercent}%)</dd></div>
          <div><dt>Phần đội vào trận</dt><dd class="num">${money(m.guestAmount)}</dd></div>
          <div><dt>Hạn chót đủ hai đội</dt><dd class="num">${shortTs(m.closesAt)}</dd></div>
        </dl>
        ${partsHtml(m)}
        ${action()}
      </div></div>
      ${qr ? qrHtml(qr, `Chuyển phần của đội bạn · ${money(qr.amount)}`) : ''}
      <div class="stack area-rest"><div class="card card-pad"><h2 class="h3" style="margin-bottom:var(--sp-2)">Cách ghép trận hoạt động</h2>${steps()}</div></div>
    </div>`;
  document.title = `Trận ${timeOf(m.startAt)} – SânNhanh`;
  decorate();
  const until = m.status === 'joined' ? m.guestHoldUntil : m.hostPayBy;
  if ($('cd') && until) countdown($('cd'), secondsLeft(until, meta.now), (n) => (n > 0 ? mmss(n) : 'đã hết hạn'), load);
}

async function load() {
  try {
    [meta, m] = await Promise.all([api.meta(), api.match(id)]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy trận' : 'Không tải được'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/matches.html">Xem trận đang chờ</a></div>`;
    decorate();
  }
}

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
    toast('Đã sao chép link trận');
    return;
  }
  if (e.target.closest('#withdraw')) {
    confirmingWithdraw = true;
    render();
  } else if (e.target.closest('#withdraw-no')) {
    confirmingWithdraw = false;
    render();
  } else if (e.target.closest('#withdraw-ok')) {
    e.target.closest('#withdraw-ok').disabled = true;
    try {
      await api.withdrawMatch(id);
      confirmingWithdraw = false;
      await load();
    } catch (err) {
      toast(err.message, { error: true });
      await load();
    }
  } else if (e.target.closest('#join')) {
    e.target.closest('#join').disabled = true;
    try {
      m = await api.joinMatch(id);
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
