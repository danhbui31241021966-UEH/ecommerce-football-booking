// Smoke trên link công khai (chế độ thật, không có api.proto): đăng nhập bằng form → đặt một ô cách bây giờ hơn 24 giờ → kiểm đơn → hủy (hoàn 100%) → đăng xuất.
// Chỉ dùng giao diện như người dùng (api.* chỉ để ĐỌC dữ liệu có cấu trúc: giờ và trạng thái ô). Đơn nào đã tạo thì luôn được hủy (finally); không hủy được thì in mã đơn kèm FAIL.
// Chạy được cả trên mock. Tài khoản: khách demo trong seed (mật khẩu seed nằm trong lib.mjs).
import { start, step, save, loginAs, api, U, W, logs, dayPlus } from './lib.mjs';
const { b, p } = await start();
const must = (c, m) => { if (!c) throw new Error(m); };
const EMAIL = 'khach1@datsan.local';
const MIN_AHEAD_MS = 24 * 3600000 + 10 * 60000; // hơn 24 giờ: hủy được hoàn đủ, không tính hủy sát giờ
const VN = (s) => Date.parse(s.replace(' ', 'T') + '+07:00');
const STATUS_TEXT = { confirmed: 'Đã có sân', pending: 'Chờ chủ sân đồng ý' };
let code = null, url = null, cancelled = false;

// Ô còn trống, cách bây giờ hơn 24 giờ, ở sân không cần chủ sân duyệt (ưu tiên). Chọn ngẫu nhiên để các lần chạy không tranh một ô.
async function candidates() {
  const meta = await api(p, 'a=>a.meta()');
  const nowMs = VN(meta.now);
  const out = [];
  const venues = (await api(p, 'a=>a.venues({})')).venues.slice(0, 12);
  for (let d = 1; d <= (meta.bookingWindowDays || 3); d++) {
    const date = dayPlus(meta.now.slice(0, 10), d);
    for (const v of venues) {
      const sc = await p.evaluate(async ([id, dt]) => (await import('/js/api.js')).api.schedule(id, dt), [v.id, date]);
      for (const c of sc.courts) for (const s of c.slots) {
        if (s.status === 'available' && VN(`${date} ${s.start}:00`) - nowMs >= MIN_AHEAD_MS) out.push({ venue: v.id, court: c.id, date, start: s.start, approval: !!v.requiresApproval });
      }
    }
  }
  const pool = out.filter((x) => !x.approval);
  const list = pool.length ? pool : out;
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

async function bookUI(slot) {
  await p.goto(`${U}/venue?id=${slot.venue}&date=${slot.date}&slot=${slot.start}&court=${slot.court}`);
  await p.locator('[data-pick][aria-pressed=true]:visible').first().waitFor({ timeout: 15000 });
  await p.click('#bar-book'); await p.waitForSelector('#confirm-dialog[open]'); await p.click('#do-book');
  await p.waitForURL(/\/booking(\.html)?(?=[?#]|$)/, { timeout: 15000 }); await p.waitForSelector('.booking-code');
  return (await p.locator('.booking-code').innerText()).trim();
}
async function cancelUI() {
  await p.goto(url); await p.waitForSelector('.booking-code');
  await p.click('#open-cancel'); await p.waitForSelector('#cancel-dialog[open]');
  const dlg = (await p.locator('#cancel-refund').innerText()).replace(/\s+/g, ' ');
  await p.click('#do-cancel'); await p.waitForSelector('.toast', { timeout: 15000 });
  return dlg;
}
const detail = (id) => p.evaluate(async (i) => (await import('/js/api.js')).api.booking(i), id);

try {
  await step(p, 'live', '01-login-form', async () => { await loginAs(p, EMAIL); const me = await p.evaluate(async () => (await (await import('/js/api.js')).api.me()).user); must(me && me.email === EMAIL, 'chưa đăng nhập: ' + JSON.stringify(me)); return `${me.email} (${me.role})`; }, { shot: false });
  let slot;
  await step(p, 'live', '02-book-slot-over-24h', async () => {
    const list = await candidates(); must(list.length, 'không có ô trống nào cách hơn 24 giờ');
    let lastErr;
    for (const s of list.slice(0, 5)) {
      try { code = await bookUI(s); slot = s; url = p.url(); break; } catch (e) { lastErr = e; }
    }
    must(code, 'không đặt được ô nào trong 5 ô thử: ' + (lastErr && lastErr.message));
    console.log(`INFO ma-don ${code} sân ${slot.venue} ${slot.date} ${slot.start}`);
    return `${code} · sân ${slot.venue} ${slot.date} ${slot.start}`;
  });
  await step(p, 'live', '03-booking-shows-expected-status', async () => {
    const d = await detail(Number(new URL(url).searchParams.get('id')));
    must(d.code === code, `mã đơn ${d.code} ≠ ${code}`);
    must(['confirmed', 'pending'].includes(d.status), 'trạng thái ' + d.status);
    must(d.paymentStatus === 'unpaid', 'thanh toán ' + d.paymentStatus);
    const badges = (await p.locator('.badge').allInnerTexts()).join(',');
    must(badges.includes(STATUS_TEXT[d.status]), `badge "${badges}" không khớp trạng thái ${d.status}`);
    return `${d.status} / ${d.paymentStatus} · ${badges}`;
  });
  await step(p, 'live', '04-cancel-full-refund', async () => {
    const dlg = await cancelUI();
    must(/100%/.test(dlg), 'hộp thoại hủy không báo hoàn 100%: ' + dlg);
    const d = await detail(Number(new URL(url).searchParams.get('id')));
    must(d.status === 'cancelled', 'trạng thái sau hủy: ' + d.status);
    must(d.refundPercent === 100, 'mức hoàn ' + d.refundPercent);
    cancelled = true;
    return `${code} đã hủy, hoàn ${d.refundPercent}%`;
  });
  await step(p, 'live', '05-logout', async () => {
    await p.goto(U + '/');
    await p.waitForSelector('.user-menu summary', { state: 'attached' });
    // Khổ nhỏ: nút menu mở danh sách có "Đăng xuất"; khổ lớn: bấm ảnh đại diện rồi "Đăng xuất" trong bảng tài khoản.
    if (await p.locator('.menu-btn:visible').count()) { await p.click('.menu-btn'); await p.locator('.mobile-logout').click(); }
    else { await p.click('.user-menu summary'); await p.locator('.user-menu [data-logout]').click(); }
    await p.waitForSelector('.site-header a[href*="login"]', { timeout: 15000 });
    const me = await p.evaluate(async () => (await (await import('/js/api.js')).api.me()).user);
    must(!me, 'vẫn đăng nhập sau khi đăng xuất');
    return 'đã đăng xuất';
  }, { shot: false });
} finally {
  if (code && !cancelled) {
    try {
      await loginAs(p, EMAIL);
      await step(p, 'live', '99-cleanup-cancel', async () => { await cancelUI(); const d = await detail(Number(new URL(url).searchParams.get('id'))); must(d.status === 'cancelled', 'trạng thái ' + d.status); cancelled = true; return `${code} đã hủy khi dọn`; }, { shot: false });
    } catch (e) { /* in FAIL bên dưới */ }
    if (!cancelled) console.log(`FAIL live cleanup ${code} CHƯA HỦY ĐƯỢC, cần hủy tay (${url})`);
  }
  console.log(code ? `INFO ma-don ${code} ${cancelled ? 'đã hủy' : 'CHƯA hủy'}` : 'INFO không có đơn nào được tạo');
  await b.close();
  save();
  console.log(logs.length ? 'LOGS:\n' + logs.join('\n') : 'no console errors');
}
