// Màn 2: danh sách sân. Điều kiện lọc nằm trên URL: ?date&at&fieldType&district&maxPrice&lastMinute&q
import { api } from '/js/api.js';
import { mountShell, toast } from '/js/ui/shell.js';
import { hoursFor, nearestHour, settleChoice } from '/js/ui/hours.js';
import { $, decorate, esc, modeTag } from '/js/ui/page.js';
import { addDays, dateOf, dayLabel, hmToMin, minToHm, money, moneyShort, relativeDayLabel, weekdayOf } from '/js/ui/format.js';

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MAX_PILLS = 8;

let today;
let nowTs;
let windowDays = 3;
const state = { date: '', at: '', fieldType: '', district: '', maxPrice: '', lastMinute: '', q: '' };

function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const k of Object.keys(state)) state[k] = p.get(k) || '';
  if (!state.date || state.date > addDays(today, windowDays - 1)) state.date = today;
  if (state.at || state.date < today) Object.assign(state, settleChoice({ ...state, date: state.date < today ? today : state.date }, nowTs, windowDays));
}
function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) p.set(k, v);
  history.replaceState(null, '', `/venues.html?${p}`);
}

function paintFilters(districts) {
  $('f-days').innerHTML = Array.from({ length: windowDays }, (_, i) => addDays(today, i))
    .map((d) => {
      const rel = relativeDayLabel(d, today).split(',')[0];
      return `<button type="button" class="day-chip" data-date="${d}" aria-pressed="${d === state.date}" aria-label="${dayLabel(d)}"><span class="dow">${rel === 'Hôm nay' || rel === 'Mai' ? rel : DOW[weekdayOf(d)]}</span><span class="dnum">${d.slice(8)}</span><span class="dsub">${rel === 'Hôm nay' || rel === 'Mai' ? DOW[weekdayOf(d)] : `Th${+d.slice(5, 7)}`}</span></button>`;
    })
    .join('');
  const list = hoursFor(state.date, nowTs);
  $('f-at').innerHTML = ['<option value="">Cả ngày</option>', ...list.map((t) => `<option value="${t}">${t}</option>`)].join('');
  $('f-at').value = state.at;
  if (districts) $('f-district').insertAdjacentHTML('beforeend', districts.map((d) => `<option>${esc(d)}</option>`).join(''));
  $('f-district').value = state.district;
  for (const [id, key] of [['f-type', 'fieldType'], ['f-price', 'maxPrice']]) {
    $(id).querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === state[key])));
  }
  $('f-last').setAttribute('aria-pressed', String(!!state.lastMinute));
}

const slotLink = (venueId, s) => `/venue.html?id=${venueId}&date=${state.date}&slot=${s.start}&court=${s.courtId}`;

