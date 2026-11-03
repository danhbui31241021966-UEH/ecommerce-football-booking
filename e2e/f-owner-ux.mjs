// Chủ sân dùng khu mới: làm việc hằng ngày, đếm số lần bấm; kiểm bố cục Hôm nay, lịch từng sân, link cũ.
import { start, step, save, loginAs, api, U, W, logs, anchor, mockNow, dayPlus } from './lib.mjs';
const { b, p } = await start();
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const must = (c, m) => { if (!c) throw new Error(m); };
const OWNER = 'chusan1@datsan.local';
const NARROW = W < 700;
const shot = (n, full = true) => p.screenshot({ path: `e2e/out/owner2-${n}-${W}.png`, fullPage: full });
const table = [];
let clicks = 0;
const click = async (sel, opt) => { clicks++; await p.click(sel, opt); };
const task = async (name, fn) => { clicks = 0; const r = await fn(); table.push([name, clicks]); return `${clicks} lần bấm${typeof r === 'string' ? ' · ' + r : ''}`; };
const dupCodes = () => p.evaluate(() => { const seen = new Map(); document.querySelectorAll('#content li').forEach((li, i) => { new Set(li.innerText.match(/SN\d{5}/g) || []).forEach((c) => seen.set(c, [...(seen.get(c) || []), i])); }); return [...seen].filter(([, v]) => v.length > 1).map(([c]) => c); });
const reset = async () => { await p.goto(U + '/'); await p.evaluate(async () => { sessionStorage.clear(); const { api } = await import('/js/api.js'); await api.proto.resetDemo(); }); };
const text = async (sel = '#content') => (await p.locator(sel).innerText()).replace(/\s+/g, ' ');
const gotoToday = async () => { await p.goto(U + '/owner'); await p.waitForSelector('#add-booking'); await p.waitForSelector('#content .panel'); };
const ownerBookings = async (q = '{venueId:1}') => (await attempt(`a=>a.owner.bookings(${q})`)).r;
// Ở điện thoại phải mở menu rồi bấm mục; ở màn rộng bấm thẳng trên thanh menu.
const goMenu = async (label) => {
  if (NARROW) await click('.menu-btn');
  await click(`${NARROW ? '.mobile-nav' : '.site-header .nav'} a:has-text("${label}")`);
};

await step(p, 'ownux', '01-menu-has-four-items-and-demo-group', async () => {
  await reset(); await loginAs(p, OWNER); await gotoToday();
  const links = await p.locator('.site-header .nav a').allInnerTexts();
  must(JSON.stringify(links) === JSON.stringify(['Hôm nay', 'Lịch sân', 'Khách nhờ báo giá', 'Cài đặt sân']), 'menu: ' + links);
  if (NARROW) await p.click('.menu-btn'); // menu đóng thì ẩn hẳn: mở ra mới đọc được
  const mob = await p.locator('.mobile-nav a').allInnerTexts(); must(JSON.stringify(mob) === JSON.stringify(links), 'menu điện thoại: ' + mob);
  if (NARROW) await p.click('.menu-btn');
  must(await p.locator('.mobile-nav details.demo-group > summary').count() === 1, 'thiếu mục Demo');
  must(!(await p.locator('.mobile-nav > button[data-proto], .mobile-nav > .proto-tools').count()), 'công cụ demo còn nằm lẫn trong menu');
  const cur = await p.locator('.site-header .nav a[aria-current=page]').allInnerTexts(); must(cur.join() === 'Hôm nay', 'mục đang mở: ' + cur);
  if (NARROW) { await p.click('.menu-btn'); await p.locator('.mobile-nav details.demo-group > summary').click(); await p.waitForTimeout(250); await shot('menu', false); await p.click('.menu-btn'); }
  else { await p.click('.role-dock summary'); await p.waitForTimeout(200); await shot('menu', false); await p.click('.role-dock summary'); }
  return links.join(' | ');
}, { shot: false });

