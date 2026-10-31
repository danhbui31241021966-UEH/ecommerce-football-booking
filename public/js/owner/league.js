// Quản lý một giải: đội, tạo trận, xếp giờ, công bố, nhập tỉ số, hoãn trận, đội rút, bảng xếp hạng, điều lệ.
import { $, $$, esc, initPage, loadVenues, errorBox, api, dialog, guard, toast, mountViewSwitch, todayStr, dayLabel } from './common.js';

const content = $('#content');
const id = Number(new URLSearchParams(location.search).get('id'));
const STATUS_TEXT = { draft: 'Đang soạn', published: 'Đã công bố', ongoing: 'Đang đá', finished: 'Đã kết thúc' };
const MATCH_TEXT = { unscheduled: 'Chưa có giờ', planned: 'Đã chọn giờ, chưa giữ', scheduled: 'Đã giữ giờ', played: 'Đã đá', forfeit: 'Xử thua do đội rút' };
let L; // giải đang xem
let venue;

const when = (m) => (m.date ? `${m.start}–${m.end}, ${dayLabel(m.date)} · ${esc(m.courtName)}` : 'Chưa có giờ');
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

function histHtml(m) {
  if (!m.history.length) return '';
  return `<details class="lg-hist"><summary>Lịch sử (${m.history.length})</summary><ul>${m.history
    .map((h) => {
      const what = h.kind === 'reschedule' ? `Đổi giờ: ${esc(h.from)} → ${esc(h.to)}` : h.kind === 'forfeit' ? `Xử thua ${esc(h.to)}` : h.from ? `Sửa tỉ số ${esc(h.from)} → ${esc(h.to)}` : `Nhập tỉ số ${esc(h.to)}`;
      return `<li>${esc(h.at.slice(8, 10))}/${esc(h.at.slice(5, 7))} ${esc(h.at.slice(11, 16))} · ${esc(h.by)} · ${what}${h.note ? ` · Lý do: ${esc(h.note)}` : ''}</li>`;
    })
    .join('')}</ul></details>`;
}

function matchHtml(m) {
  const draft = L.status === 'draft';
  const score = m.score ? `<span class="score">${m.score.home} – ${m.score.away}</span>` : '';
  const acts = [];
  if (draft && L.counts.matches) acts.push(`<button class="btn btn-sm" type="button" data-pick="${m.id}">${m.date ? 'Đổi giờ' : 'Chọn giờ'}</button>`);
  if (!draft && m.status === 'scheduled') acts.push(`<button class="btn btn-sm" type="button" data-resched="${m.id}">Hoãn / đổi giờ</button>`);
  if (!draft && m.status === 'scheduled') {
    acts.push(m.started ? `<button class="btn btn-sm btn-primary" type="button" data-score="${m.id}">Nhập tỉ số</button>` : '<span class="muted">Đến giờ đá mới nhập tỉ số được</span>');
  }
  if (!draft && m.status === 'played') acts.push(`<button class="btn btn-sm" type="button" data-score="${m.id}">Sửa tỉ số</button>`);
  return `<li class="lg-match" data-id="${m.id}"><span class="teams">${matchLine(m)} ${score}</span>
    <span class="when">${when(m)} · ${MATCH_TEXT[m.status]}</span>
    ${acts.length ? `<span class="row-actions">${acts.join('')}</span>` : ''}${histHtml(m)}</li>`;
}

function standingsHtml() {
  return `<div class="lg-table-wrap"><table class="lg-table"><caption class="sr-only">Bảng xếp hạng</caption>
    <thead><tr><th scope="col">#</th><th scope="col">Đội</th><th scope="col" title="Trận">Tr</th><th scope="col" title="Thắng">T</th><th scope="col" title="Hòa">H</th><th scope="col" title="Thua">B</th><th scope="col" title="Hiệu số">HS</th><th scope="col">Đ</th></tr></thead>
    <tbody>${L.standings
      .map((r) => `<tr><td>${r.rank}</td><td>${esc(r.name)}${r.withdrawn ? ' <span class="lg-out">Đã rút</span>' : ''}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.points}</td></tr>`)
      .join('')}</tbody></table></div>
    <p class="muted">Tr: số trận · T: thắng · H: hòa · B: thua · HS: hiệu số · Đ: điểm. Thắng 3, hòa 1, thua 0.</p>`;
}

