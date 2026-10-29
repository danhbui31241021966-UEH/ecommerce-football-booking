// Màn 13 – Quản lý booking: lọc theo trạng thái / ngày / từ khóa, duyệt, thu tiền, hoàn tiền, đã đá / bùng.
import {
  $, $$, esc, dayLabel, todayStr, initPage, loadVenues, venueSelect, errorBox, bookingRow, withDetail,
  tickCountdowns, wireActions, api, dm, syncClock,
} from './common.js';

const content = $('#content');
let venues = [];
let venueId;
let all = [];
const q = new URLSearchParams(location.search);
const state = { status: q.get('status') || 'all', date: q.get('date') || '', text: q.get('q') || '', id: Number(q.get('id')) || 0 };

const CHIPS = [
  ['all', 'Tất cả', () => true],
  ['pending', 'Chờ duyệt', (b) => b.status === 'pending'],
  ['confirmed', 'Đã xác nhận', (b) => b.status === 'confirmed'],
  ['unpaid', 'Chưa thu tiền', (b) => ['confirmed', 'completed'].includes(b.status) && b.paymentStatus === 'unpaid'],
  ['refund', 'Chờ hoàn tiền', (b) => b.refundStatus === 'pending'],
  ['completed', 'Đã đá', (b) => b.status === 'completed'],
  ['no_show', 'Bùng sân', (b) => b.status === 'no_show'],
  ['closed', 'Đã hủy / từ chối / hết hạn', (b) => ['cancelled', 'rejected', 'expired'].includes(b.status)],
];

const norm = (s) => String(s ?? '').toLowerCase();
const matchText = (b) => {
  const t = norm(state.text).trim();
  return !t || [b.code, b.customerName, b.customerPhone, b.courtName].some((f) => norm(f).includes(t));
};
const baseFiltered = () => all.filter((b) => (!state.id || b.id === state.id) && (!state.date || b.startAt.startsWith(state.date)) && matchText(b));

function syncUrl() {
  const p = new URLSearchParams();
  if (state.status !== 'all') p.set('status', state.status);
  if (state.date) p.set('date', state.date);
  if (state.text) p.set('q', state.text);
  if (state.id) p.set('id', state.id);
  history.replaceState(null, '', p.size ? `?${p}` : location.pathname);
}

function render() {
  const base = baseFiltered();
  const pick = CHIPS.find((c) => c[0] === state.status) || CHIPS[0];
  const rows = base.filter(pick[2]).sort((a, b) => {
    const pa = a.status === 'pending';
    const pb = b.status === 'pending';
    if (pa !== pb) return pa ? -1 : 1;
    return pa ? a.expiresAt.localeCompare(b.expiresAt) : b.startAt.localeCompare(a.startAt);
  });
  const today = todayStr();
  content.innerHTML = `
    <div class="filters">
      <div class="chips" role="group" aria-label="Lọc theo trạng thái">${CHIPS.map(
        ([k, label, fn]) => `<button class="chip" type="button" data-status="${k}" aria-pressed="${state.status === k}">${label}<span class="n">${base.filter(fn).length}</span></button>`,
      ).join('')}</div>
      <div class="filter-row">
        <div class="chips" role="group" aria-label="Lọc theo ngày">
          <button class="chip" type="button" data-date="" aria-pressed="${!state.date}">Mọi ngày</button>
          <button class="chip" type="button" data-date="${today}" aria-pressed="${state.date === today}">Hôm nay</button>
          <button class="chip" type="button" data-date="${todayStr(1)}" aria-pressed="${state.date === todayStr(1)}">Mai</button>
        </div>
        <label class="sr-only" for="date">Chọn ngày</label>
        <input class="input" type="date" id="date" value="${esc(state.date)}">
        <label class="sr-only" for="text">Tìm theo mã, tên khách, số điện thoại</label>
        <input class="input grow" type="search" id="text" placeholder="Tìm mã, tên, SĐT" value="${esc(state.text)}">
      </div>
    </div>
    ${state.id ? `<p class="notice" style="margin-bottom:var(--sp-3)">Đang xem một booking theo liên kết. <button class="btn btn-sm" type="button" data-clear-id>Xem tất cả booking</button></p>` : ''}
    <p class="result-note" role="status">${rows.length} booking${state.date ? ` ngày ${dm(state.date)}` : ''} · ${esc(pick[1].toLowerCase())}</p>
    <div class="panel bk-table">
      <div class="bk-head" aria-hidden="true"><span>Giờ đá</span><span>Khách</span><span>Sân</span><span>Trạng thái</span><span>Tiền</span><span></span></div>
      ${rows.length ? `<ul class="bk-list">${rows.map((b) => bookingRow(b)).join('')}</ul>` : '<p class="panel-empty">Không có booking nào khớp bộ lọc.</p>'}
    </div>`;
  tickCountdowns(load);
}

content.addEventListener('click', (e) => {
  if (e.target.closest('[data-clear-id]')) {
    state.id = 0;
    syncUrl();
    return render();
  }
  const c = e.target.closest('.chip');
  if (!c) return;
  if ('status' in c.dataset) state.status = c.dataset.status;
  if ('date' in c.dataset) state.date = c.dataset.date;
  syncUrl();
  render();
});
content.addEventListener('change', (e) => {
  if (e.target.id !== 'date') return;
  state.date = e.target.value;
  syncUrl();
  render();
});
content.addEventListener('input', (e) => {
  if (e.target.id !== 'text') return;
  state.text = e.target.value;
  syncUrl();
  const pos = e.target.selectionStart;
  render();
  const t = $('#text');
  t.focus();
  t.setSelectionRange(pos, pos);
});

async function load() {
  try {
    await syncClock();
    const list = await api.owner.bookings({ venueId });
    const detailed = await withDetail(list.filter((b) => b.status === 'pending'));
    const byId = new Map(detailed.map((b) => [b.id, b]));
    all = list.map((b) => byId.get(b.id) || b);
    const v = venues.find((x) => x.id === venueId);
    $('#sub').textContent = `${v.name} · ${all.length} booking`;
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
      wireActions(content, (id) => all.find((b) => b.id === id), load);
      await load();
    }
  } catch (err) {
    errorBox(content, err, () => location.reload());
  }
}
