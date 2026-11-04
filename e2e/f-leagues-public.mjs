// Khách thường tìm thấy giải: menu "Giải đấu", trang danh sách + lọc quận, nút nhắn chủ sân, dải ở trang chủ, giải nháp không lộ.
import fs from 'node:fs';
import { start, step, save, loginAs, U, W, logs } from './lib.mjs';
const { b, p } = await start();
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const call = async (expr) => { const r = await attempt(expr); if (!r.ok) throw new Error(`${expr} → ${r.status} ${r.msg}`); return r.r; };
const must = (c, m) => { if (!c) throw new Error(m); };
const J = JSON.stringify;
const OUT = 'e2e/out/leagues-public'; fs.mkdirSync(OUT, { recursive: true });
const snap = async (name, target = p, full = true) => { await p.waitForTimeout(600); await target.screenshot({ path: `${OUT}/${name}-${W}.png`, ...(target === p ? { fullPage: full } : {}) }); };
const noOverflow = async (what) => { const o = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); must(o[0] <= o[1], `${what}: tràn ngang ${o[0]} > ${o[1]}`); };
const tel = (s) => String(s).replace(/[^\d+]/g, '');
const names = (a) => a.map((l) => l.name).sort();
const cardNames = () => p.locator('.lg-pubcard .lc-name').allTextContents().then((a) => a.map((s) => s.trim()).sort());

await p.goto(U + '/'); await p.evaluate(async () => { await (await import('/js/api.js')).api.proto.resetDemo(); });
let ALL;

// Từ 900px Pass sân / Ghép kèo / Giải đấu / Nhờ báo giá nằm trong mục "Thêm": mở ra trước khi tìm link.
const openMore = async () => { if (W >= 1024 && (await p.locator('.nav-more-btn').getAttribute('aria-expanded')) !== 'true') await p.click('.nav-more-btn'); };
const openMenuTo = async (label) => {
  if (W < 1024) { await p.click('.menu-btn'); }
  else if (await p.locator(`.nav-more-panel a:has-text("${label}")`).count()) await openMore();
  const link = p.locator(`nav a:has-text("${label}"):visible`).first();
  await link.waitFor(); await link.click();
};
const navOrder = () => p.evaluate(() => { const nav = [...document.querySelectorAll('nav')].find((n) => n.getClientRects().length > 0 && n.querySelector('a')); return [...nav.querySelectorAll('a')].map((a) => a.textContent.trim()); });

