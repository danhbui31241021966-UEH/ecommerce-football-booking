// Giải đấu phủi tại một sân: tạo, xếp giờ, giữ giờ, tỉ số, bảng xếp hạng, hoãn, rút đội, xóa, quyền, trang công khai.
import { start, step, save, loginAs, api, U, W, logs, anchor, mockNow, dayPlus } from './lib.mjs';
const { b, p } = await start();
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const call = async (expr) => { const r = await attempt(expr); if (!r.ok) throw new Error(`${expr} → ${r.status} ${r.msg}`); return r.r; };
const must = (c, m) => { if (!c) throw new Error(m); };
const OWNER = 'chusan1@datsan.local';
const shot = async (n, full = false) => { await p.waitForTimeout(600); return p.screenshot({ path: `e2e/out/league-${n}-${W}.png`, fullPage: full }); };
const noOverflow = async (what) => { const o = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); must(o[0] <= o[1], `${what}: tràn ngang ${o[0]} > ${o[1]}`); };
const J = JSON.stringify;

// tính bảng xếp hạng độc lập từ danh sách trận (không dùng hàm của mock)
function calc(teams, matches) {
  const r = Object.fromEntries(teams.map((t) => [t.id, { id: t.id, name: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const m of matches) {
    if (!m.score) continue;
    const [a, c] = [r[m.homeId], r[m.awayId]];
    a.p++; c.p++; a.gf += m.score.home; a.ga += m.score.away; c.gf += m.score.away; c.ga += m.score.home;
    if (m.score.home > m.score.away) { a.w++; c.l++; a.pts += 3; } else if (m.score.home < m.score.away) { c.w++; a.l++; c.pts += 3; } else { a.d++; c.d++; a.pts++; c.pts++; }
  }
  return Object.values(r).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name, 'vi'));
}
const sameStandings = (L) => {
  const want = calc(L.teams, L.matches).map((x) => [x.name, x.p, x.w, x.d, x.l, x.gf, x.ga, x.pts]);
  const got = L.standings.map((x) => [x.name, x.played, x.won, x.drawn, x.lost, x.gf, x.ga, x.points]);
  must(J(want) === J(got), `bảng xếp hạng lệch:\n mong đợi ${J(want)}\n nhận được ${J(got)}`);
};

await p.goto(U + '/');
const T0 = await anchor(p, '08:00');
const TODAY = T0.slice(0, 10);
const D0 = dayPlus(TODAY, 10); // ngày bắt đầu xếp lịch: xa hơn cửa sổ đặt 3 ngày của khách
let LG, courts5;
const sched = async (d, v = 1) => call(`a=>a.schedule(${v},'${d}')`);
const cellOf = async (m) => (await sched(m.date)).courts.find((c) => c.id === m.courtId).slots.find((s) => s.start === m.start);
const blocksOf = async (d) => { await loginAs(p, OWNER); return (await call(`a=>a.owner.schedule(1,'${d}')`)); };

await step(p, 'league', '01-demo-league-visible-everywhere', async () => {
  await loginAs(p, OWNER);
  const list = await call('a=>a.owner.leagues(1)');
  const demo = list.find((l) => /Thành Phát/.test(l.name));
  must(demo && demo.status === 'ongoing' && demo.done === 4 && demo.matches === 6, 'giải mẫu: ' + J(demo));
  const L = await call(`a=>a.owner.league(${demo.id})`);
  sameStandings(L);
  must(L.teams.length === 4 && L.standings.some((r) => r.points > 0), 'bảng mẫu rỗng');
  const left = L.matches.filter((m) => m.status === 'scheduled');
  must(left.length === 2 && left.every((m) => m.held), 'hai trận còn lại phải có giờ giữ: ' + J(left.map((m) => [m.date, m.start, m.held])));
  // ô giải hiện trên lưới của khách và của chủ sân, kể cả ngày xa
  await loginAs(p, 'khach1@datsan.local');
  for (const m of left) { const c = await cellOf(m); must(c.status === 'blocked' && c.league?.name === L.name, 'lưới khách thiếu nhãn giải: ' + J(c)); }
  await p.goto(`${U}/venue?id=1&date=${left[0].date}`);
  await p.waitForSelector('div.slot-league:visible', { timeout: 6000 }).catch(async (e) => { await p.screenshot({ path: 'e2e/out/dbg-fail.png' }); console.log(await p.url(), (await p.locator('#venue-root').innerText()).slice(-500)); throw e; });
  const txt = await p.locator('div.slot-league:visible').first().innerText();
  must(/Giải: /.test(txt), 'ô lưới khách không ghi "Giải: tên": ' + txt);
  await p.waitForSelector('.venue-leagues a');
  await p.locator('div.slot-league:visible').first().scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -140));
  await shot('venue-grid-cell');
  await loginAs(p, OWNER);
  await p.goto(`${U}/owner-schedule?date=${left[0].date}`);
  await p.waitForSelector('.sched-grid .sc');
  const ot = (await p.locator('.sched-grid').innerText()).replace(/\s+/g, ' ');
  must(/Giải: /.test(ot) || /Giải/.test(ot), 'lưới chủ sân không có ô giải');
  must(await p.locator('.sc', { hasText: /Giải/ }).count() >= 1, 'không thấy ô Giải trên lưới chủ');
  await p.locator('.sc', { hasText: /Giải/ }).first().scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -140));
  await shot('owner-grid-cell');
  await noOverflow('lưới chủ sân');
  return `giải mẫu ${L.name}: 4/6 trận, bảng khớp, ô giải ở lưới khách và chủ sân`;
}, { shot: false });

