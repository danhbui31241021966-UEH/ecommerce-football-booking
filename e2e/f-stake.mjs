// Kèo tiền sân: 7-3, thua bao sân, hòa, báo lệch → chủ sân chốt, quá hạn → chủ sân chốt, đội thắng bấm Đã nhận, người ngoài kèo.
import { start, step, save, loginAs, api, U, W, logs, anchor, mockNow } from './lib.mjs';
const { b, p } = await start();
const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const must = (c, m) => { if (!c) throw new Error(m); };
const ev = (fn, arg) => p.evaluate(fn, arg);
const OWNER = 'chusan1@datsan.local';
const BANK = { bin: '970436', account: '0071001234567', accountName: 'NGUYEN VAN A' };
const shot = (n) => p.screenshot({ path: `e2e/out/stake-${n}-${W}.png`, fullPage: true });
const NOW0 = await anchor(p, '08:00');
const SL = { m1: [6, '18:00', 70], m2: [7, '18:00', 100], m3: [6, '19:00', 60], m4: [7, '19:00', 70], m5: [6, '20:00', 60] };
let D;
for (let i = 0; i < 3 && !D; i++) {
  const d = new Date(VN(NOW0) + i * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
  if (VN(`${d} 18:00:00`) - VN(NOW0) < 4 * 3600000) continue;
  const sc = await ev(async (dd) => (await import('/js/api.js')).api.schedule(3, dd), d);
  if (Object.values(SL).every(([c, s]) => sc.courts.find((x) => x.id === c).slots.find((x) => x.start === s).status === 'available')) D = d;
}
if (!D) throw new Error('không có ngày phù hợp');
console.log('ngày', D, 'now', NOW0);
const M = {};
const stakeLabel = { 70: '7-3', 100: 'thua bao sân', 60: '6-4' };
const loserShare = (m) => Math.round((m.price * m.loserPercent) / 100 / 1000) * 1000;

await step(p, 'stake', '01-open-form-has-stakes-and-limits', async () => {
  await loginAs(p, 'khach1@datsan.local');
  await p.goto(`${U}/match-new?venue=3&court=6&date=${D}&start=18:00`);
  await p.waitForSelector('#match-form');
  const chips = await p.locator('[data-stake]').allInnerTexts();
  must(JSON.stringify(chips) === JSON.stringify(['5-5', '6-4', '7-3', 'Thua bao sân']), 'chip kèo: ' + chips);
  must(await p.locator('[data-percent]').count() === 0, 'còn lựa chọn chia 30–70%');
  await p.click('[data-stake="70"]');
  const t = (await p.locator('#match-form').innerText()).replace(/\s+/g, ' ');
  must(/Đội thua chịu/.test(t) && /không cược thêm tiền, không kèo theo tỉ số/i.test(t), 'thiếu giải thích kèo/giới hạn: ' + t.slice(0, 300));
  must(!/chia đôi/i.test(await p.locator('body').innerText()), 'còn chữ chia đôi');
  await shot('open'); return t.slice(t.indexOf('Kèo tiền sân'), t.indexOf('Kèo tiền sân') + 260);
}, { shot: false });

// Mở 5 kèo, chủ sân nhận đủ hai phần: kèo chốt.
await step(p, 'stake', '02-setup-five-confirmed-matches', async () => {
  await loginAs(p, 'khach1@datsan.local');
  for (const k of Object.keys(SL)) {
    const [c, s, lp] = SL[k];
    const r = await attempt(`async a=>{const m=await a.meta();const st=Date.parse('${D} ${s}:00'.replace(' ','T')+'+07:00');const ca=new Date(st-m.matchCloseMinutes*60000+7*3600000).toISOString().slice(0,19).replace('T',' ');return a.openMatch({courtId:${c},date:'${D}',start:'${s}',loserPercent:${lp},closesAt:ca})}`);
    must(r.ok, k + ' ' + r.msg); M[k] = r.r;
    must(r.r.loserPercent === lp && r.r.hostAmount + r.r.guestAmount === r.r.price, 'tổng hai phần khác giá sân');
  }
  const bad = await attempt(`a=>a.openMatch({courtId:6,date:'${D}',start:'21:00',loserPercent:80,closesAt:'${D} 18:00:00'})`); must(!bad.ok && bad.status === 400, 'chấp nhận tỉ lệ 80');
  await loginAs(p, OWNER);
  for (const k of Object.keys(SL)) must((await attempt(`a=>a.owner.confirmMatchPart(${M[k].id},'host','')`)).ok, 'nhận phần host ' + k);
  await loginAs(p, 'khach2@datsan.local');
  for (const k of Object.keys(SL)) must((await attempt(`a=>a.joinMatch(${M[k].id})`)).ok, 'vào kèo ' + k);
  await loginAs(p, OWNER);
  for (const k of Object.keys(SL)) must((await attempt(`a=>a.owner.confirmMatchPart(${M[k].id},'guest','')`)).ok, 'nhận phần guest ' + k);
  const early = await (async () => { await loginAs(p, 'khach1@datsan.local'); return attempt(`a=>a.reportMatchResult(${M.m1.id},'host')`); })();
  must(!early.ok && early.status === 409, 'báo kết quả trước giờ đá phải bị chặn: ' + JSON.stringify(early));
  return Object.entries(M).map(([k, m]) => `${k}#${m.id} ${m.price}`).join(' ');
}, { shot: false });

// Tua đồng hồ qua giờ kết thúc của kèo cuối (21:00) + 1 phút.
await step(p, 'stake', '03-played-awaiting-report', async () => {
  const now = await mockNow(p);
  const mins = Math.ceil((VN(`${D} 21:00:00`) - VN(now)) / 60000) + 1;
  await api(p, `a=>a.proto.advanceClock(${mins})`);
  const r = await attempt(`a=>a.match(${M.m1.id})`); M.m1 = r.r;
  must(M.m1.result?.status === 'awaiting', 'chưa sang bước báo kết quả: ' + JSON.stringify(M.m1.result));
  await loginAs(p, 'khach1@datsan.local'); await p.goto(`${U}/match?id=${M.m1.id}`); await p.waitForSelector('#result-form');
  await shot('report-empty');
  return 'hạn báo ' + M.m1.result.reportBy;
}, { shot: false });

await step(p, 'stake', '04-m1-7-3-host-wins-by-agreement-ui', async () => {
  // Đội mở kèo (khach1) báo mình thắng + nhập tài khoản; chưa khớp thì chưa chốt.
  await p.click('[data-report="mine"]');
  await p.selectOption('#rb-bin', BANK.bin); await p.fill('#rb-acc', BANK.account); await p.fill('#rb-name', BANK.accountName);
  await p.click('#report-send'); await p.waitForFunction(() => /Bạn đã báo/.test(document.body.innerText));
  const mid = (await attempt(`a=>a.match(${M.m1.id})`)).r; must(mid.result.status === 'awaiting' && mid.result.yourReport === 'host', 'chưa khớp mà đã chốt');
  await shot('report-sent');
  // Đội vào kèo (khach2) chưa thấy tài khoản của đội kia; báo "Đội kia thắng" → khớp.
  await loginAs(p, 'khach2@datsan.local');
  const g = (await attempt(`a=>a.match(${M.m1.id})`)).r; must(JSON.stringify(g).indexOf(BANK.account) === -1, 'đội kia thấy số tài khoản trước khi chốt');
  must(g.result.otherReported === true && g.result.yourReport === null, 'otherReported');
  await p.goto(`${U}/match?id=${M.m1.id}`); await p.waitForSelector('#result-form');
  await p.click('[data-report="other"]'); await p.click('#report-send');
  await p.waitForSelector('.qr-card'); const t = (await p.locator('#root').innerText()).replace(/\s+/g, ' ');
  const m = (await attempt(`a=>a.match(${M.m1.id})`)).r; M.m1 = m;
  const want = loserShare(m) - m.guestAmount;
  must(m.result.status === 'settled' && m.result.winner === 'host' && m.result.settledBy === 'agree', 'chưa chốt: ' + JSON.stringify(m.result));
  must(m.result.topUp.from === 'guest' && m.result.topUp.amount === want && m.result.topUp.status === 'unpaid', 'tiền chênh ' + m.result.topUp.amount + ' ≠ ' + want);
  must(m.loserAmount + m.winnerAmount === m.price, 'tổng hai phần ≠ giá sân');
  must(m.guestAmount + m.result.topUp.amount === m.loserAmount && m.hostAmount - m.result.topUp.amount * 0 === m.hostAmount && m.winnerAmount === m.price - m.loserAmount, 'cân tiền');
  must(/Đội thua trả thêm/.test(t) && /Chưa trả/.test(t), 'thiếu câu trả thêm/Chưa trả: ' + t.slice(0, 200));
  must(m.topUpQr && m.topUpQr.account === BANK.account && m.topUpQr.amount === want && m.topUpQr.url.includes(`${BANK.bin}-${BANK.account}`), 'QR không tới tài khoản đội thắng');
  await shot('topup-loser');
  return `giá ${m.price}, thua chịu ${m.loserAmount}, đã trả ${m.guestAmount}, trả thêm ${want}`;
}, { shot: false });

await step(p, 'stake', '05-winner-presses-received', async () => {
  await loginAs(p, 'khach1@datsan.local'); await p.goto(`${U}/match?id=${M.m1.id}`); await p.waitForSelector('#topup-ok');
  const t0 = (await p.locator('#root').innerText()).replace(/\s+/g, ' '); must(/Chưa trả/.test(t0), 'đội thắng chưa thấy Chưa trả');
  await shot('topup-winner');
  const wrong = await (async () => { await loginAs(p, 'khach2@datsan.local'); return attempt(`a=>a.matchTopUpReceived(${M.m1.id})`); })();
  must(!wrong.ok && wrong.status === 403, 'đội thua bấm được Đã nhận');
  await loginAs(p, 'khach1@datsan.local'); await p.goto(`${U}/match?id=${M.m1.id}`); await p.click('#topup-ok');
  // Chờ toast thành công: nhãn nút "Đã nhận …" có sẵn trước khi bấm nên không dùng để chờ được.
  await p.waitForFunction(() => [...document.querySelectorAll('.toast:not(.error)')].some((t) => /Đã ghi nhận đã nhận tiền/.test(t.textContent)));
  const m = (await attempt(`a=>a.match(${M.m1.id})`)).r; must(m.result.topUp.status === 'received', 'status');
  await loginAs(p, 'khach2@datsan.local'); const g = (await attempt(`a=>a.match(${M.m1.id})`)).r; must(g.topUpQr == null, 'QR vẫn hiện sau khi đã nhận');
  return 'Đã nhận ' + m.result.topUp.amount;
}, { shot: false });

await step(p, 'stake', '06-m2-lose-all-guest-wins', async () => {
  await loginAs(p, 'khach1@datsan.local'); must((await attempt(`a=>a.reportMatchResult(${M.m2.id},'guest')`)).ok, 'host báo');
  await loginAs(p, 'khach2@datsan.local'); const r = await attempt(`a=>a.reportMatchResult(${M.m2.id},'guest',${JSON.stringify(BANK)})`); must(r.ok, r.msg);
  const m = r.r; must(m.result.status === 'settled' && m.result.winner === 'guest', 'chưa chốt');
  must(m.loserAmount === m.price && m.winnerAmount === 0, 'thua bao sân: thua chịu cả sân');
  must(m.result.topUp.from === 'host' && m.result.topUp.amount === m.price - m.hostAmount, `trả thêm ${m.result.topUp.amount} ≠ ${m.price - m.hostAmount}`);
  return `giá ${m.price}, host đã trả ${m.hostAmount}, trả thêm ${m.result.topUp.amount}`;
}, { shot: false });

await step(p, 'stake', '07-m3-draw-no-top-up', async () => {
  await loginAs(p, 'khach1@datsan.local'); await attempt(`a=>a.reportMatchResult(${M.m3.id},'draw')`);
  await loginAs(p, 'khach2@datsan.local'); const r = await attempt(`a=>a.reportMatchResult(${M.m3.id},'draw')`); must(r.ok, r.msg);
  const m = r.r; must(m.result.status === 'settled' && m.result.winner === 'draw' && m.result.topUp === null, 'hòa mà có trả thêm');
  await p.goto(`${U}/match?id=${M.m3.id}`); await p.waitForFunction(() => /Không ai trả thêm/.test(document.body.innerText)); return 'hòa, không ai trả thêm';
}, { shot: false });

await step(p, 'stake', '08-m4-mismatch-owner-settles-ui', async () => {
  await loginAs(p, 'khach1@datsan.local'); must((await attempt(`a=>a.reportMatchResult(${M.m4.id},'host')`)).ok, 'host báo');
  await loginAs(p, 'khach2@datsan.local'); const r = await attempt(`a=>a.reportMatchResult(${M.m4.id},'guest')`); must(r.ok, r.msg);
  must(r.r.result.status === 'needs_owner' && r.r.result.winner === null, 'báo lệch mà không chuyển cho chủ sân: ' + r.r.result.status);
  const again = await attempt(`a=>a.reportMatchResult(${M.m4.id},'draw')`); must(!again.ok && again.status === 409, 'còn báo lại được sau khi chuyển cho chủ sân');
  const noOwner = await attempt(`a=>a.owner.settleMatchResult(${M.m4.id},'host')`); must(!noOwner.ok && noOwner.status === 403, 'khách chốt được kết quả');
  await loginAs(p, 'chusan2@datsan.local'); const other = await attempt(`a=>a.owner.settleMatchResult(${M.m4.id},'host')`); must(!other.ok && other.status === 403, 'chủ sân khác chốt được');
  await loginAs(p, OWNER); await p.goto(`${U}/owner-bookings`); await p.waitForSelector('#venue'); await p.selectOption('#venue', '3');
  await p.waitForSelector(`[data-mt-settle="${M.m4.id}"]`); await shot('owner-matches');
  await p.click(`[data-mt-settle="${M.m4.id}"]`); await p.waitForSelector('dialog[open] input[name=winner]');
  await p.waitForTimeout(400); await p.locator('dialog[open]').screenshot({ path: `e2e/out/stake-owner-settle-${W}.png` });
  await p.check('dialog[open] input[name=winner][value=guest]'); await p.click('dialog[open] button[type=submit]');
  // Hộp thoại đóng trước khi gọi API; chờ toast thành công mới đọc lại trận.
  await p.waitForFunction(() => !document.querySelector('dialog[open]') && [...document.querySelectorAll('.toast:not(.error)')].some((t) => /Đã chốt kết quả/.test(t.textContent)));
  const m = (await attempt(`a=>a.match(${M.m4.id})`)).r;
  must(m.result.status === 'settled' && m.result.winner === 'guest' && m.result.settledBy === 'owner', 'chủ sân chưa chốt: ' + JSON.stringify(m.result));
  must(m.result.topUp.from === 'host' && m.result.topUp.amount === loserShare(m) - m.hostAmount, 'tiền chênh sau chủ sân chốt');
  return `chủ sân chốt guest thắng, trả thêm ${m.result.topUp.amount}`;
}, { shot: false });

await step(p, 'stake', '09-m5-nobody-reports-past-deadline-owner-settles', async () => {
  await loginAs(p, 'khach1@datsan.local'); must((await attempt(`a=>a.reportMatchResult(${M.m5.id},'host')`)).ok, 'một bên báo');
  const before = (await attempt(`a=>a.match(${M.m5.id})`)).r; must(before.result.status === 'awaiting', 'status trước hạn ' + before.result.status);
  await loginAs(p, OWNER); const early = await attempt(`a=>a.owner.settleMatchResult(${M.m5.id},'host')`); must(!early.ok && early.status === 409, 'chủ sân chốt trước hạn khi hai đội chưa lệch');
  await api(p, 'a=>a.proto.advanceClock(2880)');
  await loginAs(p, 'khach2@datsan.local'); const late = await attempt(`a=>a.reportMatchResult(${M.m5.id},'host')`); must(!late.ok && late.status === 409, 'còn báo được sau hạn');
  const g = (await attempt(`a=>a.match(${M.m5.id})`)).r; must(g.result.status === 'needs_owner', 'quá hạn chưa chuyển cho chủ sân: ' + g.result.status);
  await loginAs(p, OWNER); const r = await attempt(`a=>a.owner.settleMatchResult(${M.m5.id},'draw')`); must(r.ok, r.msg);
  must(r.r.result.status === 'settled' && r.r.result.winner === 'draw' && r.r.result.topUp === null, 'chốt hòa');
  const m1 = (await attempt(`a=>a.match(${M.m1.id})`)).r; must(m1.result.topUp.status === 'received', 'kèo cũ giữ trạng thái');
  return 'quá hạn → chủ sân chốt hòa';
}, { shot: false });

await step(p, 'stake', '10-outsider-cannot-report-or-see-bank', async () => {
  await loginAs(p, 'khach3@datsan.local');
  for (const k of ['m1', 'm2', 'm4']) {
    const r = await attempt(`a=>a.reportMatchResult(${M[k].id},'draw')`); must(!r.ok && r.status === 403, `người ngoài báo được ${k}: ` + JSON.stringify(r));
    const t = await attempt(`a=>a.matchTopUpReceived(${M[k].id})`); must(!t.ok && [403, 409].includes(t.status), `người ngoài bấm Đã nhận ${k}`);
    const bk = await attempt(`a=>a.setMatchBank(${M[k].id},${JSON.stringify(BANK)})`); must(!bk.ok && bk.status === 403, `người ngoài nhập tài khoản ${k}`);
    const j = JSON.stringify((await attempt(`a=>a.match(${M[k].id})`)).r); must(!j.includes(BANK.account) && !j.includes(BANK.accountName) && !j.includes('topUpQr') && !j.includes('yourBank'), `người ngoài thấy tài khoản ${k}`);
  }
  await loginAs(p, OWNER); const oj = JSON.stringify((await attempt(`a=>a.owner.matches()`)).r); must(!oj.includes(BANK.account) && !oj.includes('topUpQr'), 'chủ sân thấy số tài khoản các đội');
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout().catch(() => {}); });
  const anon = await attempt(`a=>a.match(${M.m1.id})`); const aj = JSON.stringify(anon.r || {}); must(!aj.includes(BANK.account), 'ẩn danh');
  must(!aj.includes(BANK.account), 'ẩn danh thấy tài khoản');
  return 'người ngoài: 403 khi báo/nhập tài khoản/Đã nhận, JSON không chứa số tài khoản';
}, { shot: false });

