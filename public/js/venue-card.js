import { esc, money } from './common.js';

export function venueCard(v, date) {
  const href = `/venue.html?id=${v.id}${date ? `&date=${date}` : ''}`;
  const priceText = v.minPrice === v.maxPrice ? money(v.minPrice) : `${money(v.minPrice)} – ${money(v.maxPrice)}`;
  return `<a class="card venue-card" href="${href}">
    <img src="${esc(v.imageUrl)}" alt="${esc(v.name)}" loading="lazy">
    <div class="body">
      <strong>${esc(v.name)}</strong>
      <span class="muted small">📍 ${esc(v.address)}, ${esc(v.district)}</span>
      <span class="small">🕒 ${esc(v.openTime)} – ${esc(v.closeTime)} · slot ${v.slotMinutes} phút</span>
      <span class="price">${priceText} / slot</span>
      <div>${v.fieldTypes.map((t) => `<span class="tag">Sân ${esc(t)}</span>`).join('')}
        ${v.requiresApproval ? '<span class="tag">Chủ sân duyệt</span>' : '<span class="tag">Xác nhận ngay</span>'}
        ${v.availableSlots !== undefined ? `<span class="tag" style="background:#dcfce7">${v.availableSlots} slot trống</span>` : ''}</div>
    </div></a>`;
}

export async function fillDistricts(select, api) {
  const districts = await api('/venues/districts');
  select.insertAdjacentHTML('beforeend', districts.map((d) => `<option>${esc(d)}</option>`).join(''));
}
