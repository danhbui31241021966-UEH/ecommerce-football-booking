// Phần giao diện giải đấu dùng chung cho trang công khai và trang chủ sân: biểu tượng đội, thẻ trận, bảng xếp hạng,
// đầu trang, tab (lưu trong #hash) và menu "⋯". Chỉ vẽ dữ liệu có sẵn; không tính luật (điểm do API tính).
import { dayLabel } from '/js/ui/format.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const STATUS_TEXT = { draft: 'Đang soạn', published: 'Đã công bố', ongoing: 'Đang đá', finished: 'Đã kết thúc' };
export const HERO_IMG = { small: '/img/photos/hero-13907438-800.jpg', large: '/img/photos/hero-13907438-1600.jpg' };

/* ---------- Biểu tượng đội: tròn, màu cố định theo id ---------- */
const TEAM_COLORS = ['#1d4e9a', '#b4400c', '#0f766e', '#7e22ce', '#be123c', '#8a5a0b', '#334155', '#176b44'];
export const teamColor = (id) => TEAM_COLORS[Math.abs(Number(id) || 0) % TEAM_COLORS.length];
export const teamBadge = (id, name, cls = '') =>
  `<span class="tm ${cls}" style="--tm:${teamColor(id)}" aria-hidden="true">${esc(Array.from(String(name).trim())[0]?.toUpperCase() || '?')}</span>`;

/* ---------- Tiến độ ---------- */
export function progress(done, total, { label = 'trận đã đá' } = {}) {
  if (!total) return '<div class="lg-prog"><div class="pg" aria-hidden="true"><span style="width:0"></span></div><span class="pg-t">Chưa xếp lịch</span></div>';
  const pct = Math.round((done / total) * 100);
  return `<div class="lg-prog"><div class="pg" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="${done} trên ${total} ${label}"><span style="width:${pct}%"></span></div><span class="pg-t">${done}/${total} trận</span></div>`;
}

/* ---------- Đầu trang ---------- */
export function heroHtml(L, { sub = '', actions = '' } = {}) {
  return `<header class="lg-hero">
    <img src="${HERO_IMG.small}" srcset="${HERO_IMG.small} 800w, ${HERO_IMG.large} 1600w" sizes="(min-width: 1180px) 1180px, 100vw" alt="" width="800" height="533" fetchpriority="high">
    <div class="lg-hero-in">
      <p class="lg-kicker"><span class="lg-st lg-st-${L.status}">${STATUS_TEXT[L.status]}</span><span>Sân ${esc(L.fieldType)} người · ${L.teams.length} đội</span></p>
      <h1 class="lg-title">${esc(L.name)}</h1>
      ${sub ? `<p class="lg-where">${sub}</p>` : ''}
      ${progress(L.counts.done, L.counts.matches)}
      ${actions ? `<div class="lg-actions">${actions}</div>` : ''}
    </div></header>`;
}

/* ---------- Phong độ 3 trận gần nhất (từ tỉ số có cấu trúc) ---------- */
const FORM_TEXT = { T: 'thắng', H: 'hòa', B: 'thua' };
export function formMap(L) {
  const played = L.matches.filter((m) => m.score).sort((a, b) => `${a.date} ${a.start} ${a.round}`.localeCompare(`${b.date} ${b.start} ${b.round}`));
  const out = new Map(L.teams.map((t) => [t.id, []]));
  for (const m of played) {
    const { home: h, away: a } = m.score;
    out.get(m.homeId)?.push(h > a ? 'T' : h === a ? 'H' : 'B');
    out.get(m.awayId)?.push(h > a ? 'B' : h === a ? 'H' : 'T');
  }
  for (const [k, v] of out) out.set(k, v.slice(-3));
  return out;
}
const formHtml = (list) =>
  list.length
    ? `<span class="fm-row" role="img" aria-label="3 trận gần nhất: ${list.map((r) => FORM_TEXT[r]).join(', ')}">${list.map((r) => `<span class="fm fm-${r}" aria-hidden="true">${r}</span>`).join('')}</span>`
    : '<span class="muted" aria-label="Chưa đá trận nào">–</span>';