function teamsHtml() {
  const draft = L.status === 'draft';
  const open = draft && !L.counts.matches;
  const rows = L.teams
    .map(
      (t) => `<li class="lg-team" data-tid="${t.id}"><strong>${esc(t.name)}${t.withdrawn ? ' <span class="lg-out">Đã rút</span>' : ''}</strong>
      <span class="muted">${esc(t.contactName || 'Chưa ghi người liên hệ')}${t.contactPhone ? ` · ${esc(t.contactPhone)}` : ''}</span>
      <span class="row-actions"><label class="check"><input type="checkbox" data-fee="${t.id}" ${t.feePaid ? 'checked' : ''}> ${t.feePaid ? 'Đã nộp lệ phí' : 'Chưa nộp lệ phí'}</label>
        ${open ? `<button class="btn btn-sm" type="button" data-edit-team="${t.id}">Sửa</button><button class="btn btn-sm btn-ghost" type="button" data-del-team="${t.id}">Xóa đội</button>` : ''}
        ${!draft && !t.withdrawn ? `<button class="btn btn-sm btn-ghost" type="button" data-withdraw="${t.id}">Đội rút khỏi giải</button>` : ''}</span></li>`,
    )
    .join('');
  const add = open && L.teams.length < L.teamCount ? `<button class="btn" type="button" id="add-team">Thêm đội (${L.teams.length}/${L.teamCount})</button>` : '';
  const note = open && L.teams.length < L.teamCount ? '' : open ? '<p class="muted">Đủ đội rồi. Thêm hoặc xóa đội chỉ làm được trước khi tạo các trận.</p>' : '';
  return `<ul class="plain-list">${rows}</ul>${add}${note}<p class="muted">Lệ phí thu ngoài web, ở đây chỉ ghi đội đã nộp hay chưa. Số điện thoại chỉ chủ sân thấy.</p>`;
}

function planHtml() {
  if (L.status !== 'draft') return '';
  const full = L.teams.length === L.teamCount;
  const hasM = L.counts.matches > 0;
  const courts = venue.courts.filter((c) => c.isActive && c.fieldType === L.fieldType);
  const step1 = hasM
    ? `<p class="muted">${L.counts.matches} trận. Làm lại các trận sẽ xóa giờ đã chọn.</p><button class="btn btn-sm btn-ghost" type="button" id="make-fixtures">Tạo lại các trận</button>`
    : `<button class="btn btn-primary" type="button" id="make-fixtures" ${full ? '' : 'disabled'}>Tạo các trận</button>${full ? '' : `<p class="muted">Cần đủ ${L.teamCount} đội (đang có ${L.teams.length}).</p>`}`;
  const auto = hasM
    ? `<form class="lg-auto" id="auto-plan" novalidate>
        <p class="muted">Xếp nhanh các trận chưa có giờ vào ô trống kế tiếp. Sau đó bạn vẫn đổi giờ từng trận được.</p>
        <div class="field"><label for="ap-court">Sân con</label><select class="select" id="ap-court" name="courtId">${courts.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ap-date">Từ ngày</label><input class="input" id="ap-date" name="date" type="date" min="${todayStr(1)}" value="${todayStr(1)}"></div>
        <div class="field"><label for="ap-start">Từ giờ</label><input class="input" id="ap-start" name="start" type="time" value="19:00"></div>
        <div class="field"><label for="ap-per">Số trận mỗi ngày</label><select class="select" id="ap-per" name="perDay">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <button class="btn" type="submit">Xếp tự động</button></form>`
    : '';
  const missing = L.counts.matches - L.counts.planned;
  const pub = hasM
    ? `<p class="${missing ? 'muted' : ''}">${missing ? `Còn ${missing} trận chưa có giờ. Phải có giờ đủ mọi trận mới công bố được.` : `Đã có giờ cho cả ${L.counts.matches} trận.`}</p>
       <button class="btn btn-primary" type="button" id="publish" ${missing ? 'disabled' : ''}>Công bố giải và giữ giờ</button>
       <p class="muted">Khi công bố, mọi giờ được giữ cùng lúc trên lưới sân (khách đặt thường không đặt trùng được). Có một giờ bị trùng thì không giữ giờ nào và báo bạn giờ nào trùng.</p>`
    : '';
  return `<section class="lg-sec"><h2 class="h2">Xếp lịch và công bố</h2>${step1}${auto}${pub}</section>`;
}