await step(p, 'stake', '11-demo-data-visible', async () => {
  await p.goto(U + '/'); await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });
  await loginAs(p, 'khachnen05@datsan.local'); const a = (await attempt('a=>a.myMatches()')).r.find((m) => m.result?.status === 'awaiting'); must(a, 'khachnen05 không thấy kèo chờ báo kết quả');
  await p.goto(`${U}/match?id=${a.id}`); await p.waitForSelector('#result-form'); await shot('demo-awaiting');
  await loginAs(p, 'khachnen08@datsan.local'); const s = (await attempt('a=>a.myMatches()')).r.find((m) => m.result?.status === 'settled' && m.result.topUp?.status === 'unpaid'); must(s, 'khachnen08 không thấy kèo đã chốt');
  await loginAs(p, 'khachnen11@datsan.local'); const l = (await attempt('a=>a.myMatches()')).r.find((m) => m.result?.topUp?.status === 'unpaid'); must(l && l.topUpQr, 'khachnen11 (đội thua) không có QR trả chênh');
  await p.goto(`${U}/match?id=${l.id}`); await p.waitForSelector('.qr-card'); await shot('demo-settled');
  await loginAs(p, OWNER); const om = (await attempt('a=>a.owner.matches()')).r; must(om.some((m) => m.result), 'chủ sân không thấy kèo có kết quả');
  return `chờ báo #${a.id}, đã chốt #${s.id}, trả thêm ${l.result.topUp.amount}`;
}, { shot: false });
console.log(logs.length ? 'console: ' + logs.join(' | ') : 'console: sạch'); save(); await b.close();