/* ---------- Bảng xếp hạng ---------- */
export function standingsHtml(L) {
  const form = formMap(L);
  const lead = L.standings[0]?.played > 0 ? L.standings[0].teamId : null;
  return `<div class="lg-card lg-table-wrap"><table class="lg-table"><caption class="sr-only">Bảng xếp hạng</caption>
    <thead><tr><th scope="col">#</th><th scope="col">Đội</th><th scope="col" title="Số trận">Tr</th><th scope="col" class="c-opt" title="Thắng">T</th><th scope="col" class="c-opt" title="Hòa">H</th><th scope="col" class="c-opt" title="Thua">B</th><th scope="col" title="Hiệu số">HS</th><th scope="col" title="Điểm">Đ</th><th scope="col" class="c-form">Phong độ</th></tr></thead>
    <tbody>${L.standings
      .map(
        (r) => `<tr class="${r.teamId === lead ? 'is-lead' : ''} ${r.withdrawn ? 'is-out' : ''}"><td class="rk">${r.rank}</td>
        <td class="nm"><span class="nm-in">${teamBadge(r.teamId, r.name)}<span>${esc(r.name)}${r.withdrawn ? ' <span class="lg-out">Đã rút</span>' : ''}</span></span></td>
        <td>${r.played}</td><td class="c-opt">${r.won}</td><td class="c-opt">${r.drawn}</td><td class="c-opt">${r.lost}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.points}</td><td class="c-form">${formHtml(form.get(r.teamId) || [])}</td></tr>`,
      )
      .join('')}</tbody></table></div>
    <p class="lg-legend">Tr: số trận · T: thắng · H: hòa · B: thua · HS: hiệu số · Đ: điểm. Phong độ: 3 trận gần nhất, trận mới nhất ở bên phải.</p>`;
}

/* ---------- Thẻ trận ---------- */
function midHtml(m) {
  if (m.score) {
    const f = m.forfeitBy ? ', xử thua' : '';
    return `<div class="mc-mid is-score score" role="img" aria-label="${esc(m.homeName)} ${m.score.home}, ${esc(m.awayName)} ${m.score.away}${f}"><span aria-hidden="true">${m.score.home}<i>–</i>${m.score.away}</span></div>`;
  }
  const when = m.date ? `${m.start} ngày ${m.date.slice(8, 10)}/${m.date.slice(5, 7)}` : 'chưa có giờ';
  return `<div class="mc-mid is-time" role="img" aria-label="${esc(m.homeName)} gặp ${esc(m.awayName)}, ${when}"><span aria-hidden="true">${m.start || '–:–'}</span></div>`;
}
/** foot: nút chính dưới thẻ; menu: nút "⋯" ở góc thẻ (cả hai do chủ sân dùng). */
export function matchCard(m, { foot = '', menu = '' } = {}) {
  const meta = m.date ? `${m.start}–${m.end} · ${esc(m.courtName)} · Lượt ${m.round}` : `Lượt ${m.round} · Chưa có giờ`;
  const tags = [m.status === 'forfeit' ? '<span class="mc-tag">Xử thua</span>' : '', m.rescheduled && !m.score ? '<span class="mc-tag">Đã hoãn</span>' : ''].join('');
  return `<li class="mc ${m.status === 'forfeit' ? 'is-forfeit' : ''}" data-id="${m.id}">
    <div class="mc-meta"><span>${meta}</span>${tags || menu ? `<span class="mc-tags">${tags}${menu}</span>` : ''}</div>
    <div class="mc-row">
      <div class="mc-team mc-a"><span class="mc-name">${esc(m.homeName)}</span>${teamBadge(m.homeId, m.homeName)}</div>
      ${midHtml(m)}
      <div class="mc-team mc-b">${teamBadge(m.awayId, m.awayName)}<span class="mc-name">${esc(m.awayName)}</span></div>
    </div>${foot ? `<div class="mc-foot">${foot}</div>` : ''}</li>`;
}

/** Trận gom theo ngày; trận chưa có giờ ở nhóm riêng cuối cùng. */
export function scheduleHtml(L, { footOf = () => ({}), empty = 'Chưa có trận nào.' } = {}) {
  if (!L.matches.length) return `<p class="muted">${empty}</p>`;
  const sorted = [...L.matches].sort((a, b) => `${a.date || '9999'} ${a.start || ''} ${a.id}`.localeCompare(`${b.date || '9999'} ${b.start || ''} ${b.id}`));
  const groups = new Map();
  for (const m of sorted) (groups.get(m.date || '') || groups.set(m.date || '', []).get(m.date || '')).push(m);
  return [...groups]
    .map(([d, ms]) => `<section class="lg-day-group"><h3 class="lg-day">${d ? esc(dayLabel(d)) : 'Chưa có giờ'}</h3><ul class="plain-list mc-list">${ms.map((m) => matchCard(m, footOf(m))).join('')}</ul></section>`)
    .join('');
}

export function rulesHtml(L) {
  return `<div class="lg-card lg-rules-card"><ol class="lg-rules">${String(L.rules)
    .split('\n')
    .filter((x) => x.trim())
    .map((x) => `<li>${esc(x.replace(/^\d+\.\s*/, ''))}</li>`)
    .join('')}</ol></div>${L.link ? `<p class="lg-linkrow"><a class="btn btn-sm" href="${esc(L.link)}" target="_blank" rel="noopener">Nhóm Zalo / fanpage của giải</a></p>` : ''}`;
}

