// Màn 12 – Lịch & chặn lịch: mỗi cột một sân con, vạch giờ hiện tại, bấm ô để chặn / bỏ chặn / xem booking.
import {
  $, $$, esc, money, hhmm, dm, dowOf, dayLabel, todayStr, initPage, loadVenues, venueSelect, errorBox, dialog, guard, toast,
  api, badge, payBadge, refundBadge, reliabilityHtml, actionButtons, runAction, STATUS_LABEL, parseAt, withDetail, nowMs, syncClock,
} from './common.js';
import { vnToMs, msToVn, hmToMin, moneyShort } from '/js/ui/format.js';

const ROW_H = 56;
const HEAD_H = 52;
const content = $('#content');
let venues = [];
let venueId;
let date = new URLSearchParams(location.search).get('date') || todayStr();
let sched;
let bookings = [];
let nowTimer;

const days = () => [-1, 0, 1, 2].map((n) => todayStr(n));

const SLOT_TEXT = { available: 'Trống', booked: 'Đã đặt', held: 'Chờ duyệt', blocked: 'Đã chặn', past: 'Đã qua', offered: 'Giữ cho người chờ' };

function cell(court, s) {
  const bk = s.booking;
  const full = bk && bookings.find((b) => b.id === bk.id);
  let st = SLOT_TEXT[s.status] || s.status;
  let line = '';
  if (s.status === 'available') line = `<span class="who">${moneyShort(s.price)}${s.discountPercent ? ` · -${s.discountPercent}%` : ''}</span>`;
  if (s.status === 'blocked') line = `<span class="why">${esc(s.block?.reason || 'Không ghi lý do')}</span>`;
  if (bk) {
    const bs = full?.status || bk.status;
    if (s.status === 'past') st = bs === 'confirmed' ? 'Cần ghi nhận' : STATUS_LABEL[bs] || st;
    const unpaid = (full?.paymentStatus || bk.paymentStatus) === 'unpaid' && ['confirmed', 'completed'].includes(bs);
    line = `<span class="who">${esc(bk.customerName || 'Khách')}${unpaid ? ' · chưa thu' : ''}</span>`;
  }
  const wl = s.waitlistCount ? `<span class="wl">${s.waitlistCount} người chờ</span>` : '';
  const interactive = s.status !== 'offered' && !(s.status === 'past' && !bk);
  const cls = `sc sc-${s.status}${bk && s.status === 'past' ? ' has-bk' : ''}`;
  return `<button type="button" class="${cls}" ${interactive ? '' : 'disabled style="cursor:default"'} data-court="${court.id}" data-start="${s.start}"
    aria-label="${esc(`${court.name}, ${s.start}, ${st}${bk ? ', ' + (bk.customerName || '') : ''}`)}"><span class="st">${st}</span>${line}${wl}</button>`;
}

function render() {
  const courts = sched.courts;
  const starts = [...new Set(courts.flatMap((c) => c.slots.map((s) => s.start)))].sort();
  const count = (k) => courts.reduce((t, c) => t + c.slots.filter((s) => s.status === k).length, 0);
  const waiting = courts.reduce((t, c) => t + c.slots.reduce((u, s) => u + (s.waitlistCount || 0), 0), 0);
  const need = bookings.filter((b) => b.startAt.startsWith(date) && b.status === 'confirmed' && parseAt(b.startAt).getTime() <= nowMs()).length;

  const head = `<div class="sg-h sg-corner"></div>${courts.map((c) => `<div class="sg-h"><b>${esc(c.name)}</b><small>Sân ${esc(c.fieldType)}</small></div>`).join('')}`;
  const rows = starts
    .map(
      (t) =>
        `<div class="sg-t">${t}</div>${courts
          .map((c) => {
            const s = c.slots.find((x) => x.start === t);
            return s ? cell(c, s) : '<div class="sc" style="cursor:default"></div>';
          })
          .join('')}`,
    )
    .join('');

  content.innerHTML = `
    <div class="sched-bar">
      <div class="day-chips" role="group" aria-label="Chọn ngày">${days()
        .map((d) => `<button class="day-chip" type="button" data-date="${d}" aria-pressed="${d === date}"><span class="dow">${dowOf(d)}</span><span class="dnum">${d.slice(8)}</span><span class="dsub">${d === todayStr() ? 'Hôm nay' : d === todayStr(1) ? 'Mai' : d === todayStr(-1) ? 'Hôm qua' : dm(d)}</span></button>`)
        .join('')}</div>
      <p class="sched-summary" role="status"><span><b>${count('available')}</b> trống</span><span><b>${count('booked')}</b> đã đặt</span><span><b>${count('held')}</b> chờ duyệt</span><span><b>${count('blocked')}</b> chặn</span><span><b>${waiting}</b> người đang chờ slot</span>${need ? `<span><b>${need}</b> booking đã qua giờ, chưa ghi nhận đã đá / bùng</span>` : ''}</p>
    </div>
    <div class="sc-legend" aria-label="Chú thích">
      <span><i style="background:var(--surface)"></i>Trống – bấm để chặn</span><span><i class="sc-booked"></i>Đã đặt</span><span><i class="sc-held"></i>Chờ duyệt</span>
      <span><i class="sc-blocked"></i>Đã chặn</span><span><i class="sc-offered"></i>Giữ cho người chờ</span><span><i class="sc-past"></i>Đã qua</span>
    </div>
    <div class="sched" tabindex="0" aria-label="Lịch ${esc(dayLabel(date))}">
      <div class="sched-grid" style="--n:${courts.length};--row-h:${ROW_H}px">${head}${rows}<div class="now-line" hidden><span></span></div></div>
    </div>`;
  placeNow(starts);
  clearInterval(nowTimer);
  nowTimer = setInterval(() => placeNow(starts), 30000);
}

