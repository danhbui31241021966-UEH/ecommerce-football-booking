// Đăng nhu cầu: quận, ngày, khung giờ, loại sân, ngân sách. Sân phù hợp thấy nhu cầu và gửi chào giá; chào giá chưa giữ sân.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, decorate, esc, redirectToLogin } from '/js/ui/page.js';
import { addDays, dateOf, hmToMin, minToHm, msToVn, relativeDayLabel, shortTs, vnToMs } from '/js/ui/format.js';

const q = new URLSearchParams(location.search);
let meta;
let districts = [];
const st = { district: q.get('district') || '', fieldType: q.get('fieldType') === '7' ? '7' : '5', date: q.get('date') || '', from: q.get('from') || '19:00', to: q.get('to') || '', budget: '', closesAt: '', note: '' };

const HOURS = Array.from({ length: 18 }, (_, i) => minToHm((6 + i) * 60)); // 06:00 – 23:00

function deadlines() {
  const startMs = vnToMs(`${st.date} ${st.from}:00`);
  const latest = startMs - meta.requestCloseMinutes * 60000;
  const nowMs = vnToMs(meta.now);
  const earliest = nowMs + meta.requestMinOpenMinutes * 60000;
  const ms = new Set([60, 180, 360, 720, 1440].map((m) => nowMs + m * 60000).filter((t) => t >= earliest && t <= latest));
  if (latest >= earliest) ms.add(latest);
  return [...ms].sort((a, b) => a - b).map((t) => [msToVn(t), `${t === latest ? 'Đến sát giờ' : `Sau ${Math.round((t - nowMs) / 3600000)} giờ`} · ${shortTs(msToVn(t))}`]);
}

function toOptions() {
  return HOURS.filter((h) => hmToMin(h) >= hmToMin(st.from) + 60).concat('24:00');
}

function paintDeadlines() {
  const opts = deadlines();
  if (!opts.some((o) => o[0] === st.closesAt)) st.closesAt = opts.at(-1)?.[0] || '';
  $('closes').innerHTML = opts.length ? opts.map(([v, l]) => `<option value="${v}" ${v === st.closesAt ? 'selected' : ''}>${esc(l)}</option>`).join('') : '<option value="">Không đủ thời gian</option>';
  $('closes').disabled = !opts.length;
  $('too-late').hidden = opts.length > 0;
  $('submit').disabled = !opts.length;
}

function paintTo() {
  const opts = toOptions();
  if (!opts.includes(st.to) || hmToMin(st.to) < hmToMin(st.from) + 60) st.to = opts.find((h) => hmToMin(h) >= hmToMin(st.from) + 120) || opts[0];
  $('to').innerHTML = opts.map((h) => `<option ${h === st.to ? 'selected' : ''}>${h}</option>`).join('');
}

