process.env.TZ = 'Asia/Ho_Chi_Minh';
const test = require('node:test');
const assert = require('node:assert/strict');
const slots = require('../src/services/slots');

test('sinh slot cố định, slot cuối không vượt giờ đóng cửa', () => {
  const s = slots.generateSlots({ open_time: '06:00:00', close_time: '22:30:00', slot_minutes: 90 });
  assert.equal(s[0].start, '06:00');
  assert.equal(s.at(-1).start, '21:00');
  assert.equal(s.at(-1).end, '22:30');
  assert.equal(s.length, 11);

  const odd = slots.generateSlots({ open_time: '06:00:00', close_time: '23:00:00', slot_minutes: 90 });
  assert.equal(odd.at(-1).end, '22:30'); // 22:30-24:00 vượt giờ đóng cửa nên bị bỏ
});

test('giá giờ vàng áp dụng theo giờ bắt đầu slot, khung [peak_start, peak_end)', () => {
  const venue = { peak_start: '17:00:00', peak_end: '21:00:00' };
  const court = { price: 300000, peak_price: 450000 };
  assert.equal(slots.slotPrice(venue, court, '16:00'), 300000);
  assert.equal(slots.slotPrice(venue, court, '17:00'), 450000);
  assert.equal(slots.slotPrice(venue, court, '20:00'), 450000);
  assert.equal(slots.slotPrice(venue, court, '21:00'), 300000);
  assert.equal(slots.slotPrice({ peak_start: null, peak_end: null }, court, '18:00'), 300000);
});

test('mức hoàn khi khách hủy theo mốc 24h / 12h', () => {
  const start = new Date('2026-11-01T18:00:00');
  const hoursBefore = (h) => new Date(start.getTime() - h * 3_600_000);
  assert.equal(slots.customerRefundPercent(start, hoursBefore(48)), 100);
  assert.equal(slots.customerRefundPercent(start, hoursBefore(24)), 100);
  assert.equal(slots.customerRefundPercent(start, hoursBefore(23.99)), 50);
  assert.equal(slots.customerRefundPercent(start, hoursBefore(12)), 50);
  assert.equal(slots.customerRefundPercent(start, hoursBefore(11.99)), 0);
});

test('tiền hoàn chỉ tính trên số tiền đã thanh toán', () => {
  assert.equal(slots.refundAmount(450000, 'paid', 50), 225000);
  assert.equal(slots.refundAmount(450000, 'unpaid', 100), 0);
});
