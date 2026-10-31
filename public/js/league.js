// Trang giải công khai (không cần đăng nhập): đội, lịch, kết quả, bảng xếp hạng, điều lệ. ?id=
import { api } from '/js/api.js';
import { mountShell, toast } from '/js/ui/shell.js';
import { $, esc } from '/js/ui/page.js';
import { dayLabel } from '/js/ui/format.js';

const SITE = 'https://sannhanh.pages.dev';
const STATUS_TEXT = { published: 'Sắp đá', ongoing: 'Đang đá', finished: 'Đã kết thúc' };
const MATCH_TEXT = { scheduled: 'Chưa đá', played: 'Đã đá', forfeit: 'Xử thua do đội rút' };
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

const matchHtml = (m) => {
  const score = m.score ? `<span class="score">${m.score.home} – ${m.score.away}</span>` : '';
  const when = m.date ? `${m.start}–${m.end}, ${esc(dayLabel(m.date))} · ${esc(m.courtName)}` : 'Chưa có giờ';
  return `<li class="lg-match"><span class="teams">${esc(m.homeName)} – ${esc(m.awayName)} ${score}</span><span class="when">${when} · ${MATCH_TEXT[m.status] || ''}</span></li>`;
};

function render() {
  const rounds = new Map();
  for (const m of L.matches) (rounds.get(m.round) || rounds.set(m.round, []).get(m.round)).push(m);
  const standings = `<div class="lg-table-wrap"><table class="lg-table"><caption class="sr-only">Bảng xếp hạng</caption>
    <thead><tr><th scope="col">#</th><th scope="col">Đội</th><th scope="col" title="Trận">Tr</th><th scope="col" title="Thắng">T</th><th scope="col" title="Hòa">H</th><th scope="col" title="Thua">B</th><th scope="col" title="Hiệu số">HS</th><th scope="col">Đ</th></tr></thead>
    <tbody>${L.standings.map((r) => `<tr><td>${r.rank}</td><td>${esc(r.name)}${r.withdrawn ? ' <span class="lg-out">Đã rút</span>' : ''}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.points}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted">Tr: số trận · T: thắng · H: hòa · B: thua · HS: hiệu số · Đ: điểm.</p>`;
  root.innerHTML = `<div class="lg-head">
      <h1 class="h1">${esc(L.name)}</h1>
      <p><span class="badge badge-lg-${L.status}">${STATUS_TEXT[L.status]}</span> <span class="muted">Sân ${esc(L.fieldType)} người · ${L.teams.length} đội · ${L.counts.done}/${L.counts.matches} trận đã đá</span></p>
      <p>Đá tại <a href="/venue.html?id=${L.venueId}">${esc(L.venueName)}</a><span class="muted"> · ${esc(L.venueAddress || '')}</span></p>
      <div class="lg-actions"><button class="btn btn-sm" type="button" id="copy-link">Sao chép link giải</button>${L.link ? `<a class="btn btn-sm" href="${esc(L.link)}" target="_blank" rel="noopener">Nhóm Zalo / fanpage</a>` : ''}<a class="btn btn-sm btn-primary" href="/venue.html?id=${L.venueId}">Xem giờ trống của sân</a></div></div>
    <section class="lg-sec"><h2 class="h2">Bảng xếp hạng</h2>${standings}</section>
    <section class="lg-sec"><h2 class="h2">Lịch thi đấu và kết quả</h2>${[...rounds].map(([r, ms]) => `<h3 class="lg-round">Lượt ${r}</h3><ul class="plain-list">${ms.map(matchHtml).join('')}</ul>`).join('')}</section>
    <section class="lg-sec"><h2 class="h2">Các đội</h2><ul class="plain-list">${L.teams.map((t) => `<li class="lg-team"><strong>${esc(t.name)}${t.withdrawn ? ' <span class="lg-out">Đã rút</span>' : ''}</strong></li>`).join('')}</ul></section>
    <section class="lg-sec"><h2 class="h2">Điều lệ</h2><div class="lg-rules">${esc(L.rules)}</div></section>`;
  $('copy-link').onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/league.html?id=${L.id}`);
      toast('Đã sao chép link giải');
    } catch {
      toast(`${location.origin}/league.html?id=${L.id}`);
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