function render() {
  const today = dateOf(meta.now);
  const days = Array.from({ length: meta.bookingWindowDays }, (_, i) => addDays(today, i));
  if (!days.includes(st.date)) st.date = days[days.length > 1 ? 1 : 0];
  if (!st.budget) st.budget = st.fieldType === '7' ? '600000' : '300000';
  $('root').innerHTML = `
    <p class="crumb"><a href="/requests.html">Nhu cầu của tôi</a> / Đăng nhu cầu</p>
    <div class="page-head" style="margin-top:var(--sp-3)"><h1 class="h1">Đăng nhu cầu</h1><p class="sub">Chưa thấy giờ hợp ý? Cho biết bạn cần gì, các sân phù hợp sẽ gửi chào giá. Bạn xem, chọn một chào giá rồi đặt sân như bình thường; tiền chuyển thẳng cho chủ sân.</p></div>
    <form class="card card-pad stack" id="req-form" style="max-width:640px" novalidate>
      <div class="field"><label for="district">Quận</label>
        <select class="select" id="district" required><option value="">Chọn quận</option>${districts.map((d) => `<option ${d === st.district ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
      <fieldset class="field" style="border:0;padding:0;margin:var(--sp-3) 0 0;min-width:0"><legend style="padding:0;font-weight:600;margin-bottom:var(--sp-2)">Loại sân</legend>
        <div class="chips" role="group">${['5', '7'].map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${st.fieldType === t}">Sân ${t}</button>`).join('')}</div></fieldset>
      <fieldset class="field" style="border:0;padding:0;margin:var(--sp-3) 0 0;min-width:0"><legend style="padding:0;font-weight:600;margin-bottom:var(--sp-2)">Ngày</legend>
        <div class="chips" role="group" style="flex-wrap:wrap">${days.map((d) => `<button type="button" class="chip" data-date="${d}" aria-pressed="${st.date === d}">${esc(relativeDayLabel(d, today))}</button>`).join('')}</div></fieldset>
      <div class="row" style="gap:var(--sp-3);align-items:flex-end">
        <div class="field grow"><label for="from">Từ giờ</label><select class="select" id="from">${HOURS.slice(0, -1).map((h) => `<option ${h === st.from ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
        <div class="field grow"><label for="to">Đến giờ</label><select class="select" id="to"></select></div>
      </div>
      <div class="field"><label for="budget">Ngân sách cho một slot (đ)</label>
        <input class="input" id="budget" type="number" inputmode="numeric" min="1000" max="5000000" step="1000" value="${esc(st.budget)}">
        <span class="hint">Sân chào giá vẫn có thể cao hơn ngân sách; khi đó bạn thấy nhãn “Vượt ngân sách” và tự quyết.</span></div>
      <div class="field"><label for="closes">Nhận chào giá đến</label><select class="select" id="closes"></select>
        <span class="hint">Hết hạn mà bạn chưa chọn thì nhu cầu đóng và các chào giá hết hiệu lực. Sân cần thời gian chào giá nên hạn tối đa là ${meta.requestCloseMinutes} phút trước giờ bắt đầu khung giờ.</span>
        <p class="dlg-error" id="too-late" hidden>Còn quá ít thời gian trước khung giờ này. Chọn khung giờ muộn hơn hoặc ngày khác.</p></div>
      <div class="field"><label for="note">Ghi chú (không bắt buộc)</label><textarea class="textarea" id="note" rows="2" maxlength="300" placeholder="Ví dụ: đá giao hữu 14 người, cần chỗ để xe">${esc(st.note)}</textarea></div>
      <div class="notice" role="note"><div><b>Chào giá không giữ sân.</b> Chỉ khi bạn bấm chọn, hệ thống mới kiểm lại slot còn trống rồi đặt sân. Nếu người khác đặt trước thì chào giá đó không dùng được. Bạn đăng tối đa ${meta.requestMaxOpen} nhu cầu cùng lúc.</div></div>
      <p class="dlg-error" id="req-error" role="alert" hidden></p>
      <div class="row"><button type="submit" class="btn btn-lime" id="submit">Đăng nhu cầu</button><a class="btn btn-ghost" href="/requests.html">Để sau</a></div>
    </form>`;
  paintTo();
  paintDeadlines();
  decorate();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-type]');
  const d = e.target.closest('[data-date]');
  if (!t && !d) return;
  if (t) {
    if (st.budget === (st.fieldType === '7' ? '600000' : '300000')) st.budget = '';
    st.fieldType = t.dataset.type;
  }
  if (d) st.date = d.dataset.date;
  syncFields();
  render();
});
function syncFields() {
  for (const [id, key] of [['district', 'district'], ['from', 'from'], ['to', 'to'], ['budget', 'budget'], ['closes', 'closesAt'], ['note', 'note']]) if ($(id)) st[key] = $(id).value;
}
document.addEventListener('change', (e) => {
  if (!e.target.closest('#req-form')) return;
  syncFields();
  if (e.target.id === 'from') {
    paintTo();
    st.to = $('to').value;
  }
  if (['from', 'to'].includes(e.target.id)) paintDeadlines();
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'req-form') return;
  e.preventDefault();
  syncFields();
  const err = $('req-error');
  err.hidden = true;
  if (!st.district) {
    err.textContent = 'Vui lòng chọn quận.';
    err.hidden = false;
    return;
  }
  const btn = $('submit');
  btn.disabled = true;
  try {
    const r = await api.openRequest({ district: st.district, date: st.date, from: st.from, to: st.to, fieldType: st.fieldType, budget: Number(st.budget), closesAt: st.closesAt, note: st.note });
    location.href = `/request.html?id=${r.id}`;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
    toast(ex.message, { error: true });
  }
});

await mountShell();
if (!getUser()) redirectToLogin();
else if (getUser().role !== 'customer') $('root').innerHTML = '<div class="card empty"><p><b style="color:var(--text)">Chỉ tài khoản khách đăng được nhu cầu</b></p></div>';
else {
  try {
    [meta, districts] = await Promise.all([api.meta(), api.districts()]);
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không tải được dữ liệu</b><br>${esc(e.message)}</p></div>`;
  }
}