await step(p, 'league', '02-create-league-ui', async () => {
  await loginAs(p, OWNER);
  courts5 = (await call('a=>a.owner.venues()')).find((v) => v.id === 1).courts.filter((c) => c.isActive && c.fieldType === '5');
  await p.goto(`${U}/owner-leagues`);
  await p.waitForSelector('#new-league');
  await shot('list');
  await noOverflow('danh sách giải');
  await p.click('#new-league');
  await p.waitForSelector('dialog[open] #lg-name');
  await p.fill('#lg-name', 'Giải thử nghiệm cuối tuần');
  await p.selectOption('#lg-type', '5');
  await p.selectOption('#lg-count', '4');
  await p.fill('#lg-link', 'https://zalo.me/g/thu-nghiem');
  await shot('create-dialog');
  await p.click('dialog[open] button[type=submit]');
  await p.waitForURL(/\/owner-league(\.html)?\?id=/);
  await p.waitForSelector('#add-team');
  const id = Number(new URL(p.url()).searchParams.get('id'));
  LG = await call(`a=>a.owner.league(${id})`);
  must(LG.status === 'draft' && LG.fieldType === '5' && LG.teamCount === 4 && LG.link === 'https://zalo.me/g/thu-nghiem', 'giải mới: ' + J([LG.status, LG.fieldType, LG.teamCount, LG.link]));
  must(/xếp hạng theo điểm/i.test(LG.rules) && /rút/.test(LG.rules) && /3 điểm/.test(LG.rules), 'điều lệ mặc định thiếu ý');
  // thêm đội bằng hộp thoại (một đội) rồi ba đội qua API
  await p.click('#add-team');
  await p.waitForSelector('dialog[open] #tm-name');
  await p.fill('#tm-name', 'Bóng Đêm FC'); await p.fill('#tm-contact', 'Anh Hùng'); await p.fill('#tm-phone', '0901234567');
  await p.click('dialog[open] button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('.lg-team').length === 1);
  for (const [n, c] of [['Sao Mai', 'Chị Lan'], ['Thiên Long', 'Anh Bảo'], ['Rồng Xanh', 'Anh Phát']]) await call(`a=>a.owner.addLeagueTeam(${id}, ${J({ name: n, contactName: c })})`);
  await p.reload(); await p.waitForSelector('#make-fixtures');
  await shot('draft-teams', true);
  await noOverflow('trang giải (nháp)');
  LG = await call(`a=>a.owner.league(${id})`);
  must(LG.teams.length === 4, 'đủ 4 đội');
  const bad = await attempt(`a=>a.owner.addLeagueTeam(${id}, {name:'Quá số đội'})`);
  must(!bad.ok && [400, 409].includes(bad.status), 'thêm đội thứ 5 phải bị từ chối: ' + J(bad));
  const dup = await attempt(`a=>a.owner.updateLeague(${id}, {link:'khong-phai-link'})`);
  must(!dup.ok && dup.status === 400, 'link sai phải bị từ chối');
  const bigger = await attempt(`a=>a.owner.createLeague({venueId:1,name:'X',fieldType:'5',teamCount:9})`);
  must(!bigger.ok, '9 đội phải bị từ chối');
  const typ = await attempt(`a=>a.owner.createLeague({venueId:1,name:'X',fieldType:'11',teamCount:4})`);
  must(!typ.ok, 'sân 11 người phải bị từ chối');
  return `giải #${id} tạo bằng giao diện, 4 đội`;
}, { shot: false });

await step(p, 'league', '03-publish-needs-all-hours-and-batch-clash', async () => {
  const id = LG.id;
  const noFix = await attempt(`a=>a.owner.publishLeague(${id})`);
  must(!noFix.ok, 'chưa tạo trận không được công bố');
  await call(`a=>a.owner.makeLeagueFixtures(${id})`);
  LG = await call(`a=>a.owner.league(${id})`);
  must(LG.matches.length === 6 && new Set(LG.matches.map((m) => `${m.homeId}-${m.awayId}`)).size === 6, '4 đội phải ra 6 trận khác nhau');
  const pairs = new Set(LG.matches.map((m) => [m.homeId, m.awayId].sort().join('-')));
  must(pairs.size === 6, 'mỗi cặp đúng một trận');
  const none = await attempt(`a=>a.owner.publishLeague(${id})`);
  must(!none.ok && none.status === 409, 'chưa có giờ thì không công bố: ' + J(none));
  // giao diện: xếp tự động
  await loginAs(p, OWNER);
  await p.goto(`${U}/owner-league?id=${id}`);
  await p.waitForSelector('#auto-plan');
  await p.locator('#publish').isDisabled().then((d) => must(d, 'nút công bố phải khóa khi thiếu giờ'));
  await p.selectOption('#ap-court', String(courts5[0].id));
  await p.fill('#ap-date', D0); await p.fill('#ap-start', '18:00'); await p.selectOption('#ap-per', '2');
  await shot('schedule-before-auto');
  await p.click('#auto-plan button[type=submit]');
  await p.waitForFunction(() => !document.querySelector('#publish')?.disabled);
  await shot('schedule-after-auto', true);
  await noOverflow('xếp lịch');
  LG = await call(`a=>a.owner.league(${id})`);
  must(LG.matches.every((m) => m.date && m.courtId === courts5[0].id && !m.held), 'xếp tự động: ' + J(LG.matches.map((m) => [m.date, m.start, m.held])));
  const perDay = {}; for (const m of LG.matches) perDay[m.date] = (perDay[m.date] || 0) + 1;
  must(Object.values(perDay).every((n) => n <= 2) && Object.keys(perDay).length === 3, 'tối đa 2 trận/ngày, 3 ngày: ' + J(perDay));
  // một ô bị chặn trước khi công bố → không giữ ô nào
  const victim = LG.matches[4];
  const blk = await call(`a=>a.owner.block({courtId:${victim.courtId},date:'${victim.date}',start:'${victim.start}',end:'${victim.end}',reason:'Bảo trì'})`);
  const r = await attempt(`a=>a.owner.publishLeague(${id})`);
  must(!r.ok && r.status === 409 && /chặn/.test(r.msg), 'công bố phải bị từ chối vì ô bị chặn: ' + J(r));
  LG = await call(`a=>a.owner.league(${id})`);
  must(LG.status === 'draft' && LG.counts.held === 0 && LG.matches.every((m) => !m.held), 'không được giữ ô nào khi có một ô trùng');
  for (const m of LG.matches.filter((x) => x.id !== victim.id)) { const c = await cellOf(m); must(c.status === 'available', `ô ${m.date} ${m.start} bị giữ dù công bố thất bại: ${c.status}`); }
  // trong giao diện: bấm công bố khi đang trùng → hộp báo lỗi, giờ vẫn chưa giữ
  await p.reload(); await p.waitForSelector('#publish');
  await p.click('#publish'); await p.waitForSelector('dialog[open] button[type=submit]'); await p.click('dialog[open] button[type=submit]');
  await p.waitForSelector('dialog[open]:has-text("Chưa công bố được")');
  await shot('publish-clash');
  await p.keyboard.press('Escape');
  await call(`a=>a.owner.unblock(${blk.id})`);
  await p.reload(); await p.waitForSelector('#publish');
  await p.click('#publish'); await p.waitForSelector('dialog[open] button[type=submit]'); await p.click('dialog[open] button[type=submit]');
  await p.waitForFunction(() => !document.querySelector('#publish'));
  LG = await call(`a=>a.owner.league(${id})`);
  must(LG.status === 'published' && LG.counts.held === 6 && LG.matches.every((m) => m.held && m.status === 'scheduled'), 'công bố: ' + J([LG.status, LG.counts]));
  await shot('published', true);
  return `thiếu giờ → khóa; 1 ô trùng → giữ 0/6; hết trùng → giữ 6/6`;
}, { shot: false });

await step(p, 'league', '04-adhoc-customers-cannot-book-held-slot', async () => {
  const m = LG.matches[0];
  await loginAs(p, 'khach1@datsan.local');
  const c = await cellOf(m);
  must(c.status === 'blocked' && c.league?.id === LG.id && c.league?.name === LG.name, 'ô giải ở lưới khách: ' + J(c));
  const r = await attempt(`a=>a.createBooking({courtId:${m.courtId},date:'${m.date}',start:'${m.start}'})`);
  must(!r.ok && [400, 409].includes(r.status), 'khách đặt vào giờ giải phải bị từ chối: ' + J(r));
  const w = await attempt(`a=>a.joinWaitlist({courtId:${m.courtId},date:'${m.date}',start:'${m.start}'})`);
  must(!w.ok, 'không xếp hàng chờ giờ của giải');
  // chủ sân thêm lịch điện thoại và chặn tay cũng bị từ chối
  await loginAs(p, OWNER);
  const ph = await attempt(`a=>a.owner.addBooking({courtId:${m.courtId},date:'${m.date}',start:'${m.start}',customerName:'Khách gọi'})`);
  must(!ph.ok, 'thêm lịch điện thoại vào giờ giải phải bị từ chối: ' + J(ph));
  const lb = (await call(`a=>a.owner.schedule(1,'${m.date}')`)).courts.find((x) => x.id === m.courtId).slots.find((s) => s.start === m.start);
  must(lb.status === 'blocked' && lb.block?.leagueId === LG.id, 'ô giải ở lưới chủ: ' + J(lb));
  const ub = await attempt(`a=>a.owner.unblock(${lb.block.id})`);
  must(!ub.ok && ub.status === 409, 'bỏ chặn tay ô giải phải bị từ chối: ' + J(ub));
  // giờ ngoài 3 ngày vẫn hiện trên lưới khách (giữ giờ không bị giới hạn cửa sổ đặt)
  must(m.date > dayPlus(TODAY, 3), 'ô giải phải nằm ngoài cửa sổ 3 ngày');
  return 'khách không đặt/không chờ được; chủ không thêm lịch, không bỏ chặn tay; ô ngoài 3 ngày vẫn có nhãn giải ở API (lưới web chỉ cho chọn 3 ngày)';
}, { shot: false });

await step(p, 'league', '05-scores-and-standings', async () => {
  await loginAs(p, OWNER);
  const m0 = LG.matches[0];
  const early = await attempt(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${m0.id}, {home:2,away:1})`);
  must(!early.ok && early.status === 409, 'nhập tỉ số trước giờ đá phải bị từ chối: ' + J(early));
  // tua đồng hồ tới sau trận 3 để nhập kết quả
  const m2 = LG.matches[2];
  const nowT = await mockNow(p);
  const mins = Math.ceil((Date.parse(`${m2.date}T${m2.start}:00Z`) - Date.parse(nowT.replace(' ', 'T').slice(0, 16) + ':00Z')) / 60000) + 130;
  await call(`a=>a.proto.advanceClock(${mins})`);
  await loginAs(p, OWNER);
  // người khác không nhập được
  await loginAs(p, 'chusan2@datsan.local');
  const other = await attempt(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${m0.id}, {home:1,away:0})`);
  must(!other.ok && other.status === 403, 'chủ sân khác không được nhập: ' + J(other));
  await loginAs(p, 'khach1@datsan.local');
  const cus = await attempt(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${m0.id}, {home:1,away:0})`);
  must(!cus.ok && [401, 403].includes(cus.status), 'khách không được nhập: ' + J(cus));
  await loginAs(p, OWNER);
  // nhập bằng giao diện cho trận đầu
  await p.goto(`${U}/owner-league?id=${LG.id}`);
  await p.waitForSelector(`[data-score="${m0.id}"]`);
  await p.click(`[data-score="${m0.id}"]`);
  await p.waitForSelector('dialog[open] #sc-home');
  await p.fill('#sc-home', '3'); await p.fill('#sc-away', '1');
  await shot('score-dialog');
  await p.click('dialog[open] button[type=submit]');
  await p.waitForSelector(`[data-id="${m0.id}"] .score`);
  const scores = [[3, 1], [0, 0], [2, 2], [1, 4]];
  const bad = await attempt(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${LG.matches[1].id}, {home:-1,away:2})`);
  must(!bad.ok && bad.status === 400, 'tỉ số âm phải bị từ chối');
  for (let i = 1; i < 3; i++) await call(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${LG.matches[i].id}, {home:${scores[i][0]},away:${scores[i][1]}})`);
  LG = await call(`a=>a.owner.league(${LG.id})`);
  must(LG.counts.done === 3 && LG.status === 'ongoing', 'sau 3 trận phải đang đá: ' + J([LG.counts, LG.status]));
  sameStandings(LG);
  const top = LG.standings[0];
  // sửa tỉ số: bắt buộc có lý do, lưu ai/lúc nào/vì sao
  const noWhy = await attempt(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${m0.id}, {home:3,away:2})`);
  must(!noWhy.ok && noWhy.status === 400, 'sửa không lý do phải bị từ chối: ' + J(noWhy));
  const same = await attempt(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${m0.id}, {home:3,away:1,note:'x'})`);
  must(!same.ok && same.status === 409, 'tỉ số giống cũ bị từ chối');
  await call(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${m0.id}, {home:3,away:2,note:'Ghi nhầm bàn thắng'})`);
  LG = await call(`a=>a.owner.league(${LG.id})`);
  const h = LG.matches[0].history;
  must(h.length === 2 && h[1].from === '3-1' && h[1].to === '3-2' && h[1].note === 'Ghi nhầm bàn thắng' && h[1].by && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(h[1].at), 'lịch sử sửa: ' + J(h));
  sameStandings(LG);
  // thứ hạng với điểm bằng nhau: so với tính độc lập (đã gồm hiệu số, bàn thắng)
  await p.goto(`${U}/owner-league?id=${LG.id}#bang-xep-hang`);
  await p.waitForSelector('.lg-table');
  must(await p.locator('#tab-bang-xep-hang').getAttribute('aria-selected') === 'true', 'tab theo #hash');
  await shot('standings-owner', true);
  await noOverflow('bảng xếp hạng (chủ sân)');
  return `tỉ số trước giờ bị chặn; sau ${LG.counts.done} trận bảng khớp tính độc lập; sửa có lý do + người + giờ; đội đầu: ${top.name}`;
}, { shot: false });

