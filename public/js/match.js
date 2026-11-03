// Chi tiết một kèo: người xem là đội mở kèo, đội vào kèo hoặc khách khác. Mỗi đội thấy QR của phần mình; sau trận hai đội báo kết quả và đội thua trả phần chênh thẳng cho đội thắng.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, qrHtml } from '/js/ui/page.js';
import { dateOf, dayLabel, mmss, money, secondsLeft, shortTs, timeOf } from '/js/ui/format.js';
import { matchLabel, partsHtml, stakeText, winnerWord } from '/js/ui/match.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let m;
let meta;
let confirmingWithdraw = false;
let editingBank = false;
let picked = null;

function steps() {
  const s = (n, text, on) => `<li class="${on ? 'on' : ''}"><b>${n}</b><span>${text}</span></li>`;
  return `<ol class="transfer-steps">
    ${s(1, 'Đội mở kèo chọn kèo tiền sân, mỗi đội chuyển trước nửa tiền sân cho chủ sân.', true)}
    ${s(2, 'Đủ hai đội và chủ sân nhận đủ tiền thì chốt sân. Thiếu đội thì sân mở lại, tiền được trả lại.', m.status === 'confirmed')}
    ${s(3, 'Đá xong, hai đội báo kết quả. Đội thua chuyển thêm phần chênh thẳng cho đội thắng.', !!m.result)}
  </ol>
  <p class="muted" style="font-size:var(--fs-sm);margin-top:var(--sp-3)">Chỉ có kèo tiền sân: hai đội cộng lại luôn đúng giá sân. Không cược thêm tiền, không kèo theo tỉ số.</p>`;
}

function stakeLine() {
  if (m.loserPercent <= 50) return 'Hòa vốn 5-5: mỗi đội chịu một nửa';
  return `<b>${stakeText(m.loserPercent)}</b>: đội thua chịu <span class="num">${money(m.loserAmount)}</span>, đội thắng chịu <span class="num">${money(m.winnerAmount)}</span>`;
}

const REPORTS = [['mine', 'Đội mình thắng'], ['other', 'Đội kia thắng'], ['draw', 'Hòa']];
const partOf = (key) => (key === 'draw' ? 'draw' : key === 'mine' ? m.role : m.role === 'host' ? 'guest' : 'host');
const keyOf = (w) => (w === 'draw' ? 'draw' : w === m.role ? 'mine' : 'other');