// Vạch giờ hiện tại: chỉ hiện khi đang xem hôm nay và giờ nằm trong khung lịch.
function placeNow(starts) {
  const line = $('.now-line');
  if (!line) return;
  const nowVn = msToVn(nowMs());
  if (nowVn.slice(0, 10) !== date || !starts.length) return void (line.hidden = true);
  const mins = hmToMin(nowVn.slice(11, 16));
  const step = sched.slotMinutes;
  const first = hmToMin(starts[0]);
  const last = hmToMin(starts[starts.length - 1]) + step;
  if (mins < first || mins >= last) return void (line.hidden = true);
  const idx = starts.findIndex((t, i) => mins < hmToMin(t) + step || i === starts.length - 1);
  const frac = Math.min(1, (mins - hmToMin(starts[idx])) / step);
  line.style.top = `${HEAD_H + (idx + frac) * ROW_H}px`;
  line.firstElementChild.textContent = `Bây giờ ${nowVn.slice(11, 16)}`;
  line.hidden = false;
}

const findSlot = (courtId, start) => {
  const c = sched.courts.find((x) => x.id === courtId);
  return { court: c, slot: c.slots.find((s) => s.start === start) };
};

async function openBlock(court, slot) {
  // Có thể chặn kéo dài qua các ô trống liền sau.
  const ends = [];
  const i = court.slots.indexOf(slot);
  for (let j = i; j < court.slots.length && court.slots[j].status === 'available'; j++) ends.push(court.slots[j].end);
  const r = await dialog({
    title: 'Chặn giờ này',
    confirm: 'Chặn lịch',
    body: `<p class="dlg-ref"><b>${esc(court.name)}</b> · ${esc(dayLabel(date))} ${dm(date)} · ${slot.start}</p>
      <div class="field"><label for="f-end">Chặn đến hết</label>
        <select class="select" id="f-end" name="end">${ends.map((e) => `<option value="${e}">${e}</option>`).join('')}</select>
        <span class="hint">Khách không đặt được trong khung này. Bỏ chặn bất cứ lúc nào.</span></div>
      <div class="field"><label for="f-reason">Lý do</label>
        <textarea class="textarea" id="f-reason" name="reason" rows="2" required data-label="lý do chặn" placeholder="Ví dụ: bảo trì cỏ, giải nội bộ, khách quen đặt qua điện thoại"></textarea></div>`,
  });
  if (!r) return;
  await api.owner.block({ courtId: court.id, date, start: slot.start, end: r.end, reason: r.reason.trim() });
  toast(`Đã chặn ${court.name} ${slot.start}–${r.end}`);
  await load();
}

