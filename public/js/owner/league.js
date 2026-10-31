// Quản lý một giải: đội, tạo trận, xếp giờ, công bố, nhập tỉ số, hoãn trận, đội rút, bảng xếp hạng, điều lệ.
import { $, $$, esc, initPage, errorBox, api, dialog, guard, toast, mountViewSwitch, todayStr } from './common.js';
import { heroHtml, tabsHtml, wireTabs, standingsHtml, scheduleHtml, rulesHtml, teamBadge, menuHtml, menuItem, wireMenus, TAB_KEYS } from '/js/ui/league-ui.js';

const content = $('#content');
const id = Number(new URLSearchParams(location.search).get('id'));
let L; // giải đang xem
let venue;

const publicUrl = () => `${location.origin}/league.html?id=${L.id}`;
const matchLine = (m) => `${esc(m.homeName)} – ${esc(m.awayName)}`;

async function load() {
  try {
    L = await api.owner.league(id);
    venue = venue || (await api.owner.venues()).find((v) => v.id === L.venueId);
    render();
  } catch (err) {
    errorBox(content, err, load);
  }
}

/* ---------- Phần dưới mỗi thẻ trận ---------- */
function footOf(m) {
  const draft = L.status === 'draft';
  if (draft) return { foot: L.counts.matches ? `<button class="btn btn-sm" type="button" data-pick="${m.id}">${m.date ? 'Đổi giờ' : 'Chọn giờ'}</button>` : '' };
  const items = [];
  if (m.status === 'scheduled') items.push(menuItem('Hoãn / đổi giờ', `data-resched="${m.id}"`));
  if (m.status === 'played') items.push(menuItem('Sửa tỉ số', `data-score="${m.id}"`));
  if (m.history?.length) items.push(menuItem(`Xem lịch sử (${m.history.length})`, `data-hist="${m.id}"`));
  let foot = '';
  if (m.status === 'scheduled') foot = m.started ? `<button class="btn btn-sm btn-primary" type="button" data-score="${m.id}">Nhập tỉ số</button>` : '<span class="mc-hint">Đến giờ đá mới nhập tỉ số được</span>';
  return { foot, menu: menuHtml(items, `Thao tác cho trận ${m.homeName} – ${m.awayName}`) };
}

/* ---------- Các đội: bảng gọn, lệ phí cùng dòng, thao tác trong menu ---------- */
function teamsHtml() {
  const draft = L.status === 'draft';
  const open = draft && !L.counts.matches;
  const rows = L.teams
    .map((t) => {
      const items = [];
      if (open) items.push(menuItem('Sửa thông tin', `data-edit-team="${t.id}"`), menuItem('Xóa đội', `data-del-team="${t.id}"`, true));
      if (!draft && !t.withdrawn) items.push(menuItem('Đội rút khỏi giải', `data-withdraw="${t.id}"`, true));
      return `<tr class="lg-team ${t.withdrawn ? 'is-out' : ''}" data-tid="${t.id}">
        <td class="tn"><span class="nm-in">${teamBadge(t.id, t.name)}<strong>${esc(t.name)}${t.withdrawn ? ' <span class="lg-out">Đã rút</span>' : ''}</strong></span></td>
        <td class="tc"><span>${esc(t.contactName || 'Chưa ghi người liên hệ')}</span>${t.contactPhone ? `<span class="muted">${esc(t.contactPhone)}</span>` : ''}</td>
        <td class="tf"><label class="check"><input type="checkbox" data-fee="${t.id}" ${t.feePaid ? 'checked' : ''}> <span>${t.feePaid ? 'Đã nộp lệ phí' : 'Chưa nộp lệ phí'}</span></label></td>
        <td class="tm-act">${menuHtml(items, `Thao tác cho đội ${t.name}`)}</td></tr>`;
    })
    .join('');
  const add = open && L.teams.length < L.teamCount ? `<button class="btn" type="button" id="add-team">Thêm đội (${L.teams.length}/${L.teamCount})</button>` : '';
  const note = open && L.teams.length === L.teamCount ? '<p class="lg-legend">Đủ đội rồi. Thêm hoặc xóa đội chỉ làm được trước khi tạo các trận.</p>' : '';
  return `<div class="lg-card lg-tblwrap"><table class="lg-tbl"><caption class="sr-only">Các đội</caption>
    <thead><tr><th scope="col">Đội</th><th scope="col">Liên hệ</th><th scope="col">Lệ phí</th><th scope="col"><span class="sr-only">Thao tác</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${add}${note}<p class="lg-legend">Lệ phí thu ngoài web, ở đây chỉ ghi đội đã nộp hay chưa. Số điện thoại chỉ chủ sân thấy.</p>`;
}

