// Chi tiết một tin nhờ báo giá: xem các báo giá của sân và chọn một. Chọn = kiểm lại giờ rồi đặt sân qua luồng đặt thường.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, redirectToLogin } from '/js/ui/page.js';
import { dayLabel, mmss, money, secondsLeft, shortTs } from '/js/ui/format.js';
import { budgetText, offerLabel, requestLabel, requestTitle, requestWhen } from '/js/ui/request.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let r;
let meta;
let choosing = null;
let cancelling = false;
let note = '';

// Một số địa chỉ trong dữ liệu đã có tên quận ở giữa chuỗi và lặp lại ở cuối: bỏ phần lặp ở cuối khi hiển thị, không sửa dữ liệu.
function addressOf(o) {
  const parts = o.venueAddress.split(',').map((x) => x.trim());
  const d = o.venueDistrict.toLowerCase();
  if (parts.length > 1 && parts.at(-1).toLowerCase() === d && parts.slice(0, -1).some((x) => x.toLowerCase() === d)) parts.pop();
  return parts.join(', ');
}

function offerCard(o) {
  const [label, cls] = offerLabel(o);
  const off = o.listedPrice > o.price ? Math.round((1 - o.price / o.listedPrice) * 100) : 0;
  const pickable = r.status === 'open' && o.status === 'open' && o.usable;
  let action = '';
  if (pickable && choosing === o.id) {
    action = `<div class="notice warn" role="alert"><div><b>Đặt sân với giá ${money(o.price)}?</b> Nếu giờ này còn trống, sân sẽ được đặt cho bạn${o.requiresApproval ? ' và chờ chủ sân đồng ý' : ' ngay'}. Sau đó bạn chuyển khoản cho chủ sân bằng mã QR.</div></div>
      <div class="row"><button type="button" class="btn btn-lime btn-sm" data-choose-ok="${o.id}">Đặt sân · ${money(o.price)}</button><button type="button" class="btn btn-ghost btn-sm" data-choose-no>Thôi</button></div>`;
  } else if (pickable) action = `<div class="row"><button type="button" class="btn btn-lime btn-sm" data-choose="${o.id}">Chọn báo giá này</button></div>`;
  else if (o.status === 'open') action = `<p class="muted" style="font-size:var(--fs-sm)"><b>Không chọn được:</b> ${esc(o.unusableReason)}. Báo giá chưa giữ sân nên người khác có thể đặt trước.</p>`;
  else if (o.status === 'chosen' && r.bookingId) action = `<div class="row"><a class="btn btn-sm" href="/booking.html?id=${r.bookingId}">Mở lịch đặt</a></div>`;
  else if (o.endReason) action = `<p class="muted" style="font-size:var(--fs-sm)">${esc(o.endReason)}.</p>`;
  return `<article class="card booking-item offer-item${o.status === 'open' && o.usable ? '' : ' off'}">
    <div class="top"><div><div class="when">${esc(o.venueName)} · ${esc(o.courtName)}</div>
      <div class="where">${o.startAt.slice(11, 16)}–${o.endAt.slice(11, 16)}, ${esc(dayLabel(o.startAt.slice(0, 10)))} · ${o.requiresApproval ? 'Chủ sân duyệt' : 'Xác nhận ngay'}</div></div>
      <div class="badges"><span class="badge badge-${cls}">${label}</span></div></div>
    <p class="transfer-price"><b class="num">${money(o.price)}</b> ${off ? `<span class="price-old">${money(o.listedPrice)}</span> <span class="tag-sale">-${off}%</span>` : '<span class="muted">bằng giá thường</span>'}
      <span class="badge ${o.overBudget ? 'badge-pending' : 'badge-confirmed'}">${o.overBudget ? `Cao hơn mức bạn muốn ${money(o.price - r.budget)}` : 'Đúng mức bạn muốn'}</span></p>
    ${o.note ? `<p class="muted" style="font-size:var(--fs-sm)">“${esc(o.note)}”</p>` : ''}
    ${o.status === 'open' ? `<p class="muted" style="font-size:var(--fs-sm)">Giá này có hiệu lực đến ${shortTs(o.validUntil)}. ${esc(addressOf(o))}</p>` : ''}
    ${action}
  </article>`;
}

