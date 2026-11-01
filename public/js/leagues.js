// Danh sách giải công khai (không cần đăng nhập): đang đá, sắp đá, rồi giải đã kết thúc thu gọn. Quận chọn nằm trong ?district=.
import { api } from '/js/api.js';
import { mountShell } from '/js/ui/shell.js';
import { $ } from '/js/ui/page.js';
import { esc, leagueCard } from '/js/ui/league-ui.js';

const root = $('lg-root');
const sel = $('f-district');
const summary = $('summary');

const grid = (list) => `<ul class="plain-list lg-cards lg-pubgrid">${list.map(leagueCard).join('')}</ul>`;

function render(list, district) {
  const live = list.filter((l) => l.status !== 'finished');
  const done = list.filter((l) => l.status === 'finished');
  summary.textContent = list.length ? `${list.length} giải${district ? ` ở ${district}` : ''}: ${live.length} đang đá hoặc sắp đá, ${done.length} đã kết thúc` : '';
  if (!list.length) {
    root.innerHTML = `<div class="empty"><p>${district ? `Chưa có giải nào ở ${esc(district)}.` : 'Chưa có giải nào được công bố.'}</p>${district ? '<button class="btn" type="button" id="clear-district">Xem tất cả quận</button>' : ''}</div>`;
    $('clear-district')?.addEventListener('click', () => choose(''));
    return;
  }
  root.innerHTML = `${live.length ? `<section aria-labelledby="h-live"><h2 class="h2" id="h-live">Đang đá và sắp đá</h2>${grid(live)}</section>` : '<p class="muted">Quận này chưa có giải nào đang đá hay sắp đá.</p>'}
    ${done.length ? `<details class="lg-done"><summary><h2 class="h2">Đã kết thúc <span class="count">${done.length}</span></h2></summary>${grid(done)}</details>` : ''}`;
}

async function load() {
  const district = sel.value;
  try {
    render(await api.leagues(district), district);
  } catch (err) {
    summary.textContent = '';
    root.innerHTML = `<div class="empty"><p>${esc(err.message || 'Không tải được danh sách giải')}</p><button class="btn" type="button" id="retry">Thử lại</button></div>`;
    $('retry').onclick = load;
  }
}

function choose(d) {
  sel.value = d;
  const url = new URL(location.href);
  if (d) url.searchParams.set('district', d); else url.searchParams.delete('district');
  history.replaceState(null, '', url);
  load();
}

mountShell();
try {
  const all = await api.leagues();
  const districts = [...new Set(all.map((l) => l.venueDistrict))].sort((a, b) => a.localeCompare(b, 'vi'));
  sel.innerHTML = `<option value="">Tất cả quận</option>${districts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;
  const want = new URLSearchParams(location.search).get('district') || '';
  sel.value = districts.includes(want) ? want : '';
  sel.onchange = () => choose(sel.value);
  await load();
} catch (err) {
  summary.textContent = '';
  root.innerHTML = `<div class="empty"><p>${esc(err.message || 'Không tải được danh sách giải')}</p></div>`;
}
