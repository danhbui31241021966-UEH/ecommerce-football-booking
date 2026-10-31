// Mở kèo đủ hai đội: chọn cách chia tiền và hạn chót. Giữ giờ 15 phút để đội mở kèo trả phần của mình.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, decorate, esc, redirectToLogin } from '/js/ui/page.js';
import { dayLabel, money, msToVn, shortTs, timeOf, vnToMs } from '/js/ui/format.js';

const q = new URLSearchParams(location.search);
const venueId = Number(q.get('venue'));
const courtId = Number(q.get('court'));
const date = q.get('date');
const start = q.get('start');
const PERCENTS = [30, 40, 50, 60, 70];
let meta;
let venue;
let court;
let slot;
let percent = 50;
let closesAt = '';

// Cùng quy tắc làm tròn với server: phần đội mở = giá × tỉ lệ, làm tròn nghìn; phần đội vào là phần còn lại.
const hostOf = (price, p) => Math.min(price - 1000, Math.max(1000, Math.round((price * p) / 100 / 1000) * 1000));

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
  const host = hostOf(slot.basePrice, percent);
  const opts = deadlines();
  if (!opts.some((o) => o[0] === closesAt)) closesAt = opts[0]?.[0] || '';
  $('root').innerHTML = `
    <p class="crumb"><a href="/venue.html?id=${venueId}&date=${date}">${esc(venue.name)}</a> / Mở kèo</p>
    <div class="page-head" style="margin-top:var(--sp-3)"><h1 class="h1">Mở kèo, tìm đội đá cùng</h1><p class="sub">Giờ này ở ${esc(court.name)} chỉ chốt khi có đủ hai đội. Bạn chuyển khoản phần của mình trước, đội kia chuyển phần còn lại.</p></div>
    <form class="card card-pad stack" id="match-form" style="max-width:640px">
      <dl class="kv">
        <div><dt>Sân</dt><dd>${esc(venue.name)} · ${esc(court.name)} (sân ${court.fieldType})</dd></div>
        <div><dt>Thời gian</dt><dd class="num">${start}–${slot.end}, ${dayLabel(date)}</dd></div>
        <div class="total"><dt>Giá sân</dt><dd class="num">${money(slot.basePrice)}</dd></div>
      </dl>
      <fieldset class="field"><legend>Phần của đội bạn</legend>
        <div class="chips" role="group">${PERCENTS.map((p) => `<button type="button" class="chip" data-percent="${p}" aria-pressed="${p === percent}">${p}%</button>`).join('')}</div>
        <p class="muted" style="font-size:var(--fs-sm)">Đội bạn trả <b class="num">${money(host)}</b>, đội kia trả <b class="num">${money(slot.basePrice - host)}</b>. Cộng lại đúng giá sân.</p>
      </fieldset>
      <div class="field"><label for="closes">Hạn tìm đủ đội</label>
        <select class="select" id="closes">${opts.map(([v, l]) => `<option value="${v}" ${v === closesAt ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <span class="hint">Hết hạn mà chưa đủ hai đội thì sân mở lại, chủ sân sẽ trả lại tiền cho đội đã chuyển.</span></div>
      <div class="notice warn" role="note"><div>Sân được giữ cho bạn <b>${meta.holdMinutes} phút</b> để chuyển phần của mình. Chủ sân nhận tiền xong, kèo mới hiện cho các đội khác.</div></div>
      <p class="dlg-error" id="match-error" role="alert" hidden></p>
      <div class="row"><button type="submit" class="btn btn-lime" ${opts.length ? '' : 'disabled'}>Mở kèo · trả ${money(host)}</button><a class="btn btn-ghost" href="/venue.html?id=${venueId}&date=${date}">Để sau</a></div>
    </form>`;
  decorate();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-percent]');
  if (!c) return;
  percent = Number(c.dataset.percent);
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
    const m = await api.openMatch({ courtId, date, start, hostPercent: percent, closesAt });
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
    $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không mở kèo được</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/venue.html?id=${venueId}">Về trang sân</a></div>`;
  }
}
