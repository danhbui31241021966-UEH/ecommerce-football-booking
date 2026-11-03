// Chủ sân thêm lịch đặt cho khách gọi điện/Zalo.
import { start, step, save, loginAs, api, U, W, logs, anchor, mockNow, dayPlus } from './lib.mjs';
const { b, p } = await start();
const attempt = (expr) => p.evaluate(`(async()=>{const {api}=await import('/js/api.js');try{const r=await (${expr})(api);return {ok:true,r}}catch(e){return {ok:false,status:e.status,msg:e.message}}})()`);
const must = (c, m) => { if (!c) throw new Error(m); };
const ev = (fn, arg) => p.evaluate(fn, arg);
const OWNER = 'chusan1@datsan.local';
const shot = (n, full = false) => p.screenshot({ path: `e2e/out/phone-${n}-${W}.png`, fullPage: full });
await p.goto(U + '/'); await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });
const DEMO_DAY = (await mockNow(p)).slice(0, 10);
let TODAY = DEMO_DAY, D;
const sched = async (d, v = 1) => ev(async ([dd, vv]) => (await import('/js/api.js')).api.schedule(vv, dd), [d, v]);
const slotOf = async (d, court, s, v = 1) => (await sched(d, v)).courts.find((c) => c.id === court).slots.find((x) => x.start === s);
const S1 = '13:00', S2 = '14:00', S3 = '15:00';
let B1;
const ownerSlotBtn = (court, s) => `.sc[data-court="${court}"][data-start="${s}"]`;
const openGrid = async (d = D) => { await loginAs(p, OWNER); await p.goto(`${U}/owner-schedule?date=${d}`); await p.waitForSelector('.sched-grid .sc'); };

await step(p, 'phone', '01-demo-phone-bookings-and-overview-button', async () => {
  await loginAs(p, OWNER);
  const list = (await attempt('a=>a.owner.bookings({venueId:1})')).r.filter((x) => x.source === 'phone');
  must(list.length >= 2 && list.every((x) => x.status === 'confirmed' && x.startAt.slice(0, 10) === list[0].startAt.slice(0, 10) && [DEMO_DAY, dayPlus(DEMO_DAY, 1)].includes(x.startAt.slice(0, 10))), 'demo: ' + JSON.stringify(list.map((x) => [x.customerName, x.startAt, x.source])));
  { const nowTs = await mockNow(p); must(list.length === 2 && list.every((x) => x.startAt > nowTs), 'cần đúng 2 lịch điện thoại chưa bắt đầu, now=' + nowTs + ' ' + JSON.stringify(list.map((x) => x.startAt))); }
  must(list.some((x) => x.paymentStatus === 'paid') && list.some((x) => x.paymentStatus === 'unpaid'), 'thiếu một lịch đã nhận tiền và một lịch chưa');
  await p.goto(`${U}/owner`); await p.waitForSelector('#add-booking'); await p.waitForSelector('.bk');
  const box = await p.locator('#add-booking').boundingBox(); const vh = p.viewportSize().height;
  must(box && box.y >= 0 && box.y + box.height <= vh, `nút + Thêm lịch đặt không nằm trong màn hình đầu: y=${box?.y} h=${box?.height} vh=${vh}`);
  const t = (await p.locator('#content').innerText()).replace(/\s+/g, ' ');
  must(/Đặt qua điện thoại/.test(t) && /Anh Tùng/.test(t) && /Chị Lan/.test(t), 'màn chủ sân không hiện đủ hai lịch điện thoại mẫu (hôm nay hoặc mục ngày mai)');
  await shot('overview');
  await p.goto(`${U}/owner-bookings?date=${list[0].startAt.slice(0, 10)}`); await p.waitForSelector('.bk');
  const lt = (await p.locator('#content').innerText()).replace(/\s+/g, ' '); must(/Đặt qua điện thoại/.test(lt) && /Anh Tùng/.test(lt) && /Chị Lan/.test(lt), 'danh sách chủ sân thiếu nhãn'); await shot('list', true);
  await p.goto(`${U}/owner`); await p.waitForSelector('#add-booking');
  await p.click('#add-booking'); await p.waitForSelector('dialog[open] #pb-name');
  must((await p.inputValue('#pb-date')) === TODAY, 'ngày mặc định ≠ hôm nay'); must((await p.inputValue('#pb-start')) === '', 'đã chọn sẵn giờ');
  await p.waitForFunction(() => document.querySelectorAll('#pb-start option').length > 5);
  await p.keyboard.press('Escape');
  return `${list.length} lịch điện thoại hôm nay; nút ở y=${Math.round(box.y)}`;
}, { shot: false });

