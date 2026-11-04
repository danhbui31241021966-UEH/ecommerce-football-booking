// Mở kèo: chọn kèo tiền sân (5-5, 6-4, 7-3, thua bao sân) và hạn tìm đội. Giữ giờ 15 phút để đội mở kèo trả nửa tiền sân trước.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, decorate, esc, redirectToLogin } from '/js/ui/page.js';
import { dayLabel, money, msToVn, shortTs, timeOf, vnToMs } from '/js/ui/format.js';
import { STAKES } from '/js/ui/match.js';

const q = new URLSearchParams(location.search);
const venueId = Number(q.get('venue'));
const courtId = Number(q.get('court'));
const date = q.get('date');
const start = q.get('start');
let meta;
let venue;
let court;
let slot;
let loserPercent = 50;
let closesAt = '';

// Cùng quy tắc làm tròn với server: mỗi đội chuyển trước nửa tiền sân (làm tròn nghìn); đội thua chịu giá × tỉ lệ.
const halfOf = (price) => Math.min(price - 1000, Math.max(1000, Math.round(price / 2 / 1000) * 1000));
const loserOf = (price, p) => Math.round((price * p) / 100 / 1000) * 1000;

function deadlines() {
  const startMs = vnToMs(`${date} ${start}:00`);
  const latest = startMs - meta.matchCloseMinutes * 60000;
  const earliest = vnToMs(meta.now) + meta.matchMinOpenMinutes * 60000;
  const out = [];
  for (const h of [meta.matchCloseMinutes / 60, 4, 8, 24]) {
    const ms = startMs - h * 3600000;
    if (ms >= earliest && ms <= latest) out.push([msToVn(ms), `Trước giờ đá ${h} giờ · ${shortTs(msToVn(ms))}`]);
  }
  return out;
}

function render() {
  const host = halfOf(slot.basePrice);
  const loser = loserOf(slot.basePrice, loserPercent);
  const opts = deadlines();
  if (!opts.some((o) => o[0] === closesAt)) closesAt = opts[0]?.[0] || '';
  $('root').innerHTML = `
    <p class="crumb"><a href="/product-detail.html?id=${venueId}&date=${date}">${esc(venue.name)}</a> / Mở kèo</p>
    <div class="page-head" style="margin-top:var(--sp-3)"><h1 class="h1">Mở kèo, tìm đội đá cùng</h1><p class="sub">Giờ này ở ${esc(court.name)} chỉ chốt khi có đủ hai đội. Mỗi đội chuyển trước nửa tiền sân cho chủ sân. Đá xong, đội thua trả thêm theo kèo.</p></div>
    <form class="card card-pad stack" id="match-form" style="max-width:640px">
      <dl class="kv">
        <div><dt>Sân</dt><dd>${esc(venue.name)} · ${esc(court.name)} (sân ${court.fieldType})</dd></div>
        <div><dt>Thời gian</dt><dd class="num">${start}–${slot.end}, ${dayLabel(date)}</dd></div>
        <div class="total"><dt>Giá sân</dt><dd class="num">${money(slot.basePrice)}</dd></div>
      </dl>
      <fieldset class="field"><legend>Kèo tiền sân</legend>
        <div class="chips wrap" role="group">${STAKES.map(([p, label]) => `<button type="button" class="chip" data-stake="${p}" aria-pressed="${p === loserPercent}">${label}</button>`).join('')}</div>
        <p class="muted" style="font-size:var(--fs-sm)">${loserPercent === 50
          ? `Hòa vốn: mỗi đội chịu <b class="num">${money(host)}</b>, không ai phải trả thêm.`
          : `Đội thua chịu <b class="num">${money(loser)}</b>, đội thắng chịu <b class="num">${money(slot.basePrice - loser)}</b>. Mỗi đội đã trả trước nửa tiền sân, nên đá xong đội thua chuyển thêm khoảng <b class="num">${money(Math.max(0, loser - host))}</b> cho đội thắng. Hòa thì không ai trả thêm.`}</p>
        <p class="muted" style="font-size:var(--fs-sm)">Chỉ có kèo tiền sân: hai đội cộng lại luôn đúng giá sân. Không cược thêm tiền, không kèo theo tỉ số. Khoản trả thêm chuyển thẳng giữa hai đội, GGO không giữ tiền.</p>
      </fieldset>
      <div class="field"><label for="closes">Hạn tìm đủ đội</label>
        <select class="select" id="closes">${opts.map(([v, l]) => `<option value="${v}" ${v === closesAt ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <span class="hint">Hết hạn mà chưa đủ hai đội thì sân mở lại, chủ sân sẽ trả lại tiền cho đội đã chuyển.</span></div>
      <div class="notice warn" role="note"><div>Sân được giữ cho bạn <b>${meta.holdMinutes} phút</b> để chuyển nửa tiền sân. Chủ sân nhận tiền xong, kèo mới hiện cho các đội khác.</div></div>
      <p class="dlg-error" id="match-error" role="alert" hidden></p>
      <div class="row"><button type="submit" class="btn btn-lime" ${opts.length ? '' : 'disabled'}>Mở kèo ${STAKES.find((x) => x[0] === loserPercent)[1].toLowerCase()} · trả trước ${money(host)}</button><a class="btn btn-ghost" href="/product-detail.html?id=${venueId}&date=${date}">Để sau</a></div>
    </form>`;
  decorate();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-stake]');
  if (!c) return;
  loserPercent = Number(c.dataset.stake);
  render();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'closes') closesAt = e.target.value;
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'match-form') return;
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const m = await api.openMatch({ courtId, date, start, loserPercent, closesAt });
    location.href = `/match.html?id=${m.id}`;
  } catch (err) {
    $('match-error').textContent = err.message;
    $('match-error').hidden = false;
    btn.disabled = false;
    toast(err.message, { error: true });
  }
});

await mountShell();
if (!getUser()) redirectToLogin();
else if (getUser().role !== 'customer') $('root').innerHTML = '<div class="card empty"><p><b style="color:var(--text)">Chỉ tài khoản khách mới mở kèo được</b></p></div>';
else {
  try {
    meta = await api.meta();
    venue = await api.venue(venueId);
    const sc = await api.schedule(venueId, date);
    const c = sc.courts.find((x) => x.id === courtId);
    slot = c?.slots.find((s) => s.start === start);
    court = venue.courts.find((x) => x.id === courtId);
    if (!slot || !court) throw new Error('Không tìm thấy giờ này');
    if (!slot.teamMode) throw new Error(slot.status === 'available' ? 'Giờ này không ghép kèo, bạn đặt sân như bình thường nhé.' : 'Giờ này đã có người đặt.');
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không mở kèo được</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/product-detail.html?id=${venueId}">Về trang sân</a></div>`;
  }
}