async function openUnblock(court, slot) {
  const id = slot.block.id;
  const same = court.slots.filter((s) => s.block?.id === id);
  const range = `${same[0].start}–${same[same.length - 1].end}`;
  const r = await dialog({
    title: 'Giờ đang bị chặn',
    confirm: 'Bỏ chặn',
    body: `<p class="dlg-ref"><b>${esc(court.name)}</b> · ${esc(dayLabel(date))} ${dm(date)} · khung ${range}</p>
      <p><b>Lý do:</b> ${esc(slot.block.reason || 'Không ghi lý do')}</p>
      <p class="muted">Bỏ chặn sẽ mở lại cả khung ${range}${same.length > 1 ? ` (${same.length} ô)` : ''} cho khách đặt.</p>`,
  });
  if (!r) return;
  await api.owner.unblock(id);
  toast(`Đã bỏ chặn ${court.name} ${range}`);
  await load();
}

async function openBooking(court, slot) {
  const id = slot.booking.id;
  let b = bookings.find((x) => x.id === id) || { ...slot.booking };
  const [d] = await withDetail([b]);
  b = { ...b, ...d };
  const waitNote = slot.waitlistCount ? `<p><b>${slot.waitlistCount} người</b> đang chờ slot này. Nếu booking bị hủy, người chờ sớm nhất được giữ quyền đặt 10 phút.</p>` : '';
  let reload = false;
  await dialog({
    title: `${court.name} · ${slot.start}–${slot.end}`,
    hideConfirm: true,
    body: `<div class="det">
      <p><b>${esc(b.customerName || 'Khách')}</b>${b.customerPhone ? ` · <a href="tel:${esc(b.customerPhone)}">${esc(b.customerPhone)}</a>` : ''}</p>
      ${b.customerNote ? `<p class="muted">“${esc(b.customerNote)}”</p>` : ''}
      <p>${reliabilityHtml(b.customerReliability ?? null)}</p>
      <div class="row-b">${badge(b.status)}${b.paymentStatus ? payBadge(b) : ''}${b.refundStatus ? refundBadge(b) : ''}<span class="muted">${esc(b.code)}${b.price ? ' · ' + money(b.price) : ''}</span></div>
      ${waitNote}
      <div class="bk-acts" id="dlg-acts">${bookings.find((x) => x.id === id) ? actionButtons(b, '') : ''}</div>
      <a href="/owner-bookings.html?q=${encodeURIComponent(b.code)}" class="muted" style="font-size:var(--fs-sm)">Mở trong Quản lý booking</a>
    </div>`,
    onOpen(dlg) {
      dlg.querySelector('#dlg-acts').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        guard(btn, async () => {
          const done = await runAction(btn.dataset.act, b);
          if (done) {
            toast('Đã cập nhật booking');
            reload = true;
            dlg.close();
          }
        });
      });
    },
  });
  if (reload) await load();
}

content.addEventListener('click', (e) => {
  const chip = e.target.closest('.day-chip');
  if (chip) {
    date = chip.dataset.date;
    history.replaceState(null, '', date === todayStr() ? location.pathname : `?date=${date}`);
    return void load();
  }
  const c = e.target.closest('.sc[data-court]');
  if (!c || c.disabled) return;
  const { court, slot } = findSlot(Number(c.dataset.court), c.dataset.start);
  guard(c, async () => {
    if (slot.booking) return openBooking(court, slot);
    if (slot.status === 'blocked' && slot.block) return openUnblock(court, slot);
    if (slot.status === 'available') return openBlock(court, slot);
  });
});

async function load() {
  try {
    await syncClock();
    [sched, bookings] = await Promise.all([api.owner.schedule(venueId, date), api.owner.bookings({ venueId, date })]);
    const v = venues.find((x) => x.id === venueId);
    $('#sub').textContent = `${v.name} · ${dayLabel(date)}, ${dm(date)} · slot ${sched.slotMinutes} phút`;
    render();
  } catch (err) {
    errorBox(content, err, load);
  }
}

if (await initPage()) {
  try {
    ({ venues, id: venueId } = await loadVenues());
    if (!venues.length) {
      content.innerHTML = '<div class="empty"><p>Bạn chưa có cụm sân nào.</p><a class="btn btn-primary" href="/owner-settings.html">Tạo cụm sân</a></div>';
    } else {
      $('#tools').innerHTML = `<label class="sr-only" for="venue">Cụm sân</label><select class="select" id="venue"></select>`;
      venueSelect($('#venue'), venues, venueId, (id) => {
        venueId = id;
        load();
      });
      await load();
    }
  } catch (err) {
    errorBox(content, err, () => location.reload());
  }
}
