// Màn 10 – Tổng quan: chờ chủ sân đồng ý (đếm ngược), lịch hôm nay, tiền chưa thu, tiền chờ trả lại.
import {
  $, esc, money, dayLabel, todayStr, initPage, loadVenues, venueSelect, errorBox, bookingRow, withDetail,
  tickCountdowns, wireActions, api, dm, startsAt, nowMs, syncClock,
} from './common.js';

const content = $('#content');
let venues = [];
let venueId;
let bookings = [];

const panel = (title, list, { href, empty, count = list.length, note = '' }) => `
  <section class="panel">
    <div class="panel-head"><h2 class="h2">${title}</h2><span class="count">${count}${note}</span>${href ? `<a href="${href}">Xem tất cả</a>` : ''}</div>
    ${list.length ? `<ul class="bk-list">${list.map((b) => bookingRow(b, { showDate: true })).join('')}</ul>` : `<p class="panel-empty">${empty}</p>`}
  </section>`;

function render() {
  const today = todayStr();
  const pending = bookings.filter((b) => b.status === 'pending').sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const todayList = bookings
    .filter((b) => b.startAt.startsWith(today) && ['pending', 'confirmed', 'completed', 'no_show'].includes(b.status))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const unpaid = bookings.filter((b) => ['confirmed', 'completed'].includes(b.status) && b.paymentStatus === 'unpaid').sort((a, b) => a.startAt.localeCompare(b.startAt));
  const refund = bookings.filter((b) => b.refundStatus === 'pending');
  const sum = (l, f) => l.reduce((t, b) => t + f(b), 0);
  const toPlay = todayList.filter((b) => b.status === 'confirmed' && startsAt(b).getTime() > nowMs()).length;

  content.innerHTML = `
    <div class="kpis">
      <a class="kpi ${pending.length ? 'alert' : ''}" href="/owner-bookings.html?status=pending"><span class="k">Chờ chủ sân đồng ý</span><span class="n">${pending.length}</span><span class="s">${pending.length ? 'Giờ giữ 15 phút, quá hạn tự mở lại' : 'Không có lịch đặt nào đang chờ'}</span></a>
      <a class="kpi" href="/owner-schedule.html"><span class="k">Hôm nay</span><span class="n">${todayList.length}</span><span class="s">lịch đặt · ${toPlay} chưa đến giờ đá</span></a>
      <a class="kpi" href="/owner-bookings.html?status=unpaid"><span class="k">Chưa chuyển khoản</span><span class="n">${unpaid.length}</span><span class="s">${money(sum(unpaid, (b) => b.price))}</span></a>
      <a class="kpi" href="/owner-bookings.html?status=refund"><span class="k">Chờ trả lại tiền</span><span class="n">${refund.length}</span><span class="s">${money(sum(refund, (b) => b.refundAmount))}</span></a>
    </div>
    <div class="cols two">
      <div>${panel('Chờ chủ sân đồng ý', pending, { href: '/owner-bookings.html?status=pending', empty: 'Chưa có lịch đặt nào chờ chủ sân đồng ý.' })}</div>
      <div>${panel(`Lịch hôm nay <span class="muted" style="font-size:var(--fs-sm);font-weight:600;text-transform:none">${dm(today)}</span>`, todayList, { href: '/owner-schedule.html', empty: 'Hôm nay chưa có booking.' })}</div>
    </div>
    <div class="cols two" style="margin-top:var(--sp-6)">
      <div>${panel('Có sân nhưng chưa chuyển khoản', unpaid, { href: '/owner-bookings.html?status=unpaid', empty: 'Mọi lịch đặt đã có sân đều đã chuyển khoản.' })}</div>
      <div>${panel('Chờ trả lại tiền', refund, { href: '/owner-bookings.html?status=refund', empty: 'Không có khoản nào cần chuyển lại cho khách.' })}</div>
    </div>`;
  tickCountdowns(load);
}

async function load() {
  try {
    await syncClock();
    const list = await api.owner.bookings({ venueId });
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
      content.innerHTML = '<div class="empty"><p>Bạn chưa có cụm sân nào.</p><a class="btn btn-primary" href="/owner-settings.html">Tạo cụm sân</a></div>';
    } else {
      $('#tools').innerHTML = `<label class="sr-only" for="venue">Cụm sân</label><select class="select" id="venue"></select>`;
      venueSelect($('#venue'), venues, venueId, (id) => {
        venueId = id;
        load();
      });
      wireActions(content, (id) => bookings.find((b) => b.id === id), load);
      await load();
    }
  } catch (err) {
    errorBox(content, err, () => location.reload());
  }
}
