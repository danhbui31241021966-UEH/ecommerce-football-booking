// Admin: nhãn trạng thái trùng với khách ("Đã có sân"), nút "Hủy lịch đặt", cột có nhãn và thẳng hàng, hủy để trống lý do chỉ báo một lỗi.
import { start, step, save, loginAs, anchor, U, logs } from './lib.mjs';
const { b, p } = await start();
await anchor(p, '08:00');
await loginAs(p, 'admin@datsan.local');
const labelsVisible = () => p.evaluate(() => {
  const l = [...document.querySelectorAll('.record-label')];
  return l.length > 0 && l.every((x) => x.offsetParent !== null && x.getBoundingClientRect().height > 0);
});
const columnsAligned = (sel) => p.evaluate((s) => {
  const rows = [...document.querySelectorAll(s)].filter((r) => r.offsetParent);
  if (rows.length < 2) throw new Error('cần ít nhất 2 dòng');
  const w = window.innerWidth;
  if (w < 700) return true; // khổ hẹp xếp 2 cột, không có cột để so
  const xs = rows.map((r) => [...r.children].map((c) => Math.round(c.getBoundingClientRect().left)).join(','));
  return xs.every((x) => x === xs[0]) ? true : xs.slice(0, 4).join(' | ');
}, sel);

await step(p, 'admin', '01-users-labelled-aligned', async () => {
  await p.goto(U + '/admin'); await p.waitForSelector('#user-list .record-grid');
  if (!(await labelsVisible())) throw new Error('nhãn cột bị ẩn');
  const t = await p.locator('#user-list').innerText();
  if (!/TẠO LÚC/i.test(t)) throw new Error('thiếu nhãn cột ngày');
  const a = await columnsAligned('#user-list .record-grid');
  if (a !== true) throw new Error('cột lệch: ' + a);
});
await step(p, 'admin', '02-bookings-status-and-cancel-wording', async () => {
  await p.goto(U + '/admin-bookings'); await p.waitForSelector('#booking-list .record-grid');
  await p.selectOption('#booking-status', 'confirmed'); await p.waitForSelector('[data-op=cancel]');
  const t = await p.locator('#booking-list').innerText();
  if (/Đã xác nhận/.test(t)) throw new Error('còn nhãn "Đã xác nhận"');
  if (!/Đã có sân/.test(t)) throw new Error('thiếu nhãn "Đã có sân"');
  if (/ngoại lệ/i.test(t)) throw new Error('còn chữ "ngoại lệ"');
  if (!(await p.locator('[data-op=cancel]').first().innerText()).match(/Hủy lịch đặt/)) throw new Error('nút hủy sai chữ');
  const a = await columnsAligned('#booking-list .record-grid');
  if (a !== true) throw new Error('cột lệch: ' + a);
});
await step(p, 'admin', '03-cancel-empty-reason-one-error', async () => {
  await p.click('[data-op=cancel]'); await p.waitForSelector('dialog[open]');
  const title = await p.locator('dialog[open] h2').innerText();
  if (/ngoại lệ/i.test(title)) throw new Error(title);
  await p.click('dialog[open] button[type=submit]');
  await p.waitForSelector('dialog[open] .form-error:not([hidden])');
  const r = await p.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const f = d.querySelector('form');
    return { open: !!d, noValidate: f.noValidate, errors: [...d.querySelectorAll('.form-error')].filter((e) => !e.hidden).length, native: d.querySelector('textarea').validationMessage && f.noValidate === false, focus: document.activeElement?.tagName };
  });
  if (!r.open || !r.noValidate || r.errors !== 1 || r.native || r.focus !== 'TEXTAREA') throw new Error(JSON.stringify(r));
  await p.waitForTimeout(300);
});
await step(p, 'admin', '04-logs-status-label', async () => {
  await p.keyboard.press('Escape');
  await p.goto(U + '/admin-logs'); await p.waitForSelector('#log-list .record-grid');
  const t = await p.locator('#log-list').innerText();
  if (/Đã xác nhận/.test(t)) throw new Error('nhật ký còn "Đã xác nhận"');
  if (!/Đã có sân/.test(t)) throw new Error('nhật ký thiếu "Đã có sân"');
  if (!(await labelsVisible())) throw new Error('nhãn cột bị ẩn');
});
save();
await b.close();
if (logs.length) console.log('LOGS', logs.join('\n'));
