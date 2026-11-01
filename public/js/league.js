// Trang giải công khai (không cần đăng nhập): đầu trang, bảng xếp hạng, lịch đấu, các đội, điều lệ. ?id= và #tab
import { api } from '/js/api.js';
import { mountShell, toast } from '/js/ui/shell.js';
import { $ } from '/js/ui/page.js';
import { esc, heroHtml, tabsHtml, wireTabs, standingsHtml, scheduleHtml, rulesHtml, teamBadge, TAB_KEYS, PUBLIC_STATUS_TEXT, contactLink, REGISTER_NOTE } from '/js/ui/league-ui.js';

const SITE = 'https://sannhanh.pages.dev';
const root = $('league-root');
const id = Number(new URLSearchParams(location.search).get('id'));
let L;

function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) (el = document.createElement('meta'), el.setAttribute(attr, key), document.head.append(el));
  el.setAttribute('content', value);
}
function setSeo() {
  const title = `${L.name} – bóng đá phủi tại ${L.venueName} | SânNhanh`;
  const desc = `${L.name}: giải sân ${L.fieldType} người, ${L.teams.length} đội đá vòng tròn tại ${L.venueName}. Xem lịch thi đấu, kết quả và bảng xếp hạng.`;
  const url = `${SITE}/league.html?id=${L.id}`;
  document.title = title;
  setMeta('name', 'description', desc);
  for (const [k, v] of [['og:title', title], ['og:description', desc], ['og:url', url]]) setMeta('property', k, v);
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) (link = document.createElement('link'), link.rel = 'canonical', document.head.append(link));
  link.href = url;
  if (!L.indexable) setMeta('name', 'robots', 'noindex,follow');
}

const teamsHtml = () =>
  `<ul class="plain-list lg-teamgrid">${L.teams
    .map((t) => `<li class="lg-teamcard ${t.withdrawn ? 'is-out' : ''}">${teamBadge(t.id, t.name, 'tm-lg')}<strong>${esc(t.name)}</strong>${t.withdrawn ? '<span class="lg-out">Đã rút</span>' : ''}</li>`)
    .join('')}</ul>`;

function render() {
  const actions = `${contactLink(L, { cls: 'btn btn-sm btn-lime' })}
    <button class="btn btn-sm btn-onimg" type="button" id="copy-link">Sao chép link giải</button>
    <a class="btn btn-sm btn-onimg" href="/venue.html?id=${L.venueId}">Xem giờ trống của sân</a>`;
  const sub = `Đá tại <a href="/venue.html?id=${L.venueId}">${esc(L.venueName)}</a>${L.venueAddress ? ` · ${esc(L.venueAddress)}` : ''}`;
  root.innerHTML = `${heroHtml(L, { sub, actions, statusText: PUBLIC_STATUS_TEXT })}
    <p class="lg-regnote">${REGISTER_NOTE}</p>
    ${tabsHtml(
      [
        { key: TAB_KEYS.standings, label: 'Bảng xếp hạng', html: standingsHtml(L) },
        { key: TAB_KEYS.schedule, label: 'Lịch đấu', html: scheduleHtml(L) },
        { key: TAB_KEYS.teams, label: 'Các đội', html: teamsHtml() },
        { key: TAB_KEYS.rules, label: 'Điều lệ', html: rulesHtml(L) },
      ],
      TAB_KEYS.standings,
    )}`;
  wireTabs(root);
  $('copy-link').onclick = async () => {
    const url = `${location.origin}/league.html?id=${L.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Đã sao chép link giải');
    } catch {
      toast(url);
    }
  };
}

await mountShell();
try {
  L = await api.league(id);
  setSeo();
  render();
} catch (err) {
  document.title = 'Không tìm thấy giải – SânNhanh';
  setMeta('name', 'robots', 'noindex');
  root.innerHTML = `<div class="empty"><p>${esc(err.status === 404 ? 'Không tìm thấy giải này, hoặc giải chưa được công bố.' : err.message || 'Không tải được giải')}</p><a class="btn" href="/venues.html">Xem các sân</a></div>`;
}
