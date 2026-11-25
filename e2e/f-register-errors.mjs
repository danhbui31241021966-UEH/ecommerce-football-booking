// Đăng ký để trống hoặc sai: lỗi hiện ở ô sai đầu tiên theo thứ tự trên form và con trỏ nằm đúng ô đó.
import { start, step, save, U, logs } from './lib.mjs';
const { b, p } = await start();
const focused = () => p.evaluate(() => document.activeElement?.name || '');
const msg = (name) => p.locator(`#${name}-msg`).innerText();
const submit = () => p.click('#auth-form button[type=submit]');
await p.goto(U + '/register');
await p.evaluate(async () => { const { api } = await import('/js/api.js'); await api.logout().catch(() => {}); });
await p.goto(U + '/register');
await step(p, 'reg', '01-all-empty', async () => {
  await submit();
  if ((await focused()) !== 'fullName') throw new Error('con trỏ ở ' + (await focused()));
  const m = await msg('fullName');
  if (!/họ tên/i.test(m)) throw new Error(m);
  if (await p.locator('#phone-msg').count()) throw new Error('không được báo lỗi ô khác');
  return m;
});
await step(p, 'reg', '02-name-only', async () => {
  await p.fill('#fullName', 'Trần Minh Khoa');
  await submit();
  if ((await focused()) !== 'phone') throw new Error('con trỏ ở ' + (await focused()));
  if (await p.locator('#fullName-msg').count()) throw new Error('lỗi cũ chưa xóa');
  return msg('phone');
});
await step(p, 'reg', '03-bad-phone-server-error', async () => {
  await p.fill('#phone', '123');
  await p.fill('#email', 'loi.dang.ky@example.test');
  await p.fill('#password', 'matkhau123');
  await submit();
  await p.waitForSelector('#phone-msg');
  if ((await focused()) !== 'phone') throw new Error('con trỏ ở ' + (await focused()));
  return msg('phone');
});
await step(p, 'reg', '04-short-password-server-error', async () => {
  await p.fill('#phone', '0912345678');
  await p.fill('#password', 'ngan');
  await submit();
  await p.waitForSelector('#password-msg');
  if ((await focused()) !== 'password') throw new Error('con trỏ ở ' + (await focused()));
  return msg('password');
});
save();
await b.close();
if (logs.length) console.log('LOGS', logs.join('\n'));