await step(p, 'ownux', '02-today-layout-and-view-tasks', async () => {
  await reset(); await loginAs(p, OWNER); await gotoToday();
  const t = await text(); must(/Việc cần làm ngay/i.test(t) && /Giờ đá hôm nay/i.test(t), 'thiếu hai khối');
  const yTasks = (await p.locator('#h-tasks').boundingBox()).y, yToday = (await p.locator('#h-today').boundingBox()).y;
  must(yTasks < yToday, 'việc cần làm phải nằm trên giờ đá hôm nay');
  must(!(await p.locator('.kpis, .kpi').count()), 'còn 4 ô số');
  const box = await p.locator('#add-booking').boundingBox(); const vh = p.viewportSize().height;
  must(box.y >= 0 && box.y + box.height <= vh, `nút + Thêm lịch đặt ngoài màn hình đầu y=${box.y}`);
  must(/Đặt qua điện thoại/.test(t) && /Anh Tùng/.test(t) && /Chị Lan/.test(t), 'giờ đá hôm nay không có hai lịch qua điện thoại');
  must(/chưa nhận tiền/i.test(t) && /Chưa nhận tiền/.test(t), 'không thấy tình trạng tiền');
  const k = await task('Xem hôm nay ai đá và ai chưa nhận tiền', async () => 0);
  await shot('today'); return k;
}, { shot: false });

await step(p, 'ownux', '03-each-booking-once-and-every-card-has-action', async () => {
  const codes = (await text()).match(/SN\d{5}/g) || [];
  const dup = await dupCodes(); must(!dup.length, 'đơn xuất hiện ở hai thẻ: ' + dup);
  const cards = await p.locator('#h-tasks').evaluate((h) => [...h.closest('section').querySelectorAll('li')].map((li) => ({ btn: li.querySelectorAll('button, a.btn').length, t: li.innerText.slice(0, 40) })));
  must(cards.length >= 1 && cards.every((c) => c.btn > 0), 'thẻ cần xử lý không có nút: ' + JSON.stringify(cards.filter((c) => !c.btn)));
  const bad = (await p.locator('#h-tasks').evaluate((h) => [...h.closest('section').querySelectorAll('.badge')].filter((x) => !x.closest('li').querySelector('button')).length)); must(bad === 0, 'nhãn đứng một mình');
  return `${codes.length} đơn, ${cards.length} thẻ cần xử lý, đều có nút`;
}, { shot: false });