/** Mỗi giờ bắt đầu giữ một ô (rẻ nhất) trong các sân con còn trống. */
function pillsOf(v) {
  let slots = v.availableSlots;
  if (state.at) {
    const at = hmToMin(state.at);
    slots = slots.filter((s) => hmToMin(s.start) >= at - 30 && hmToMin(s.start) <= at + 90);
  }
  if (state.lastMinute) slots = slots.filter((s) => s.discountPercent > 0);
  const byStart = new Map();
  for (const s of slots) if (!byStart.has(s.start) || s.price < byStart.get(s.start).price) byStart.set(s.start, s);
  return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function card(v, i, pills) {
  const shown = pills.slice(0, MAX_PILLS);
  const more = pills.length - shown.length;
  const best = pills.reduce((m, s) => Math.max(m, s.discountPercent), 0);
  const unit = v.slotMinutes === 60 ? 'giờ' : `ca ${v.slotMinutes} phút`;
  const detail = `/venue.html?id=${v.id}&date=${state.date}`;
  return `<article class="card card-hover venue-card">
    <div class="media">${v.imageUrl ? `<img src="${esc(v.imageUrl)}" width="900" height="450" loading="lazy" alt="${v.imageIsIllustrative ? 'Ảnh minh họa, không phải ảnh của sân' : esc(v.name)}">` : '<span class="no-photo">Chưa có ảnh</span>'}
      ${best ? `<div class="tags"><span class="tag-sale">-${best}% giờ chót</span></div>` : ''}</div>
    <div class="body">
      <div class="row" style="gap:8px">${modeTag(v.requiresApproval)}</div>
      <a class="title" href="${detail}">${esc(v.name)}</a>
      <div class="meta"><span data-icon="pin">${esc(v.district)}</span><span>${v.fieldTypes.map((t) => `Sân ${t}`).join(' · ')}</span></div>
      <div><span class="price">${money(v.minPrice)}</span> <span class="muted">– ${money(v.maxPrice)} / ${unit}</span></div>
      <p class="slot-row-label">Giờ còn trống · ${relativeDayLabel(state.date, today)}</p>
      ${
        shown.length
          ? `<div class="slot-pills">${shown
              .map((s) => `<a class="slot-pill${s.discountPercent ? ' sale' : ''}" href="${slotLink(v.id, s)}" aria-label="${s.start}, ${money(s.price)}${s.discountPercent ? `, giảm ${s.discountPercent}%` : ''}"><span class="t">${s.start}</span><span class="p">${moneyShort(s.price)}${s.discountPercent ? ` · -${s.discountPercent}%` : ''}</span></a>`)
              .join('')}${more > 0 ? `<a class="slot-pill more" href="${detail}"><span class="t">+${more}</span><span class="p">giờ khác</span></a>` : ''}</div>`
          : `<p class="none">Không còn giờ phù hợp.</p><a class="btn btn-sm" href="${detail}">Xem lịch cả ngày</a>`
      }
    </div>
  </article>`;
}

async function load() {
  writeUrl();
  $('summary').textContent = 'Đang tìm sân…';
  try {
    const r = await api.venues({ date: state.date, fieldType: state.fieldType, district: state.district, maxPrice: state.maxPrice, q: state.q });
    const rows = r.venues.map((v) => ({ v, pills: pillsOf(v) }));
    const withSlots = rows.filter((x) => x.pills.length).sort((a, b) => b.pills.length - a.pills.length);
    const without = rows.filter((x) => !x.pills.length);
    const total = withSlots.reduce((n, x) => n + x.pills.length, 0);
    $('summary').textContent = withSlots.length
      ? `${withSlots.length} sân còn ${total} giờ trống · ${relativeDayLabel(state.date, today)}${state.at ? ` · quanh ${state.at}` : ''}`
      : `Không sân nào còn giờ trống · ${relativeDayLabel(state.date, today)}${state.at ? ` · quanh ${state.at}` : ''}`;
    $('results').innerHTML = [...withSlots, ...without].map((x, i) => card(x.v, i, x.pills)).join('');
    $('empty').hidden = withSlots.length > 0 || rows.length > 0;
    $('empty-why').textContent = 'Thử đổi ngày, bỏ bớt bộ lọc hoặc chọn giờ khác.';
    decorate();
  } catch (e) {
    $('summary').textContent = 'Không tải được danh sách sân.';
    toast(e.message || 'Không tải được dữ liệu', { error: true });
  }
}

function wire() {
  $('f-days').addEventListener('click', (e) => {
    const b = e.target.closest('[data-date]');
    if (!b) return;
    state.date = b.dataset.date;
    state.at = nearestHour(hoursFor(state.date, nowTs), state.at);
    paintFilters();
    load();
  });
  $('f-at').addEventListener('change', () => ((state.at = $('f-at').value), load()));
  $('f-district').addEventListener('change', () => ((state.district = $('f-district').value), load()));
  for (const [id, key] of [['f-type', 'fieldType'], ['f-price', 'maxPrice']]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      state[key] = b.dataset.v;
      paintFilters();
      load();
    });
  }
  $('f-last').addEventListener('click', () => {
    state.lastMinute = state.lastMinute ? '' : '1';
    paintFilters();
    load();
  });
  $('clear-filters').addEventListener('click', () => {
    Object.assign(state, { at: '', fieldType: '', district: '', maxPrice: '', lastMinute: '', q: '' });
    paintFilters();
    load();
  });
}

async function main() {
  await mountShell();
  decorate();
  try {
    const [meta, districts] = await Promise.all([api.meta(), api.districts()]);
    nowTs = meta.now;
    today = dateOf(meta.now);
    windowDays = meta.bookingWindowDays;
    readUrl();
    paintFilters(districts);
    wire();
    await load();
  } catch (e) {
    $('summary').textContent = 'Không tải được dữ liệu.';
    toast(e.message || 'Không tải được dữ liệu', { error: true });
  }
}
main();
