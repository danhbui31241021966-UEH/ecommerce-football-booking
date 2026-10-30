// Trang chủ: mọi dữ liệu đi qua api.js; form tìm kiếm chuyển sang /venues.html với điều kiện trên URL.
import { api } from '/js/api.js';
import { mountShell, toast } from '/js/ui/shell.js';
import { icon } from '/js/ui/icons.js';
import { teamSlotHref } from '/js/ui/match.js';
import { hoursFor, nearestHour, settleChoice } from '/js/ui/hours.js';
import { addDays, dateOf, hmToMin, minToHm, money, moneyShort, relativeDayLabel, timeOf } from '/js/ui/format.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const shortName = (n) => n.replace(/^Sân (bóng đá|bóng|cỏ nhân tạo|banh|mini)\s+/i, '').replace(/^Sân\s+/i, '');
const slotLink = (venueId, date, s) => teamSlotHref(venueId, date, s) || `/venue.html?id=${venueId}&date=${date}&slot=${s.start}&court=${s.courtId}`;
const isTeam = (s) => !!(s.match || s.teamMode);
// Mỗi (sân, giờ) tối đa hai dòng: ô đặt thường và ô Ghép trận (ưu tiên trận đang chờ đội thứ hai hơn ô mở trận mới). Thẻ sân chỉ liệt kê ô đặt thường.
const rank = (s) => (s.match ? 1 : s.teamMode ? 2 : 0);
const better = (s, cur) => !cur || rank(s) < rank(cur) || (rank(s) === rank(cur) && s.price < cur.price);

/** Mỗi (sân, giờ) lấy một ô rẻ nhất trong số các sân con còn trống, sắp theo giờ rồi theo sân. */
function flatten(venues) {
  const best = new Map();
  for (const v of venues) {
    for (const s of v.availableSlots) {
      const k = `${v.id}|${s.start}|${isTeam(s) ? 1 : 0}`;
      if (better(s, best.get(k))) best.set(k, { ...s, venue: v });
    }
  }
  return [...best.values()].sort((a, b) => a.start.localeCompare(b.start) || a.venue.id - b.venue.id || isTeam(a) - isTeam(b));
}

function defaultChoice(nowTs, window) {
  const today = dateOf(nowTs);
  const min = hmToMin(timeOf(nowTs));
  if (min >= 21 * 60 + 30) return { date: addDays(today, 1), at: '19:00' };
  if (min < 17 * 60) return { date: today, at: '19:00' };
  return { date: today, at: minToHm(Math.min(22 * 60, Math.ceil((min + 1) / 60) * 60)) };
}

function fillSearch(meta, districts) {
  const today = dateOf(meta.now);
  const choice = settleChoice(defaultChoice(meta.now), meta.now, meta.bookingWindowDays);
  $('f-date').innerHTML = Array.from({ length: meta.bookingWindowDays }, (_, i) => addDays(today, i))
    .map((d) => `<option value="${d}"${d === choice.date ? ' selected' : ''}>${relativeDayLabel(d, today)}</option>`)
    .join('');
  const paintHours = (keep) => {
    const list = hoursFor($('f-date').value, meta.now);
    const at = nearestHour(list, keep);
    $('f-at').innerHTML = list.map((t) => `<option${t === at ? ' selected' : ''}>${t}</option>`).join('');
  };
  paintHours(choice.at);
  $('f-date').addEventListener('change', () => paintHours($('f-at').value));
  $('f-district').insertAdjacentHTML('beforeend', districts.map((d) => `<option>${esc(d)}</option>`).join(''));
  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(e.target)) if (v) params.set(k, v);
    location.href = `/venues.html?${params}`;
  });
}

function renderTonight(rows, date, today, total) {
  $('tonight-meta').textContent = `${relativeDayLabel(date, today)} · ${total} giờ còn trống`;
  $('tonight-more').href = `/venues.html?date=${date}`;
  // Giữ chỗ cho tối đa 2 dòng Ghép trận để không bị đẩy ra ngoài danh sách bởi các giờ đặt thường sớm hơn.
  const shown = [...rows.filter((s) => !isTeam(s)).slice(0, 6), ...rows.filter(isTeam).slice(0, 2)].sort((a, b) => a.start.localeCompare(b.start) || a.venue.id - b.venue.id || isTeam(a) - isTeam(b));
  $('tonight-rows').innerHTML = shown.length
    ? shown
        .map(
          (s, i) => `<a class="tonight-row${i >= 4 ? ' extra' : ''}" href="${slotLink(s.venue.id, date, s)}"><span class="t">${s.start}</span><span class="what"><b>${esc(shortName(s.venue.name))}</b><span>${esc(s.courtName)} · Sân ${s.fieldType}</span></span><span class="cost"><span class="price">${money(s.price)}</span>${s.discountPercent ? `<span class="tag-sale">-${s.discountPercent}%</span>` : ''}${isTeam(s) ? '<span class="tag-team">Ghép trận</span>' : ''}</span></a>`,
        )
        .join('')
    : '<p class="muted" style="padding:var(--sp-4) 0">Hôm nay đã hết giờ trống.</p>';
  const items = shown.filter((_, i) => i < 6).map((s) => `${s.start} ${esc(shortName(s.venue.name))} · ${esc(s.courtName)} · ${moneyShort(s.price)}${s.discountPercent ? ` · -${s.discountPercent}%` : ''}`);
  if (items.length) {
    $('ticker-track').innerHTML = items.map((t) => `<span>${t}</span>`).join('') + items.map((t) => `<span aria-hidden="true">${t}</span>`).join('');
    $('ticker').hidden = false;
  }
}

