// Nhu cầu của khách ở khu vực sân của bạn: xem, gửi chào giá (chọn sân con + slot, giá, hiệu lực), rút chào giá.
// Chào giá không giữ slot: khách chưa chọn thì slot vẫn đặt được như thường.
import { $, esc, money, dayLabel, dm, hhmm, initPage, errorBox, api, toast, dialog, guard, syncClock, nowMs, reliabilityHtml, tickCountdowns } from './common.js';
import { msToVn, vnToMs } from '/js/ui/format.js';
import { offerLabel, requestLabel } from '/js/ui/request.js';

const content = $('#content');
let list = [];
let meta;

const when = (r) => `${dayLabel(r.date)}, ${r.from}–${r.to}`;

function offerLine(o) {
  const [label, cls] = offerLabel(o);
  return `<li class="rq-offer"><div><b>${esc(o.venueName)}</b> · ${esc(o.courtName)} · ${hhmm(o.startAt)}–${hhmm(o.endAt)} · chào <b class="num">${money(o.price)}</b> <span class="muted">(niêm yết ${money(o.listedPrice)})</span></div>
    <div class="tr-state"><span class="badge badge-${cls}">${esc(label)}</span>
      ${o.status === 'open' ? `<span class="muted">Hiệu lực đến ${hhmm(o.validUntil)} ${dm(o.validUntil)}</span>${o.usable ? '' : `<span class="muted">· ${esc(o.unusableReason)}, khách sẽ không chọn được</span>`}<button class="btn btn-sm" type="button" data-withdraw="${o.id}">Rút chào giá</button>` : ''}
      ${o.status !== 'open' && o.endReason ? `<span class="muted">${esc(o.endReason)}</span>` : ''}
      ${o.status === 'chosen' && o.bookingId ? `<a class="btn btn-sm" href="/owner-bookings.html?id=${o.bookingId}">Xem booking</a>` : ''}</div></li>`;
}

function requestCard(r) {
  const [label, cls] = requestLabel({ ...r, offers: r.offers });
  const mineOpen = new Set(r.offers.filter((o) => o.status === 'open').map((o) => o.venueId));
  const free = r.options.filter((o) => !mineOpen.has(o.venueId));
  const canOffer = r.status === 'open' && free.length && r.openOfferCount < r.maxOffers;
  return `<li class="tr-row rq-card" data-req="${r.id}">
    <div><b>${esc(r.district)} · sân ${r.fieldType} · ${esc(when(r))}</b> · <b class="num">Ngân sách ${money(r.budget)}</b></div>
    <div>Khách: <b>${esc(r.customerName)}</b> ${reliabilityHtml(r.customerReliability)}</div>
    ${r.note ? `<div class="muted">“${esc(r.note)}”</div>` : ''}
    <div class="tr-state"><span class="badge badge-${cls === 'matching' ? 'matching' : cls}">${r.status === 'open' ? 'Đang nhận chào giá' : esc(label)}</span><span class="muted">Hạn nhận chào giá ${hhmm(r.closesAt)} ${dm(r.closesAt)}</span>${r.status === 'open' ? `<span class="countdown-sm" data-expires="${esc(r.closesAt)}">Còn --:--</span>` : ''}<span class="muted">${r.openOfferCount}/${r.maxOffers} chào giá đang mở</span></div>
    <div class="muted">Sân của bạn phù hợp: ${r.venues.map((v) => esc(v.name)).join(', ')}</div>
    ${r.offers.length ? `<ul class="rq-offers">${r.offers.map(offerLine).join('')}</ul>` : ''}
    ${r.status === 'open' ? (canOffer ? `<div class="row-actions"><button class="btn btn-lime btn-sm" type="button" data-offer="${r.id}">Gửi chào giá</button></div>` : `<p class="muted">${r.openOfferCount >= r.maxOffers ? 'Nhu cầu đã đủ chào giá đang mở.' : free.length ? '' : r.options.length ? 'Mỗi sân chỉ có một chào giá đang mở cho một nhu cầu; hãy rút chào giá cũ nếu muốn chào lại.' : 'Hiện không còn slot trống trong khung giờ này ở sân con phù hợp.'}</p>`) : ''}
  </li>`;
}