/* ---------- Bước soạn giải (chỉ khi chưa công bố) ---------- */
function setupHtml() {
  if (L.status !== 'draft') return '';
  const full = L.teams.length === L.teamCount;
  const hasM = L.counts.matches > 0;
  const missing = L.counts.matches - L.counts.planned;
  const courts = venue.courts.filter((c) => c.isActive && c.fieldType === L.fieldType);
  const steps = [
    ['Đủ đội', full, `${L.teams.length}/${L.teamCount} đội`],
    ['Tạo các trận', hasM, hasM ? `${L.counts.matches} trận` : 'Chưa tạo'],
    ['Xếp giờ', hasM && !missing, hasM ? `${L.counts.planned}/${L.counts.matches} trận có giờ` : 'Chưa xếp'],
    ['Công bố', false, 'Giữ giờ cả loạt'],
  ];
  const fix = hasM
    ? '<button class="btn btn-sm btn-ghost" type="button" id="make-fixtures">Tạo lại các trận</button>'
    : `<button class="btn btn-primary" type="button" id="make-fixtures" ${full ? '' : 'disabled'}>Tạo các trận</button>`;
  const auto = hasM
    ? `<form class="lg-auto" id="auto-plan" novalidate>
        <div class="field"><label for="ap-court">Sân con</label><select class="select" id="ap-court" name="courtId">${courts.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ap-date">Từ ngày</label><input class="input" id="ap-date" name="date" type="date" min="${todayStr(1)}" value="${todayStr(1)}"></div>
        <div class="field"><label for="ap-start">Từ giờ</label><input class="input" id="ap-start" name="start" type="time" value="19:00"></div>
        <div class="field"><label for="ap-per">Trận mỗi ngày</label><select class="select" id="ap-per" name="perDay">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <button class="btn" type="submit">Xếp tự động</button></form>
        <p class="lg-legend">Xếp tự động điền các trận chưa có giờ vào ô trống kế tiếp. Sau đó vẫn đổi giờ từng trận được ở tab Lịch đấu.</p>`
    : '';
  const pub = hasM
    ? `<div class="lg-pub"><button class="btn btn-lime" type="button" id="publish" ${missing ? 'disabled' : ''}>Công bố giải và giữ giờ</button>
        <p class="lg-legend">${missing ? `Còn ${missing} trận chưa có giờ; phải đủ giờ mọi trận mới công bố được. ` : ''}Khi công bố, mọi giờ được giữ cùng lúc trên lưới sân. Có một giờ bị trùng thì không giữ giờ nào và báo bạn giờ nào trùng.</p></div>`
    : '';
  return `<section class="lg-card lg-setup" aria-labelledby="setup-h"><h2 class="h2" id="setup-h">Soạn giải</h2>
    <ol class="lg-steps">${steps.map(([n, ok, t], i) => `<li class="${ok ? 'is-done' : ''}"><span class="n" aria-hidden="true">${ok ? '✓' : i + 1}</span><span><strong>${n}</strong><span class="muted">${esc(t)}</span></span></li>`).join('')}</ol>
    <div class="lg-setup-act">${fix}</div>${auto}${pub}</section>`;
}

function render() {
  const draft = L.status === 'draft';
  $('#sub').textContent = `${venue.name} · sân ${L.fieldType} người`;
  const menu = menuHtml([menuItem('Sửa tên, link, điều lệ', 'id="edit-league"'), menuItem('Xóa giải', 'id="del-league"', true)], 'Thao tác với giải');
  const actions = draft
    ? `<a class="btn btn-sm btn-onimg" href="/owner-leagues.html">← Các giải</a><span class="lg-hint">Chưa công bố nên khách chưa xem được trang giải.</span>${menu}`
    : `<a class="btn btn-sm btn-lime" href="/league.html?id=${L.id}" target="_blank" rel="noopener">Xem trang công khai</a><button class="btn btn-sm btn-onimg" type="button" id="copy-link">Sao chép link giải</button><a class="btn btn-sm btn-onimg" href="/owner-leagues.html">← Các giải</a>${menu}`;
  content.innerHTML = `${heroHtml(L, { actions })}${setupHtml()}
    ${tabsHtml(
      [
        { key: TAB_KEYS.standings, label: 'Bảng xếp hạng', html: standingsHtml(L) },
        { key: TAB_KEYS.schedule, label: 'Lịch đấu', html: scheduleHtml(L, { footOf, empty: 'Chưa có trận nào. Nhập đủ đội rồi bấm "Tạo các trận".' }) },
        { key: TAB_KEYS.teams, label: 'Các đội', html: teamsHtml() },
        { key: TAB_KEYS.rules, label: 'Điều lệ', html: rulesHtml(L) },
      ],
      draft ? TAB_KEYS.teams : TAB_KEYS.schedule,
    )}`;
  wireTabs(content);
  wireMenus(content);
  wire();
}

