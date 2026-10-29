import { initPage, api, qs, todayStr, toast } from './common.js';
import { venueCard, fillDistricts } from './venue-card.js';

await initPage();
const dateInput = qs('#date');
dateInput.min = todayStr();
dateInput.max = todayStr(14);

fillDistricts(qs('#district'), api).catch(() => {});

// Bỏ các ô trống khỏi URL tìm kiếm cho gọn.
qs('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = new URLSearchParams(new FormData(e.target));
  for (const [k, val] of [...p]) if (!val) p.delete(k);
  location.href = `/venues.html?${p}`;
});

try {
  const { venues } = await api('/venues');
  qs('#venue-list').innerHTML = venues.slice(0, 6).map((v) => venueCard(v)).join('') || '<p class="empty">Chưa có sân nào.</p>';
} catch (err) {
  toast(err.message, 'error');
}
