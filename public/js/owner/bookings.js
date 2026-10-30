// Màn 13 – Quản lý booking: lọc theo trạng thái / ngày / từ khóa, duyệt, thu tiền, hoàn tiền, đã đá / bùng.
import {
  $, $$, esc, dayLabel, todayStr, initPage, loadVenues, venueSelect, errorBox, bookingRow, withDetail,
  tickCountdowns, wireActions, api, dm, syncClock, dialog, guard, toast, money, reliabilityHtml, hhmm as hm,
} from './common.js';

const content = $('#content');
let venues = [];
let venueId;
let all = [];
let transfers = [];
let matches = [];
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
  ['matching', 'Chờ đủ hai đội', (b) => b.status === 'matching'],
  ['transferred', 'Đã nhượng', (b) => b.status === 'transferred'],
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

const TR_NOTE = { open: 'Đang đăng nhượng, chưa có đội nhận', claimed: 'Đội nhận đang chuyển tiền cho bạn', completed: 'Đã đổi chủ, chờ bạn hoàn tiền cho đội cũ' };

function transferRow(t) {
  const claimed = t.status === 'claimed';
  return `<li class="tr-row" data-transfer="${t.id}">
    <div><b>${hm(t.startAt)}–${hm(t.endAt)} · ${esc(dayLabel(t.startAt.slice(0, 10)))}</b> · ${esc(t.courtName)} · <span class="code">${esc(t.bookingCode)}</span></div>
    <div class="muted">Đội đăng: ${esc(t.giverName)} · giá nhượng <b class="num">${money(t.askPrice)}</b>${t.askPrice < t.originalPrice ? ` (giá gốc ${money(t.originalPrice)})` : ''}</div>
    ${t.claimerName ? `<div>Đội nhận: <b>${esc(t.claimerName)}</b> <a class="phone" href="tel:${esc(t.claimerPhone)}">${esc(t.claimerPhone)}</a> ${reliabilityHtml(t.claimerReliability)}</div>` : ''}
    <div class="tr-state"><span class="badge badge-${claimed ? 'pending' : t.status === 'completed' ? 'confirmed' : 'transferred'}">${esc(TR_NOTE[t.status])}</span>${claimed ? `<span class="countdown-sm" data-expires="${esc(t.claimExpiresAt)}">Còn --:--</span>` : ''}</div>
    ${claimed ? `<p class="muted">Chỉ xác nhận sau khi tiền đã vào tài khoản của bạn. Nội dung chuyển khoản: <b>${esc(t.paymentContent)}</b>. Xác nhận xong, booking chuyển sang đội nhận ngay; đội cũ chưa được hoàn cho đến khi bạn ghi nhận hoàn tiền.</p>
    <div class="row-actions"><button class="btn btn-lime btn-sm" type="button" data-tr-confirm="${t.id}">Đã nhận ${money(t.askPrice)}</button><button class="btn btn-danger btn-sm" type="button" data-tr-reject="${t.id}">Từ chối đội nhận</button></div>` : ''}
    ${t.status === 'completed' ? `<div class="row-actions"><button class="btn btn-lime btn-sm" type="button" data-act="refund" data-id="${t.bookingId}">Đã hoàn ${money(t.refund?.amount ?? t.askPrice)} cho đội cũ</button></div>` : ''}
  </li>`;
}

const MT_NOTE = { open: 'Chờ đội thứ hai', joined: 'Đội vào trận đang chuyển tiền', expired: 'Hết hạn, trận không thành', cancelled: 'Đã hủy', confirmed: 'Đã chốt' };

