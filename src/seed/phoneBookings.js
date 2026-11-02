// Lịch điện thoại mẫu (R16) từ public/mock/bookings.json → phoneBookings, luôn có mặt dù mở demo giờ nào. Chạy SAU seeder chặn giờ
// vì chọn ô theo dữ liệu đã dựng: giờ ghi trong mẫu là giờ ưu tiên; ô đó đã qua, đã có lịch/chặn hoặc là giờ chỉ ghép kèo thì lấy ô trống
// chưa bắt đầu gần giờ ưu tiên nhất (cùng cụm sân, trong ngày của mẫu); hết ô thì sang ngày kế tiếp. Kết quả tất định.
const clock = require('../clock');
const { CANCEL_POLICY_TEXT } = require('../rules');
const { vnToMs, msToVn, addDays, hmToMin } = require('../lib/time');
const { loadVenue } = require('../services/venueStore');
const { slotGrid, slotEndAt, basePriceOf, teamModeAt } = require('../services/slotGrid');
const { bookingCode } = require('../services/bookingCore');
const { describe } = require('../services/phoneBooking');
const { readMock } = require('./core');

async function seedPhoneBookings(tx) {
  const specs = readMock('bookings').phoneBookings || [];
  const nowMs = clock.nowMs();
  const today = clock.today();
  let count = 0;
  for (const spec of specs) {
    const row = await tx.one('SELECT venue_id FROM courts WHERE id = ?', [spec.courtId]);
    if (!row) continue;
    const venue = await loadVenue(row.venueId, { activeOnly: false, conn: tx });
    const grid = slotGrid(venue);
    const want = hmToMin(spec.start);
    const courts = [venue.courts.find((c) => c.id === spec.courtId), ...venue.courts.filter((c) => c.id !== spec.courtId)].filter((c) => c?.isActive);
    let pick = null;
    for (let d = spec.day; d <= spec.day + 1 && !pick; d++) {
      const date = addDays(today, d);
      const cands = [];
      for (const [ci, court] of courts.entries()) {
        for (const start of grid) {
          const startAt = `${date} ${start}:00`;
          if (vnToMs(startAt) <= nowMs || teamModeAt(court, start)) continue;
          if (await tx.one('SELECT 1 AS x FROM slot_claims WHERE court_id = ? AND start_at = ?', [court.id, startAt])) continue;
          cands.push({ court, date, start, key: [Math.abs(hmToMin(start) - want), ci, start] });
        }
      }
      cands.sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1] || x.key[2].localeCompare(y.key[2]));
      pick = cands[0] || null;
    }
    if (!pick) continue;
    const { court, date, start } = pick;
    const startAt = `${date} ${start}:00`;
    const base = basePriceOf(venue, court, start);
    const price = spec.price ?? base;
    const created = msToVn(nowMs - 3 * 3600000);
    const r = await tx.query(
      `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, walk_in_name, walk_in_phone, price, base_price,
         discount_percent, payment_status, paid_at, paid_via, customer_note, rules_snapshot, policy_snapshot, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, 'confirmed', 'phone', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`T${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`, venue.id, court.id, startAt, slotEndAt(venue, date, start), spec.name, spec.phone || null, price, base,
        spec.paid ? 'paid' : 'unpaid', spec.paid ? created : null, spec.paid ? 'owner' : null, spec.note || '', venue.rules, CANCEL_POLICY_TEXT, created, created],
    );
    const id = r.insertId;
    await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [bookingCode(id), id]);
    await tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [court.id, startAt, id]);
    await tx.query(
      "INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note, created_at) VALUES (?, 'phone_create', NULL, 'confirmed', ?, 'owner', ?, ?)",
      [id, venue.ownerId, describe(spec.name, spec.phone, price, spec.paid), created],
    );
    count += 1;
  }
  return { phoneBookings: count };
}

module.exports = { seedPhoneBookings };