/* ---------- Tab trong URL (#hash): tablist / tab / tabpanel, phím mũi tên ---------- */
export const TAB_KEYS = { standings: 'bang-xep-hang', schedule: 'lich-dau', teams: 'cac-doi', rules: 'dieu-le' };
/** tabs: [{ key, label, html }]. Tab đang chọn lấy từ #hash, không hợp lệ thì dùng def. */
export function tabsHtml(tabs, def) {
  const hash = decodeURIComponent(location.hash.slice(1));
  const active = tabs.some((t) => t.key === hash) ? hash : def;
  return `<div class="lg-tabs" role="tablist" aria-label="Nội dung giải">${tabs
    .map((t) => `<button type="button" role="tab" id="tab-${t.key}" class="lg-tab" aria-controls="tp-${t.key}" aria-selected="${t.key === active}" tabindex="${t.key === active ? 0 : -1}" data-tab="${t.key}">${esc(t.label)}</button>`)
    .join('')}</div>
    <div class="lg-panels" data-active="${active}">${tabs
      .map((t) => `<section role="tabpanel" id="tp-${t.key}" aria-labelledby="tab-${t.key}" class="tp tp-${t.key} ${t.key === active ? 'is-on' : ''}" tabindex="0"><h2 class="sr-only">${esc(t.label)}</h2>${t.html}</section>`)
      .join('')}</div>`;
}
export function wireTabs(root) {
  const list = root.querySelector('[role=tablist]');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role=tab]')];
  const panels = root.querySelector('.lg-panels');
  const select = (key, { focus = false, push = true } = {}) => {
    for (const t of tabs) {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    panels.dataset.active = key;
    for (const p of panels.children) p.classList.toggle('is-on', p.id === `tp-${key}`);
    if (push) history.replaceState(null, '', `${location.pathname}${location.search}#${key}`);
  };
  list.addEventListener('click', (e) => {
    const t = e.target.closest('[role=tab]');
    if (t) select(t.dataset.tab);
  });
  list.addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const to = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(tabs[to].dataset.tab, { focus: true });
  });
  window.addEventListener('hashchange', () => {
    const key = decodeURIComponent(location.hash.slice(1));
    if (tabs.some((t) => t.dataset.tab === key)) select(key, { push: false });
  });
}

/* ---------- Menu "⋯" dùng được bằng bàn phím ---------- */
let menuSeq = 0;
/** items: [{ html (nội dung nút, đã có data-*), danger? }] */
export function menuHtml(items, label = 'Thao tác khác') {
  if (!items.length) return '';
  const id = `mn-${++menuSeq}`;
  return `<span class="mn"><button type="button" class="mn-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="${id}" aria-label="${esc(label)}">⋯</button>
    <ul class="mn-list" role="menu" id="${id}" hidden>${items.map((i) => `<li role="none">${i}</li>`).join('')}</ul></span>`;
}
/** Nút trong menu: attrs ví dụ `data-resched="12"`. */
export const menuItem = (label, attrs, danger = false) => `<button type="button" role="menuitem" class="mn-item ${danger ? 'is-danger' : ''}" tabindex="-1" ${attrs}>${esc(label)}</button>`;

let docWired = false;
function closeAll(except) {
  for (const b of document.querySelectorAll('.mn-btn[aria-expanded=true]')) {
    if (b === except) continue;
    b.setAttribute('aria-expanded', 'false');
    document.getElementById(b.getAttribute('aria-controls')).hidden = true;
  }
}
export function wireMenus(root) {
  if (!docWired) {
    docWired = true;
    document.addEventListener('click', (e) => { if (!e.target.closest('.mn')) closeAll(); });
  }
  for (const wrap of root.querySelectorAll('.mn')) {
    const btn = wrap.querySelector('.mn-btn');
    const list = wrap.querySelector('.mn-list');
    const items = () => [...list.querySelectorAll('[role=menuitem]')];
    const open = (focusAt) => {
      closeAll(btn);
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const it = items();
      (focusAt === 'last' ? it.at(-1) : it[0])?.focus();
    };
    const close = (back) => {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (back) btn.focus();
    };
    btn.addEventListener('click', () => (list.hidden ? open() : close(true)));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); open('last'); }
    });
    list.addEventListener('keydown', (e) => {
      const it = items();
      const i = it.indexOf(document.activeElement);
      const to = { ArrowDown: (i + 1) % it.length, ArrowUp: (i - 1 + it.length) % it.length, Home: 0, End: it.length - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); it[to].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    list.addEventListener('click', () => close(false));
  }
}
