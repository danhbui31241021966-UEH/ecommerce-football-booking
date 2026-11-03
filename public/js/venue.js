// Màn 3 + 4: chi tiết sân, lưới giờ, thanh đặt và hộp xác nhận. ?id=&date=&slot=HH:mm&court=
import { api, ApiError } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, countdown, decorate, esc, isCustomer, modeTag, policyStepsHtml, redirectToLogin } from '/js/ui/page.js';
import { addDays, cancelDeadlines, dateOf, dayLabel, hmToMin, mmss, money, moneyShort, relativeDayLabel, secondsLeft, weekdayOf } from '/js/ui/format.js';

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const params = new URLSearchParams(location.search);
const venueId = Number(params.get('id'));

const ESTIMATED_LABEL = { courtCount: 'số sân', fieldTypes: 'loại sân', openingHours: 'giờ mở cửa', priceVnd: 'giá' };
const DERIVED_LABEL = { district: 'khu vực', address: 'địa chỉ', name: 'tên', phone: 'số điện thoại' };

// Sân lấy từ nguồn công khai: ghi nguồn, ngày lấy và các trường chỉ là ước lượng (dataSource do dữ liệu cung cấp).
function sourceNote(ds) {
  if (!ds) return '';
  const links = ds.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(', ');
  const [y, m, d] = ds.retrievedOn.split('-');
  const parts = [`Nguồn dữ liệu: ${links}, lấy ngày ${d}/${m}/${y}.`];
  if (ds.estimated.length) parts.push(`Ước lượng: ${ds.estimated.map((k) => ESTIMATED_LABEL[k] || k).join(', ')}.`);
  if (ds.derived?.length) parts.push(`Suy ra từ địa chỉ: ${ds.derived.map((k) => DERIVED_LABEL[k] || k).join(', ')}.`);
  return `<p class="muted source-note">${parts.join(' ')}</p>`;
}

// Nhãn dưới ảnh: ảnh minh họa của sân demo, hoặc ghi nguồn ảnh lấy từ Google Maps.
function photoNote() {
  if (!venue.imageUrl) return '';
  if (venue.imageIsIllustrative) return '<span class="photo-note">Ảnh minh họa</span>';
  const c = venue.imageCredit;
  if (!c) return '';
  const who = c.contributor ? ` · ${esc(c.contributor)}` : '';
  return `<a class="photo-note" href="${esc(c.url)}" target="_blank" rel="noopener">Ảnh: ${esc(c.source)}${who}</a>`;
}

let venue;
let meta;
let today;
let date;
let schedule;
let picked = null; // { courtId, start }
let wantCourt = Number(params.get('court')) || null; // sân đang xem trên mobile
let reliability = null;
let stopTimers = [];

const courtById = (id) => venue.courts.find((c) => c.id === id);
const periodOf = (start) => (hmToMin(start) < 12 * 60 ? 'Sáng' : hmToMin(start) < 17 * 60 ? 'Chiều' : 'Tối');
const findSlot = (courtId, start) => schedule.courts.find((c) => c.id === courtId)?.slots.find((s) => s.start === start);
const isBookable = (s) => s && (s.status === 'available' || s.offeredToYou);

function setUrl() {
  const p = new URLSearchParams({ id: venueId, date });
  if (picked) (p.set('slot', picked.start), p.set('court', picked.courtId));
  history.replaceState(null, '', `/venue.html?${p}`);
}

// Tiêu đề, mô tả, thẻ xem trước (Open Graph) và canonical theo từng sân; trang tĩnh chỉ có bản chung.
const SITE = 'https://ggo-datsan.pages.dev';
function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) (el = document.createElement('meta'), el.setAttribute(attr, key), document.head.append(el));
  el.setAttribute('content', value);
}
function setSeo() {
  const where = venue.name.includes(venue.district) ? 'TP.HCM' : `${venue.district}, TP.HCM`; // tên đã có quận thì không lặp lại
  const title = `${venue.name} – ${where} | Đặt sân GGO`;
  const types = venue.fieldTypes?.length ? `, sân ${venue.fieldTypes.join(' và ')} người` : '';
  const desc = `Đặt ${venue.name} ở ${where}: xem giờ còn trống, giá từ ${money(venue.minPrice)}/giờ${types}. Đặt online, chuyển khoản bằng mã QR.`;
  const url = `${SITE}/venue.html?id=${venue.id}`;
  const image = SITE + (venue.imageUrl || '/img/photos/hero-1920.jpg');
  document.title = title;
  setMeta('name', 'description', desc);
  for (const [k, v] of [['og:title', title], ['og:description', desc], ['og:url', url], ['og:image', image]]) setMeta('property', k, v);
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) (link = document.createElement('link'), link.rel = 'canonical', document.head.append(link));
  link.href = url;
  // sân demo không có dataSource là sân hư cấu, không cho lập chỉ mục
  if (!venue.dataSource) setMeta('name', 'robots', 'noindex,follow');
}