function bankForm(prefix, hint) {
  const b = m.yourBank;
  return `<fieldset class="field bank-fields"><legend>Tài khoản nhận tiền</legend>
    <div class="field"><label for="${prefix}-bin">Ngân hàng</label><select class="select" id="${prefix}-bin" name="bin"><option value="">Chọn ngân hàng</option>${meta.banks.map((x) => `<option value="${esc(x.bin)}" ${b?.bin === x.bin ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="${prefix}-acc">Số tài khoản</label><input class="input" id="${prefix}-acc" name="account" inputmode="numeric" autocomplete="off" value="${esc(b?.account || '')}"></div>
    <div class="field"><label for="${prefix}-name">Tên chủ tài khoản</label><input class="input" id="${prefix}-name" name="accountName" autocomplete="off" value="${esc(b?.accountName || '')}"></div>
    <span class="hint">${hint}</span></fieldset>`;
}

function topUpBox() {
  const t = m.result.topUp;
  const r = m.result;
  if (r.winner === 'draw') return '<div class="notice"><div><b>Hòa.</b> Không ai trả thêm. Xong kèo.</div></div>';
  if (!t) return `<div class="notice"><div><b>${winnerWord(m, r.winner)}.</b> Không có phần chênh để trả.</div></div>`;
  const state = t.status === 'received' ? '<b>Đã nhận</b>' : `<b>Chưa trả</b>${t.overdue ? ' · quá hạn' : ` · hạn ${shortTs(t.dueBy)}`}`;
  const head = `<p><b>${winnerWord(m, r.winner)}.</b> Đội thua trả thêm <b class="num">${money(t.amount)}</b> cho đội thắng. Trạng thái: ${state}.</p>`;
  const foot = '<p class="muted" style="font-size:var(--fs-sm)">Khoản này chuyển thẳng giữa hai đội. GGO không giữ tiền và không bắt buộc trả, chỉ ghi lại trạng thái.</p>';
  if (m.role === t.from) {
    if (t.status === 'received') return `<div class="refund-box">${head}</div>`;
    return `<div class="notice warn" role="status"><div>${head}${m.topUpQr ? '<p>Quét mã QR bên cạnh để chuyển cho đội thắng.</p>' : '<p>Đội thắng chưa nhập số tài khoản. Khi họ nhập xong, mã QR sẽ hiện ở đây.</p>'}${foot}</div></div>`;
  }
  if (m.role === t.to) {
    const form = t.status === 'unpaid' ? (m.yourBank
      ? `<p>Tài khoản nhận: <b>${esc(m.yourBank.bankName)} · ${esc(m.yourBank.account)} · ${esc(m.yourBank.accountName)}</b></p><div class="row"><button type="button" class="btn btn-lime btn-sm" id="topup-ok">Đã nhận ${money(t.amount)}</button><button type="button" class="btn btn-ghost btn-sm" id="bank-edit">Sửa tài khoản</button></div>`
      : '') : '';
    const bank = t.status === 'unpaid' && (!m.yourBank || editingBank)
      ? `<form id="bank-form" class="stack">${bankForm('tb', 'Chỉ đội kia trong kèo này thấy tài khoản này.')}<div class="row"><button type="submit" class="btn btn-lime btn-sm">Lưu tài khoản</button></div></form>` : '';
    return `<div class="notice ${t.status === 'unpaid' ? 'warn' : ''}" role="status"><div>${head}${editingBank ? '' : form}${bank}${foot}</div></div>`;
  }
  return '';
}

function resultBox() {
  const r = m.result;
  if (!r || !m.role || m.role === 'staff') return '';
  if (r.status === 'awaiting') {
    const mine = r.yourReport ? keyOf(r.yourReport) : '';
    return `<form id="result-form" class="stack"><fieldset class="field"><legend>Kết quả trận ${stakeText(m.loserPercent)}</legend>
      <div class="chips wrap" role="group">${REPORTS.map(([k, label]) => `<button type="button" class="chip" data-report="${k}" aria-pressed="${mine === k}">${label}</button>`).join('')}</div>
      <span class="hint">${r.yourReport ? `Bạn đã báo: ${winnerWord(m, r.yourReport)}. ${r.otherReported ? 'Đội kia cũng đã báo.' : 'Chờ đội kia báo.'} Bạn có thể báo lại trước khi hai bên khớp nhau.` : `${r.otherReported ? 'Đội kia đã báo. ' : ''}Hai đội báo giống nhau là chốt kết quả.`} Hạn báo ${shortTs(r.reportBy)}; quá hạn hoặc báo lệch nhau thì chủ sân chốt.</span></fieldset>
      ${bankForm('rb', 'Điền nếu đội bạn thắng để nhận phần chênh. Chỉ đội kia trong kèo này thấy.')}
      <div class="row"><button type="submit" class="btn btn-lime" id="report-send" ${mine ? '' : 'disabled'}>${r.yourReport ? 'Báo lại kết quả' : 'Gửi kết quả'}</button></div></form>`;
  }
  if (r.status === 'needs_owner') return `<div class="notice" role="status"><div><b>Chờ chủ sân chốt kết quả.</b> ${r.yourReport ? `Bạn đã báo: ${winnerWord(m, r.yourReport)}.` : 'Bạn chưa báo kết quả.'} ${r.otherReported ? 'Đội kia đã báo.' : 'Đội kia chưa báo.'} Hai bên báo lệch nhau hoặc quá hạn thì chủ sân chốt.</div></div>`;
  return topUpBox();
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
    if (m.status === 'confirmed') return `<div class="notice" role="status"><div>Kèo đã chốt: chủ sân đã nhận đủ tiền của hai đội. <a href="/booking.html?id=${m.bookingId}">Mở lịch đặt</a>.</div></div>${resultBox()}`;
    return `<div class="notice"><div>${esc(m.endReason || 'Kèo đã kết thúc.')}</div></div>${refundBox()}`;
  }
  if (m.role === 'guest') {
    if (m.status === 'joined') return `<div class="notice warn" role="status"><div><b>Chuyển ${money(m.guestAmount)} cho chủ sân</b> bằng mã QR bên cạnh, giữ nguyên nội dung chuyển khoản. Bạn còn <span id="cd"></span> để chủ sân nhận tiền. Kèo chỉ chốt sau khi chủ sân nhận tiền của bạn.</div></div>`;
    if (m.status === 'confirmed') return `<div class="notice"><div>Kèo đã chốt. Hẹn gặp bạn trên sân.</div></div>${resultBox()}`;
    return `<div class="notice"><div>${esc(m.endReason || 'Bạn không còn trong kèo này.')}</div></div>${refundBox()}`;
  }
  if (m.role === 'staff') return `<div class="notice"><div>Quản lý kèo này ở mục Lịch đặt.${m.result ? ` Kết quả: ${staffResult()}.` : ''}</div></div>`;
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

function staffResult() {
  const r = m.result;
  const w = (x) => (x ? winnerWord(m, x) : 'chưa báo');
  if (r.status === 'settled') return `đã chốt, ${w(r.winner)}`;
  return `${r.status === 'needs_owner' ? 'chờ chủ sân chốt' : 'chờ hai đội báo'} (đội mở kèo: ${w(r.hostReport)}; đội vào kèo: ${w(r.guestReport)})`;
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
  const qr = m.paymentQr || m.topUpQr;
  $('root').innerHTML = `
    <p class="crumb"><a href="/matches.html">Ghép kèo</a> / #${m.id}</p>
    <div class="booking-layout${qr ? ' has-side' : ''}" style="margin-top:var(--sp-3)">
      <div class="area-sum"><div class="card card-pad stack">
        <div class="row"><h1 class="booking-code">${timeOf(m.startAt)}–${timeOf(m.endAt)} · ${dayLabel(dateOf(m.startAt))}</h1><span class="spacer"></span><span class="badge badge-${cls}">${label}</span></div>
        <dl class="kv">
          <div><dt>Sân</dt><dd><a href="/venue.html?id=${m.venueId}">${esc(m.venueName)}</a> · ${esc(m.courtName)} (sân ${m.fieldType})</dd></div>
          <div class="total"><dt>Giá sân</dt><dd class="num">${money(m.price)}</dd></div>
          <div><dt>Kèo tiền sân</dt><dd>${stakeLine()}</dd></div>
          <div><dt>Mỗi đội trả trước</dt><dd class="num">${m.hostAmount === m.guestAmount ? money(m.hostAmount) : `${money(m.hostAmount)} · ${money(m.guestAmount)}`}</dd></div>
          <div><dt>Hạn tìm đủ đội</dt><dd class="num">${shortTs(m.closesAt)}</dd></div>
        </dl>
        ${partsHtml(m)}
        ${action()}
      </div></div>
      ${qr ? (m.paymentQr ? qrHtml(qr, `Chuyển phần của đội bạn · ${money(qr.amount)}`) : qrHtml(qr, `Trả thêm cho đội thắng · ${money(qr.amount)}`, 'Tiền chuyển thẳng cho đội thắng. GGO không giữ tiền, chỉ ghi lại Chưa trả hoặc Đã nhận.', { simulate: false })) : ''}
      <div class="stack area-rest"><div class="card card-pad"><h2 class="h3" style="margin-bottom:var(--sp-2)">Ghép kèo hoạt động thế nào</h2>${steps()}</div></div>
    </div>`;
  document.title = `Kèo ${timeOf(m.startAt)} – GGO`;
  decorate();
  if (picked) document.querySelectorAll('[data-report]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.report === picked)));
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
  const rp = e.target.closest('[data-report]');
  if (rp) {
    picked = rp.dataset.report;
    document.querySelectorAll('[data-report]').forEach((b) => b.setAttribute('aria-pressed', String(b === rp)));
    const send = $('report-send');
    if (send) send.disabled = false;
    return;
  }
  if (e.target.closest('#bank-edit')) {
    editingBank = true;
    render();
    return;
  }
  if (e.target.closest('#topup-ok')) {
    e.target.closest('#topup-ok').disabled = true;
    try {
      m = await api.matchTopUpReceived(id);
      toast('Đã ghi nhận đã nhận tiền');
      render();
    } catch (err) {
      toast(err.message, { error: true });
      await load();
    }
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

const bankOf = (form) => Object.fromEntries(['bin', 'account', 'accountName'].map((k) => [k, String(form.elements[k].value || '').trim()]));

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.id !== 'result-form' && form.id !== 'bank-form') return;
  e.preventDefault();
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    if (form.id === 'bank-form') {
      m = await api.setMatchBank(id, bankOf(form));
      editingBank = false;
      toast('Đã lưu tài khoản');
    } else {
      const bank = bankOf(form);
      m = await api.reportMatchResult(id, partOf(picked || keyOf(m.result.yourReport)), bank.bin || bank.account || bank.accountName ? bank : undefined);
      picked = null;
      toast('Đã gửi kết quả');
    }
    meta = await api.meta();
    render();
  } catch (err) {
    toast(err.message, { error: true });
    btn.disabled = false;
  }
});

await mountShell();
await load();