{ const now = await anchor(p, '08:00'); TODAY = (typeof now === 'string' ? now : await mockNow(p)).slice(0, 10); TODAY = (await mockNow(p)).slice(0, 10); D = dayPlus(TODAY, 1);
  for (const s of [S1, S2, S3]) must((await slotOf(D, 1, s)).status === 'available', `${s} sân 1 không trống`); }
await step(p, 'phone', '02-owner-adds-via-grid', async () => {
  const k1 = await attempt('a=>a.notifications()'); // chưa đăng nhập khách: bỏ qua
  await loginAs(p, 'khach1@datsan.local'); const n1 = (await attempt('a=>a.notifications()')).r.length;
  await loginAs(p, 'khach2@datsan.local'); const n2 = (await attempt('a=>a.notifications()')).r.length;
  await openGrid();
  await p.click(ownerSlotBtn(1, S1)); await p.waitForSelector('dialog[open] .choice-btn');
  { const a = await p.locator('dialog[open] [data-kind=booking]').boundingBox(), c = await p.locator('dialog[open] [data-kind=block]').boundingBox(); must(await p.locator('dialog[open] [data-kind=booking].primary').count() === 1 && a.height > c.height, 'Khách đặt phải nổi hơn Chặn giờ'); }
  const t0 = await p.locator('dialog[open]').innerText(); must(/Khách đặt \(điện thoại\/Zalo\)/.test(t0) && /Chặn giờ \(sửa sân, sự kiện\)/.test(t0), 'thiếu hai lựa chọn');
  await p.locator('dialog[open]').screenshot({ path: `e2e/out/phone-choice-${W}.png` });
  await p.click('dialog[open] [data-kind=booking]'); await p.waitForSelector('dialog[open] #pb-name');
  await p.waitForFunction(() => document.querySelector('#pb-start').value);
  must((await p.inputValue('#pb-start')) === S1 && (await p.inputValue('#pb-court')) === '1' && (await p.inputValue('#pb-date')) === D, 'form không điền sẵn từ ô đã bấm');
  const base = (await slotOf(D, 1, S1)).basePrice; must(Number(await p.inputValue('#pb-price')) === base, 'giá mặc định ≠ giá thường');
  await p.click('dialog[open] [data-save]'); await p.waitForFunction(() => /tên khách/i.test(document.querySelector('dialog[open] .form-error')?.textContent || ''));
  must((await ev(async () => (await import('/js/api.js')).api.owner.bookings({ venueId: 1 }))).filter((x) => x.customerName === 'Cô Hạnh').length === 0, 'tạo lịch khi chưa nhập tên');
  await p.fill('#pb-name', 'Cô Hạnh'); await p.fill('#pb-phone', '0912 345 678'); await p.fill('#pb-note', 'Gọi điện, đá lúc 13h');
  await p.waitForTimeout(150); await p.locator('dialog[open]').evaluate((d) => d.scrollTo(0, 0)); await shot('form');
  await p.click('dialog[open] [data-save]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  await p.waitForSelector(`${ownerSlotBtn(1, S1)}.sc-booked`);
  const cell = (await p.locator(ownerSlotBtn(1, S1)).innerText()).replace(/\s+/g, ' '); must(/Đặt qua điện thoại/.test(cell) && /Cô Hạnh/.test(cell) && /chưa nhận tiền/.test(cell), 'ô lưới: ' + cell);
  await shot('grid', true);
  B1 = (await attempt('a=>a.owner.bookings({venueId:1,date:"' + D + '"})')).r.find((x) => x.customerName === 'Cô Hạnh');
  must(B1 && B1.source === 'phone' && B1.status === 'confirmed' && B1.paymentStatus === 'unpaid' && B1.price === base && B1.startAt === `${D} ${S1}:00`, 'booking: ' + JSON.stringify(B1));
  await loginAs(p, 'khach1@datsan.local'); const m1 = (await attempt('a=>a.notifications()')).r.length; await loginAs(p, 'khach2@datsan.local'); const m2 = (await attempt('a=>a.notifications()')).r.length;
  must(m1 === n1 && m2 === n2, 'khách bị gửi thông báo');
  const rel = (await attempt('a=>a.myReliability()')).r; must(rel.violations === 0, 'uy tín bị ảnh hưởng');
  return `#${B1.id} ${B1.code} ${B1.customerName} giá ${B1.price}`;
}, { shot: false });

await step(p, 'phone', '03-customer-sees-booked-and-cannot-double-book', async () => {
  await loginAs(p, 'khach1@datsan.local');
  must((await slotOf(D, 1, S1)).status === 'booked', 'khách thấy giờ chưa đặt');
  const r = await attempt(`a=>a.createBooking({courtId:1,date:'${D}',start:'${S1}'})`); must(!r.ok && r.status === 409, 'khách đặt trùng được: ' + JSON.stringify(r));
  await p.goto(`${U}/venue?id=1&date=${D}`); await p.waitForSelector('#grid .slot', { state: 'attached' });
  must(await p.locator('#grid .slot-booked').count() > 0 && (await p.locator(`#grid [data-pick][data-start="${S1}"][data-court="1"]`).count()) === 0, 'ô đã đặt vẫn bấm được trên trang sân');
  const mine = (await attempt('a=>a.myBookings()')).r; must(!mine.some((x) => x.code === B1.code), 'lịch điện thoại lọt vào Lịch đặt của khách');
  const bk = await attempt(`a=>a.booking(${B1.id})`); must(!bk.ok && [403, 404].includes(bk.status), 'khách xem được lịch của người khác');
  return 'booked, đặt trùng 409';
}, { shot: false });

await step(p, 'phone', '04-owner-marks-paid-and-edits', async () => {
  await openGrid(); await p.click(ownerSlotBtn(1, S1)); await p.waitForSelector('dialog[open] [data-act=paid]');
  const t = (await p.locator('dialog[open]').innerText()).replace(/\s+/g, ' '); must(/Đặt qua điện thoại/.test(t) && !/Khách mới/.test(t), 'hộp lịch: ' + t.slice(0, 200));
  await p.locator('dialog[open]').screenshot({ path: `e2e/out/phone-detail-${W}.png` });
  // Sửa trước khi nhận tiền: đổi giá + tên.
  await p.click('dialog[open] [data-act=edit]'); await p.waitForSelector('dialog[open] #pe-name');
  await p.fill('#pe-name', 'Cô Hạnh (Zalo)'); await p.fill('#pe-price', '250000'); await p.click('dialog[open] [data-save]'); await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  let cur = (await attempt(`a=>a.owner.bookings({venueId:1,date:'${D}'})`)).r.find((x) => x.id === B1.id); must(cur.customerName === 'Cô Hạnh (Zalo)' && cur.price === 250000, 'sửa chưa lưu: ' + JSON.stringify([cur.customerName, cur.price]));
  const row = await attempt(`a=>a.owner.updateBooking(${B1.id},{customerName:'X',startAt:'${D} 20:00:00',courtId:2})`); cur = (await attempt(`a=>a.owner.bookings({venueId:1,date:'${D}'})`)).r.find((x) => x.id === B1.id); must(cur.startAt === `${D} ${S1}:00` && cur.courtId === 1, 'giờ/sân bị đổi');
  await p.goto(`${U}/owner-schedule?date=${D}`); await p.waitForSelector(ownerSlotBtn(1, S1)); await p.click(ownerSlotBtn(1, S1)); await p.waitForSelector('dialog[open] [data-act=paid]');
  await p.click('dialog[open] [data-act=paid]'); await p.waitForSelector('dialog[open] #f-note'); await p.click('dialog[open] button[type=submit]');
  await p.waitForFunction(() => !document.querySelector('dialog[open]')); await p.waitForTimeout(300);
  cur = (await attempt(`a=>a.owner.bookings({venueId:1,date:'${D}'})`)).r.find((x) => x.id === B1.id); must(cur.paymentStatus === 'paid', 'chưa ghi nhận tiền');
  const lock = await attempt(`a=>a.owner.updateBooking(${B1.id},{price:300000})`); must(!lock.ok && lock.status === 409, 'đổi giá được sau khi đã nhận tiền');
  const bad = await attempt(`a=>a.owner.updateBooking(${B1.id},{customerPhone:'abc'})`); must(!bad.ok && bad.status === 400, 'SĐT sai vẫn lưu');
  const ud = (await attempt(`a=>a.booking(${B1.id})`)); 
  return 'sửa tên/giá, đã nhận tiền, khóa giá sau khi nhận';
}, { shot: false });

await step(p, 'phone', '05-owner-cancels-slot-free-customer-can-book', async () => {
  await loginAs(p, OWNER); await p.goto(`${U}/owner-schedule?date=${D}`); await p.waitForSelector(ownerSlotBtn(1, S1)); await p.click(ownerSlotBtn(1, S1)); await p.waitForSelector('dialog[open] [data-act=cancel]');
  await p.click('dialog[open] [data-act=cancel]'); await p.waitForSelector('dialog[open] #f-note');
  const t = (await p.locator('dialog[open]').last().innerText()).replace(/\s+/g, ' '); must(/không ghi trả lại tiền/.test(t) && /tự trả lại cho khách ngoài web/.test(t), 'câu hủy: ' + t.slice(0, 250));
  await p.click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]')); await p.waitForTimeout(300);
  const cur = (await attempt(`a=>a.owner.bookings({venueId:1,date:'${D}'})`)).r.find((x) => x.id === B1.id);
  must(cur.status === 'cancelled' && cur.refundStatus === 'none' && cur.refundAmount === 0, 'hủy: ' + JSON.stringify([cur.status, cur.refundStatus, cur.refundAmount]));
  must(!(await attempt('a=>a.owner.bookings({venueId:1,status:"cancelled"})')).r.some((x) => x.refundStatus === 'pending' && x.id === B1.id), 'có khoản chờ trả lại');
  await loginAs(p, 'khach1@datsan.local'); must((await slotOf(D, 1, S1)).status === 'available', 'giờ chưa trống lại');
  const r = await attempt(`a=>a.createBooking({courtId:1,date:'${D}',start:'${S1}'})`); must(r.ok, 'khách chưa đặt được: ' + r.msg);
  await attempt(`a=>a.cancelBooking(${r.r.id},'đổi ý')`);
  return 'hủy → giờ trống, không có khoản trả lại, khách đặt được';
}, { shot: false });