function matchRow(m) {
  const hostBtn = m.status === 'open' && !m.hostPaid && m.hostPayBy
    ? `<button class="btn btn-lime btn-sm" type="button" data-mt-confirm="${m.id}" data-part="host">Đã nhận ${money(m.hostAmount)} từ đội mở</button>` : '';
  const guestBtn = m.status === 'joined'
    ? `<button class="btn btn-lime btn-sm" type="button" data-mt-confirm="${m.id}" data-part="guest">Đã nhận ${money(m.guestAmount)} từ đội vào</button><button class="btn btn-danger btn-sm" type="button" data-mt-reject="${m.id}">Từ chối đội vào</button>` : '';
  const cancelBtn = ['open', 'joined'].includes(m.status) ? `<button class="btn btn-sm" type="button" data-mt-cancel="${m.id}">Hủy trận</button>` : '';
  const refunds = (m.refunds || []).map((r) => `<div class="mt-refund"><span>Hoàn cho ${r.part === 'host' ? 'đội mở' : 'đội vào'} (${esc(r.name)}): <b class="num">${money(r.amount)}</b> · <b>${r.status === 'done' ? 'Đã hoàn' : 'Chưa hoàn'}</b></span>${r.status === 'pending' ? `<button class="btn btn-lime btn-sm" type="button" data-mt-refund="${m.id}" data-part="${r.part}">Đã hoàn ${money(r.amount)}</button>` : ''}</div>`).join('');
  return `<li class="tr-row" data-match="${m.id}">
    <div><b>${hm(m.startAt)}–${hm(m.endAt)} · ${esc(dayLabel(m.startAt.slice(0, 10)))}</b> · ${esc(m.courtName)} · <span class="code">${esc(m.bookingCode)}</span> · giá sân <b class="num">${money(m.price)}</b></div>
    <div>Đội mở: <b>${esc(m.hostName)}</b> <a class="phone" href="tel:${esc(m.hostPhone)}">${esc(m.hostPhone)}</a> ${reliabilityHtml(m.hostReliability)} · phần <b class="num">${money(m.hostAmount)}</b> · ${m.hostPaid ? '<b>đã nhận</b>' : `chưa nhận, nội dung <b>${esc(m.hostContent)}</b>`}</div>
    ${m.guestName ? `<div>Đội vào: <b>${esc(m.guestName)}</b> <a class="phone" href="tel:${esc(m.guestPhone)}">${esc(m.guestPhone)}</a> ${reliabilityHtml(m.guestReliability)} · phần <b class="num">${money(m.guestAmount)}</b> · ${m.guestPaid ? '<b>đã nhận</b>' : `chưa nhận, nội dung <b>${esc(m.guestContent)}</b>`}</div>` : `<div class="muted">Chưa có đội vào · phần <span class="num">${money(m.guestAmount)}</span></div>`}
    <div class="tr-state"><span class="badge badge-${m.status === 'joined' ? 'pending' : m.status === 'open' ? 'matching' : 'expired'}">${esc(MT_NOTE[m.status])}</span><span class="muted">Hạn chót ${hm(m.closesAt)} ${dm(m.closesAt)}</span>${m.status === 'joined' ? `<span class="countdown-sm" data-expires="${esc(m.guestHoldUntil)}">Còn --:--</span>` : ''}${m.status === 'open' && !m.hostPaid && m.hostPayBy ? `<span class="countdown-sm" data-expires="${esc(m.hostPayBy)}">Còn --:--</span>` : ''}</div>
    <p class="muted">Xác nhận từng phần riêng, chỉ sau khi tiền đã vào tài khoản của bạn. Đủ hai phần thì sân chốt. Đến hạn mà thiếu một đội thì slot nhả và tiền đã nhận ghi vào hoàn tiền: chưa hoàn cho đến khi bạn ghi nhận.</p>
    <div class="row-actions">${hostBtn}${guestBtn}${cancelBtn}</div>
    ${refunds}
  </li>`;
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
    ${transfers.length ? `<div class="panel tr-panel"><h2 class="h3">Nhượng sân (${transfers.length})</h2><ul class="tr-list">${transfers.map(transferRow).join('')}</ul></div>` : ''}
    ${matches.length ? `<div class="panel tr-panel" id="matches"><h2 class="h3">Trận đủ hai đội (${matches.length})</h2><ul class="tr-list">${matches.map(matchRow).join('')}</ul></div>` : ''}
    ${state.id ? `<p class="notice" style="margin-bottom:var(--sp-3)">Đang xem một booking theo liên kết. <button class="btn btn-sm" type="button" data-clear-id>Xem tất cả booking</button></p>` : ''}
    <p class="result-note" role="status">${rows.length} booking${state.date ? ` ngày ${dm(state.date)}` : ''} · ${esc(pick[1].toLowerCase())}</p>
    <div class="panel bk-table">
      <div class="bk-head" aria-hidden="true"><span>Giờ đá</span><span>Khách</span><span>Sân</span><span>Trạng thái</span><span>Tiền</span><span></span></div>
      ${rows.length ? `<ul class="bk-list">${rows.map((b) => bookingRow(b)).join('')}</ul>` : '<p class="panel-empty">Không có booking nào khớp bộ lọc.</p>'}
    </div>`;
  tickCountdowns(load);
}

content.addEventListener('click', (e) => {
  const mc = e.target.closest('[data-mt-confirm]');
  const mr = e.target.closest('[data-mt-reject]');
  const mx = e.target.closest('[data-mt-cancel]');
  const mf = e.target.closest('[data-mt-refund]');
  const mb = mc || mr || mx || mf;
  if (mb) {
    const m = matches.find((x) => x.id === Number(mb.dataset.mtConfirm || mb.dataset.mtReject || mb.dataset.mtCancel || mb.dataset.mtRefund));
    guard(mb, async () => {
      const ref = `<p class="dlg-ref"><b>${esc(m.courtName)}</b> · ${hm(m.startAt)}–${hm(m.endAt)} ${dm(m.startAt)} · ${esc(m.bookingCode)}</p>`;
      const reasonField = '<div class="field"><label for="f-note">Lý do</label><textarea class="textarea" id="f-note" name="note" rows="3" required data-label="lý do"></textarea></div>';
      if (mc || mf) {
        const part = mb.dataset.part;
        const amount = mf ? m.refunds.find((r) => r.part === part).amount : part === 'host' ? m.hostAmount : m.guestAmount;
        const who = part === 'host' ? 'đội mở trận' : 'đội vào trận';
        const r = await dialog(mf
          ? { title: 'Ghi nhận đã hoàn tiền', confirm: `Đã hoàn ${money(amount)}`, body: `${ref}<p>Hoàn <b>${money(amount)}</b> cho ${who} bằng chuyển khoản, rồi ghi nhận ở đây.</p>` }
          : { title: `Xác nhận đã nhận phần của ${who}?`, confirm: `Đã nhận ${money(amount)}`, body: `${ref}<p>Chỉ xác nhận sau khi ${money(amount)} đã vào tài khoản của bạn. Đây chỉ là phần của ${who}; sân chốt khi cả hai phần đã được xác nhận.</p>` });
        if (!r) return;
        if (mf) await api.owner.refundMatch(m.id, part, '');
        else await api.owner.confirmMatchPart(m.id, part, '');
        toast(mf ? 'Đã ghi nhận hoàn tiền' : 'Đã ghi nhận phần tiền');
      } else {
        const r = await dialog({
          title: mr ? 'Từ chối đội vào trận' : 'Hủy trận',
          confirm: mr ? 'Từ chối' : 'Hủy trận',
          danger: true,
          body: `${ref}<p>${mr ? 'Trận mở lại cho đội khác. Lý do được gửi cho đội vào trận.' : 'Slot được nhả. Tiền các đội đã trả ghi vào hoàn tiền: chưa hoàn cho đến khi bạn chuyển lại và ghi nhận.'}</p>${reasonField}`,
        });
        if (!r) return;
        if (mr) await api.owner.rejectMatchGuest(m.id, r.note.trim());
        else await api.owner.cancelMatch(m.id, r.note.trim());
        toast(mr ? 'Đã từ chối đội vào trận' : 'Đã hủy trận');
      }
      await load();
    });
    return;
  }
  const ok = e.target.closest('[data-tr-confirm]');
  const no = e.target.closest('[data-tr-reject]');
  if (ok || no) {
    const t = transfers.find((x) => x.id === Number((ok || no).dataset.trConfirm || (ok || no).dataset.trReject));
    guard(ok || no, async () => {
      const who = `<p class="dlg-ref"><b>${esc(t.claimerName)}</b> nhận ${esc(t.courtName)} · ${hm(t.startAt)}–${hm(t.endAt)} · ${esc(t.bookingCode)}</p>`;
      if (ok) {
        const r = await dialog({
          title: 'Xác nhận đã nhận tiền?',
          confirm: `Đã nhận ${money(t.askPrice)}`,
          body: `${who}<p>Chỉ xác nhận sau khi ${money(t.askPrice)} đã vào tài khoản của bạn. Booking sẽ chuyển sang đội nhận ngay. Đây chưa phải hoàn tiền: đội cũ vẫn ở trạng thái chưa hoàn cho đến khi bạn ghi nhận hoàn.</p>`,
        });
        if (!r) return;
        await api.owner.confirmTransfer(t.id, '');
        toast('Đã đổi chủ booking. Đội cũ đang chờ hoàn tiền.');
      } else {
        const r = await dialog({
          title: 'Từ chối đội nhận',
          confirm: 'Từ chối',
          danger: true,
          body: `${who}<p>Đăng nhượng được mở lại cho đội khác nếu còn hạn. Lý do được gửi cho đội nhận.</p><div class="field"><label for="f-note">Lý do</label><textarea class="textarea" id="f-note" name="note" rows="3" required data-label="lý do"></textarea></div>`,
        });
        if (!r) return;
        await api.owner.rejectTransfer(t.id, r.note.trim());
        toast('Đã từ chối đội nhận');
      }
      await load();
    });
    return;
  }
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
    const [list, trs, mts] = await Promise.all([api.owner.bookings({ venueId }), api.owner.transfers(), api.owner.matches()]);
    matches = mts.filter((m) => m.venueId === venueId);
    transfers = trs.filter((t) => t.venueId === venueId);
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