await step(p, 'league', '06-postpone-releases-old-holds-new', async () => {
  await loginAs(p, OWNER);
  const m = LG.matches[5]; // trận cuối chưa đá
  const old = { courtId: m.courtId, date: m.date, start: m.start };
  const nd = dayPlus(m.date, 7);
  const sc = (await call(`a=>a.owner.schedule(1,'${nd}')`)).courts.find((c) => c.id === courts5[0].id);
  const free = sc.slots.find((s) => s.status === 'available' && !s.teamMode && s.start >= '17:00');
  must(free, 'không có giờ trống để hoãn tới');
  const bad = await attempt(`a=>a.owner.rescheduleLeagueMatch(${LG.id}, ${m.id}, {courtId:${m.courtId},date:'${m.date}',start:'${m.start}'})`);
  must(!bad.ok && bad.status === 409, 'đổi sang đúng giờ cũ bị từ chối');
  const blocked = LG.matches[4];
  const clash = await attempt(`a=>a.owner.rescheduleLeagueMatch(${LG.id}, ${m.id}, {courtId:${blocked.courtId},date:'${blocked.date}',start:'${blocked.start}'})`);
  must(!clash.ok && clash.status === 409, 'đổi sang giờ của trận khác bị từ chối: ' + J(clash));
  must((await cellOf(old)).status === 'blocked', 'giờ cũ vẫn phải giữ sau khi đổi thất bại');
  LG = await call(`a=>a.owner.rescheduleLeagueMatch(${LG.id}, ${m.id}, {courtId:${courts5[0].id},date:'${nd}',start:'${free.start}',note:'Trời mưa'})`);
  const m2 = LG.matches.find((x) => x.id === m.id);
  must(m2.date === nd && m2.start === free.start && m2.held, 'trận phải có giờ mới đã giữ: ' + J(m2));
  must(m2.history.some((h) => h.kind === 'reschedule' && h.note === 'Trời mưa' && h.by), 'lịch sử hoãn thiếu');
  await loginAs(p, 'khach1@datsan.local');
  const oldCell = await cellOf(old);
  const newCell = await cellOf(m2);
  must(oldCell.status !== 'blocked' && !oldCell.league, 'giờ cũ phải được trả: ' + J(oldCell));
  must(newCell.status === 'blocked' && newCell.league?.name === LG.name, 'giờ mới phải giữ: ' + J(newCell));
  must(LG.counts.held === 6, 'vẫn giữ đúng 6 giờ');
  // giao diện: hoãn một trận
  await loginAs(p, OWNER);
  await p.goto(`${U}/owner-league?id=${LG.id}`);
  const other = LG.matches.find((x) => x.status === 'scheduled' && !x.score && x.id !== m.id);
  await p.waitForSelector(`.mc[data-id="${other.id}"] .mn-btn`);
  await p.click(`.mc[data-id="${other.id}"] .mn-btn`);
  await p.waitForSelector(`[data-resched="${other.id}"]`);
  await p.click(`[data-resched="${other.id}"]`);
  await p.waitForSelector('dialog[open] #sl-start option:not([value=""]):not([disabled])', { state: 'attached' });
  await shot('postpone-dialog');
  await p.keyboard.press('Escape');
  return `giờ cũ ${old.date} ${old.start} → trống; giờ mới ${nd} ${free.start} → giữ; vẫn 6 giờ giữ`;
}, { shot: false });

