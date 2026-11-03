// Nhu cầu nhờ báo giá mẫu (R14) từ public/mock/requests.json, cùng nguồn với prototype. Mỗi chào giá tự chọn ô trống đầu tiên trong
// khung giờ (không bị giữ/chặn, không thuộc chế độ đủ hai đội) lúc dựng; giá bị chặn bởi giá niêm yết. Chạy sau các seeder lịch đặt/chặn giờ.
const clock = require('../clock');
const { CANCEL_POLICY_TEXT, RULES } = require('../rules');
const { msToVn, vnToMs, addDays } = require('../lib/time');
const { loadVenues } = require('../services/venueStore');
const { slotEnd, slotEndAt, basePriceOf, teamModeAt } = require('../services/slotGrid');
const { bookingCode } = require('../services/bookingCore');
const { money } = require('../services/notify');
const { venueFits, slotsInWindow, reqLabel } = require('../services/requestOps');
const { readMock } = require('./core');

async function seedRequests(tx) {
  const spec = readMock('requests');
  const nowMs = clock.nowMs();
  const today = clock.today();
  const ago = (min) => msToVn(nowMs - min * 60000);
  const venues = await loadVenues({ conn: tx });
  const note = (userId, bookingId, message, link, isRead, at) =>
    tx.query('INSERT INTO notifications (user_id, booking_id, message, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?)', [userId, bookingId, message, link, isRead ? 1 : 0, at]);
  let requests = 0;
  let offers = 0;

  for (const s of spec.requests) {
    const date = addDays(today, s.day);
    const created = ago(s.minAgo);
    const closesAt = msToVn(vnToMs(`${date} ${s.from}`) - RULES.requestCloseMinutes * 60000);
    const r = { district: s.district, wantDate: date, fromTime: s.from, toTime: s.to, fieldType: s.fieldType };
    const ins = await tx.query(
      `INSERT INTO requests (user_id, district, want_date, from_time, to_time, field_type, budget, note, status, closes_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [s.userId, s.district, date, `${s.from}:00`, `${s.to}:00`, s.fieldType, s.budget, s.note || '', closesAt, created],
    );
    const requestId = ins.insertId;
    requests += 1;
    for (const ownerId of new Set(venues.filter((v) => venueFits(v, r)).map((v) => v.ownerId))) {
      await note(ownerId, null, `Tin nhờ báo giá mới: ${reqLabel(r)}, mức giá bạn muốn ${money(s.budget)}.`, '/owner-requests.html', !!s.offers?.length, created);
    }
    let chosen = null;
    for (const of of s.offers || []) {
      const venue = venues.find((v) => v.id === of.venueId);
      if (!venue) continue;
      let picked = null;
      for (const c of venue.courts.filter((x) => x.isActive && x.fieldType === s.fieldType)) {
        for (const slot of slotsInWindow(venue, r)) {
          if (picked || teamModeAt(c, slot)) continue;
          const startAt = `${date} ${slot}:00`;
          if (await tx.one('SELECT 1 AS x FROM slot_claims WHERE court_id = ? AND start_at = ?', [c.id, startAt])) continue;
          picked = { court: c, slot, startAt, endAt: slotEndAt(venue, date, slot), listed: basePriceOf(venue, c, slot) };
        }
      }
      if (!picked) continue;
      const price = Math.min(of.price, picked.listed);
      const status = s.state === 'chosen' && of.chosen ? 'chosen' : s.state === 'chosen' ? 'lost' : 'open';
      const o = await tx.query(
        `INSERT INTO offers (request_id, venue_id, court_id, start_at, end_at, price, listed_price, valid_until, note, status, end_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [requestId, venue.id, picked.court.id, picked.startAt, picked.endAt, price, picked.listed, closesAt, of.note || '', status, status === 'lost' ? 'Đội đã chọn báo giá khác' : null, ago(of.minAgo)],
      );
      offers += 1;
      await note(s.userId, null, `${venue.name} báo giá ${money(price)} cho ${picked.court.name} ${picked.slot}–${slotEnd(venue, picked.slot)}.`, `/request.html?id=${requestId}`, s.state === 'chosen', ago(of.minAgo));
      if (status === 'chosen') chosen = { id: o.insertId, venue, ...picked, price };
    }
    if (chosen) {
      const pending = chosen.venue.requiresApproval;
      const at = ago(s.minAgo - 20);
      const b = await tx.query(
        `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, expires_at, price, base_price, discount_percent, offer_id,
           customer_note, rules_snapshot, policy_snapshot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, 0, ?, '', ?, ?, ?, ?)`,
        [`T${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`, s.userId, chosen.venue.id, chosen.court.id, chosen.startAt, chosen.endAt, pending ? 'pending' : 'confirmed',
          pending ? msToVn(nowMs + RULES.holdMinutes * 60000) : chosen.venue.bank?.bin && chosen.venue.bank?.account ? msToVn(Math.min(nowMs + 8 * 60000, vnToMs(chosen.startAt))) : null, chosen.price, chosen.listed, chosen.id, chosen.venue.rules, CANCEL_POLICY_TEXT, at, at],
      );
      await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [bookingCode(b.insertId), b.insertId]);
      await tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [chosen.court.id, chosen.startAt, b.insertId]);
      await tx.query("UPDATE requests SET status = 'chosen', chosen_offer_id = ?, booking_id = ? WHERE id = ?", [chosen.id, b.insertId, requestId]);
      const hist = (action, from, to, text) =>
        tx.query('INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [b.insertId, action, from, to, s.userId, 'customer', text, at]);
      await hist('create', null, pending ? 'pending' : 'confirmed', '');
      await hist('offer_accept', null, pending ? 'pending' : 'confirmed', `Báo giá #${chosen.id} của sân: ${money(chosen.price)} (giá thường ${money(chosen.listed)})`);
    }
  }
  return { requests, offers };
}

module.exports = { seedRequests };