await step(p, 'phone', '06-access-and-rule-errors', async () => {
  const body = (court, d, s, extra = '') => `a=>a.owner.addBooking({courtId:${court},date:'${d}',start:'${s}',customerName:'Khách thử'${extra}})`;
  await loginAs(p, 'chusan2@datsan.local'); let r = await attempt(body(1, D, S2)); must(!r.ok && r.status === 403, 'chủ sân khác thêm được: ' + JSON.stringify(r));
  await loginAs(p, 'khach1@datsan.local'); r = await attempt(body(1, D, S2)); must(!r.ok && r.status === 403, 'khách thêm được: ' + JSON.stringify(r));
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout().catch(() => {}); }); r = await attempt(body(1, D, S2)); must(!r.ok && r.status === 401, 'chưa đăng nhập thêm được');
  await loginAs(p, 'admin@datsan.local'); r = await attempt(body(1, D, S2)); must(!r.ok && r.status === 403, 'admin thêm được');
  await loginAs(p, OWNER);
  r = await attempt(body(1, TODAY, '06:00')); must(!r.ok && r.status === 400 && /đã qua/.test(r.msg), 'giờ đã qua: ' + JSON.stringify(r));
  r = await attempt(body(6, D, '19:00')); must(!r.ok && r.status === 409 && /ghép kèo/i.test(r.msg), 'giờ ghép kèo: ' + JSON.stringify(r));
  r = await attempt(`a=>a.owner.addBooking({courtId:1,date:'${D}',start:'${S2}',customerName:'   '})`); must(!r.ok && r.status === 400, 'tên trống');
  r = await attempt(body(1, D, S2, ",customerPhone:'12'")); must(!r.ok && r.status === 400, 'SĐT sai');
  r = await attempt(body(1, D, S2, ',price:-5')); must(!r.ok && r.status === 400, 'giá âm');
  r = await attempt(body(1, D, S2)); must(r.ok && r.r.price > 0 && r.r.paymentStatus === 'unpaid', 'tạo hợp lệ (giá mặc định, chưa nhận tiền)'); const id2 = r.r.id;
  r = await attempt(body(1, D, S2)); must(!r.ok && r.status === 409 && /đã có lịch/.test(r.msg), 'trùng lịch của chính chủ sân: ' + JSON.stringify(r));
  r = await attempt(`a=>a.owner.block({courtId:1,date:'${D}',start:'${S2}',end:'15:00',reason:'x'})`); must(!r.ok && r.status === 409, 'chặn giờ đã có lịch');
  // giờ đang chặn
  r = await attempt(`a=>a.owner.block({courtId:1,date:'${D}',start:'16:00',end:'17:00',reason:'sửa đèn'})`); must(r.ok, 'chặn');
  const bk = r.r.id; r = await attempt(body(1, D, '16:00')); must(!r.ok && r.status === 409 && /chặn/.test(r.msg), 'giờ đang chặn: ' + JSON.stringify(r)); await attempt(`a=>a.owner.unblock(${bk})`);
  // giờ đang giữ cho người chờ
  await loginAs(p, 'khach2@datsan.local'); r = await attempt(`a=>a.createBooking({courtId:2,date:'${D}',start:'${S3}'})`); must(r.ok, 'khach2 đặt'); const bid = r.r.id;
  await loginAs(p, 'khach1@datsan.local'); r = await attempt(`a=>a.joinWaitlist({courtId:2,date:'${D}',start:'${S3}'})`); must(r.ok, 'xếp hàng chờ: ' + r.msg);
  await loginAs(p, 'khach2@datsan.local'); await attempt(`a=>a.cancelBooking(${bid},'đổi ý')`);
  await loginAs(p, OWNER); const st = await slotOf(D, 2, S3); must(st.status === 'offered', 'giờ chưa sang giữ cho người chờ: ' + st.status);
  r = await attempt(body(2, D, S3)); must(!r.ok && r.status === 409 && /người đã đăng ký chờ/.test(r.msg), 'giờ giữ cho người chờ: ' + JSON.stringify(r));
  return 'quyền + 9 lỗi có câu rõ; giờ đã đặt/chặn/ghép kèo/giữ cho người chờ/đã qua đều bị chặn';
}, { shot: false });