await step(p, 'league', '07-withdraw-forfeits-and-releases', async () => {
  await loginAs(p, OWNER);
  const before = await call(`a=>a.owner.league(${LG.id})`);
  const t = before.teams.find((x) => x.name === 'Rồng Xanh');
  const mine = before.matches.filter((m) => [m.homeId, m.awayId].includes(t.id));
  const unplayed = mine.filter((m) => !m.score);
  const played = mine.filter((m) => m.score);
  must(unplayed.length >= 1, 'đội rút phải còn trận chưa đá để thử');
  const noWhy = await attempt(`a=>a.owner.withdrawLeagueTeam(${LG.id}, ${t.id}, 'Thiếu người')`);
  must(noWhy.ok, 'rút đội: ' + J(noWhy));
  LG = await call(`a=>a.owner.league(${LG.id})`);
  const twice = await attempt(`a=>a.owner.withdrawLeagueTeam(${LG.id}, ${t.id}, '')`);
  must(!twice.ok && twice.status === 409, 'rút hai lần bị từ chối');
  must(LG.teams.find((x) => x.id === t.id).withdrawn, 'đội phải ghi đã rút');
  for (const m of played) { const n = LG.matches.find((x) => x.id === m.id); must(J(n.score) === J(m.score) && !n.forfeitBy, 'kết quả đã đá phải giữ nguyên'); }
  for (const m of unplayed) {
    const n = LG.matches.find((x) => x.id === m.id);
    const want = n.homeId === t.id ? { home: 0, away: 3 } : { home: 3, away: 0 };
    must(J(n.score) === J(want) && n.status === 'forfeit' && n.forfeitBy === t.id && !n.held, 'xử thua 0-3: ' + J(n));
    must((await cellOf(m)).status !== 'blocked', `giờ ${m.date} ${m.start} phải được trả`);
    must(n.history.some((h) => h.kind === 'forfeit' && /rút/.test(h.note)), 'lịch sử thiếu xử thua');
  }
  sameStandings(LG);
  must(LG.standings.find((r) => r.teamId === t.id).withdrawn, 'bảng phải đánh dấu đã rút');
  must(LG.matches.filter((m) => m.status === 'forfeit').every((m) => !m.held) && LG.matches.filter((m) => m.status === 'scheduled').every((m) => m.held), 'trận xử thua không giữ giờ, trận còn lại vẫn giữ');
  const noScore = await attempt(`a=>a.owner.scoreLeagueMatch(${LG.id}, ${unplayed[0].id}, {home:1,away:0,note:'x'})`);
  must(!noScore.ok && noScore.status === 409, 'trận xử thua không nhập tỉ số tay được');
  await p.goto(`${U}/owner-league?id=${LG.id}#bang-xep-hang`);
  await p.waitForSelector('.lg-out');
  await shot('withdrawn-owner', true);
  await noOverflow('đội rút (chủ sân)');
  return `${t.name} rút: ${played.length} kết quả giữ, ${unplayed.length} trận xử 0-3, giờ trả lại, bảng khớp`;
}, { shot: false });