function render() {
  const [label, cls] = requestLabel(r);
  const open = r.status === 'open';
  $('root').innerHTML = `
    <p class="crumb"><a href="/requests.html">Tôi đã nhờ báo giá</a> / #${r.id}</p>
    <div class="page-head" style="margin-top:var(--sp-3)"><div class="row"><h1 class="h1">${esc(requestTitle(r))}</h1><span class="spacer"></span><span class="badge badge-${cls}">${label}</span></div>
      <p class="sub">${esc(requestWhen(r))} · ${esc(budgetText(r))}${r.note ? ` · “${esc(r.note)}”` : ''}</p></div>
    ${open ? `<div class="notice" role="note"><div><b>Báo giá chưa giữ sân.</b> Chỉ khi bạn bấm chọn, sân mới được đặt. Nếu có người đặt trước, báo giá đó không còn dùng được. Nhận báo giá đến <b>${shortTs(r.closesAt)}</b> (còn <span id="cd"></span>).</div></div>` : r.status === 'chosen' ? `<div class="notice"><div>Bạn đã chọn báo giá và đặt sân. <a href="/booking.html?id=${r.bookingId}">Mở lịch đặt</a> để lấy mã QR và chuyển khoản cho chủ sân.</div></div>` : `<div class="notice"><div>${esc(r.endReason || 'Tin này đã kết thúc.')}</div></div>`}
    <h2 class="h3" style="margin:var(--sp-5) 0 var(--sp-3)">Báo giá (${r.offers.length})</h2>
    <div class="booking-list">${r.offers.length ? r.offers.map(offerCard).join('') : `<div class="card empty"><div class="art" data-icon="calendar"></div><p><b style="color:var(--text)">${open ? 'Chưa có sân nào báo giá' : 'Không có báo giá nào'}</b><br>${open ? 'Các sân phù hợp đã nhận được tin của bạn. Có báo giá, bạn sẽ được báo.' : ''}</p></div>`}</div>
    ${open ? cancelHtml() : ''}`;
  document.title = `Nhờ báo giá ${r.district} – GGO`;
  decorate();
  if ($('cd')) countdown($('cd'), secondsLeft(r.closesAt, meta.now), (n) => (n > 0 ? (n >= 3600 ? `${Math.floor(n / 3600)} giờ ${Math.floor((n % 3600) / 60)} phút` : mmss(n)) : 'đã hết hạn'), load);
}

function cancelHtml() {
  if (!cancelling) return '<div class="row" style="margin-top:var(--sp-5)"><button type="button" class="btn btn-danger btn-sm" id="cancel">Hủy tin này</button></div>';
  return `<div class="notice warn" role="alert" style="margin-top:var(--sp-5)"><div><b>Hủy tin này?</b> Các báo giá sẽ đóng và chủ sân được báo. Bạn chưa đặt sân nào nên không mất tiền.</div></div>
    <div class="row"><button type="button" class="btn btn-danger btn-sm" id="cancel-ok">Xác nhận hủy</button><button type="button" class="btn btn-ghost btn-sm" id="cancel-no">Giữ lại tin</button></div>`;
}

async function load() {
  try {
    [meta, r] = await Promise.all([api.meta(), api.request(id)]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy tin này' : 'Không tải được'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/requests.html">Về danh sách đã nhờ báo giá</a></p></div>`;
    decorate();
  }
}

document.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-choose]');
  if (pick) {
    choosing = Number(pick.dataset.choose);
    render();
  } else if (e.target.closest('[data-choose-no]')) {
    choosing = null;
    render();
  } else if (e.target.closest('[data-choose-ok]')) {
    const btn = e.target.closest('[data-choose-ok]');
    btn.disabled = true;
    try {
      const b = await api.acceptOffer(r.id, Number(btn.dataset.chooseOk));
      location.href = `/booking.html?id=${b.id}`;
    } catch (err) {
      choosing = null;
      note = err.message;
      await load();
      toast(note, { error: true });
    }
  } else if (e.target.closest('#cancel')) {
    cancelling = true;
    render();
  } else if (e.target.closest('#cancel-no')) {
    cancelling = false;
    render();
  } else if (e.target.closest('#cancel-ok')) {
    e.target.closest('#cancel-ok').disabled = true;
    try {
      await api.cancelRequest(r.id);
      cancelling = false;
      await load();
    } catch (err) {
      toast(err.message, { error: true });
      await load();
    }
  }
});

await mountShell();
if (!getUser()) redirectToLogin();
else await load();
