// Ban đêm (hôm nay đã hết giờ): lịch sân và hộp "Thêm lịch đặt" của chủ sân mở sẵn ở ngày còn giờ trống, không phải toàn "Đã qua".
import { start, step, save, loginAs, api, U, W, logs, anchor, dayPlus } from './lib.mjs';
const { b, p } = await start();
await anchor(p, '08:00');
await api(p, 'a=>a.proto.advanceClock(15*60+45)'); // 23:45 cùng ngày
const now = await api(p, 'a=>a.meta()').then((m) => m.now);
const today = now.slice(0, 10);
const must = (c, m) => { if (!c) throw new Error(m); };
await loginAs(p, 'chusan1@datsan.local');
await step(p, 'night', '01-schedule-opens-on-day-with-free-hours', async () => {
  await p.goto(`${U}/owner-schedule`);
  await p.waitForSelector('.day-chip[aria-pressed=true]');
  const chosen = await p.locator('.day-chip[aria-pressed=true]').getAttribute('data-date');
  must(chosen === dayPlus(today, 1), `đang mở ${chosen}, phải là ${dayPlus(today, 1)} (hôm nay ${today} ${now.slice(11, 16)})`);
  must(await p.locator('.sc-available').count() > 0, 'không có ô trống');
  return `${chosen}; ${await p.locator('#sub').innerText()}`;
});
await step(p, 'night', '02-can-still-open-today', async () => {
  await p.click(`.day-chip[data-date="${today}"]`);
  await p.waitForSelector(`.day-chip[data-date="${today}"][aria-pressed=true]`);
  return 'chọn lại hôm nay được';
});
await step(p, 'night', '03-add-booking-dialog-defaults-to-free-day', async () => {
  await p.goto(`${U}/owner-schedule`);
  await p.waitForSelector('#add-booking');
  await p.click('#add-booking');
  await p.waitForSelector('#pb-start option[value]:not([disabled])', { state: 'attached', timeout: 8000 });
  const d = await p.inputValue('#pb-date');
  must(d === dayPlus(today, 1), `ngày trong form là ${d}`);
  return `${d}; ${await p.locator('#pb-slot-hint').innerText()}`;
});
await p.keyboard.press('Escape');
await step(p, 'night', '04-add-booking-from-today-page', async () => {
  await p.goto(`${U}/owner-schedule?date=${today}`);
  await p.waitForSelector('#add-booking');
  await p.click('#add-booking');
  await p.waitForSelector('#pb-start option', { state: 'attached' });
  await p.waitForFunction(() => document.querySelector('#pb-start option[value]:not([disabled])') || document.querySelector('#pb-slot-hint')?.textContent);
  const d = await p.inputValue('#pb-date');
  must(d === dayPlus(today, 1), `chủ sân chọn hôm nay nhưng hôm nay hết giờ, form phải gợi ý ngày còn giờ, đang là ${d}`);
  return d;
});
save();
await b.close();
if (logs.length) console.log('LOGS', logs.join('\n'));