// Nhãn đọc của từng thẻ trận phải đúng bằng chuỗi dựng từ dữ liệu của chính trận đó (theo id).
async function checkLabels(url) {
  const d = await call(`a=>a.league(${LG.id})`);
  await p.goto(url); await p.waitForSelector('.mc', { state: 'attached' });
  let played = 0, forfeit = 0, upcoming = 0;
  for (const m of d.matches) {
    const got = await p.locator(`.mc[data-id="${m.id}"] .mc-mid`).getAttribute('aria-label');
    let want;
    if (m.score) { want = `${m.homeName} ${m.score.home}, ${m.awayName} ${m.score.away}${m.forfeitBy ? ', xử thua' : ''}`; played++; if (m.forfeitBy) forfeit++; }
    else { want = `${m.homeName} gặp ${m.awayName}, ${m.start} ngày ${m.date.slice(8, 10)}/${m.date.slice(5, 7)}`; upcoming++; }
    must(got === want, `nhãn trận ${m.id}: "${got}" ≠ "${want}"`);
  }
  must(played > 0 && forfeit > 0 && upcoming > 0, `cần đủ 3 loại trận để kiểm: ${played}/${forfeit}/${upcoming}`);
}

await step(p, 'league', '07b-redesign-a11y-keyboard-overflow', async () => {
  // hoãn một trận chưa đá để thấy nhãn "Đã hoãn"
  { const cur = await call(`a=>a.owner.league(${LG.id})`); const m = cur.matches.find((x) => x.status === 'scheduled' && !x.score);
    const nd = dayPlus(m.date, 14); const sc = (await call(`a=>a.owner.schedule(1,'${nd}')`)).courts.find((c) => c.id === m.courtId); const free = sc.slots.find((x) => x.status === 'available' && !x.teamMode && x.start >= '17:00');
    LG = await call(`a=>a.owner.rescheduleLeagueMatch(${LG.id}, ${m.id}, {courtId:${m.courtId},date:'${nd}',start:'${free.start}',note:'Mưa'})`); must(LG.matches.find((x) => x.id === m.id).rescheduled, 'API thiếu rescheduled'); }
  // trang công khai: tab đúng vai trò, chuyển bằng mũi tên, URL giữ tab, thẻ trận có nhãn đủ chữ, tiến độ có giá trị
  await loginAs(p, OWNER);
  const pubUrl = `${U}/league?id=${LG.id}`;
  await p.goto(pubUrl + '#lich-dau');
  await p.waitForSelector('.mc');
  must(await p.locator('[role=tablist] [role=tab]').count() === 4 && await p.locator('[role=tabpanel]').count() === 4, 'thiếu tablist/tab/tabpanel');
  must(await p.locator('#tab-lich-dau').getAttribute('aria-selected') === 'true', 'mở link #lich-dau phải chọn tab Lịch đấu');
  must(await p.locator('#tab-lich-dau').getAttribute('aria-controls') === 'tp-lich-dau' && await p.locator('#tp-lich-dau').getAttribute('aria-labelledby') === 'tab-lich-dau', 'aria-controls/labelledby');
  const pg = await p.locator('.pg').first().evaluate((e) => [e.getAttribute('role'), e.getAttribute('aria-valuenow'), e.getAttribute('aria-valuemax'), e.getAttribute('aria-label')]);
  { const d = await call(`a=>a.league(${LG.id})`); const done = d.matches.filter((m) => m.score).length; must(pg[0] === 'progressbar' && Number(pg[1]) === done && Number(pg[2]) === d.matches.length && done > 0, `progressbar: now=${pg[1]} max=${pg[2]} mong đợi ${done}/${d.matches.length}`); }
  must(/trên/.test(pg[3]), 'progressbar thiếu nhãn: ' + pg);
  await p.focus('#tab-lich-dau'); await p.keyboard.press('ArrowRight');
  must(p.url().endsWith('#cac-doi') && await p.locator('#tab-cac-doi').getAttribute('aria-selected') === 'true', 'ArrowRight phải sang tab Các đội: ' + p.url());
  await p.keyboard.press('End'); must(p.url().endsWith('#dieu-le'), 'End → tab cuối');
  await p.keyboard.press('Home'); must(p.url().endsWith('#bang-xep-hang'), 'Home → tab đầu');
  await p.keyboard.press('ArrowLeft'); must(p.url().endsWith('#dieu-le'), 'ArrowLeft ở tab đầu quay vòng');
  // chữ trên thẻ: tên đội có cả hai phía, xử thua và đã hoãn có nhãn chữ
  await p.goto(pubUrl + '#lich-dau'); await p.waitForSelector('.mc');
  const tags = await p.locator('.mc-tag').allInnerTexts();
  must(tags.some((t) => /Xử thua/.test(t)) && tags.some((t) => /Đã hoãn/.test(t)), 'thiếu nhãn Xử thua/Đã hoãn: ' + J(tags));
  await checkLabels(pubUrl + '#lich-dau');
  for (const [tab] of [['bang-xep-hang'], ['lich-dau'], ['cac-doi'], ['dieu-le']]) { await p.goto(`${pubUrl}#${tab}`); await p.waitForSelector(`#tp-${tab}.is-on`); await noOverflow('công khai #' + tab); }
  // phong độ: có chữ T/H/B trong từng ô
  await p.goto(pubUrl + '#bang-xep-hang'); await p.waitForSelector('.fm');
  const fm = await p.locator('.fm').allInnerTexts(); must(fm.length > 0 && fm.every((t) => /^[THB]$/.test(t)), 'ô phong độ phải có chữ: ' + J(fm));
  const lead = await p.locator('tr.is-lead td.nm').innerText(); const calcLead = calc(LG.teams, (await call(`a=>a.league(${LG.id})`)).matches)[0].name; must(lead.includes(calcLead), 'đội đầu bảng được tô: ' + lead + ' / ' + calcLead);
  // hai panel hiện cùng lúc ở 1280: mỗi panel đều có tiêu đề để trình đọc màn hình tìm thấy
  if (W >= 1024) {
    await p.goto(pubUrl + '#lich-dau'); await p.waitForSelector('#tp-bang-xep-hang');
    for (const k of ['bang-xep-hang', 'lich-dau']) {
      must(await p.locator(`#tp-${k}`).isVisible(), `panel ${k} phải hiện ở ${W}px`);
      const h = await p.locator(`#tp-${k} > h2`).allInnerTexts(); must(h.length === 1 && h[0].trim().length > 0, `panel ${k} thiếu tiêu đề h2: ` + J(h));
    }
  }
  // chủ sân: menu ⋯ bằng bàn phím
  await p.goto(`${U}/owner-league?id=${LG.id}#lich-dau`); await p.waitForSelector('.mc .mn-btn');
  for (const tab of ['bang-xep-hang', 'lich-dau', 'cac-doi', 'dieu-le']) { await p.goto(`${U}/owner-league?id=${LG.id}#${tab}`); await p.waitForSelector(`#tp-${tab}.is-on`); await noOverflow('chủ sân #' + tab); }
  await p.goto(`${U}/owner-league?id=${LG.id}#lich-dau`); await p.waitForSelector('.mc .mn-btn');
  const btn = p.locator('.mc .mn-btn').first();
  must(await btn.getAttribute('aria-haspopup') === 'menu' && await btn.getAttribute('aria-expanded') === 'false' && !!(await btn.getAttribute('aria-label')), 'nút ⋯ thiếu aria');
  await btn.focus(); await p.keyboard.press('Enter');
  must(await btn.getAttribute('aria-expanded') === 'true', 'Enter phải mở menu');
  must(await p.evaluate(() => document.activeElement?.getAttribute('role')) === 'menuitem', 'tiêu điểm phải vào mục đầu');
  const n = await p.locator('.mn-list:not([hidden]) [role=menuitem]').count();
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp');
  await p.keyboard.press('End');
  must(await p.evaluate(() => document.activeElement === [...document.querySelectorAll('.mn-list:not([hidden]) [role=menuitem]')].at(-1)), 'End → mục cuối');
  await p.keyboard.press('Escape');
  must(await btn.getAttribute('aria-expanded') === 'false' && await p.evaluate(() => document.activeElement?.classList.contains('mn-btn')), 'Escape phải đóng và trả tiêu điểm về nút ⋯');
  await p.keyboard.press('ArrowDown'); must(await btn.getAttribute('aria-expanded') === 'true', 'ArrowDown mở menu');
  await p.mouse.click(5, 300); must(await btn.getAttribute('aria-expanded') === 'false', 'bấm ra ngoài phải đóng');
  // hoãn/rút/xóa nằm trong menu, không lặp thành nút ở từng dòng
  const loose = await p.locator('.mc .btn:visible').allInnerTexts();
  must(!loose.some((t) => /Hoãn|Rút|Xóa/.test(t)), 'Hoãn/Rút/Xóa không được là nút lộ trên thẻ: ' + J(loose));
  await p.goto(`${U}/owner-leagues`); await p.waitForSelector('.lg-listcard');
  const pb = await p.locator('.lg-listcard .pg').first().getAttribute('role'); must(pb === 'progressbar', 'thẻ giải có thanh tiến độ');
  await noOverflow('danh sách giải');
  return `tab/menu/aria đúng; ${n} mục trong menu; không tràn ngang ở mọi tab`;
}, { shot: false });