/* ---------- Khối thông tin sân ---------- */
function renderTop() {
  setSeo();
  const unit = venue.slotMinutes === 60 ? 'giờ' : `ca ${venue.slotMinutes} phút`;
  $('venue-root').innerHTML = `
    <p class="crumb"><a href="/">Trang chủ</a> / <a href="/venues.html?date=${date}">Tìm sân</a> / ${esc(venue.name)}</p>
    <div class="venue-top" style="margin-top:var(--sp-3)">
      <div class="photo">${venue.imageUrl ? `<img src="${esc(venue.imageUrl)}" width="900" height="506" alt="${venue.imageIsIllustrative ? 'Ảnh minh họa, không phải ảnh của sân' : esc(venue.name)}">` : '<span class="no-photo">Chưa có ảnh</span>'}${photoNote()}</div>
      <div class="info">
        <div class="row" style="gap:8px">${modeTag(venue.requiresApproval)}${venue.lastMinutePercent ? `<span class="tag-sale">Giờ chót -${venue.lastMinutePercent}%</span>` : ''}</div>
        <h1 class="h1">${esc(venue.name)}</h1>
        <div class="addr"><span data-icon="pin">${esc(venue.address)}</span>
          <a href="${esc(venue.mapsUrl)}" target="_blank" rel="noopener">Mở Google Maps</a></div>
        <p><span class="price">${money(venue.minPrice)}</span> <span class="muted">– ${money(venue.maxPrice)} / ${unit} · mở ${venue.openTime}–${venue.closeTime}</span></p>
        <p class="muted">${esc(venue.description)}</p>
        ${venue.amenities.length ? `<div class="amenities" aria-label="Tiện ích">${venue.amenities.map((a) => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
        ${venue.phone ? `<p class="muted" style="font-size:var(--fs-sm)">Điện thoại: <a href="tel:${esc(venue.phone)}">${esc(venue.phone)}</a></p>` : ''}
        ${sourceNote(venue.dataSource)}
      </div>
    </div>
    ${(venue.leagues || []).length ? `<section class="card card-pad venue-leagues" aria-labelledby="vl-title" style="margin-bottom:var(--sp-4)"><h2 class="h3" id="vl-title">Giải đang đá ở sân này</h2><ul>${venue.leagues.map((l) => `<li><a href="/league.html?id=${l.id}">${esc(l.name)}</a> <span class="muted">· sân ${esc(l.fieldType)} người · ${l.status === 'ongoing' ? 'đang đá' : 'sắp đá'}</span></li>`).join('')}</ul></section>` : ''}
    <div class="rules-grid card card-pad" style="margin-bottom:var(--sp-8)">
      ${venue.rules ? `<div><h3>Nội quy sân</h3><p>${esc(venue.rules)}</p></div>` : ''}
      <div><h3>Chính sách hủy</h3><p>${esc(venue.cancelPolicy)}</p></div>
    </div>
    <section aria-labelledby="pick-title">
      <div class="pick-head">
        <div><h2 class="h2" id="pick-title">Chọn giờ</h2><p class="muted" id="pick-sub"></p></div>
        <div class="day-chips" id="days" role="group" aria-label="Chọn ngày"></div>
      </div>
      <div class="slot-legend" aria-label="Chú giải">
        <span><i class="slot slot-available"></i>Trống</span>
        <span><i class="slot" aria-pressed="true"></i>Bạn chọn</span>
        <span><i class="slot slot-held"></i>Đang giữ</span>
        <span><i class="slot slot-booked"></i>Đã đặt</span>
        <span><i class="slot slot-blocked"></i>Bị chặn</span>
        <span><i class="slot slot-league"></i>Giải</span>
        <span><i class="slot slot-offered"></i>Giữ cho người đang chờ</span>
        <span><i class="slot slot-for-you"></i>Giữ cho bạn</span>
        <span><i class="slot slot-past"></i>Đã qua</span>
      </div>
      <div id="picked-note"></div>
      <div id="grid" aria-live="polite"></div>
    </section>`;
  $('days').innerHTML = Array.from({ length: meta.bookingWindowDays }, (_, i) => addDays(today, i))
    .map((d) => {
      const rel = relativeDayLabel(d, today).split(',')[0];
      return `<button type="button" class="day-chip" data-date="${d}" aria-pressed="${d === date}" aria-label="${dayLabel(d)}"><span class="dow">${rel === 'Hôm nay' || rel === 'Mai' ? rel : DOW[weekdayOf(d)]}</span><span class="dnum">${d.slice(8)}</span><span class="dsub">${rel === 'Hôm nay' || rel === 'Mai' ? DOW[weekdayOf(d)] : `Th${+d.slice(5, 7)}`}</span></button>`;
    })
    .join('');
  decorate();
}

/* ---------- Lưới giờ ---------- */
function cell(court, s, layout) {
  const key = `data-court="${court.id}" data-start="${s.start}"`;
  const sel = picked && picked.courtId === court.id && picked.start === s.start;
  // Mobile: giờ ở dòng trên, trạng thái/giá ở dòng dưới. Desktop: cột đã là giờ nên dòng trên là giá hoặc trạng thái.
  const top = (t) => (layout === 'm' ? `<span class="t">${s.start}</span>` : t ? `<span class="t">${t}</span>` : '');
  const wait = (label) =>
    s.onWaitlist
      ? `<span class="s">${label} · bạn đang chờ</span>`
      : `<span class="s">${label}</span>${isCustomer() || !getUser() ? `<button type="button" class="wait-btn" data-wait ${key}>Báo tôi khi trống</button>` : ''}`;
  switch (s.status) {
    case 'past':
      return `<div class="slot slot-past">${top('')}<span class="s">Đã qua</span></div>`;
    case 'blocked':
      if (s.league) return `<div class="slot slot-league">${top('')}<a class="s" href="/league.html?id=${s.league.id}" title="Giải: ${esc(s.league.name)}">Giải: ${esc(s.league.name)}</a></div>`;
      return `<div class="slot slot-blocked">${top('')}<span class="s">Bị chặn</span></div>`;
    case 'booked':
    case 'held':
      return `<div class="slot slot-${s.status}">${top('')}${s.mine ? `<span class="s">${s.status === 'booked' ? 'Bạn đã đặt' : 'Bạn đang giữ'}</span>` : wait(s.status === 'booked' ? 'Đã đặt' : 'Đang giữ')}${s.match?.joinable ? `<a class="slot-transfer" href="/match.html?id=${s.match.id}">Chờ đội thứ hai · vào kèo</a>` : s.match ? `<a class="slot-transfer" href="/match.html?id=${s.match.id}">${s.mine ? 'Kèo của bạn' : 'Ghép kèo'}</a>` : ''}${s.transfer && !s.mine ? `<a class="slot-transfer" href="/transfer.html?id=${s.transfer.id}">Đang pass · ${moneyShort(s.transfer.askPrice)}</a>` : ''}</div>`;
    case 'offered':
      if (s.offeredToYou)
        return `<button type="button" class="slot slot-for-you" data-pick ${key} aria-pressed="${!!sel}">${top(moneyShort(s.price))}<span class="s" data-offer="${esc(s.offerExpiresAt)}">Giữ cho bạn</span></button>`;
      return `<div class="slot slot-offered">${top('')}${s.onWaitlist ? '<span class="s">Người chờ đang đặt · bạn chờ tiếp</span>' : `<span class="s">Người chờ đang đặt</span>${isCustomer() || !getUser() ? `<button type="button" class="wait-btn" data-wait ${key}>Báo tôi khi trống</button>` : ''}`}</div>`;
    default: {
      if (s.teamMode) {
        const q = `venue=${venue.id}&court=${court.id}&date=${date}&start=${s.start}`;
        return `<a class="slot slot-available slot-team" href="/match-new.html?${q}" aria-label="${s.start}, ${money(s.basePrice)}, ghép kèo, chốt sân khi đủ hai đội">${top(moneyShort(s.basePrice))}<span class="s">${layout === 'm' ? 'Đủ 2 đội' : 'Đủ hai đội'}</span></a>`;
      }
      const sale = s.discountPercent > 0;
      const sub = layout === 'm' ? moneyShort(s.price) : sale ? `-${s.discountPercent}% giờ chót` : s.peak ? 'Cao điểm' : 'Trống';
      return `<button type="button" class="slot slot-available${sale ? ' sale' : ''}" data-pick ${key} aria-pressed="${!!sel}" aria-label="${s.start}, ${money(s.price)}${sale ? `, giảm ${s.discountPercent}%` : ''}${sel ? ', đang chọn' : ''}">${sale && layout === 'm' ? `<span class="corner tag-sale" style="padding:0 5px">-${s.discountPercent}%</span>` : ''}${top(moneyShort(s.price))}<span class="s">${layout === 'm' ? 'Trống' : sub}</span></button>`;
    }
  }
}

function renderGrid() {
  const courts = schedule.courts;
  if (!courts.length) {
    $('grid').innerHTML = '<div class="card empty"><p>Sân này chưa có sân nào đang mở.</p></div>';
    return;
  }
  if (!courts.some((c) => c.id === wantCourt)) wantCourt = courts[0].id;
  const cur = courts.find((c) => c.id === wantCourt);
  const periods = ['Sáng', 'Chiều', 'Tối'];
  const mobile = `<div class="slot-mobile">
    ${courts.length > 1 ? `<div class="segmented court-switch" role="group" aria-label="Chọn sân">${courts.map((c) => `<button type="button" data-court-tab="${c.id}" aria-pressed="${c.id === wantCourt}">${esc(c.name)} · ${c.fieldType}</button>`).join('')}</div>` : `<p class="muted" style="margin-bottom:var(--sp-3)">${esc(cur.name)} · sân ${cur.fieldType} người</p>`}
    ${periods
      .map((p) => {
        const slots = cur.slots.filter((s) => periodOf(s.start) === p);
        if (!slots.length) return '';
        return `<div class="slot-period"><div class="slot-period-head"><h3 style="font-weight:700;font-size:var(--fs-lg)">${p}</h3><span class="muted" style="font-size:12px">${slots[0].start} – ${slots.at(-1).end}</span>${slots.some((s) => s.peak) ? '<span class="tag-peak" data-icon="flame">Có giờ cao điểm</span>' : ''}</div>
          <div class="slot-period-grid">${slots.map((s) => cell(cur, s, 'm')).join('')}</div></div>`;
      })
      .join('')}
  </div>`;
  const starts = courts[0].slots.map((s) => s.start);
  const desktop = `<div class="slot-desktop"><div class="slot-board"><table>
    <thead><tr><th><span class="sr-only">Giờ</span></th>${courts.map((c) => `<th scope="col">${esc(c.name)}<small>Sân ${c.fieldType} người</small></th>`).join('')}</tr></thead>
    <tbody>${starts
      .map((st) => `<tr><td class="time">${st}</td>${courts.map((c) => `<td>${cell(c, findSlot(c.id, st), 'd')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div></div>`;
  $('grid').innerHTML = mobile + desktop;
  $('pick-sub').textContent = `${dayLabel(date)} · mỗi ca ${venue.slotMinutes} phút`;
  decorate();
  startOfferTimers();
}

function startOfferTimers() {
  stopTimers.forEach((f) => f());
  stopTimers = [];
  const byOffer = new Map();
  document.querySelectorAll('[data-offer]').forEach((el) => {
    const k = el.dataset.offer;
    if (!byOffer.has(k)) byOffer.set(k, []);
    byOffer.get(k).push(el);
  });
  for (const [deadline, els] of byOffer) {
    const left = secondsLeft(deadline, meta.now);
    const stop = countdown(els[0], left, (n) => `Giữ cho bạn · ${mmss(n)}`, () => reloadGrid('Lượt giữ chỗ của bạn đã hết hạn.'));
    // các phần tử còn lại cùng hạn: đồng bộ chữ theo phần tử đầu
    const sync = setInterval(() => els.slice(1).forEach((e) => (e.textContent = els[0].textContent)), 1000);
    els.slice(1).forEach((e) => (e.textContent = els[0].textContent));
    stopTimers.push(stop, () => clearInterval(sync));
  }
}

async function reloadGrid(message) {
  try {
    [meta, schedule] = await Promise.all([api.meta(), api.schedule(venueId, date)]);
    if (picked && !isBookable(findSlot(picked.courtId, picked.start))) picked = null;
    renderGrid();
    paintBar();
    paintPickedNote();
    if (message) toast(message, { error: true });
  } catch (e) {
    toast(e.message, { error: true });
  }
}

/* ---------- Ô đang chọn: thanh đặt và ghi chú ---------- */
function paintBar() {
  const bar = $('booking-bar');
  bar.hidden = false;
  const s = picked && findSlot(picked.courtId, picked.start);
  const btn = $('bar-book');
  const user = getUser();
  if (user && !isCustomer()) {
    $('bar-what').textContent = 'Chỉ tài khoản khách mới đặt được sân';
    $('bar-total').textContent = '—';
    btn.disabled = true;
    return;
  }
  if (!s) {
    $('bar-what').textContent = 'Chọn một giờ trống ở lưới phía trên';
    $('bar-total').textContent = '—';
    btn.disabled = true;
    return;
  }
  const court = courtById(picked.courtId);
  $('bar-what').textContent = `${court.name} · ${s.start}–${s.end} · ${relativeDayLabel(date, today)}`;
  $('bar-total').textContent = money(s.price);
  btn.disabled = false;
}

function paintPickedNote() {
  const want = params.get('slot');
  const el = $('picked-note');
  el.innerHTML = '';
  if (!want || date !== params.get('date') || picked) return;
  const court = Number(params.get('court')) || null;
  const s = court ? findSlot(court, want) : schedule.courts.map((c) => findSlot(c.id, want)).find(Boolean);
  if (!s) return;
  const why = { booked: 'đã có người đặt', held: 'đang có người giữ', blocked: 'bị chủ sân chặn', past: 'đã qua', offered: 'đang giữ cho người đã đăng ký chờ' }[s.status];
  if (why) el.innerHTML = `<div class="notice warn picked-note" role="status">Giờ ${want} bạn chọn từ trang trước ${why}. ${['booked', 'held', 'offered'].includes(s.status) ? 'Bấm “Báo tôi khi trống” ở ô đó để được báo khi có chỗ, hoặc chọn giờ khác.' : 'Chọn giờ khác bên dưới.'}</div>`;
}

function pick(courtId, start) {
  picked = picked && picked.courtId === courtId && picked.start === start ? null : { courtId, start };
  if (picked) wantCourt = courtId;
  setUrl();
  renderGrid();
  paintBar();
}

/* ---------- Hộp xác nhận ---------- */
function openConfirm() {
  const user = getUser();
  if (!user) return redirectToLogin();
  const s = picked && findSlot(picked.courtId, picked.start);
  if (!s) return;
  const court = courtById(picked.courtId);
  const restricted = reliability?.restricted;
  const needsApproval = venue.requiresApproval || restricted;
  $('dlg-venue').textContent = `${venue.name} · ${court.name} (sân ${court.fieldType})`;
  $('dlg-time').textContent = `${s.start}–${s.end}, ${dayLabel(date)}`;
  $('dlg-orig-row').hidden = $('dlg-sale-row').hidden = !s.discountPercent;
  $('dlg-orig').textContent = money(s.basePrice);
  $('dlg-sale').textContent = `-${money(s.basePrice - s.price)} (${s.discountPercent}%)`;
  $('dlg-total').textContent = money(s.price);
  $('dlg-approval').hidden = !needsApproval;
  $('dlg-auto').hidden = needsApproval;
  if (needsApproval) {
    $('dlg-approval').textContent = restricted && !venue.requiresApproval
      ? `Lịch đặt này phải chờ chủ sân đồng ý, vì bạn đã bùng sân hoặc hủy sát giờ ${reliability.violations} lần trong ${reliability.windowDays} ngày qua. Chủ sân có ${meta.holdMinutes} phút để trả lời, quá hạn thì giờ tự mở lại.`
      : `Sân này cần chủ sân đồng ý. Sau khi đặt, bạn chờ tối đa ${meta.holdMinutes} phút; quá hạn mà chưa được đồng ý thì giờ tự mở lại. Bạn chưa cần chuyển khoản lúc này.`;
  } else {
    $('dlg-auto').textContent = 'Sân đặt là chốt: đặt xong là giữ được sân và bạn nhận mã QR để chuyển khoản.';
  }
  $('dlg-policy').innerHTML = policyStepsHtml(`${date} ${s.start}:00`, meta.now);
  $('dlg-error').hidden = true;
  $('do-book').textContent = `${needsApproval ? 'Gửi yêu cầu' : 'Đặt sân'} · ${money(s.price)}`;
  $('do-book').disabled = false;
  $('confirm-dialog').showModal();
}

async function submitBooking() {
  const btn = $('do-book');
  btn.disabled = true;
  try {
    const b = await api.createBooking({ courtId: picked.courtId, date, start: picked.start, note: $('note').value.trim() });
    location.href = `/booking.html?id=${b.id}`;
  } catch (e) {
    $('confirm-dialog').close();
    if (e instanceof ApiError && e.status === 409) {
      picked = null;
      setUrl();
      await reloadGrid(e.message);
    } else if (e instanceof ApiError && e.status === 401) {
      redirectToLogin();
    } else {
      $('confirm-dialog').showModal();
      $('dlg-error').textContent = e.message;
      $('dlg-error').hidden = false;
      btn.disabled = false;
    }
  }
}

async function joinWait(courtId, start) {
  if (!getUser()) return redirectToLogin();
  try {
    const r = await api.joinWaitlist({ courtId, date, start });
    toast(`Đã ghi tên bạn chờ giờ này – bạn đứng thứ ${r.position}. Khi giờ trống, bạn có 10 phút để đặt trước.`);
    await reloadGrid();
  } catch (e) {
    toast(e.message, { error: true });
    if (e.status === 409 || e.status === 400) reloadGrid();
  }
}

async function changeDate(d) {
  date = d;
  picked = null;
  params.delete('slot');
  document.querySelectorAll('#days [data-date]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.date === d)));
  setUrl();
  await reloadGrid();
  paintPickedNote();
}

function wire() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const day = t.closest('#days [data-date]');
    if (day) return changeDate(day.dataset.date);
    const tab = t.closest('[data-court-tab]');
    if (tab) {
      wantCourt = Number(tab.dataset.courtTab);
      return renderGrid();
    }
    const wait = t.closest('[data-wait]');
    if (wait) return joinWait(Number(wait.dataset.court), wait.dataset.start);
    const p = t.closest('[data-pick]');
    if (p) return pick(Number(p.dataset.court), p.dataset.start);
  });
  $('bar-book').addEventListener('click', openConfirm);
  $('do-book').addEventListener('click', submitBooking);
  $('confirm-dialog').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $('confirm-dialog').close()));
}

async function main() {
  await mountShell();
  try {
    [meta, venue] = await Promise.all([api.meta(), api.venue(venueId)]);
    today = dateOf(meta.now);
    const wantDate = params.get('date');
    date = wantDate && wantDate >= today && wantDate <= addDays(today, meta.bookingWindowDays - 1) ? wantDate : today;
    if (isCustomer()) reliability = await api.myReliability().catch(() => null);
    renderTop();
    schedule = await api.schedule(venueId, date);
    const want = params.get('slot');
    if (want && date === params.get('date')) {
      const c = Number(params.get('court')) || null;
      const cand = c ? [findSlot(c, want) && { courtId: c }] : schedule.courts.filter((x) => isBookable(findSlot(x.id, want))).map((x) => ({ courtId: x.id }));
      const first = cand.find((x) => x && findSlot(x.courtId, want)?.offeredToYou) || cand.find((x) => x && isBookable(findSlot(x.courtId, want)));
      if (first) picked = { courtId: first.courtId, start: want };
    }
    if (picked) wantCourt = picked.courtId;
    renderGrid();
    paintBar();
    paintPickedNote();
    wire();
    if (picked) document.querySelector('[data-pick][aria-pressed="true"]')?.scrollIntoView?.({ block: 'center' });
  } catch (e) {
    $('venue-root').innerHTML = `<div class="card empty"><div class="art" data-icon="info"></div><p><b style="color:var(--text)">${e.status === 404 ? 'Không tìm thấy sân này' : 'Không tải được dữ liệu'}</b><br>${esc(e.message)}</p><a class="btn btn-lime" href="/venues.html">Xem danh sách sân</a></div>`;
    decorate();
  }
}
main();