function render() {
  const open = list.filter((r) => r.status === 'open');
  const rest = list.filter((r) => r.status !== 'open');
  $('#sub').textContent = `${open.length} nhu cầu đang chờ chào giá · ${rest.length} đã kết thúc`;
  content.innerHTML = `
    <div class="notice" role="note" style="margin-bottom:var(--sp-4)"><div><b>Chào giá không giữ slot.</b> Khách chưa chọn thì người khác vẫn đặt được slot đó. Khi khách chọn, hệ thống kiểm lại slot và giá rồi tạo booking theo chế độ nhận booking của sân; tiền vẫn khách chuyển thẳng cho bạn. Nhu cầu hiện khi cùng quận, có sân con đúng loại và giờ mở cửa phù hợp; ngân sách chỉ để tham khảo.</div></div>
    <div class="panel tr-panel"><h2 class="h3">Đang chờ chào giá (${open.length})</h2>${open.length ? `<ul class="tr-list">${open.map(requestCard).join('')}</ul>` : '<p class="panel-empty">Chưa có nhu cầu nào phù hợp với sân của bạn.</p>'}</div>
    ${rest.length ? `<div class="panel tr-panel"><h2 class="h3">Đã kết thúc (${rest.length})</h2><ul class="tr-list">${rest.map(requestCard).join('')}</ul></div>` : ''}`;
  tickCountdowns(load);
}

async function offerDialog(r) {
  const mineOpen = new Set(r.offers.filter((o) => o.status === 'open').map((o) => o.venueId));
  const options = r.options.filter((o) => !mineOpen.has(o.venueId));
  const flat = options.flatMap((c) => c.slots.map((s) => ({ ...s, courtId: c.courtId, label: `${c.venueName} · ${c.courtName} · ${s.start}–${s.end} · niêm yết ${money(s.basePrice)}` })));
  const closeMs = vnToMs(r.closesAt);
  const base = nowMs();
  const mins = [30, 60, 180, 360, 720].filter((m) => base + m * 60000 >= base + meta.offerMinMinutes * 60000 && base + m * 60000 < closeMs);
  const valids = [...mins.map((m) => [msToVn(base + m * 60000), m < 60 ? `${m} phút` : `${m / 60} giờ`]), [r.closesAt, 'Đến hết hạn nhận chào giá']];
  const res = await dialog({
    title: 'Gửi chào giá',
    confirm: 'Gửi chào giá',
    body: `<p class="muted">${esc(r.district)} · sân ${r.fieldType} · ${esc(when(r))} · ngân sách ${money(r.budget)}</p>
      <div class="field"><label for="of-slot">Sân con và slot</label><select class="select" id="of-slot" name="slot">${flat.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="of-price">Giá chào (đ)</label><input class="input" id="of-price" name="price" type="number" inputmode="numeric" step="1000" min="1000" required data-label="giá chào"><span class="hint" id="of-hint"></span></div>
      <div class="field"><label for="of-valid">Hiệu lực trong</label><select class="select" id="of-valid" name="validUntil">${valids.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="of-note">Lời nhắn (không bắt buộc)</label><input class="input" id="of-note" name="note" maxlength="200" placeholder="Ví dụ: tặng nước, giá cho khách mới"></div>
      <p class="muted">Giá chào là số nguyên, bội số 1.000đ và không vượt giá niêm yết của slot. Chào giá chưa giữ slot.</p>`,
    onOpen: (dlg) => {
      const sel = dlg.querySelector('#of-slot');
      const price = dlg.querySelector('#of-price');
      const hint = dlg.querySelector('#of-hint');
      const paint = () => {
        const s = flat[Number(sel.value)];
        price.max = s.basePrice;
        price.value = Math.min(s.basePrice, r.budget >= 1000 ? Math.max(1000, Math.round(r.budget / 1000) * 1000) : s.basePrice);
        hint.textContent = `Niêm yết ${money(s.basePrice)}; ngân sách của khách ${money(r.budget)}.`;
      };
      sel.addEventListener('change', paint);
      paint();
    },
  });
  if (!res) return;
  const s = flat[Number(res.slot)];
  await guard(null, async () => {
    await api.owner.sendOffer(r.id, { courtId: s.courtId, start: s.start, price: Number(res.price), validUntil: res.validUntil, note: res.note });
    toast('Đã gửi chào giá');
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
      toast('Đã rút chào giá');
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