await step(p, 'ownux', '04-approve', async () => {
  const k = await task('Đồng ý đơn đang chờ', async () => {
    await click('#h-tasks >> xpath=ancestor::section >> button:has-text("Đồng ý")'); await p.waitForSelector('dialog[open]');
    await click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
  await p.waitForTimeout(400);
  const pend = (await ownerBookings()).filter((x) => x.status === 'pending'); must(pend.length === 0, 'đơn vẫn chờ'); return k;
}, { shot: false });

await step(p, 'ownux', '05-reject', async () => {
  await reset(); await loginAs(p, OWNER); await gotoToday();
  const k = await task('Từ chối đơn đang chờ', async () => {
    await click('#h-tasks >> xpath=ancestor::section >> button:has-text("Từ chối")'); await p.waitForSelector('dialog[open] textarea');
    await p.fill('dialog[open] textarea', 'Sân bảo trì giờ này'); await click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
  await p.waitForTimeout(400); must((await ownerBookings()).filter((x) => x.status === 'rejected').length >= 1, 'chưa từ chối'); return k;
}, { shot: false });

await step(p, 'ownux', '06-record-payment', async () => {
  await reset(); await loginAs(p, OWNER); await gotoToday();
  const k = await task('Ghi nhận đã nhận tiền (giờ đá hôm nay)', async () => {
    await click('#h-today >> xpath=ancestor::section >> li.bk:has-text("Chị Lan") button:has-text("Đã nhận tiền")'); await p.waitForSelector('dialog[open]');
    await click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
  await p.waitForTimeout(400);
  const lan = (await ownerBookings()).find((x) => x.customerName === 'Chị Lan (Zalo)'); must(lan.paymentStatus === 'paid', 'chưa ghi nhận tiền'); return k;
}, { shot: false });

// Từ đây dùng giờ chuẩn: hôm nay là ngày chưa có lịch qua giờ.
let TODAY, FREE;
await step(p, 'ownux', '07-block-slot', async () => {
  await anchor(p, '08:00'); await p.evaluate(() => sessionStorage.clear()); await loginAs(p, OWNER); TODAY = (await mockNow(p)).slice(0, 10);
  const sc = (await attempt(`a=>a.owner.schedule(1,'${TODAY}')`)).r; const c0 = sc.courts[0];
  FREE = c0.slots.filter((s) => s.status === 'available').map((s) => s.start); must(FREE.length >= 4, 'sân 1 không đủ giờ trống');
  await gotoToday();
  const k = await task('Chặn một giờ', async () => {
    await goMenu('Lịch sân'); await p.waitForSelector('.sched-grid .sc');
    await click(`.sc[data-court="${c0.id}"][data-start="${FREE[0]}"]`); await p.waitForSelector('dialog[open] .choice-btn');
    await p.waitForTimeout(400); await p.locator('dialog[open]').screenshot({ path: `e2e/out/owner2-choice-${W}.png` });
    await click('dialog[open] [data-kind=block]'); await p.waitForSelector('dialog[open] #f-reason');
    await p.fill('#f-reason', 'Sửa đèn sân'); await click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
  await p.waitForSelector(`.sc[data-start="${FREE[0]}"].sc-blocked`); return k;
}, { shot: false });

await step(p, 'ownux', '08-add-phone-booking', async () => {
  await gotoToday();
  const k = await task('Thêm lịch cho khách gọi điện', async () => {
    await click('#add-booking'); await p.waitForSelector('dialog[open] #pb-name'); await p.waitForFunction(() => document.querySelectorAll('#pb-start option').length > 3);
    await p.fill('#pb-name', 'Chú Bảy'); await p.fill('#pb-phone', '0909 000 111');
    clicks++; await p.selectOption('#pb-start', FREE[1]); await p.waitForTimeout(200);
    await click('dialog[open] [data-save]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
  await p.waitForTimeout(400);
  must((await ownerBookings()).some((x) => x.customerName === 'Chú Bảy' && x.source === 'phone'), 'chưa có lịch'); must(/Chú Bảy/.test(await text()), 'Hôm nay chưa hiện lịch mới'); return k;
}, { shot: false });

// Việc của kèo và pass: dựng bằng API rồi chủ sân xử lý trên giao diện.
let M, T, D;
await step(p, 'ownux', '09-setup-match-and-transfer', async () => {
  D = dayPlus(TODAY, 1);
  const free3 = (await attempt(`a=>a.schedule(3,'${D}')`)).r.courts.find((c) => c.id === 6).slots.find((s) => s.start === '20:00'); must(free3.status === 'available', 'sân 3 không trống');
  await loginAs(p, 'khach1@datsan.local');
  const m = await attempt(`async a=>{const meta=await a.meta();const st=Date.parse('${D} 20:00:00'.replace(' ','T')+'+07:00');const ca=new Date(st-meta.matchCloseMinutes*60000+7*3600000).toISOString().slice(0,19).replace('T',' ');return a.openMatch({courtId:6,date:'${D}',start:'20:00',loserPercent:70,closesAt:ca})}`); must(m.ok, m.msg); M = m.r;
  await loginAs(p, OWNER); must((await attempt(`a=>a.owner.confirmMatchPart(${M.id},'host','')`)).ok, 'host');
  await loginAs(p, 'khach2@datsan.local'); must((await attempt(`a=>a.joinMatch(${M.id})`)).ok, 'join');
  // Pass: khach3 đặt, đăng pass, khach1 nhận.
  await loginAs(p, 'khach3@datsan.local');
  const bk = await attempt(`a=>a.createBooking({courtId:2,date:'${D}',start:'18:00',note:''})`); must(bk.ok, 'đặt ' + bk.msg);
  await loginAs(p, OWNER); await attempt(`a=>a.owner.approve(${bk.r.id})`); const pd = await attempt(`a=>a.owner.markPaid(${bk.r.id},'')`); must(pd.ok, 'paid ' + pd.msg);
  await loginAs(p, 'khach3@datsan.local'); const of = await attempt(`a=>a.offerTransfer(${bk.r.id},{askPrice:${bk.r.price}})`); must(of.ok, 'pass ' + of.msg); T = of.r;
  await loginAs(p, 'khach1@datsan.local'); const cl = await attempt(`a=>a.claimTransfer(${T.id})`); must(cl.ok, 'nhận pass ' + cl.msg);
  return `kèo #${M.id}, pass #${T.id}`;
}, { shot: false });

await step(p, 'ownux', '10-pass-and-match-cards-in-today', async () => {
  await loginAs(p, OWNER); await gotoToday();
  const t = await text('#h-tasks >> xpath=ancestor::section');
  must(await p.locator('[data-tr-confirm]').count() === 1, 'không có thẻ pass chờ xác nhận tiền');
  const codes = (await text()).match(/SN\d{5}/g) || []; const dup = await dupCodes(); must(!dup.length, 'đơn trùng: ' + dup);
  // Chủ sân xử lý pass ngay trong Hôm nay.
  await p.click('[data-tr-confirm]'); await p.waitForSelector('dialog[open]'); await p.click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  await p.waitForTimeout(500); must(await p.locator('[data-tr-confirm]').count() === 0, 'thẻ pass chưa biến mất');
  const tr = (await attempt('a=>a.owner.transfers()')).r.find((x) => x.id === T.id); must(tr.status === 'completed', 'pass chưa xong: ' + tr.status);
  must(await p.locator('[data-act=refund]').count() >= 1, 'chưa hiện thẻ "Đã chuyển lại" cho đội pass');
  await shot('today-cards');
  await p.selectOption('#venue', '3'); await p.waitForSelector('[data-mt-confirm]');
  const t3 = await text('#h-tasks >> xpath=ancestor::section'); must(/Đã nhận .*đội vào kèo/i.test(t3), 'thẻ kèo thiếu nút nhận tiền: ' + t3.slice(0, 200));
  must(!(await dupCodes()).length, 'đơn trùng ở sân 3');
  await p.evaluate(() => sessionStorage.clear());
  return `${codes.length} đơn, pass xác nhận ngay trong Hôm nay, thẻ kèo ở sân 3`;
}, { shot: false });

await step(p, 'ownux', '11-settle-match-result', async () => {
  // Kèo: chủ sân nhận phần đội vào, tua đồng hồ, hai đội báo lệch, chủ sân chốt trong Hôm nay.
  await p.waitForTimeout(100);
  must((await attempt(`a=>a.owner.confirmMatchPart(${M.id},'guest','')`)).ok, 'nhận phần guest');
  const now = await mockNow(p); const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');
  await api(p, `a=>a.proto.advanceClock(${Math.ceil((VN(`${D} 21:00:00`) - VN(now)) / 60000) + 1})`);
  await loginAs(p, 'khach1@datsan.local'); must((await attempt(`a=>a.reportMatchResult(${M.id},'host')`)).ok, 'host báo');
  await loginAs(p, 'khach2@datsan.local'); const r = await attempt(`a=>a.reportMatchResult(${M.id},'guest')`); must(r.ok && r.r.result.status === 'needs_owner', 'chưa chuyển chủ sân');
  await loginAs(p, OWNER); await p.goto(U + '/owner'); await p.waitForSelector('#venue');
  const k = await task('Chốt kết quả kèo (kèo ở sân thứ hai)', async () => {
    clicks++; await p.selectOption('#venue', '3'); await p.waitForSelector(`[data-mt-settle="${M.id}"]`);
    await click(`[data-mt-settle="${M.id}"]`); await p.waitForSelector('dialog[open] input[name=winner]');
    await click('dialog[open] input[value=draw]'); await click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
  await p.waitForTimeout(400); const m = (await attempt(`a=>a.match(${M.id})`)).r; must(m.result.status === 'settled' && m.result.settledBy === 'owner', 'chưa chốt'); return k;
}, { shot: false });

await step(p, 'ownux', '12-schedule-one-court-at-a-time-and-names-readable', async () => {
  await anchor(p, '08:00'); await p.evaluate(() => sessionStorage.clear()); await loginAs(p, OWNER); TODAY = (await mockNow(p)).slice(0, 10);
  // Thêm một lịch qua điện thoại vào sân 2 để kiểm tên đọc được trong ô.
  const sc = (await attempt(`a=>a.owner.schedule(1,'${TODAY}')`)).r; const c2 = sc.courts[1]; const f = c2.slots.find((s) => s.status === 'available' && s.start >= '10:00');
  must((await attempt(`a=>a.owner.addBooking({courtId:${c2.id},date:'${TODAY}',start:'${f.start}',customerName:'Nguyễn Văn Trường Giang',price:300000})`)).ok, 'thêm');
  await p.goto(`${U}/owner-schedule`); await p.waitForSelector('.sched-grid .sc');
  const tabs = await p.locator('[data-court-tab]').allInnerTexts();
  if (NARROW) {
    must(tabs.length === sc.courts.length && tabs[0] === 'Sân 1', 'tab sân: ' + tabs);
    must(await p.locator('.sg-h:not(.sg-corner)').count() === 1, 'phải chỉ hiện một sân');
    const over = await p.evaluate(() => { const s = document.querySelector('.sched'); return s.scrollWidth - s.clientWidth; }); must(over <= 1, 'lưới còn bị cắt ngang ' + over);
    await shot('schedule-court1');
    await p.click('[data-court-tab]:nth-of-type(2)'); await p.waitForSelector(`.sc[data-court="${c2.id}"]`);
  } else { must(!tabs.length, 'màn rộng không cần tab'); must(await p.locator('.sg-h:not(.sg-corner)').count() === sc.courts.length, 'màn rộng phải hiện đủ các sân'); }
  const cell = (await p.locator(`.sc[data-court="${c2.id}"][data-start="${f.start}"]`).innerText()).replace(/\s+/g, ' ');
  must(/Đặt qua điện thoại/.test(cell) && /Nguyễn Văn Trường Giang/.test(cell), 'ô không đọc được tên khách: ' + cell);
  const clipped = await p.locator(`.sc[data-court="${c2.id}"][data-start="${f.start}"] .who`).evaluate((e) => e.scrollWidth > e.clientWidth + 1); must(!clipped, 'tên khách bị cắt trong ô');
  await shot('schedule-grid'); return NARROW ? `tab: ${tabs.join(', ')}` : 'đủ các sân cạnh nhau';
}, { shot: false });

await step(p, 'ownux', '13-list-view-and-money-wording', async () => {
  await p.click('.view-switch a:has-text("Danh sách")'); await p.waitForSelector('.chips .chip'); await p.waitForSelector('.bk');
  const t = await text(); must(/Chưa nhận tiền/.test(t) && !/Chưa chuyển khoản|Đã chuyển khoản/.test(t), 'chữ tiền trong danh sách: ' + t.slice(0, 200));
  must(/sân \d+ người/.test(t) && !/Sân 1 · Sân/.test(t), 'tên sân chưa viết "sân N người"');
  must(await p.locator('.site-header .nav a[aria-current=page]').innerText() === 'Lịch sân', 'danh sách phải thuộc mục Lịch sân');
  await shot('list'); return 'danh sách, chữ tiền thống nhất';
}, { shot: false });

await step(p, 'ownux', '14-old-links-keep-params', async () => {
  await reset(); await loginAs(p, OWNER);
  const code = (await ownerBookings()).find((x) => x.status === 'pending').code; const d = dayPlus((await mockNow(p)).slice(0, 10), 1);
  const open = async (path, sel) => { const r = await p.goto(U + path); must(r.ok(), path + ' ' + r.status()); await p.waitForSelector(sel, { timeout: 8000 }); };
  await open('/owner', '#h-tasks'); await open(`/owner-schedule?date=${d}`, '.sched-grid .sc');
  must((await p.locator('.day-chip[aria-pressed=true] .dnum').innerText()) === d.slice(8), '?date không giữ');
  await open(`/owner-bookings?q=${code}`, '.bk'); must((await p.inputValue('#text')) === code && await p.locator('.bk-list > .bk').count() === 1, '?q không giữ');
  const id = (await ownerBookings()).find((x) => x.code === code).id; await open(`/owner-bookings?id=${id}`, '.bk'); must(await p.locator('.bk-list > .bk').count() === 1 && /theo liên kết/.test(await text()), '?id không giữ');
  await open('/owner-bookings?status=unpaid', '.chip[aria-pressed=true]'); must(/Chưa nhận tiền/.test(await p.locator('.chip[aria-pressed=true]').first().innerText()), '?status không giữ');
  await open('/owner-requests', '#content'); await open('/owner-settings', '.set-group');
  return 'owner, schedule?date, bookings?q/id/status, requests, settings';
}, { shot: false });

await step(p, 'ownux', '15-requests-page', async () => {
  await p.goto(U + '/owner-requests'); await p.waitForTimeout(800); await shot('requests');
  const t = await text(); must(!/cụm sân/i.test(t), 'còn chữ "cụm sân": ' + t.match(/.{30}cụm sân.{20}/i)); return 'ok';
}, { shot: false });

await step(p, 'ownux', '16-settings-groups-save-separately', async () => {
  await p.goto(U + '/owner-settings'); await p.waitForSelector('.set-group');
  const groups = await p.locator('.set-group > summary h2').allInnerTexts(); must(groups.length >= 6, 'nhóm: ' + groups);
  must(await p.locator('.set-group[open]').count() === 0, 'mặc định phải thu gọn');
  await shot('settings-closed', false);
  await p.click('.set-group[data-key=info] > summary'); await p.click('.set-group[data-key=rules] > summary');
  const v1 = (await attempt('a=>a.owner.venues()')).r[0];
  await p.fill('#name', v1.name + ' (mới)'); await p.fill('#rules', 'Không mang giày đinh. Không hút thuốc.');
  const rulesBtn = p.locator('.set-form[data-group=rules] button[type=submit]'); await rulesBtn.click(); await p.waitForTimeout(600);
  const v2 = (await attempt('a=>a.owner.venues()')).r[0];
  must(v2.rules.includes('giày đinh'), 'nhóm nội quy chưa lưu'); must(v2.name === v1.name, 'lưu nhóm nội quy đã lưu cả tên sân đang sửa dở');
  must(await p.locator('.set-group[data-key=info]').evaluate((d) => d.open), 'nhóm đang mở bị đóng sau khi lưu');
  must((await p.inputValue('#name')) === v1.name, 'ô tên sân phải về giá trị đã lưu');
  await p.fill('#name', v1.name + ' (mới)'); await p.click('.set-form[data-group=info] button[type=submit]'); await p.waitForTimeout(600);
  must((await attempt('a=>a.owner.venues()')).r[0].name === v1.name + ' (mới)', 'nhóm thông tin chưa lưu');
  await p.fill('#name', v1.name); await p.click('.set-form[data-group=info] button[type=submit]'); await p.waitForTimeout(500);
  await p.click('.set-group[data-key=info] > summary'); await p.click('.set-group[data-key=rules] > summary'); await p.click('.set-group[data-key=courts] > summary'); await p.waitForSelector('.court');
  await shot('settings'); return groups.join(' | ');
}, { shot: false });

console.log('\nBảng số lần bấm (' + W + 'px):'); for (const [n, c] of table) console.log(`  ${String(c).padStart(2)}  ${n}`);
console.log(logs.length ? 'console: ' + logs.join(' | ') : 'console: sạch'); save(); await b.close();
