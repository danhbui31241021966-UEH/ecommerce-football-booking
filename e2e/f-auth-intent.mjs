import assert from 'node:assert/strict';
import { start, step, save, api, U, W, logs } from './lib.mjs';
const { b, p } = await start();
const next = '/venue?id=1&date=2026-11-04&slot=19%3A00&court=1&book=1';
const nextQuery = `?next=${encodeURIComponent(next)}`;
const phone = `091${String(W).padStart(7, '0')}`;
await p.goto(U + '/login');
await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.proto.resetDemo(); });

await step(p, 'auth-intent', 'demo-role-shortcuts', async () => {
  const accounts = [
    { identifier: 'khach1@datsan.local', role: 'customer', path: '/' },
    { identifier: 'chusan1@datsan.local', role: 'owner', path: '/owner.html' },
    { identifier: 'admin@datsan.local', role: 'admin', path: '/admin.html' },
  ];
  for (const account of accounts) {
    await p.goto(U + '/login');
    assert.equal(await p.locator('#demo-accounts').isVisible(), true);
    assert.equal(await p.locator('#demo-accounts button').count(), 3);
    await Promise.all([
      p.waitForURL((url) => url.pathname === account.path),
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
  assert.match(text, /19:00/);
  assert.match(text, /04\/11\/2026/);
  return text;
});
await step(p, 'auth-intent', 'register-3-fields-context', async () => {
  await p.locator('#alt-link').click();
  await p.waitForURL(/register/);
  assert.equal(await p.locator('#auth-form input[required]').count(), 3);
  assert.equal(await p.locator('#auth-form input[name=email]').count(), 0);
  assert.equal(await p.locator('#booking-context').isVisible(), true);
  return `required fields=${await p.locator('#auth-form input[required]').count()}; ${await p.locator('#booking-context').innerText()}`;
});
await step(p, 'auth-intent', 'register-and-return-next', async () => {
  await p.fill('input[name=fullName]', 'Khách Đặt Sân Mới');
  await p.fill('input[name=phone]', phone);
  await p.fill('input[name=password]', 'Matkhau@123');
  await Promise.all([p.waitForURL((u) => u.pathname === '/venue'), p.locator('button[type=submit]').click()]);
  assert.equal(p.url().split('?')[0], U + '/venue');
  assert.equal(new URL(p.url()).searchParams.get('book'), '1');
  const me = await api(p, 'a=>a.me()');
  assert.equal(me.user.email, null);
  assert.equal(me.user.phone, phone);
  return `${p.url().replace(U, '')}; email=${me.user.email}; phone=${me.user.phone}`;
});
await step(p, 'auth-intent', 'null-email-account-menu', async () => {
  // Sau đăng ký quay lại sân, hộp xác nhận đặt sân tự mở (đúng chủ ý) và phủ tiêu đề; đóng nó rồi mới mở menu tài khoản.
  if (await p.locator('#confirm-dialog[open]').count()) await p.locator('#confirm-dialog [data-close]').first().click();
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
  await Promise.all([p.waitForURL((u) => u.pathname === '/venue'), p.locator('button[type=submit]').click()]);
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
  await p.goto(U + '/login?next=' + encodeURIComponent('/venue?id=999999&date=2026-11-04&slot=19%3A00&court=1&book=1'));
  await p.waitForTimeout(150);
  assert.equal(await p.locator('#booking-context').isHidden(), true);
  await p.goto(U + '/register?next=' + encodeURIComponent('/venue?id=1&date=2026-11-04&slot=19%3A00&book=1'));
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
