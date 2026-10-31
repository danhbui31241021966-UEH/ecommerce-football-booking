// Màn 12 – Lịch & chặn lịch: mỗi cột một sân, vạch giờ hiện tại, bấm ô trống để thêm lịch đặt (khách gọi điện/Zalo) hoặc chặn giờ, bấm ô khác để bỏ chặn / xem lịch đặt.
import {
  $, $$, esc, money, hhmm, dm, dowOf, dayLabel, todayStr, initPage, loadVenues, venueSelect, errorBox, dialog, guard, toast,
  api, badge, payBadge, refundBadge, sourceBadge, reliabilityHtml, actionButtons, runAction, STATUS_LABEL, parseAt, withDetail, nowMs, syncClock, openAddBooking, mountViewSwitch,
} from './common.js';
import { vnToMs, msToVn, hmToMin, moneyShort } from '/js/ui/format.js';

const ROW_H = 56;
const HEAD_H = 52;
const content = $('#content');
let venues = [];
let venueId;
// Ngày mặc định lấy sau khi đồng bộ đồng hồ (initPage), để tua đồng hồ demo vẫn mở đúng hôm nay.
let date = new URLSearchParams(location.search).get('date');
let sched;
let bookings = [];
let nowTimer;
let courtTab = null;
// Điện thoại: mỗi lần xem một sân (tab), không cắt lưới. Màn rộng: các sân cạnh nhau.
const narrowMq = window.matchMedia('(max-width: 700px)');

const days = () => [-1, 0, 1, 2].map((n) => todayStr(n));

const SLOT_TEXT = { available: 'Trống', booked: 'Đã đặt', held: 'Chờ chủ sân đồng ý', blocked: 'Đã chặn', past: 'Đã qua', offered: 'Giữ cho người đang chờ' };

function cell(court, s) {
  const bk = s.booking;
  const full = bk && bookings.find((b) => b.id === bk.id);
  let st = SLOT_TEXT[s.status] || s.status;
  let line = '';
  if (s.status === 'available') line = `<span class="who">${moneyShort(s.price)}${s.discountPercent ? ` · -${s.discountPercent}%` : ''}</span>`;
  if (s.status === 'blocked') line = `<span class="why">${esc(s.block?.reason || 'Không ghi lý do')}</span>`;
  if (s.status === 'blocked' && s.block?.leagueId) st = 'Giải';
  if (bk) {
    const bs = full?.status || bk.status;
    if (s.status === 'past') st = bs === 'confirmed' ? 'Cần ghi nhận' : STATUS_LABEL[bs] || st;
    else if (bk.source === 'phone') st = 'Đặt qua điện thoại';
    const unpaid = (full?.paymentStatus || bk.paymentStatus) === 'unpaid' && ['confirmed', 'completed'].includes(bs);
    line = `<span class="who">${esc(bk.customerName || 'Khách')}${unpaid ? ' · chưa nhận tiền' : ''}</span>`;
  }
  const wl = s.waitlistCount ? `<span class="wl">${s.waitlistCount} người chờ</span>` : '';
  const interactive = s.status !== 'offered' && !(s.status === 'past' && !bk);
  const cls = `sc sc-${s.status}${bk && s.status === 'past' ? ' has-bk' : ''}`;
  return `<button type="button" class="${cls}" ${interactive ? '' : 'disabled style="cursor:default"'} data-court="${court.id}" data-start="${s.start}"
    aria-label="${esc(`${court.name}, ${s.start}, ${st}${bk ? ', ' + (bk.customerName || '') : ''}`)}"><span class="st">${st}</span>${line}${wl}</button>`;
}