await step(p, 'league', '08-public-page-anonymous', async () => {
  await p.goto(U + '/');
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout().catch(() => {}); });
  const pub = await call(`a=>a.league(${LG.id})`);
  must(!JSON.stringify(pub).includes('contactPhone') && !JSON.stringify(pub).includes('0901234567') && !JSON.stringify(pub).includes('feePaid'), 'trang công khai lộ liên hệ/lệ phí');
  sameStandings(pub);
  await p.goto(`${U}/league?id=${LG.id}`);
  await p.waitForSelector('.lg-table');
  const txt = async () => (await p.locator('#league-root').innerText()).replace(/\s+/g, ' ').toLowerCase();
  const has = (t, w) => must(t.includes(w.toLowerCase()), 'trang công khai thiếu: ' + w);
  let t = await txt();
  for (const w of [LG.name, 'Bảng xếp hạng', 'Đã rút', 'Sao chép link giải', 'Phong độ']) has(t, w);
  for (const [tab, words] of [['lich-dau', ['Xử thua', '3–0', 'Lượt']], ['cac-doi', ['Đã rút', 'Bóng Đêm FC']], ['dieu-le', ['Xếp hạng theo điểm', 'rút giữa giải']]]) {
    await p.click(`#tab-${tab}`);
    must(p.url().endsWith('#' + tab), 'tab phải nằm trong URL: ' + p.url());
    const t2 = await txt(); for (const w of words) has(t2, w);
  }
  // trận có tỉ số: aria-label đủ chữ; tab điều hướng bằng mũi tên
  await checkLabels(`${U}/league?id=${LG.id}`);
  await p.click('#tab-dieu-le'); await p.focus('#tab-dieu-le'); await p.keyboard.press('ArrowRight');
  must(await p.locator('#tab-bang-xep-hang').getAttribute('aria-selected') === 'true', 'mũi tên phải chuyển tab');
  t = await txt();
  must(!/Nộp lệ phí|0901234567/.test(t), 'lộ thông tin chủ sân');
  const meta = await p.evaluate(() => ({ title: document.title, desc: document.querySelector('meta[name=description]')?.content, ogt: document.querySelector('meta[property="og:title"]')?.content, ogu: document.querySelector('meta[property="og:url"]')?.content, canon: document.querySelector('link[rel=canonical]')?.href, robots: document.querySelector('meta[name=robots]')?.content || '' }));
  must(meta.title.includes(LG.name) && meta.desc.includes(LG.name) && meta.ogt.includes(LG.name) && meta.ogu.endsWith(`/league.html?id=${LG.id}`) && meta.canon.endsWith(`/league.html?id=${LG.id}`), 'SEO: ' + J(meta));
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await p.click('#copy-link');
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  must(!clip || clip.endsWith(`/league.html?id=${LG.id}`), 'link sao chép sai: ' + clip);
  await noOverflow('trang giải công khai');
  await shot('public', true);
  // trang giải nháp không xem được công khai
  const d = await attempt(`a=>a.league(999)`); must(!d.ok && d.status === 404, 'giải không có phải 404');
  // venue detail link tới giải đang đá
  await p.goto(`${U}/venue?id=1`);
  await p.waitForSelector('.venue-leagues a');
  const links = await p.locator('.venue-leagues a').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
  must(links.some((h) => h.includes(`league.html?id=${LG.id}`)), 'trang sân thiếu link giải: ' + links);
  return `ẩn liên hệ/lệ phí, SEO đúng, ${links.length} link giải ở trang sân`;
}, { shot: false });