const act = (btn, fn, ok) =>
  guard(btn, async () => {
    L = await fn();
    if (ok) toast(ok);
    render();
  });

function teamDialog(t) {
  return dialog({
    title: t ? 'Sửa đội' : 'Thêm đội',
    confirm: t ? 'Lưu' : 'Thêm đội',
    body: `<div class="field"><label for="tm-name">Tên đội</label><input class="input" id="tm-name" name="name" maxlength="40" required data-label="tên đội" value="${esc(t?.name || '')}"></div>
      <div class="field"><label for="tm-contact">Người liên hệ</label><input class="input" id="tm-contact" name="contactName" maxlength="60" value="${esc(t?.contactName || '')}"></div>
      <div class="field"><label for="tm-phone">Số điện thoại (không bắt buộc)</label><input class="input" id="tm-phone" name="contactPhone" type="tel" inputmode="tel" maxlength="20" value="${esc(t?.contactPhone || '')}"></div>`,
  });
}

/** Hộp chọn sân con, ngày, giờ: danh sách giờ lấy từ lưới sân thật, ô không trống thì khóa. */
async function slotDialog({ title, confirm, m, note }) {
  const courts = venue.courts.filter((c) => c.isActive && c.fieldType === L.fieldType);
  const cache = new Map();
  const sched = async (d) => {
    if (!cache.has(d)) cache.set(d, await api.owner.schedule(L.venueId, d));
    return cache.get(d);
  };
  const date0 = m.date && m.date >= todayStr() ? m.date : todayStr(1);
  return dialog({
    title,
    confirm,
    body: `<p><strong>${matchLine(m)}</strong></p>
      <div class="field"><label for="sl-court">Sân con</label><select class="select" id="sl-court" name="courtId">${courts.map((c) => `<option value="${c.id}" ${c.id === m.courtId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="sl-date">Ngày</label><input class="input" id="sl-date" name="date" type="date" min="${todayStr()}" value="${date0}"></div>
      <div class="field"><label for="sl-start">Giờ</label><select class="select" id="sl-start" name="start" required data-label="giờ"><option value="">Đang tải giờ...</option></select><span class="hint" id="sl-hint"></span></div>
      ${note ? '<div class="field"><label for="sl-note">Lý do (không bắt buộc)</label><input class="input" id="sl-note" name="note" maxlength="300" placeholder="Ví dụ: trời mưa, sân ngập"></div>' : ''}`,
    async onOpen(dlg) {
      const el = (q) => dlg.querySelector(q);
      const refresh = async () => {
        const sel = el('#sl-start');
        try {
          const sc = await sched(el('#sl-date').value || todayStr(1));
          const court = sc.courts.find((c) => c.id === Number(el('#sl-court').value));
          const free = court.slots.filter((s) => s.status === 'available' && !s.teamMode);
          sel.innerHTML = `<option value="">Chọn giờ</option>${court.slots
            .map((s) => {
              const ok = s.status === 'available' && !s.teamMode;
              const mine = !ok && m.date === sc.date && m.courtId === court.id && s.start === m.start;
              return `<option value="${s.start}" ${ok ? '' : 'disabled'}>${s.start}–${s.end}${ok ? '' : mine ? ' · giờ hiện tại của trận' : s.teamMode && s.status === 'available' ? ' · chỉ nhận ghép kèo' : ' · không trống'}</option>`;
            })
            .join('')}`;
          el('#sl-hint').textContent = free.length ? '' : 'Ngày này không còn giờ trống ở sân con này.';
        } catch (e) {
          sel.innerHTML = '<option value="">Không tải được giờ</option>';
          el('#sl-hint').textContent = e.message;
        }
      };
      el('#sl-date').addEventListener('change', refresh);
      el('#sl-court').addEventListener('change', refresh);
      await refresh();
    },
  });
}

const HIST_KIND = { reschedule: 'Đổi giờ', forfeit: 'Xử thua', score: 'Tỉ số' };
function histDialog(m) {
  const rows = m.history
    .map((h) => {
      const what = h.kind === 'reschedule' ? `Đổi giờ: ${esc(h.from)} → ${esc(h.to)}` : h.kind === 'forfeit' ? `Xử thua ${esc(h.to)}` : h.from ? `Sửa tỉ số ${esc(h.from)} → ${esc(h.to)}` : `Nhập tỉ số ${esc(h.to)}`;
      return `<li><strong>${esc(HIST_KIND[h.kind] || '')}</strong> · ${what}<br><span class="muted">${esc(h.at.slice(8, 10))}/${esc(h.at.slice(5, 7))} ${esc(h.at.slice(11, 16))} · ${esc(h.by)}${h.note ? ` · Lý do: ${esc(h.note)}` : ''}</span></li>`;
    })
    .join('');
  return dialog({ title: 'Lịch sử trận', hideConfirm: true, body: `<p><strong>${matchLine(m)}</strong></p><ul class="lg-hist">${rows}</ul>` });
}

function wire() {
  const byAttr = (attr, fn) => $$(`[${attr}]`, content).forEach((b) => (b.onclick = () => fn(Number(b.getAttribute(attr)), b)));
  const match = (mid) => L.matches.find((m) => m.id === mid);
  const team = (tid) => L.teams.find((t) => t.id === tid);

  $('#copy-link')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicUrl());
      toast('Đã sao chép link giải');
    } catch {
      toast(publicUrl());
    }
  });
  $('#add-team')?.addEventListener('click', async () => {
    const d = await teamDialog();
    if (d) act(null, () => api.owner.addLeagueTeam(L.id, d), 'Đã thêm đội');
  });
  byAttr('data-edit-team', async (tid) => {
    const d = await teamDialog(team(tid));
    if (d) act(null, () => api.owner.updateLeagueTeam(L.id, tid, d), 'Đã lưu đội');
  });
  byAttr('data-del-team', async (tid) => {
    const d = await dialog({ title: 'Xóa đội', confirm: 'Xóa đội', danger: true, body: `<p>Xóa đội <strong>${esc(team(tid).name)}</strong> khỏi giải?</p>` });
    if (d) act(null, () => api.owner.deleteLeagueTeam(L.id, tid));
  });
  $$('[data-fee]', content).forEach((c) => {
    c.onchange = () => act(c, () => api.owner.updateLeagueTeam(L.id, Number(c.dataset.fee), { feePaid: c.checked }));
  });
  byAttr('data-withdraw', async (tid) => {
    const t = team(tid);
    const left = L.matches.filter((m) => !m.score && [m.homeId, m.awayId].includes(tid)).length;
    const d = await dialog({
      title: 'Đội rút khỏi giải',
      confirm: 'Cho đội rút',
      danger: true,
      body: `<p><strong>${esc(t.name)}</strong> rút khỏi giải. Kết quả đã đá giữ nguyên. ${left} trận còn lại bị xử thua 0-3 và giờ sân của các trận đó được trả lại. Bảng xếp hạng ghi "Đã rút". Không hoàn tác được.</p>
        <div class="field"><label for="wd-note">Lý do (không bắt buộc)</label><input class="input" id="wd-note" name="note" maxlength="300"></div>`,
    });
    if (d) act(null, () => api.owner.withdrawLeagueTeam(L.id, tid, d.note || ''), 'Đã cho đội rút');
  });
  $('#make-fixtures')?.addEventListener('click', async (e) => {
    if (L.counts.matches) {
      const d = await dialog({ title: 'Tạo lại các trận', confirm: 'Tạo lại', danger: true, body: '<p>Các trận và giờ đã chọn sẽ bị xóa, tạo lại từ đầu.</p>' });
      if (!d) return;
    }
    act(e.currentTarget, () => api.owner.makeLeagueFixtures(L.id), 'Đã tạo các trận');
  });
  $('#auto-plan')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    act(e.submitter, () => api.owner.autoPlanLeague(L.id, { courtId: Number(f.courtId.value), date: f.date.value, start: f.start.value, perDay: Number(f.perDay.value) }), 'Đã xếp giờ');
  });
  byAttr('data-pick', async (mid) => {
    const m = match(mid);
    const d = await slotDialog({ title: m.date ? 'Đổi giờ trận' : 'Chọn giờ trận', confirm: 'Chọn giờ này', m });
    if (d) act(null, () => api.owner.saveLeaguePlan(L.id, [{ matchId: mid, courtId: Number(d.courtId), date: d.date, start: d.start }]), 'Đã chọn giờ');
  });
  $('#publish')?.addEventListener('click', async (e) => {
    const d = await dialog({ title: 'Công bố giải', confirm: 'Công bố và giữ giờ', body: `<p>Giữ giờ cho cả ${L.counts.matches} trận trên lưới sân và mở trang giải cho mọi người xem. Sau khi công bố không thêm hoặc xóa đội được nữa; đội rút thì vẫn ghi nhận được.</p>` });
    if (!d) return;
    guard(e.currentTarget, async () => {
      try {
        L = await api.owner.publishLeague(L.id);
        toast('Đã công bố giải, các giờ đã được giữ');
        render();
      } catch (err) {
        await dialog({ title: 'Chưa công bố được', hideConfirm: true, body: `<p>${esc(err.message)}</p><p class="muted">Chưa giữ giờ nào. Đổi giờ các trận bị trùng rồi công bố lại.</p>` });
      }
    });
  });
  byAttr('data-resched', async (mid) => {
    const m = match(mid);
    const d = await slotDialog({ title: 'Hoãn / đổi giờ trận', confirm: 'Đổi giờ', m, note: true });
    if (d) act(null, () => api.owner.rescheduleLeagueMatch(L.id, mid, { courtId: Number(d.courtId), date: d.date, start: d.start, note: d.note || '' }), 'Đã đổi giờ, giờ cũ được trả lại');
  });
  byAttr('data-hist', (mid) => histDialog(match(mid)));
  byAttr('data-score', async (mid) => {
    const m = match(mid);
    const edit = !!m.score;
    const d = await dialog({
      title: edit ? 'Sửa tỉ số' : 'Nhập tỉ số',
      confirm: 'Lưu tỉ số',
      body: `<p><strong>${matchLine(m)}</strong></p>
        <div class="field"><label for="sc-home">Bàn thắng ${esc(m.homeName)}</label><input class="input" id="sc-home" name="home" type="number" inputmode="numeric" min="0" max="99" required data-label="tỉ số" value="${m.score ? m.score.home : ''}"></div>
        <div class="field"><label for="sc-away">Bàn thắng ${esc(m.awayName)}</label><input class="input" id="sc-away" name="away" type="number" inputmode="numeric" min="0" max="99" required data-label="tỉ số" value="${m.score ? m.score.away : ''}"></div>
        <div class="field"><label for="sc-note">Lý do${edit ? '' : ' (không bắt buộc)'}</label><input class="input" id="sc-note" name="note" maxlength="300" ${edit ? 'required data-label="lý do sửa"' : ''} placeholder="${edit ? 'Ví dụ: ghi nhầm tỉ số' : ''}"></div>
        ${edit ? '<p class="muted">Mỗi lần sửa được lưu lại: ai sửa, lúc nào, vì sao.</p>' : ''}`,
    });
    if (d) act(null, () => api.owner.scoreLeagueMatch(L.id, mid, { home: Number(d.home), away: Number(d.away), note: d.note || '' }), 'Đã lưu tỉ số');
  });
  $('#edit-league')?.addEventListener('click', async () => {
    const d = await dialog({
      title: 'Sửa giải',
      confirm: 'Lưu',
      body: `<div class="field"><label for="el-name">Tên giải</label><input class="input" id="el-name" name="name" maxlength="80" required data-label="tên giải" value="${esc(L.name)}"></div>
        <div class="field"><label for="el-link">Link nhóm Zalo hoặc fanpage</label><input class="input" id="el-link" name="link" type="url" maxlength="300" value="${esc(L.link)}"></div>
        <div class="field"><label for="el-rules">Điều lệ</label><textarea class="textarea" id="el-rules" name="rules" rows="9" maxlength="3000" required data-label="điều lệ">${esc(L.rules)}</textarea></div>`,
    });
    if (d) act(null, () => api.owner.updateLeague(L.id, { name: d.name, link: d.link || '', rules: d.rules }), 'Đã lưu');
  });
  $('#del-league')?.addEventListener('click', async () => {
    const held = L.counts.held;
    const d = await dialog({
      title: 'Xóa giải',
      confirm: 'Xóa giải',
      danger: true,
      body: `<p>Xóa giải <strong>${esc(L.name)}</strong>, các đội và kết quả. ${held ? `${held} giờ đang giữ sẽ được trả lại lưới sân (người đang chờ giờ đó được báo).` : ''} Không hoàn tác được.</p>`,
    });
    if (!d) return;
    guard(null, async () => {
      await api.owner.deleteLeague(L.id);
      location.href = '/owner-leagues.html';
    });
  });
}

if (await initPage()) {
  try {
    mountViewSwitch('leagues');
    await load();
  } catch (err) {
    errorBox(content, err, () => location.reload());
  }
}
