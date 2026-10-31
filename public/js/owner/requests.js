// Tin nhờ báo giá của khách ở khu vực sân của bạn: xem, gửi báo giá (chọn sân và giờ, giá, hiệu lực), rút báo giá.
// Báo giá không giữ giờ: khách chưa chọn thì giờ vẫn đặt được như thường.
import { $, esc, money, dayLabel, dm, hhmm, initPage, errorBox, api, toast, dialog, guard, syncClock, nowMs, reliabilityHtml, tickCountdowns } from './common.js';
import { msToVn, vnToMs } from '/js/ui/format.js';
import { offerLabel, requestLabel } from '/js/ui/request.js';

const content = $('#content');
let list = [];
let meta;

const when = (r) => `${dayLabel(r.date)}, ${r.from}–${r.to}`;

function offerLine(o) {
  const [label, cls] = offerLabel(o);
  return `<li class="rq-offer"><div><b>${esc(o.venueName)}</b> · ${esc(o.courtName)} · ${hhmm(o.startAt)}–${hhmm(o.endAt)} · báo <b class="num">${money(o.price)}</b> <span class="muted">(giá thường ${money(o.listedPrice)})</span></div>
    <div class="tr-state"><span class="badge badge-${cls}">${esc(label)}</span>
      ${o.status === 'open' ? `<span class="muted">Giá có hiệu lực đến ${hhmm(o.validUntil)} ${dm(o.validUntil)}</span>${o.usable ? '' : `<span class="muted">· ${esc(o.unusableReason)}, khách sẽ không chọn được giá này</span>`}<button class="btn btn-sm" type="button" data-withdraw="${o.id}">Rút báo giá</button>` : ''}
      ${o.status !== 'open' && o.endReason ? `<span class="muted">${esc(o.endReason)}</span>` : ''}
      ${o.status === 'chosen' && o.bookingId ? `<a class="btn btn-sm" href="/owner-bookings.html?id=${o.bookingId}">Xem lịch đặt</a>` : ''}</div></li>`;
}

function requestCard(r) {
  const [label, cls] = requestLabel({ ...r, offers: r.offers });
  const mineOpen = new Set(r.offers.filter((o) => o.status === 'open').map((o) => o.venueId));
  const free = r.options.filter((o) => !mineOpen.has(o.venueId));
  const canOffer = r.status === 'open' && free.length && r.openOfferCount < r.maxOffers;
  return `<li class="tr-row rq-card" data-req="${r.id}">
    <div><b>${esc(r.district)} · sân ${r.fieldType} · ${esc(when(r))}</b> · <b class="num">Khách muốn ${money(r.budget)}/giờ</b></div>
    <div>Khách: <b>${esc(r.customerName)}</b> ${reliabilityHtml(r.customerReliability)}</div>
    ${r.note ? `<div class="muted">“${esc(r.note)}”</div>` : ''}
    <div class="tr-state"><span class="badge badge-${cls === 'matching' ? 'matching' : cls}">${r.status === 'open' ? 'Đang nhận báo giá' : esc(label)}</span><span class="muted">Hạn nhận báo giá ${hhmm(r.closesAt)} ${dm(r.closesAt)}</span>${r.status === 'open' ? `<span class="countdown-sm" data-expires="${esc(r.closesAt)}">Còn --:--</span>` : ''}<span class="muted">${r.openOfferCount}/${r.maxOffers} báo giá đang mở</span></div>
    <div class="muted">Sân của bạn phù hợp: ${r.venues.map((v) => esc(v.name)).join(', ')}</div>
    ${r.offers.length ? `<ul class="rq-offers">${r.offers.map(offerLine).join('')}</ul>` : ''}
    ${r.status === 'open' ? (canOffer ? `<div class="row-actions"><button class="btn btn-lime btn-sm" type="button" data-offer="${r.id}">Gửi báo giá</button></div>` : `<p class="muted">${r.openOfferCount >= r.maxOffers ? 'Tin này đã đủ số báo giá cho phép.' : free.length ? '' : r.options.length ? 'Mỗi sân chỉ báo giá một lần cho mỗi tin. Muốn báo lại, hãy rút báo giá cũ.' : 'Các sân của bạn không còn giờ trống trong khoảng này.'}</p>`) : ''}
  </li>`;
}