await step(p, 'lgpub', '01-menu-guest-and-customer', async () => {
  await p.goto(U + '/'); await p.waitForSelector('nav.nav a', { state: 'attached' });
  if (W < 1024) await p.click('.menu-btn');
  let order = await navOrder();
  must(order.indexOf('Giải đấu') === order.indexOf('Ghép kèo') + 1 && order.indexOf('Giải đấu') > 0, 'khách: Giải đấu phải ngay sau Ghép kèo: ' + order);
  if (W < 1024) await snap('menu-open', p, false); else await snap('menu-open', p, false);
  await openMore();
  await p.locator('nav a:has-text("Giải đấu"):visible').first().click();
  await p.waitForURL(/\/leagues(\.html)?(?=[?#]|$)/); await p.waitForSelector('.lg-pubcard');
  must(!/login/.test(p.url()), 'khách bị đẩy sang đăng nhập');
  must(await p.locator('h1:has-text("Giải đấu")').count() === 1, 'thiếu h1');
  if (W < 1024) await p.click('.menu-btn'); // menu điện thoại đóng thì ẩn hẳn khỏi Tab và trình đọc màn hình: mở ra mới đọc được
  else await openMore();
  must(await p.locator('nav a[aria-current=page]:visible').first().innerText().then((t) => t.trim() === 'Giải đấu').catch(() => false), 'mục Giải đấu chưa được đánh dấu đang xem');
  if (W < 1024) await p.click('.menu-btn');
  await loginAs(p, 'khach1@datsan.local'); await p.goto(U + '/');
  await p.waitForSelector('nav.nav a', { state: 'attached' }); if (W < 1024) await p.click('.menu-btn');
  order = await navOrder();
  must(order.indexOf('Giải đấu') === order.indexOf('Ghép kèo') + 1, 'khách hàng: Giải đấu phải ngay sau Ghép kèo: ' + order);
  await openMore();
  await p.locator('nav a:has-text("Giải đấu"):visible').first().click(); await p.waitForURL(/\/leagues(\.html)?(?=[?#]|$)/);
  await p.evaluate(async () => { await (await import('/js/api.js')).api.logout().catch(() => {}); });
  return 'menu: ' + order.join(' | ');
}, { shot: false });

await step(p, 'lgpub', '01b-more-menu-keyboard', async () => {
  await p.goto(U + '/'); await p.waitForSelector('.menu-btn', { state: 'attached' });
  const isOpen = (sel) => p.locator(sel).getAttribute('aria-expanded').then((v) => v === 'true');
  if (W >= 1024) {
    await p.locator('.nav-more-btn').focus(); await p.keyboard.press('Enter');
    must(await isOpen('.nav-more-btn') && await p.locator('.nav-more-panel a:visible').count() === 4, 'Enter không mở mục Thêm (4 link)');
    await p.keyboard.press('Escape');
    must(!(await isOpen('.nav-more-btn')) && await p.evaluate(() => document.activeElement?.classList.contains('nav-more-btn')), 'Escape phải đóng Thêm và trả tiêu điểm về nút');
    await p.keyboard.press('Enter'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    must(!(await isOpen('.nav-more-btn')), 'Tab ra khỏi Thêm phải đóng');
    return 'Thêm: Enter mở, Escape đóng + trả tiêu điểm, Tab ra thì đóng';
  }
  await p.click('.menu-btn'); must(await isOpen('.menu-btn'), 'nút menu không mở');
  await p.keyboard.press('Escape');
  must(!(await isOpen('.menu-btn')) && await p.evaluate(() => document.activeElement?.classList.contains('menu-btn')), 'Escape phải đóng menu và trả tiêu điểm về nút');
  return 'menu điện thoại: Escape đóng + trả tiêu điểm';
});

await step(p, 'lgpub', '02-list-matches-api-and-hides-drafts', async () => {
  // giải nháp của chủ sân 1: không được lộ ở API, trang danh sách, trang chủ
  await loginAs(p, 'chusan1@datsan.local');
  await call("a=>a.owner.createLeague({ venueId: 1, name: 'Giải nháp tuyệt mật', fieldType: '5', teamCount: 4, link: '' })");
  await p.evaluate(async () => { await (await import('/js/api.js')).api.logout().catch(() => {}); });
  ALL = await call('a=>a.leagues()');
  must(ALL.length === 3 && !ALL.some((l) => /nháp/.test(l.name)), 'API lộ giải nháp hoặc sai số lượng: ' + J(ALL.map((l) => l.name)));
  must(ALL.every((l) => l.status !== 'draft'), 'có giải draft trong API');
  const order = ALL.map((l) => l.status);
  must(J(order) === J(['ongoing', 'published', 'finished']), 'thứ tự đang đá → sắp đá → đã xong: ' + order);
  await p.goto(U + '/leagues'); await p.waitForSelector('.lg-pubcard');
  { const got = (await cardNames()).map((x) => x.toLowerCase()).sort(); const exp = ALL.map((l) => l.name.toLowerCase()).sort(); must(J(got) === J(exp), 'thẻ ≠ API: ' + J(got)); }
  const body = await p.locator('body').innerText();
  must(!/nháp tuyệt mật/i.test(body), 'trang danh sách lộ giải nháp');
  // giải đã xong thu gọn; đang đá/sắp đá nằm trước
  must(await p.locator('details.lg-done:not([open]) .lg-pubcard').count() === 1, 'giải đã xong phải nằm trong mục thu gọn');
  const first = await p.locator('.lg-pubcard').first().getAttribute('data-id'); must(Number(first) === ALL[0].id, 'thẻ đầu phải là giải đang đá');
  // mỗi thẻ có đủ tên, sân, quận, loại sân, tiến độ, đội đầu bảng
  for (const l of ALL) {
    const t = (await p.locator(`.lg-pubcard[data-id="${l.id}"]`).textContent()).replace(/\s+/g, ' ');
    must(t.toLowerCase().includes(l.name.toLowerCase()) && t.includes(l.venueName) && t.includes(l.venueDistrict) && t.includes(`Sân ${l.fieldType} người`) && t.includes(`${l.done}/${l.matches} trận`), `thẻ ${l.id} thiếu thông tin: ${t}`);
    if (l.leader) must(t.includes(l.leader.name) && t.includes(`${l.leader.points} điểm`), `thẻ ${l.id} thiếu đội đầu bảng: ${t}`);
    const pv = await p.locator(`.lg-pubcard[data-id="${l.id}"] [role=progressbar]`).count();
    must(l.matches === 0 || pv === 1, `thẻ ${l.id} thiếu progressbar`);
  }
  await p.goto(U + '/'); await p.waitForSelector('#home-leagues:not([hidden])');
  must(!/nháp tuyệt mật/i.test(await p.locator('#home-leagues').innerText()), 'trang chủ lộ giải nháp');
  await loginAs(p, 'chusan1@datsan.local');
  const mine = await call('a=>a.owner.leagues(1)'); must(mine.some((l) => /nháp/.test(l.name) && l.status === 'draft'), 'giải nháp đã mất khỏi trang chủ sân');
  await call(`a=>a.owner.deleteLeague(${mine.find((l) => /nháp/.test(l.name)).id})`);
  await p.evaluate(async () => { await (await import('/js/api.js')).api.logout().catch(() => {}); });
  return `${ALL.length} giải công khai: ${ALL.map((l) => l.status).join(' → ')}; giải nháp không lộ ở API/danh sách/trang chủ`;
}, { shot: false });

await step(p, 'lgpub', '03-district-filter-matches-api', async () => {
  await p.goto(U + '/leagues'); await p.waitForSelector('.lg-pubcard');
  await snap('list');
  const opts = await p.locator('#f-district option').evaluateAll((a) => a.map((o) => o.value).filter(Boolean));
  const want = [...new Set(ALL.map((l) => l.venueDistrict))].sort((a, c) => a.localeCompare(c, 'vi'));
  must(J(opts) === J(want), `danh sách quận ${J(opts)} ≠ ${J(want)}`);
  let shown = false;
  for (const d of opts) {
    await p.selectOption('#f-district', d); await p.waitForTimeout(250);
    const api = await call(`a=>a.leagues(${J(d)})`);
    must(api.length === ALL.filter((l) => l.venueDistrict === d).length && api.every((l) => l.venueDistrict === d), `API lọc ${d} sai`);
    const got = (await cardNames()).map((s) => s.toLowerCase()); const exp = api.map((l) => l.name.toLowerCase()).sort();
    must(J(got) === J(exp), `lọc ${d}: thẻ ${J(got)} ≠ API ${J(exp)}`);
    must(new URL(p.url()).searchParams.get('district') === d, 'quận không nằm trong URL: ' + p.url());
    if (!shown && api.some((l) => l.status === 'ongoing')) { await snap('list-filtered'); shown = true; }
  }
  // tải lại với ?district= vẫn giữ lọc; quận không có giải → thông báo, không lỗi
  await p.goto(U + `/leagues?district=${encodeURIComponent(opts[0])}`); await p.waitForSelector('.lg-pubcard');
  must(await p.inputValue('#f-district') === opts[0], 'tải lại không giữ quận');
  await p.selectOption('#f-district', ''); await p.waitForTimeout(250);
  must((await cardNames()).length === ALL.length, 'bỏ lọc phải hiện đủ giải');
  await noOverflow('danh sách giải');
  return `quận: ${opts.join(', ')}; mỗi quận khớp API`;
}, { shot: false });

await step(p, 'lgpub', '04-open-league-and-contact-button', async () => {
  await p.goto(U + '/leagues'); await p.waitForSelector('.lg-pubcard');
  const live = ALL[0];
  await p.locator(`.lg-pubcard[data-id="${live.id}"] .lc-link`).click(); await p.waitForURL(/\/league(\.html)?\?id=/);
  await p.waitForSelector('.lg-title');
  must((await p.locator('.lg-title').innerText()).trim().toLowerCase() === live.name.toLowerCase(), 'mở nhầm giải');
  const note = (await p.locator('.lg-regnote').innerText());
  must(/chưa cho đội tự đăng ký/.test(note) && /chủ sân là người thêm đội/i.test(note), 'thiếu câu nói rõ chủ sân thêm đội: ' + note);
  const rows = [];
  for (const l of ALL) {
    const want = l.link ? { kind: 'link', href: l.link } : { kind: 'tel', href: 'tel:' + tel(l.venuePhone) };
    must(l.link || l.venuePhone, `giải ${l.id} không có link lẫn số sân`);
    // trên thẻ
    await p.goto(U + '/leagues'); await p.waitForSelector('.lg-pubcard');
    const a = p.locator(`.lg-pubcard[data-id="${l.id}"] a[data-contact]`);
    must(await a.getAttribute('href') === want.href && await a.getAttribute('data-contact') === want.kind && /Muốn đăng ký đội\? Nhắn chủ sân/.test(await a.textContent()), `nút trên thẻ ${l.id}: ${await a.getAttribute('href')} ≠ ${want.href}`);
    // trên trang giải
    await p.goto(U + `/league?id=${l.id}`); await p.waitForSelector('.lg-title');
    const h = p.locator('.lg-hero a[data-contact]');
    must(await h.count() === 1 && await h.getAttribute('href') === want.href, `nút trên trang giải ${l.id}: ${await h.getAttribute('href')} ≠ ${want.href}`);
    must(/chưa cho đội tự đăng ký/.test(await p.locator('.lg-regnote').innerText()), 'trang giải thiếu câu chú thích');
    // nhãn trạng thái ở trang giải phải giống nhãn trên thẻ
    const onPage = (await p.locator('.lg-hero .lg-st').innerText()).trim();
    await p.goto(U + '/leagues'); await p.waitForSelector('.lg-pubcard', { state: 'attached' });
    const onCard = (await p.locator(`.lg-pubcard[data-id="${l.id}"] .lg-st`).textContent()).trim();
    must(onPage === onCard && onCard.length > 0, `giải ${l.id}: nhãn trên thẻ "${onCard}" ≠ trang giải "${onPage}"`);
    await p.goto(U + `/league?id=${l.id}`); await p.waitForSelector('.lg-title');
    rows.push(`#${l.id} ${want.kind} ${onCard}`);
    if (l.id === ALL[0].id) await snap('league-contact-link');
    if (!l.link && !rows.some((r) => r.includes('shot'))) { await snap('league-contact-tel'); rows.push('shot'); }
  }
  await noOverflow('trang giải');
  return rows.filter((r) => r !== 'shot').join(', ');
}, { shot: false });

await step(p, 'lgpub', '05-no-number-invented-when-venue-has-none', async () => {
  // sân không có số và giải không có link: nút dẫn về trang sân, không tự đặt số
  const l = ALL.find((x) => !x.link); const owner = 'chusan2@datsan.local';
  await loginAs(p, owner);
  const v = await call(`a=>a.owner.updateVenue(${l.venueId}, { phone: '' })`);
  await p.evaluate(async () => { await (await import('/js/api.js')).api.logout().catch(() => {}); });
  const pub = (await call('a=>a.leagues()')).find((x) => x.id === l.id);
  must(pub.venuePhone === '' && !pub.link, 'dữ liệu thử chưa đúng: ' + J(pub));
  await p.goto(U + '/leagues'); await p.waitForSelector('.lg-pubcard');
  const a = p.locator(`.lg-pubcard[data-id="${l.id}"] a[data-contact]`);
  must(await a.getAttribute('data-contact') === 'venue' && (await a.getAttribute('href')) === `/product-detail.html?id=${l.venueId}`, 'sân không số phải dẫn về trang sân: ' + await a.getAttribute('href'));
  await loginAs(p, owner); await call(`a=>a.owner.updateVenue(${l.venueId}, { phone: ${J(l.venuePhone)} })`);
  await p.evaluate(async () => { await (await import('/js/api.js')).api.logout().catch(() => {}); });
  return 'không có số/link → /product-detail.html?id=' + l.venueId;
}, { shot: false });

await step(p, 'lgpub', '06-home-strip-shows-and-hides', async () => {
  await p.goto(U + '/'); await p.waitForSelector('#home-leagues:not([hidden])');
  const cards = await p.locator('#home-leagues .lg-pubcard').count();
  const expect = Math.min(3, ALL.filter((l) => l.status !== 'finished').length);
  must(cards === expect && cards >= 1 && cards <= 3, `dải trang chủ có ${cards} thẻ, mong ${expect}`);
  must(await p.locator('#home-leagues .lg-st:has-text("Đã kết thúc")').count() === 0, 'giải đã xong lên trang chủ');
  // dải nằm dưới phần tìm sân và dưới "Chưa có sân? Thử ba cách này"
  const y = await p.evaluate(() => ({ s: document.querySelector('.match-hero').getBoundingClientRect().bottom + scrollY, t: document.querySelector('.home-tools').getBoundingClientRect().bottom + scrollY, h: document.querySelector('#home-leagues').getBoundingClientRect().top + scrollY }));
  must(y.h >= y.t - 1 && y.t > y.s, `dải không nằm dưới phần tìm sân/ba cách: ${J(y)}`);
  await p.locator('#home-leagues').scrollIntoViewIfNeeded(); await snap('home-strip', p.locator('#home-leagues'));
  await noOverflow('trang chủ');
  await p.locator('#home-leagues a[href="/leagues.html"]').click(); await p.waitForURL(/\/leagues(\.html)?(?=[?#]|$)/);
  // xóa hết giải đang đá và sắp đá → dải ẩn; xóa nốt → trang danh sách báo rỗng
  await loginAs(p, 'chusan1@datsan.local'); await call(`a=>a.owner.deleteLeague(${ALL.find((l) => l.venueId === 1).id})`);
  await loginAs(p, 'chusan2@datsan.local'); await call(`a=>a.owner.deleteLeague(${ALL.find((l) => l.status === 'published').id})`);
  await p.evaluate(async () => { await (await import('/js/api.js')).api.logout().catch(() => {}); });
  await p.goto(U + '/'); await p.waitForSelector('.tonight-row, #tonight-rows a, .venue-card, .slot-pill', { timeout: 8000 }); await p.waitForTimeout(1500);
  must(await p.locator('#home-leagues').isHidden(), 'còn giải đã xong thì dải vẫn phải ẩn (chỉ giải đang đá/sắp đá mới lên trang chủ)');
  await p.goto(U + '/leagues'); await p.waitForSelector('.lg-pubcard', { state: 'attached' });
  must(await p.locator('.lg-pubcard').count() === 1 && await p.locator('details.lg-done .lg-pubcard').count() === 1, 'chỉ còn giải đã xong, trong mục thu gọn');
  await loginAs(p, 'chusan2@datsan.local'); await call(`a=>a.owner.deleteLeague(${ALL.find((l) => l.status === 'finished').id})`);
  await p.evaluate(async () => { await (await import('/js/api.js')).api.logout().catch(() => {}); });
  await p.goto(U + '/leagues'); await p.waitForSelector('#lg-root .empty');
  must(/Chưa có giải nào/.test(await p.locator('#lg-root').innerText()), 'danh sách rỗng phải có thông báo');
  await p.goto(U + '/'); await p.waitForTimeout(2500);
  must(await p.locator('#home-leagues').isHidden(), 'không còn giải nào mà dải vẫn hiện');
  await noOverflow('trang chủ không giải');
  return `${cards} thẻ trên trang chủ; ẩn khi không còn giải đang đá/sắp đá; danh sách rỗng có thông báo`;
}, { shot: false });

await step(p, 'lgpub', '07-console-clean', async () => {
  const bad = logs.filter((l) => !/favicon/.test(l)); must(!bad.length, 'console: ' + bad.slice(0, 3).join(' || '));
  return 'console sạch';
}, { shot: false });
save(); console.log('LOGS', logs.join('\n')); await b.close();