await step(p, 'league', '09-permissions-and-draft-hidden', async () => {
  await loginAs(p, OWNER);
  const dr = await call(`a=>a.owner.createLeague({venueId:1,name:'Giải nháp ẩn',fieldType:'5',teamCount:4})`);
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout().catch(() => {}); });
  const anon = await attempt(`a=>a.league(${dr.id})`);
  must(!anon.ok && anon.status === 404, 'giải nháp không được xem công khai: ' + J(anon));
  const an2 = await attempt(`a=>a.owner.league(${LG.id})`);
  must(!an2.ok && an2.status === 401, 'chưa đăng nhập không xem được giải của chủ: ' + J(an2));
  const writes = [
    `a=>a.owner.updateLeague(${LG.id}, {name:'Hack'})`, `a=>a.owner.deleteLeague(${LG.id})`, `a=>a.owner.publishLeague(${dr.id})`,
    `a=>a.owner.addLeagueTeam(${dr.id}, {name:'Lén'})`, `a=>a.owner.updateLeagueTeam(${LG.id}, ${LG.teams[0].id}, {feePaid:true})`,
    `a=>a.owner.rescheduleLeagueMatch(${LG.id}, ${LG.matches[5].id}, {courtId:1,date:'${dayPlus(TODAY, 30)}',start:'19:00'})`, `a=>a.owner.withdrawLeagueTeam(${LG.id}, ${LG.teams[0].id}, '')`,
  ];
  for (const who of ['chusan2@datsan.local', 'khach1@datsan.local']) {
    await loginAs(p, who);
    for (const w of writes) { const r = await attempt(w); must(!r.ok && [401, 403].includes(r.status), `${who} làm được: ${w} → ${J(r)}`); }
    const lst = await attempt('a=>a.owner.leagues(1)');
    if (who.startsWith('chusan2')) must(lst.ok && lst.r.every((l) => l.id !== LG.id && l.id !== dr.id), 'chủ sân khác thấy giải của người khác');
    else must(!lst.ok, 'khách không xem danh sách giải của chủ');
  }
  await loginAs(p, 'chusan2@datsan.local');
  const f = await attempt(`a=>a.owner.league(${LG.id})`);
  must(!f.ok && f.status === 403, 'chủ sân khác xem chi tiết giải: ' + J(f));
  await p.goto(`${U}/owner-league?id=${LG.id}`);
  await p.waitForSelector('#content .empty');
  const g = await attempt(`a=>a.league(${LG.id})`); must(g.ok, 'trang công khai vẫn xem được');
  await loginAs(p, OWNER);
  await call(`a=>a.owner.deleteLeague(${dr.id})`);
  return 'chủ sân khác và khách: mọi thao tác ghi bị 401/403, giải nháp ẩn khỏi trang công khai';
}, { shot: false });