await step(p, 'phone', '07-block-still-works-via-new-dialog', async () => {
  await openGrid(); await p.click(ownerSlotBtn(1, '17:00')); await p.waitForSelector('dialog[open] .choice-btn');
  await p.click('dialog[open] [data-kind=block]'); await p.waitForSelector('dialog[open] #f-reason');
  await p.fill('#f-reason', 'Sửa đèn sân'); await p.screenshot({ path: `e2e/out/phone-block-${W}.png` });
  await p.click('dialog[open] button[type=submit]'); await p.waitForFunction(() => !document.querySelector('dialog[open]')); await p.waitForSelector(`${ownerSlotBtn(1, '17:00')}.sc-blocked`);
  await loginAs(p, 'khach1@datsan.local'); must((await slotOf(D, 1, '17:00')).status === 'blocked', 'khách không thấy giờ bị chặn');
  const r = await attempt(`a=>a.createBooking({courtId:1,date:'${D}',start:'17:00'})`); must(!r.ok && r.status === 409, 'khách đặt được giờ chặn');
  await openGrid(); await p.click(ownerSlotBtn(1, '17:00')); await p.waitForSelector('dialog[open]'); must(/Bỏ chặn/.test(await p.locator('dialog[open]').innerText()), 'bỏ chặn không còn'); await p.keyboard.press('Escape');
  return 'chặn → khách không đặt được; bỏ chặn vẫn mở';
}, { shot: false });

await step(p, 'phone', '08-admin-and-lists-show-phone-label', async () => {
  await loginAs(p, 'admin@datsan.local'); const ad = (await attempt("a=>a.admin.bookings({q:'Anh Tùng'})")).r.filter((x) => x.source === 'phone');
  must(ad.length >= 1 && ad.every((x) => x.customerName), 'admin không thấy lịch điện thoại: ' + ad.length);
  await p.goto(`${U}/admin-bookings`); await p.fill('#booking-search', 'Anh Tùng'); await p.click('#booking-filter'); await p.waitForSelector('.admin-record'); must(/Đặt qua điện thoại/.test(await p.locator('#booking-list').innerText()), 'admin list thiếu nhãn');
  const logsA = (await attempt('a=>a.admin.logs({})')).r; must(JSON.stringify(logsA).includes('phone_create'), 'nhật ký thiếu phone_create');
  return `admin thấy ${ad.length} lịch điện thoại`;
}, { shot: false });
console.log(logs.length ? 'console: ' + logs.join(' | ') : 'console: sạch'); save(); await b.close();
