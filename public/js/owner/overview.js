// Màn 10 – Hôm nay: việc cần làm ngay (mỗi đơn một lần), rồi giờ đá hôm nay kèm tình trạng tiền.
import {
  $, money, dayLabel, todayStr, initPage, loadVenues, venueSelect, errorBox, bookingRow, withDetail,
  tickCountdowns, wireActions, api, dm, syncClock, openAddBooking, guard, toast,
} from './common.js';
import { transferRow, matchRow, transferNeedsAction, matchNeedsAction, wireTasks } from './tasks.js';

const content = $('#content');
let venues = [];
let venueId;
let bookings = [];
let transfers = [];
let matches = [];

function render() {
  const today = todayStr();
  const shown = new Set(); // mã lịch đặt đã nằm trong một thẻ: không hiện lần hai
  const tr = transfers.filter(transferNeedsAction);
  const mt = matches.filter(matchNeedsAction);
  [...tr.map((t) => t.bookingCode), ...mt.map((m) => m.bookingCode)].forEach((c) => shown.add(c));
  const pending = bookings.filter((b) => b.status === 'pending' && !shown.has(b.code)).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  pending.forEach((b) => shown.add(b.code));
  const refund = bookings.filter((b) => b.refundStatus === 'pending' && !b.match && !shown.has(b.code));
  refund.forEach((b) => shown.add(b.code));
  const taskCount = pending.length + tr.length + mt.length + refund.length;

  const todayAll = bookings.filter((b) => b.startAt.startsWith(today) && ['confirmed', 'completed', 'no_show'].includes(b.status)).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const todayList = todayAll.filter((b) => !shown.has(b.code));
  const unpaidToday = todayAll.filter((b) => b.paymentStatus === 'unpaid');
  const unpaidOther = bookings.filter((b) => ['confirmed', 'completed'].includes(b.status) && b.paymentStatus === 'unpaid' && !b.startAt.startsWith(today));
  const owed = unpaidToday.reduce((t, b) => t + b.price, 0);

  content.innerHTML = `
    <p class="today-line" role="status">${taskCount ? `<b>${taskCount}</b> việc cần làm` : 'Không có việc cần làm'} · <b>${todayAll.length}</b> giờ đá hôm nay${unpaidToday.length ? ` · <b>${unpaidToday.length}</b> chưa nhận tiền (${money(owed)})` : ''}</p>
    <section class="panel" aria-labelledby="h-tasks">
      <div class="panel-head"><h2 class="h2" id="h-tasks">Việc cần làm ngay</h2><span class="count">${taskCount}</span></div>
      ${taskCount ? `<ul class="bk-list">${pending.map((b) => bookingRow(b, { showDate: true })).join('')}${tr.map(transferRow).join('')}${mt.map(matchRow).join('')}${refund.map((b) => bookingRow(b, { showDate: true })).join('')}</ul>` : '<p class="panel-empty">Không có đơn nào chờ bạn đồng ý, không có khoản nào cần nhận hay trả lại.</p>'}
    </section>
    <section class="panel" aria-labelledby="h-today">
      <div class="panel-head"><h2 class="h2" id="h-today">Giờ đá hôm nay</h2><span class="count">${dm(today)}</span><a href="/owner-schedule.html">Mở lịch sân</a></div>
      ${todayList.length ? `<ul class="bk-list">${todayList.map((b) => bookingRow(b, { showDate: false })).join('')}</ul>` : `<p class="panel-empty">${todayAll.length ? 'Các giờ đá hôm nay đã nằm ở phần việc cần làm.' : 'Hôm nay chưa có lịch đặt.'}</p>`}
      ${unpaidOther.length ? `<p class="panel-foot"><a href="/owner-bookings.html?status=unpaid">${unpaidOther.length} lịch đặt ngày khác còn chưa nhận tiền (${money(unpaidOther.reduce((t, b) => t + b.price, 0))}). Xem danh sách</a></p>` : ''}
    </section>`;
  tickCountdowns(load);
}

async function load() {
  try {
    await syncClock();
    const [list, trs, mts] = await Promise.all([api.owner.bookings({ venueId }), api.owner.transfers(), api.owner.matches()]);
    transfers = trs.filter((t) => t.venueId === venueId);
    matches = mts.filter((m) => m.venueId === venueId);
    const pend = await withDetail(list.filter((b) => b.status === 'pending'));
    const byId = new Map(pend.map((b) => [b.id, b]));
    bookings = list.map((b) => byId.get(b.id) || b);
    const v = venues.find((x) => x.id === venueId);
    $('#sub').textContent = `${v.name} · ${dayLabel(todayStr())}, ${dm(todayStr())}`;
    render();
  } catch (err) {
    errorBox(content, err, load);
  }
}

if (await initPage()) {
  try {
    ({ venues, id: venueId } = await loadVenues());
    if (!venues.length) {
      content.innerHTML = '<div class="empty"><p>Bạn chưa có sân nào.</p><a class="btn btn-primary" href="/owner-settings.html">Thêm sân</a></div>';
    } else {
      $('#tools').innerHTML = `<button type="button" class="btn btn-lime" id="add-booking">+ Thêm lịch đặt</button><label class="sr-only" for="venue">Sân của bạn</label><select class="select" id="venue"></select>`;
      $('#add-booking').addEventListener('click', (e) => guard(e.currentTarget, async () => {
        const added = await openAddBooking({ venues, venueId, date: todayStr() });
        if (added) {
          toast(`Đã thêm lịch đặt cho ${added.customerName}`);
          await load();
        }
      }));
      venueSelect($('#venue'), venues, venueId, (id) => {
        venueId = id;
        load();
      });
      wireActions(content, (id) => bookings.find((b) => b.id === id), load);
      wireTasks(content, () => matches, () => transfers, load);
      await load();
    }
  } catch (err) {
    errorBox(content, err, () => location.reload());
  }
}
