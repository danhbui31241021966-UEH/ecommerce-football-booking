// Hàm thuần: lưới giờ, cao điểm, giảm giờ chót, ô phủ bởi một chặn giờ. Không cần DB.
process.env.TZ = 'Asia/Ho_Chi_Minh';
const test = require('node:test');
const assert = require('node:assert/strict');
const { slotGrid, isPeak, teamModeAt } = require('../src/services/slotGrid');
const { slotStartsCovering } = require('../src/services/slotClaims');
const { discountedPrice, addDays, vnToMs, msToVn } = require('../src/lib/time');

const venue = { openTime: '06:00', closeTime: '23:00', slotMinutes: 60, peakStart: '17:00', peakEnd: '21:00' };

test('lưới giờ: ô cuối kết thúc đúng giờ đóng cửa; ô 90 phút không vượt giờ đóng', () => {
  const g = slotGrid(venue);
  assert.equal(g[0], '06:00');
  assert.equal(g.at(-1), '22:00');
  assert.equal(g.length, 17);
  const g90 = slotGrid({ ...venue, openTime: '06:00', closeTime: '22:30', slotMinutes: 90 });
  assert.equal(g90.at(-1), '21:00'); // 21:00–22:30 vừa khít
  assert.equal(slotGrid({ ...venue, closeTime: '22:00', slotMinutes: 90 }).at(-1), '19:30');
});

test('giờ cao điểm là nửa mở [start, end)', () => {
  assert.equal(isPeak(venue, '16:00'), false);
  assert.equal(isPeak(venue, '17:00'), true);
  assert.equal(isPeak(venue, '20:00'), true);
  assert.equal(isPeak(venue, '21:00'), false);
  assert.equal(isPeak({ ...venue, peakStart: null, peakEnd: null }, '18:00'), false);
});

test('R6: giá giảm giờ chót làm tròn 1.000đ', () => {
  assert.equal(discountedPrice(450000, 20), 360000);
  assert.equal(discountedPrice(350000, 15), 298000); // 297.500 làm tròn lên
  assert.equal(discountedPrice(300000, 0), 300000);
  assert.equal(discountedPrice(333000, 10) % 1000, 0);
});

test('R13: chế độ ghép kèo cả ngày hoặc theo khung', () => {
  assert.equal(teamModeAt({ teamModeEnabled: false }, '19:00'), false);
  assert.equal(teamModeAt({ teamModeEnabled: true, teamModeFrom: null, teamModeTo: null }, '07:00'), true);
  const c = { teamModeEnabled: true, teamModeFrom: '18:00', teamModeTo: '21:00' };
  assert.deepEqual(['17:00', '18:00', '20:00', '21:00'].map((s) => teamModeAt(c, s)), [false, true, true, false]);
});

test('ngày và mốc giờ theo UTC+7, không phụ thuộc múi giờ máy', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(msToVn(vnToMs('2026-11-02 23:30:00')), '2026-11-02 23:30:00');
  assert.equal(vnToMs('2026-11-02 00:00') - vnToMs('2026-11-01 00:00'), 86400000);
});

test('chặn giờ phủ đúng các ô giao với khoảng [start, end)', () => {
  assert.deepEqual(slotStartsCovering(venue, '2026-11-03 18:00:00', '2026-11-03 20:00:00'), ['2026-11-03 18:00:00', '2026-11-03 19:00:00']);
  // Khoảng bắt đầu giữa ô vẫn phủ ô đó.
  assert.deepEqual(slotStartsCovering(venue, '2026-11-03 18:30:00', '2026-11-03 19:30:00'), ['2026-11-03 18:00:00', '2026-11-03 19:00:00']);
  // Khoảng qua nửa đêm không sinh ô ngoài giờ mở cửa.
  assert.deepEqual(slotStartsCovering(venue, '2026-11-03 22:00:00', '2026-11-04 07:00:00'), ['2026-11-03 22:00:00', '2026-11-04 06:00:00']);
});