await step(p, 'league', '10-delete-releases-all-and-menu', async () => {
  await loginAs(p, OWNER);
  const L = await call(`a=>a.owner.league(${LG.id})`);
  const held = L.matches.filter((m) => m.held);
  must(held.length >= 1, 'cần còn giờ giữ');
  await p.goto(`${U}/owner-leagues`);
  await p.waitForSelector('.lg-card');
  const nav = await p.locator('header nav a, .site-nav a, #app-header a').allInnerTexts().catch(() => []);
  const view = await p.locator('.view-switch a').allInnerTexts();
  must(view.join('|').includes('Giải đấu'), 'thiếu tab Giải đấu: ' + view);
  await p.goto(`${U}/owner-league?id=${LG.id}`);
  await p.waitForSelector('.lg-hero .mn-btn');
  await p.click('.lg-hero .mn-btn');
  await p.click('#del-league');
  await p.waitForSelector('dialog[open] button[type=submit]');
  await p.click('dialog[open] button[type=submit]');
  await p.waitForURL(/\/owner-leagues(\.html)?(?=[?#]|$)/);
  for (const m of held) { const c = await cellOf(m); must(c.status !== 'blocked' && !c.league, `giờ ${m.date} ${m.start} chưa được trả: ${J(c)}`); }
  const gone = await attempt(`a=>a.owner.league(${LG.id})`);
  must(!gone.ok && gone.status === 404, 'giải phải biến mất');
  const pg = await attempt(`a=>a.league(${LG.id})`);
  must(!pg.ok && pg.status === 404, 'trang công khai phải 404');
  const demo = (await call('a=>a.owner.leagues(1)')).find((l) => /Thành Phát/.test(l.name));
  must(demo, 'giải mẫu không bị ảnh hưởng');
  await noOverflow('danh sách giải sau khi xóa');
  return `xóa giải → ${held.length} giờ trả lại lưới, trang công khai 404, giải mẫu còn nguyên`;
}, { shot: false });

console.log(logs.length ? 'console: ' + logs.join(' | ') : 'console: sạch');
save(); await b.close();
