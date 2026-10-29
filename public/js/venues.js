import { initPage, api, qs, params, todayStr, esc } from './common.js';
import { venueCard, fillDistricts } from './venue-card.js';

await initPage();
const form = qs('#filter-form');
qs('#date').min = todayStr();
qs('#date').max = todayStr(14);
await fillDistricts(qs('#district'), api).catch(() => {});

// Đồng bộ form với query string để link tìm kiếm chia sẻ được.
const p = params();
for (const el of form.elements) if (el.name && p.has(el.name)) el.value = p.get(el.name);
if (p.get('maxPrice') && !qs(`#maxPrice option[value="${CSS.escape(p.get('maxPrice'))}"]`)) {
  qs('#maxPrice').insertAdjacentHTML('beforeend', `<option>${esc(p.get('maxPrice'))}</option>`);
  qs('#maxPrice').value = p.get('maxPrice');
}
for (const opt of qs('#maxPrice').options) {
  if (opt.value) opt.textContent = `≤ ${Number(opt.value).toLocaleString('vi-VN')}đ`;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = new URLSearchParams(new FormData(form));
  for (const [k, val] of [...q]) if (!val) q.delete(k);
  history.replaceState(null, '', `?${q}`);
  load(q);
});
form.addEventListener('reset', () => setTimeout(() => form.requestSubmit(), 0));

async function load(query) {
  const list = qs('#venue-list');
  list.innerHTML = '<p class="muted">Đang tìm…</p>';
  try {
    const { venues, date } = await api(`/venues?${query}`);
    qs('#result-info').textContent = `Tìm thấy ${venues.length} sân${date ? ` còn slot trống ngày ${date.split('-').reverse().join('/')}` : ''}.`;
    list.innerHTML = venues.map((v) => venueCard(v, date)).join('') ||
      '<div class="card empty" style="grid-column:1/-1">Không có sân phù hợp. Thử đổi ngày, giờ hoặc khu vực.</div>';
  } catch (err) {
    qs('#result-info').textContent = '';
    list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

load(p);