function renderFixtures(todayRows, today) {
  const sale = todayRows.filter((s) => s.discountPercent > 0);
  const seen = new Set();
  const picks = [];
  for (const s of sale) if (!seen.has(s.venue.id) && picks.length < 3) (seen.add(s.venue.id), picks.push(s));
  for (const s of sale) if (picks.length < 3 && !picks.includes(s)) picks.push(s);
  $('fixtures-empty').hidden = picks.length > 0;
  $('fixtures').hidden = picks.length === 0;
  $('fixtures').innerHTML = picks
    .map(
      (s) => `<a class="fixture" href="${slotLink(s.venue.id, today, s)}">
            <div class="fixture-top"><span class="tag-sale">-${s.discountPercent}%</span><span>Sân ${s.fieldType} · ${s.venue.requiresApproval ? 'Chủ sân duyệt' : 'Tự xác nhận'}</span></div>
            <span class="time">${s.start}</span>
            <div><b>${esc(s.venue.name)} · ${esc(s.courtName)}</b><div class="where">${esc(s.venue.district)}</div></div>
            <div class="cost"><span class="price">${money(s.price)}</span><span class="price-old">${money(s.basePrice)}</span></div>
            <span class="btn btn-lime">Đặt giờ này <span aria-hidden="true">→</span></span>
          </a>`,
    )
    .join('');
}

function renderVenues(venues, date) {
  const plain = (v) => v.availableSlots.filter((s) => !isTeam(s));
  const top = venues.filter((v) => plain(v).length).sort((a, b) => plain(b).length - plain(a).length).slice(0, 3);
  $('venue-list').innerHTML = top
    .map((v, i) => {
      const byStart = new Map();
      for (const s of v.availableSlots) if (!isTeam(s) && better(s, byStart.get(s.start))) byStart.set(s.start, s);
      const slots = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
      // Ưu tiên giờ sắp tới nhưng chừa chỗ cho giờ giảm giá nếu có
      const pills = slots.slice(0, 2);
      const sale = slots.find((s) => s.discountPercent && !pills.includes(s));
      if (sale) pills[1] = sale;
      pills.sort((a, b) => a.start.localeCompare(b.start));
      const more = slots.length - pills.length;
      const unit = v.slotMinutes === 60 ? 'giờ' : `ca ${v.slotMinutes} phút`;
      const types = v.fieldTypes.map((t) => `Sân ${t}`).join(' · ');
      return `<article class="venue">
            <span class="no">0${i + 1}</span>
            <a class="photo" href="/venue.html?id=${v.id}&date=${date}" tabindex="-1" aria-hidden="true">${v.imageUrl ? `<img src="${esc(v.imageUrl)}" width="900" height="600" loading="lazy" alt="">` : '<span class="no-photo">Chưa có ảnh</span>'}</a>
            <h3><a href="/venue.html?id=${v.id}&date=${date}">${esc(v.name)}</a></h3>
            <div class="meta"><span data-icon="pin">${esc(v.district)}</span><span>${types}</span><span data-icon="${v.requiresApproval ? 'hourglass' : 'bolt'}">${v.requiresApproval ? 'Chủ sân duyệt' : 'Tự xác nhận'}</span></div>
            <p class="from"><span class="price">${money(v.minPrice)}</span> <span class="muted">– ${money(v.maxPrice)} / ${unit}</span></p>
            <p class="slot-row-label">Giờ còn trống</p>
            <div class="slot-pills">
              ${pills.map((s) => `<a class="slot-pill${s.discountPercent ? ' sale' : ''}${isTeam(s) ? ' team' : ''}" href="${slotLink(v.id, date, s)}"><span class="t">${s.start}</span><span class="p">${isTeam(s) ? `Ghép trận · ${moneyShort(s.price)}` : `${moneyShort(s.price)}${s.discountPercent ? ` · -${s.discountPercent}%` : ''}`}</span></a>`).join('')}
              ${more > 0 ? `<a class="slot-pill more" href="/venue.html?id=${v.id}&date=${date}"><span class="t">+${more}</span><span class="p">giờ khác</span></a>` : ''}
            </div>
          </article>`;
    })
    .join('');
}

function decorate() {
  document.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    el.insertAdjacentHTML(el.childElementCount || el.textContent.trim() ? 'afterbegin' : 'beforeend', icon(el.dataset.icon, 16));
  });
}

async function main() {
  mountShell();
  decorate();
  try {
    const [meta, districts] = await Promise.all([api.meta(), api.districts()]);
    fillSearch(meta, districts);
    const today = dateOf(meta.now);
    const first = await api.venues({ date: today });
    const todayRows = flatten(first.venues);
    let listDate = today;
    let listVenues = first.venues;
    let rows = todayRows;
    if (rows.length < 6 && meta.bookingWindowDays > 1) {
      const next = addDays(today, 1);
      const r = await api.venues({ date: next });
      listDate = next;
      listVenues = r.venues;
      rows = flatten(r.venues);
    }
    renderTonight(rows, listDate, today, rows.length);
    renderFixtures(todayRows, today);
    renderVenues(listVenues, listDate);
    decorate();
  } catch (e) {
    toast(e.message || 'Không tải được dữ liệu', { error: true });
    $('tonight-meta').textContent = 'Không tải được dữ liệu';
  }
}
main();
