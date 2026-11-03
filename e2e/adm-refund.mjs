import { start, loginAs, U, W, logs, anchor } from './lib.mjs';
const { b, p } = await start(); await anchor(p, '08:00');
await loginAs(p, 'admin@datsan.local'); await p.goto(U + '/admin-bookings'); await p.waitForSelector('#booking-status');
await p.selectOption('#booking-status', 'transferred'); await p.waitForSelector('[data-op=refund]');
await p.click('[data-op=refund]'); await p.waitForSelector('dialog[open]'); await p.click('dialog[open] button[type=submit]'); await p.waitForTimeout(1200);
const t = await p.locator('#booking-list').innerText(); console.log(/Đã trả lại/.test(t) && !/Chưa trả lại/.test(t) ? 'OK admin refund' : 'FAIL ' + t); console.log(logs.join('\n')||'console sạch'); await b.close();
