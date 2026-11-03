import assert from 'node:assert/strict';
import { start, step, save, api, U, W, logs, dayPlus } from './lib.mjs';
const { b, p } = await start();
const phone = `091${String(W).padStart(7, '0')}`;
// Bản live dùng URL không đuôi .html (Cloudflare đổi /owner.html thành /owner), bản máy giữ nguyên: so đường dẫn sau khi bỏ đuôi.
const pathOf = (u) => u.pathname.replace(/\.html$/, '');
await p.goto(U + '/login');
await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });
// Ngày mai theo đồng hồ của app: luôn nằm trong cửa sổ đặt và chưa qua giờ, chạy ngày nào cũng được.
const day = dayPlus((await api(p, 'a=>a.meta()')).now.slice(0, 10), 1);
const dayVn = `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
// Ô còn trống đầu tiên của Sân 1 ngày mai (dữ liệu mẫu có giải chặn một số giờ, nên không cố định 19:00).
const sc = await api(p, `a=>a.schedule(1,'${day}')`);
const court1 = sc.courts.find((c) => c.name === 'Sân 1');
const slotStart = court1.slots.find((s) => s.status === 'available').start;
const next = `/venue?id=1&date=${day}&slot=${encodeURIComponent(slotStart)}&court=${court1.id}&book=1`;
const nextQuery = `?next=${encodeURIComponent(next)}`;

await step(p, 'auth-intent', 'demo-role-shortcuts', async () => {
  const accounts = [
    { identifier: 'khach1@datsan.local', role: 'customer', path: '/' },
    { identifier: 'chusan1@datsan.local', role: 'owner', path: '/owner' },
    { identifier: 'admin@datsan.local', role: 'admin', path: '/admin' },
  ];
  for (const account of accounts) {
    await p.goto(U + '/login');
    assert.equal(await p.locator('#demo-accounts').isVisible(), true);
    assert.equal(await p.locator('#demo-accounts button').count(), 3);
    await Promise.all([
      p.waitForURL((url) => pathOf(url) === account.path),
      p.locator(`#demo-accounts button[data-identifier="${account.identifier}"]`).click(),
    ]);
    const me = await api(p, 'a=>a.me()');
    assert.equal(me.user.role, account.role);
    await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout(); });
  }
  return 'prototype quick login: customer, owner, admin';
});

await step(p, 'auth-intent', 'login-context', async () => {
  await p.goto(U + '/login' + nextQuery);
  await p.waitForSelector('#booking-context:not([hidden])');
  const text = await p.locator('#booking-context').innerText();
  assert.match(text, /Sân bóng Thành Phát/);
  assert.match(text, /Sân 1/);
  assert.ok(text.includes(slotStart), `thiếu giờ ${slotStart}: ${text}`);
  assert.ok(text.includes(dayVn), `thiếu ngày ${dayVn}: ${text}`);
  return text;
});
await step(p, 'auth-intent', 'register-3-fields-context', async () => {
  await p.locator('#alt-link').click();
  await p.waitForURL(/register/);
  assert.equal(await p.locator('#auth-form input[required]').count(), 3);
  assert.equal(await p.locator('#auth-form input[name=email]').count(), 0);
  await p.waitForSelector('#booking-context:not([hidden])');
  return `required fields=${await p.locator('#auth-form input[required]').count()}; ${await p.locator('#booking-context').innerText()}`;
});
await step(p, 'auth-intent', 'register-and-return-next', async () => {
  await p.fill('input[name=fullName]', 'Khách Đặt Sân Mới');
  await p.fill('input[name=phone]', phone);
  await p.fill('input[name=password]', 'Matkhau@123');
  await Promise.all([p.waitForURL((u) => pathOf(u) === '/venue'), p.locator('button[type=submit]').click()]);
  assert.equal(pathOf(new URL(p.url())), '/venue');
  assert.equal(new URL(p.url()).searchParams.get('book'), '1');
  const me = await api(p, 'a=>a.me()');
  assert.equal(me.user.email, null);
  assert.equal(me.user.phone, phone);
  return `${p.url().replace(U, '')}; email=${me.user.email}; phone=${me.user.phone}`;
});
await step(p, 'auth-intent', 'null-email-account-menu', async () => {
  // Sau đăng ký quay lại sân, hộp xác nhận đặt sân phải tự mở và phủ tiêu đề; kiểm nó mở rồi đóng rồi mới mở menu tài khoản.
  await p.locator('#confirm-dialog[open]').waitFor({ timeout: 15000 });
  await p.locator('#confirm-dialog [data-close]').first().click();
  await p.locator('.user-menu summary').click();
  const text = await p.locator('.user-menu-panel').innerText();
  assert.match(text, new RegExp(phone));
  assert.doesNotMatch(text, /null|undefined/);
  return text;
});
await step(p, 'auth-intent', 'duplicate-phone-and-login-phone', async () => {
  const duplicate = await p.evaluate(async (phoneValue) => {
    const { api } = await import('/js/api.js');
    try { await api.register({ fullName: 'Trùng số', phone: `+84 ${phoneValue.slice(1)}`, password: 'Matkhau@123' }); return 'accepted'; }
    catch (e) { return `${e.status}:${e.message}`; }
  }, phone);
  assert.match(duplicate, /^409:/);
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout(); });
  await p.goto(U + '/login' + nextQuery);
  await p.fill('input[name=identifier]', `+84 ${phone.slice(1)}`);
  await p.fill('input[name=password]', 'Matkhau@123');
  await Promise.all([p.waitForURL((u) => pathOf(u) === '/venue'), p.locator('button[type=submit]').click()]);
  const logged = await api(p, 'a=>a.me()');
  assert.equal(logged.user.phone, phone);
  assert.equal(logged.user.email, null);
  return `${duplicate}; UI login normalized to ${logged.user.phone}`;
});
await step(p, 'auth-intent', 'admin-renders-null-email', async () => {
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.quickLogin('admin'); });
  await p.goto(U + '/admin');
  await p.waitForSelector('#user-list .admin-record');
  await p.fill('#user-search', phone);
  const text = await p.locator('#user-list .admin-record').innerText();
  assert.match(text, /Không có email/);
  assert.match(text, new RegExp(phone));
  return text.replace(/\n/g, ' · ');
});
await step(p, 'auth-intent', 'missing-or-bad-context-hidden', async () => {
  await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout(); });
  await p.goto(U + '/login?next=' + encodeURIComponent(`/venue?id=999999&date=${day}&slot=19%3A00&court=1&book=1`));
  await p.waitForTimeout(150);
  assert.equal(await p.locator('#booking-context').isHidden(), true);
  await p.goto(U + '/register?next=' + encodeURIComponent(`/venue?id=1&date=${day}&slot=19%3A00&book=1`));
  await p.waitForTimeout(150);
  assert.equal(await p.locator('#booking-context').isHidden(), true);
  return 'API 404 and missing court both keep context hidden';
});
await step(p, 'auth-intent', 'explicit-null-email-registration', async () => {
  const extraPhone = phone.slice(0, 9) + String((Number(phone.slice(9)) + 1) % 10);
  const user = await p.evaluate(async (phoneValue) => {
    const { api } = await import('/js/api.js');
    const registered = await api.register({ fullName: 'Email null', phone: phoneValue, password: 'Matkhau@123', email: null });
    await api.logout();
    return registered.user;
  }, extraPhone);
  assert.equal(user.email, null);
  assert.equal(user.phone, extraPhone);
  return `email=${user.email}; phone=${user.phone}`;
});
save(); console.log('LOGS', logs.join('\n')); await b.close();