function render() {
  const open = list.filter((r) => r.status === 'open');
  const rest = list.filter((r) => r.status !== 'open');
  $('#sub').textContent = `${open.length} tin đang chờ bạn báo giá · ${rest.length} đã kết thúc`;
  content.innerHTML = `
    <div class="notice" role="note" style="margin-bottom:var(--sp-4)"><div><b>Báo giá chưa giữ sân.</b> Khách chưa chọn thì người khác vẫn đặt được giờ đó. Khi khách chọn, giờ được đặt cho khách theo cách nhận đặt sân của bạn, và khách chuyển khoản thẳng cho bạn. Bạn chỉ thấy tin cùng quận, đúng loại sân và có giờ mở cửa phù hợp. Giá khách muốn chỉ để tham khảo.</div></div>
    <div class="panel tr-panel"><h2 class="h3">Đang chờ bạn báo giá (${open.length})</h2>${open.length ? `<ul class="tr-list">${open.map(requestCard).join('')}</ul>` : '<p class="panel-empty">Chưa có khách nào nhờ báo giá phù hợp với sân của bạn.</p>'}</div>
    ${rest.length ? `<div class="panel tr-panel"><h2 class="h3">Đã kết thúc (${rest.length})</h2><ul class="tr-list">${rest.map(requestCard).join('')}</ul></div>` : ''}`;
  tickCountdowns(load);
}

async function offerDialog(r) {
  const mineOpen = new Set(r.offers.filter((o) => o.status === 'open').map((o) => o.venueId));
  const options = r.options.filter((o) => !mineOpen.has(o.venueId));
  const flat = options.flatMap((c) => c.slots.map((s) => ({ ...s, courtId: c.courtId, label: `${c.venueName} · ${c.courtName} · ${s.start}–${s.end} · giá thường ${money(s.basePrice)}` })));
  const closeMs = vnToMs(r.closesAt);
  const base = nowMs();
  const mins = [30, 60, 180, 360, 720].filter((m) => base + m * 60000 >= base + meta.offerMinMinutes * 60000 && base + m * 60000 < closeMs);
  const valids = [...mins.map((m) => [msToVn(base + m * 60000), m < 60 ? `${m} phút` : `${m / 60} giờ`]), [r.closesAt, 'Đến hết hạn nhận báo giá']];
  const res = await dialog({
    title: 'Gửi báo giá',
    confirm: 'Gửi báo giá',
    body: `<p class="muted">${esc(r.district)} · sân ${r.fieldType} · ${esc(when(r))} · khách muốn ${money(r.budget)}/giờ</p>
      <div class="field"><label for="of-slot">Sân và giờ</label><select class="select" id="of-slot" name="slot">${flat.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="of-price">Giá báo (đ)</label><input class="input" id="of-price" name="price" type="number" inputmode="numeric" step="1000" min="1000" required data-label="giá báo"><span class="hint" id="of-hint"></span></div>
      <div class="field"><label for="of-valid">Giá có hiệu lực trong</label><select class="select" id="of-valid" name="validUntil">${valids.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="of-note">Lời nhắn (không bắt buộc)</label><input class="input" id="of-note" name="note" maxlength="200" placeholder="Ví dụ: tặng nước, giá cho khách mới"></div>
      <p class="muted">Giá báo là số tròn nghìn và không cao hơn giá thường của giờ đó. Báo giá chưa giữ sân.</p>`,
    onOpen: (dlg) => {
      const sel = dlg.querySelector('#of-slot');
      const price = dlg.querySelector('#of-price');
      const hint = dlg.querySelector('#of-hint');
      const paint = () => {
        const s = flat[Number(sel.value)];
        price.max = s.basePrice;
        price.value = Math.min(s.basePrice, r.budget >= 1000 ? Math.max(1000, Math.round(r.budget / 1000) * 1000) : s.basePrice);
        hint.textContent = `Giá thường ${money(s.basePrice)}; khách muốn ${money(r.budget)}.`;
      };
      sel.addEventListener('change', paint);
      paint();
    },
  });
  if (!res) return;
  const s = flat[Number(res.slot)];
  await guard(null, async () => {
    await api.owner.sendOffer(r.id, { courtId: s.courtId, start: s.start, price: Number(res.price), validUntil: res.validUntil, note: res.note });
    toast('Đã gửi báo giá');
    await load();
  });
}

content.addEventListener('click', async (e) => {
  const of = e.target.closest('[data-offer]');
  const wd = e.target.closest('[data-withdraw]');
  if (of) await offerDialog(list.find((r) => r.id === Number(of.dataset.offer)));
  else if (wd) {
    await guard(wd, async () => {
      await api.owner.withdrawOffer(Number(wd.dataset.withdraw));
      toast('Đã rút báo giá');
      await load();
    });
  }
});

async function load() {
  try {
    await syncClock();
    [list, meta] = await Promise.all([api.owner.requests(), api.meta()]);
    render();
  } catch (err) {
    errorBox(content, err, load);
  }
}

if (await initPage()) await load();
