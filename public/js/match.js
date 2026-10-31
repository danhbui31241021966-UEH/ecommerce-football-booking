// Chi tiết một trận đủ hai đội: người xem là đội mở kèo, đội vào kèo hoặc khách khác. Mỗi đội thấy QR của phần mình.
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
    ${s(1, 'Đội mở kèo chọn giờ và cách chia tiền, rồi chuyển khoản phần của mình cho chủ sân.', true)}
    ${s(2, 'Chủ sân nhận tiền thì kèo hiện cho các đội khác. Đội thứ hai vào kèo và chuyển khoản phần còn lại.', m.hostPaid)}
    ${s(3, 'Đủ hai phần tiền là chốt sân. Hết hạn mà thiếu đội thì sân mở lại và chủ sân trả lại tiền cho đội đã chuyển.', m.status === 'confirmed')}
  </ol>`;
}

function refundBox() {
  const r = m.yourPart?.refund;
  if (!r) return m.yourPart && ['expired', 'cancelled'].includes(m.status) ? '<div class="refund-box">Chủ sân chưa nhận tiền nào của đội bạn nên không có tiền để trả lại.</div>' : '';
  return `<div class="refund-box"><b>${r.status === 'done' ? 'Đã trả lại' : 'Chưa trả lại'}</b> · tiền đội bạn được nhận lại <b class="num">${money(r.amount)}</b>. ${r.status === 'done' ? 'Chủ sân đã chuyển lại tiền cho bạn.' : 'Chủ sân chưa chuyển lại tiền cho bạn. Chuyển xong, chủ sân sẽ ghi nhận ở đây.'}</div>`;
}

function action() {
  const user = getUser();
  const link = `${location.origin}/match.html?id=${m.id}`;
  if (m.role === 'host') {
    if (m.status === 'open' && !m.hostPaid) return `<div class="notice warn" role="status"><div><b>Chuyển ${money(m.hostAmount)} cho chủ sân</b> bằng mã QR bên cạnh, giữ nguyên nội dung chuyển khoản. Bạn còn <span id="cd"></span> để chủ sân nhận tiền, quá hạn thì sân mở lại. Kèo chỉ hiện cho đội khác sau khi chủ sân nhận tiền của bạn.</div></div>${withdrawHtml()}`;
    if (m.status === 'open') return `<div class="notice" role="status"><div>Chủ sân đã nhận ${money(m.hostAmount)} của bạn. Sân được giữ đến ${shortTs(m.closesAt)} để chờ đội thứ hai. Muốn rủ đội quen? Gửi link này: <button type="button" class="btn btn-sm" data-copy="${esc(link)}">Sao chép link</button></div></div>${withdrawHtml()}`;
    if (m.status === 'joined') return `<div class="notice" role="status"><div>Đã có đội vào kèo. Họ cần chuyển ${money(m.guestAmount)} trong <span id="cd"></span> nữa thì kèo mới chốt. Phần bạn đã trả vẫn được giữ nguyên.</div></div>${withdrawHtml()}`;
    if (m.status === 'confirmed') return `<div class="notice" role="status"><div>Kèo đã chốt: chủ sân đã nhận đủ tiền của hai đội. <a href="/booking.html?id=${m.bookingId}">Mở lịch đặt</a>.</div></div>`;
    return `<div class="notice"><div>${esc(m.endReason || 'Kèo đã kết thúc.')}</div></div>${refundBox()}`;
  }
  if (m.role === 'guest') {
    if (m.status === 'joined') return `<div class="notice warn" role="status"><div><b>Chuyển ${money(m.guestAmount)} cho chủ sân</b> bằng mã QR bên cạnh, giữ nguyên nội dung chuyển khoản. Bạn còn <span id="cd"></span> để chủ sân nhận tiền. Kèo chỉ chốt sau khi chủ sân nhận tiền của bạn.</div></div>`;
    if (m.status === 'confirmed') return '<div class="notice"><div>Kèo đã chốt. Hẹn gặp bạn trên sân.</div></div>';
    return `<div class="notice"><div>${esc(m.endReason || 'Bạn không còn trong kèo này.')}</div></div>${refundBox()}`;
  }
  if (m.role === 'staff') return '<div class="notice"><div>Quản lý kèo này ở mục Lịch đặt.</div></div>';
  if (m.status === 'open' && m.joinable) {
    if (!user) return `<a class="btn btn-lime" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Đăng nhập để vào kèo</a>`;
    if (user.role !== 'customer') return '<div class="notice"><div>Chỉ tài khoản khách mới vào kèo được.</div></div>';
    return `<button type="button" class="btn btn-lime" id="join">Vào kèo · trả ${money(m.guestAmount)}</button>
      <p class="muted" style="font-size:var(--fs-sm)">Bấm để lấy mã QR. Bạn có ${meta.holdMinutes} phút để chuyển ${money(m.guestAmount)} cho chủ sân. Mỗi kèo chỉ nhận một đội, ai vào trước được giữ chỗ.</p>`;
  }
  if (m.status === 'open') return '<div class="notice"><div>Kèo chưa mở cho đội khác vì chủ sân chưa nhận tiền của đội mở kèo.</div></div>';
  if (m.status === 'joined') return '<div class="notice"><div>Đã có đội khác vào kèo này.</div></div>';
  if (m.status === 'confirmed') return '<div class="notice"><div>Kèo này đã đủ hai đội.</div></div>';
  return `<div class="notice"><div>${esc(m.endReason || 'Kèo này không còn mở.')}</div></div><a class="btn btn-lime" href="/matches.html">Xem các kèo đang mở</a>`;
}

function withdrawHtml() {
  const withGuest = m.status === 'joined';
  if (!confirmingWithdraw) return '<div class="row"><button type="button" class="btn btn-danger btn-sm" id="withdraw">Rút khỏi kèo</button></div>';
  return `<div class="notice warn" role="alert"><div><b>Rút khỏi kèo?</b> ${withGuest
    ? 'Đã có đội vào kèo nên việc rút tính như hủy sân: bạn được trả lại tiền theo chính sách hủy (có thể không đủ), và rút khi còn dưới 12 giờ là hủy sát giờ. Tiền do chủ sân chuyển lại sau.'
    : `Chưa có đội vào nên bạn không mất phí và không bị tính hủy sát giờ. ${m.hostPaid ? 'Chủ sân sẽ chuyển lại số tiền bạn đã trả.' : 'Bạn chưa trả tiền nên không có gì để trả lại.'}`} Giờ này sẽ mở lại ngay.</div></div>
    <div class="row"><button type="button" class="btn btn-danger btn-sm" id="withdraw-ok">Rút khỏi kèo</button><button type="button" class="btn btn-ghost btn-sm" id="withdraw-no">Ở lại kèo</button></div>`;
}

function render() {
  const [label, cls] = matchLabel(m);
  const qr = m.paymentQr;
  $('root').innerHTML = `
    <p class="crumb"><a href="/matches.html">Ghép kèo</a> / #${m.id}</p>
    <div class="booking-layout${qr ? ' has-side' : ''}" style="margin-top:var(--sp-3)">
      <div class="area-sum"><div class="card card-pad stack">
        <div class="row"><h1 class="booking-code">${timeOf(m.startAt)}–${timeOf(m.endAt)} · ${dayLabel(dateOf(m.startAt))}</h1><span class="spacer"></span><span class="badge badge-${cls}">${label}</span></div>
        <dl class="kv">
          <div><dt>Sân</dt><dd><a href="/venue.html?id=${m.venueId}">${esc(m.venueName)}</a> · ${esc(m.courtName)} (sân ${m.fieldType})</dd></div>
          <div class="total"><dt>Giá sân</dt><dd class="num">${money(m.price)}</dd></div>
          <div><dt>Phần đội mở kèo</dt><dd class="num">${money(m.hostAmount)} (${m.hostPercent}%)</dd></div>
          <div><dt>Phần đội vào kèo</dt><dd class="num">${money(m.guestAmount)}</dd></div>
          <div><dt>Hạn tìm đủ đội</dt><dd class="num">${shortTs(m.closesAt)}</dd></div>
        </dl>
        ${partsHtml(m)}
        ${action()}
      </div></div>
      ${qr ? qrHtml(qr, `Chuyển phần của đội bạn · ${money(qr.amount)}`) : ''}
      <div class="stack area-rest"><div class="card card-pad"><h2 class="h3" style="margin-bottom:var(--sp-2)">Ghép kèo hoạt động thế nào</h2>${steps()}</div></div>
    </div>`;
  document.title = `Kèo ${timeOf(m.startAt)} – SânNhanh`;
  decorate();
  const until = m.status === 'joined' ? m.guestHoldUntil : m.hostPayBy;
  if ($('cd') && until) countdown($('cd'), secondsLeft(until, meta.now), (n) => (n > 0 ? mmss(n) : 'đã hết hạn'), load);
}

async function load() {
  try {
    [meta, m] = await Promise.all([api.meta(), api.match(id)]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy kèo' : 'Không tải được'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/matches.html">Xem các kèo đang mở</a></div>`;
    decorate();
  }
}

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
    toast('Đã sao chép link kèo');
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
