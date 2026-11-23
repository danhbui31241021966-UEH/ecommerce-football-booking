// Thanh toán chuyển khoản: trên điện thoại ô sao chép nằm trước QR, từ 900px QR nằm trước; có nút lưu ảnh QR tải về được PNG.
import fs from 'node:fs';
import { start, step, save, loginAs, api, U, W, logs, anchor, pickCourt } from './lib.mjs';
const { b, p } = await start();
const NOW0 = await anchor(p, '08:00');
const must = (c, m) => { if (!c) throw new Error(m); };
const date = NOW0.slice(0, 10);
const slot = '17:00';
const court = await pickCourt(p, 1, date, slot) ?? await pickCourt(p, 1, date, '18:00');
await loginAs(p, 'khach1@datsan.local');
const made = await p.evaluate(async ([c, d, s]) => { const { api } = await import('/js/api.js'); return api.createBooking({ courtId: c, date: d, start: s }); }, [court, date, (await pickCourt(p, 1, date, slot)) ? slot : '18:00']);
await p.goto(`${U}/booking?id=${made.id}`);
await p.waitForSelector('.qr-card .qr');
const top = (sel) => p.locator(sel).first().evaluate((el) => el.getBoundingClientRect().top);
await step(p, 'pay', '01-order-of-copy-and-qr', async () => {
  const copyTop = await top('.qr-card .copy-row');
  const qrTop = await top('.qr-card img.qr');
  const copyFirst = copyTop < qrTop;
  if (W < 900 && !copyFirst) throw new Error(`hẹp: ô sao chép (${copyTop}) phải ở trước QR (${qrTop})`);
  if (W >= 900 && copyFirst) throw new Error(`rộng: QR (${qrTop}) phải ở trước ô sao chép (${copyTop})`);
  return `copy=${Math.round(copyTop)} qr=${Math.round(qrTop)}`;
}, { full: true });
await step(p, 'pay', '02-copy-buttons', async () => {
  const labels = await p.locator('.qr-card [data-copy]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  must(labels.length === 3, 'phải có 3 nút sao chép (số tài khoản, số tiền, nội dung): ' + labels.join('|'));
  return labels.join(' | ');
}, { shot: false });
await step(p, 'pay', '03-save-qr-downloads-png', async () => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('.qr-save')]);
  const name = dl.suggestedFilename();
  must(/\.png$/.test(name), 'tên tệp ' + name);
  const path = await dl.path();
  const head = fs.readFileSync(path).subarray(0, 8).toString('hex');
  must(head === '89504e470d0a1a0a', 'không phải PNG: ' + head);
  return `${name} ${fs.statSync(path).size}B`;
}, { shot: false });
save();
await b.close();
if (logs.length) console.log('LOGS', logs.join('\n'));