function render() {
  const allCourts = sched.courts;
  if (!allCourts.some((c) => c.id === courtTab)) courtTab = allCourts[0]?.id;
  const narrow = narrowMq.matches && allCourts.length > 1;
  const courts = narrow ? allCourts.filter((c) => c.id === courtTab) : allCourts;
  const starts = [...new Set(courts.flatMap((c) => c.slots.map((s) => s.start)))].sort();
  const count = (k) => allCourts.reduce((t, c) => t + c.slots.filter((s) => s.status === k).length, 0);
  const waiting = allCourts.reduce((t, c) => t + c.slots.reduce((u, s) => u + (s.waitlistCount || 0), 0), 0);
  const need = bookings.filter((b) => b.startAt.startsWith(date) && b.status === 'confirmed' && parseAt(b.startAt).getTime() <= nowMs()).length;

  const head = `<div class="sg-h sg-corner"></div>${courts.map((c) => `<div class="sg-h"><b>${esc(c.name)}</b><small>sân ${esc(c.fieldType)} người</small></div>`).join('')}`;
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
      <p class="sched-summary" role="status"><span><b>${count('available')}</b> trống</span><span><b>${count('booked')}</b> đã đặt</span><span><b>${count('held')}</b> chờ chủ sân đồng ý</span><span><b>${count('blocked')}</b> chặn</span><span><b>${waiting}</b> người đang chờ giờ trống</span>${need ? `<span><b>${need}</b> lịch đặt đã qua giờ đá, chưa ghi nhận đã đá hay bùng</span>` : ''}</p>
    </div>
    ${narrow ? `<div class="court-tabs chips wrap" role="group" aria-label="Chọn sân">${allCourts.map((c) => `<button type="button" class="chip" data-court-tab="${c.id}" aria-pressed="${c.id === courtTab}">${esc(c.name)}</button>`).join('')}</div>` : ''}
    <div class="sc-legend" aria-label="Chú thích">
      <span><i style="background:var(--surface)"></i>Trống – bấm để thêm lịch đặt hoặc chặn</span><span><i class="sc-booked"></i>Đã đặt</span><span><i class="sc-held"></i>Chờ chủ sân đồng ý</span>
      <span><i class="sc-blocked"></i>Đã chặn</span><span><i class="sc-offered"></i>Giữ cho người đang chờ</span><span><i class="sc-past"></i>Đã qua</span>
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

// Ô trống: chủ sân chọn thêm lịch cho khách gọi điện/Zalo hoặc chặn giờ (sửa sân, sự kiện).
async function chooseAction(court, slot) {
  const teamOnly = !!slot.teamMode;
  const r = await dialog({
    title: `${court.name} · ${slot.start}–${slot.end}`,
    hideConfirm: true,
    body: `<p class="dlg-ref"><b>${esc(court.name)}</b> · ${esc(dayLabel(date))} ${dm(date)} · ${slot.start}</p>
      <div class="choice-btns">
        <button type="button" class="choice-btn primary" data-kind="booking" ${teamOnly ? 'disabled' : 'autofocus'}><b>Khách đặt (điện thoại/Zalo)</b><small>${teamOnly ? 'Giờ này đang ở chế độ Chỉ nhận ghép kèo, nên không thêm lịch đặt riêng được.' : 'Thêm lịch cho khách quen gọi điện hoặc nhắn Zalo. Giờ này sẽ không ai đặt trùng.'}</small></button>
        <button type="button" class="choice-btn" data-kind="block"><b>Chặn giờ (sửa sân, sự kiện)</b><small>Khách không đặt được giờ này. Bạn bỏ chặn lúc nào cũng được.</small></button>
      </div>`,
    onOpen(dlg) {
      dlg.querySelectorAll('[data-kind]').forEach((btn) => btn.addEventListener('click', () => dlg.finish({ kind: btn.dataset.kind })));
    },
  });
  if (!r) return;
  if (r.kind === 'block') return openBlock(court, slot);
  const added = await openAddBooking({ venues, venueId, date, courtId: court.id, start: slot.start });
  if (added) {
    toast(`Đã thêm lịch đặt cho ${added.customerName}`);
    await load();
  }
}

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
        <span class="hint">Khách không đặt được trong khoảng này. Bạn bỏ chặn lúc nào cũng được.</span></div>
      <div class="field"><label for="f-reason">Lý do</label>
        <textarea class="textarea" id="f-reason" name="reason" rows="2" required data-label="lý do chặn" placeholder="Ví dụ: bảo trì cỏ, giải nội bộ"></textarea></div>`,
  });
  if (!r) return;
  await api.owner.block({ courtId: court.id, date, start: slot.start, end: r.end, reason: r.reason.trim() });
  toast(`Đã chặn ${court.name} ${slot.start}–${r.end}`);
  await load();
}

async function openLeagueSlot(court, slot) {
  await dialog({
    title: 'Giờ giữ cho giải',
    hideConfirm: true,
    body: `<p class="dlg-ref"><b>${esc(court.name)}</b> · ${esc(dayLabel(date))} ${dm(date)} · ${slot.start}–${slot.end}</p>
      <p>${esc(slot.block.reason)}. Giờ này khách không đặt được.</p>
      <p class="muted">Muốn đổi giờ thì hoãn trận, muốn trả giờ thì xóa giải, đều làm ở mục Giải đấu.</p>
      <p><a class="btn btn-primary" href="/owner-league.html?id=${slot.block.leagueId}">Mở giải</a></p>`,
  });
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
  const waitNote = slot.waitlistCount ? `<p><b>${slot.waitlistCount} người</b> đang chờ giờ này. Nếu lịch đặt bị hủy, người chờ sớm nhất được giữ quyền đặt 10 phút.</p>` : '';
  let reload = false;
  await dialog({
    title: `${court.name} · ${slot.start}–${slot.end}`,
    hideConfirm: true,
    body: `<div class="det">
      <p><b>${esc(b.customerName || 'Khách')}</b>${b.customerPhone ? ` · <a href="tel:${esc(b.customerPhone)}">${esc(b.customerPhone)}</a>` : ''}</p>
      ${b.customerNote ? `<p class="muted">“${esc(b.customerNote)}”</p>` : ''}
      ${b.source === 'phone' ? '' : `<p>${reliabilityHtml(b.customerReliability ?? null)}</p>`}
      <div class="row-b">${badge(b.status)}${sourceBadge(b)}${b.paymentStatus ? payBadge(b) : ''}${b.refundStatus ? refundBadge(b) : ''}<span class="muted">${esc(b.code)}${b.price ? ' · ' + money(b.price) : ''}</span></div>
      ${waitNote}
      <div class="bk-acts" id="dlg-acts">${bookings.find((x) => x.id === id) ? actionButtons(b, '') : ''}</div>
      <a href="/owner-bookings.html?q=${encodeURIComponent(b.code)}" class="muted" style="font-size:var(--fs-sm)">Mở trong danh sách lịch đặt</a>
    </div>`,
    onOpen(dlg) {
      dlg.querySelector('#dlg-acts').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        guard(btn, async () => {
          const done = await runAction(btn.dataset.act, b);
          if (done) {
            toast('Đã cập nhật lịch đặt');
            reload = true;
            dlg.close();
          }
        });
      });
    },
  });
  if (reload) await load();
}

narrowMq.addEventListener('change', () => { if (sched) render(); });
content.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-court-tab]');
  if (tab) {
    courtTab = Number(tab.dataset.courtTab);
    return void render();
  }
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
    if (slot.status === 'blocked' && slot.block?.leagueId) return openLeagueSlot(court, slot);
    if (slot.status === 'blocked' && slot.block) return openUnblock(court, slot);
    if (slot.status === 'available') return chooseAction(court, slot);
  });
});

async function load() {
  try {
    await syncClock();
    [sched, bookings] = await Promise.all([api.owner.schedule(venueId, date), api.owner.bookings({ venueId, date })]);
    const v = venues.find((x) => x.id === venueId);
    $('#sub').textContent = `${v.name} · ${dayLabel(date)}, ${dm(date)} · giờ ${sched.slotMinutes} phút`;
    render();
  } catch (err) {
    errorBox(content, err, load);
  }
}

if (await initPage()) {
  try {
    date ||= todayStr();
    ({ venues, id: venueId } = await loadVenues());
    if (!venues.length) {
      content.innerHTML = '<div class="empty"><p>Bạn chưa có sân nào.</p><a class="btn btn-primary" href="/owner-settings.html">Thêm sân</a></div>';
    } else {
      mountViewSwitch('grid');
      $('#tools').innerHTML = `<button type="button" class="btn btn-lime" id="add-booking">+ Thêm lịch đặt</button><label class="sr-only" for="venue">Sân của bạn</label><select class="select" id="venue"></select>`;
      $('#add-booking').addEventListener('click', (e) => guard(e.currentTarget, async () => {
        const added = await openAddBooking({ venues, venueId, date });
        if (added) {
          toast(`Đã thêm lịch đặt cho ${added.customerName}`);
          await load();
        }
      }));
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