function render() {
  const rounds = new Map();
  for (const m of L.matches) (rounds.get(m.round) || rounds.set(m.round, []).get(m.round)).push(m);
  const matches = L.matches.length
    ? [...rounds].map(([r, ms]) => `<h3 class="lg-round">Lượt ${r}</h3><ul class="plain-list">${ms.map(matchHtml).join('')}</ul>`).join('')
    : '<p class="muted">Chưa có trận nào. Nhập đủ đội rồi bấm "Tạo các trận".</p>';
  const pub = L.status !== 'draft'
    ? `<div class="lg-actions"><a class="btn btn-sm" href="/league.html?id=${L.id}" target="_blank" rel="noopener">Xem trang công khai</a><button class="btn btn-sm" type="button" id="copy-link">Sao chép link giải</button></div>`
    : '<p class="muted">Chưa công bố nên khách chưa xem được trang giải.</p>';
  $('#h1').textContent = L.name;
  $('#sub').textContent = `${venue.name} · sân ${L.fieldType} người · ${L.teams.length}/${L.teamCount} đội`;
  content.innerHTML = `
    <div class="lg-head"><p><span class="badge badge-lg-${L.status}">${STATUS_TEXT[L.status]}</span> <span class="muted">${L.counts.done}/${L.counts.matches || '–'} trận đã có kết quả</span></p>${pub}
      <div class="lg-actions"><a class="btn btn-sm btn-ghost" href="/owner-leagues.html">← Các giải</a><button class="btn btn-sm" type="button" id="edit-league">Sửa tên, link, điều lệ</button><button class="btn btn-sm btn-danger" type="button" id="del-league">Xóa giải</button></div></div>
    <section class="lg-sec"><h2 class="h2">Các đội</h2>${teamsHtml()}</section>
    ${planHtml()}
    <section class="lg-sec"><h2 class="h2">Lịch thi đấu và kết quả</h2>${matches}</section>
    <section class="lg-sec"><h2 class="h2">Bảng xếp hạng</h2>${standingsHtml()}</section>
    <section class="lg-sec"><h2 class="h2">Điều lệ</h2><div class="lg-rules">${esc(L.rules)}</div>${L.link ? `<p><a href="${esc(L.link)}" target="_blank" rel="noopener">Nhóm Zalo / fanpage của giải</a></p>` : ''}</section>`;
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

function wire() {
  const bt = (sel) => $(sel);
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
  bt('#add-team')?.addEventListener('click', async () => {
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
  bt('#make-fixtures')?.addEventListener('click', async (e) => {
    if (L.counts.matches) {
      const d = await dialog({ title: 'Tạo lại các trận', confirm: 'Tạo lại', danger: true, body: '<p>Các trận và giờ đã chọn sẽ bị xóa, tạo lại từ đầu.</p>' });
      if (!d) return;
    }
    act(e.currentTarget, () => api.owner.makeLeagueFixtures(L.id), 'Đã tạo các trận');
  });
  bt('#auto-plan')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    act(e.submitter, () => api.owner.autoPlanLeague(L.id, { courtId: Number(f.courtId.value), date: f.date.value, start: f.start.value, perDay: Number(f.perDay.value) }), 'Đã xếp giờ');
  });
  byAttr('data-pick', async (mid) => {
    const m = match(mid);
    const d = await slotDialog({ title: m.date ? 'Đổi giờ trận' : 'Chọn giờ trận', confirm: 'Chọn giờ này', m });
    if (d) act(null, () => api.owner.saveLeaguePlan(L.id, [{ matchId: mid, courtId: Number(d.courtId), date: d.date, start: d.start }]), 'Đã chọn giờ');
  });
  bt('#publish')?.addEventListener('click', async (e) => {
    const d = await dialog({ title: 'Công bố giải', confirm: 'Công bố và giữ giờ', body: `<p>Giữ giờ cho cả ${L.counts.matches} trận trên lưới sân và mở trang giải cho mọi người xem. Sau khi công bố không thêm hoặc xóa đội được nữa; đội rút thì vẫn ghi nhận được.</p>` });
    if (!d) return;
    const btn = e.currentTarget;
    guard(btn, async () => {
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
  bt('#edit-league')?.addEventListener('click', async () => {
    const d = await dialog({
      title: 'Sửa giải',
      confirm: 'Lưu',
      body: `<div class="field"><label for="el-name">Tên giải</label><input class="input" id="el-name" name="name" maxlength="80" required data-label="tên giải" value="${esc(L.name)}"></div>
        <div class="field"><label for="el-link">Link nhóm Zalo hoặc fanpage</label><input class="input" id="el-link" name="link" type="url" maxlength="300" value="${esc(L.link)}"></div>
        <div class="field"><label for="el-rules">Điều lệ</label><textarea class="textarea" id="el-rules" name="rules" rows="9" maxlength="3000" required data-label="điều lệ">${esc(L.rules)}</textarea></div>`,
    });
    if (d) act(null, () => api.owner.updateLeague(L.id, { name: d.name, link: d.link || '', rules: d.rules }), 'Đã lưu');
  });
  bt('#del-league')?.addEventListener('click', async () => {
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
