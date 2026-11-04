// Kèo ghép mẫu (R13, R15) từ mock/matches.json → matches, cùng nguồn với prototype. Mỗi mẫu có `day` (so với hôm nay), giờ đá,
// trạng thái (open / joined / confirmed) và, với `played`, bước kết quả. Ô đã có người giữ thì bỏ mẫu đó. Chạy sau các seeder lịch đặt.
const clock = require('../clock');
const { CANCEL_POLICY_TEXT, RULES } = require('../rules');
const { msToVn, vnToMs, addDays } = require('../lib/time');
const { loadVenue } = require('../services/venueStore');
const { slotEndAt, basePriceOf } = require('../services/slotGrid');
const { bookingCode } = require('../services/bookingCore');
const { money, shortTs } = require('../services/notify');
const { halfOf, loserShareOf, stakeText, payContent, REPORT_HOURS, TOPUP_HOURS } = require('../services/matchOps');
const { readMock } = require('./core');

const winnerText = (w) => (w === 'draw' ? 'hòa' : `${w === 'host' ? 'đội mở kèo' : 'đội vào kèo'} thắng`);

async function seedMatches(tx) {
  const spec = readMock('matches');
  const nowMs = clock.nowMs();
  const today = clock.today();
  const ago = (min) => msToVn(nowMs - min * 60000);
  let count = 0;
  const hist = (bookingId, action, from, to, actorId, role, note, at) =>
    tx.query('INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [bookingId, action, from, to, actorId, role, note, at]);
  const note = (userId, bookingId, message, createdAt, isRead = 0) =>
    tx.query("INSERT INTO notifications (user_id, booking_id, message, link, is_read, created_at) VALUES (?, ?, ?, '/owner-bookings.html#matches', ?, ?)", [userId, bookingId, message, isRead, createdAt]);

  for (const s of spec.matches) {
    const row = await tx.one('SELECT venue_id FROM courts WHERE id = ?', [s.courtId]);
    if (!row) continue;
    const venue = await loadVenue(row.venueId, { activeOnly: false, conn: tx });
    const court = venue.courts.find((c) => c.id === s.courtId);
    const date = addDays(today, s.day);
    const startAt = `${date} ${s.start}:00`;
    if (await tx.one('SELECT 1 AS x FROM slot_claims WHERE court_id = ? AND start_at = ?', [court.id, startAt])) continue;
    const endAt = slotEndAt(venue, date, s.start);
    const price = basePriceOf(venue, court, s.start);
    const hostAmount = halfOf(price);
    const guestAmount = price - hostAmount;
    const created = ago(s.minAgo);
    const closesAt = msToVn(vnToMs(startAt) - RULES.matchCloseMinutes * 60000);
    const hostPayBy = msToVn(vnToMs(created) + RULES.holdMinutes * 60000);
    const hostPaidAt = s.state === 'host_unpaid' ? null : ago(s.minAgo - 2);
    const joined = s.state === 'joined' || s.state === 'confirmed';
    const joinedAt = joined ? ago(s.joinedMinAgo ?? 2) : null;
    const confirmed = s.state === 'confirmed';
    const guestPaidAt = confirmed ? ago(1) : null;
    const lastAt = confirmed ? guestPaidAt : created;

    const b = await tx.query(
      `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, price, base_price, discount_percent,
         payment_status, paid_at, paid_via, customer_note, rules_snapshot, policy_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, 0, ?, ?, ?, '', ?, ?, ?, ?)`,
      [`T${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`, s.hostId, venue.id, court.id, startAt, endAt, confirmed ? 'confirmed' : 'matching', price, price,
        confirmed ? 'paid' : 'unpaid', confirmed ? guestPaidAt : null, confirmed ? 'owner' : null, venue.rules, CANCEL_POLICY_TEXT, created, lastAt],
    );
    const bookingId = b.insertId;
    const code = bookingCode(bookingId);
    await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [code, bookingId]);
    await tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [court.id, startAt, bookingId]);
    const m = await tx.query(
      `INSERT INTO matches (booking_id, host_id, guest_id, price, loser_percent, host_amount, guest_amount, status, created_at, closes_at, host_pay_by,
         host_paid_at, guest_paid_at, guest_hold_until, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, s.hostId, joined ? s.guestId : null, price, s.loserPercent, hostAmount, guestAmount, confirmed ? 'confirmed' : joined ? 'joined' : 'open', created, closesAt, hostPayBy,
        hostPaidAt, guestPaidAt, joined && !confirmed ? msToVn(vnToMs(joinedAt) + RULES.holdMinutes * 60000) : null, joinedAt],
    );
    const matchId = m.insertId;
    await tx.query('UPDATE bookings SET match_id = ? WHERE id = ?', [matchId, bookingId]);
    const label = shortTs(startAt);
    await hist(bookingId, 'create', null, 'matching', s.hostId, 'customer', `Mở kèo ${stakeText(s.loserPercent)}, phần của đội mở kèo ${money(hostAmount)}`, created);
    if (hostPaidAt) await hist(bookingId, 'match_part_paid', null, null, venue.ownerId, 'owner', `Đã nhận phần đội mở kèo ${money(hostAmount)}`, hostPaidAt);
    if (joined) {
      await hist(bookingId, 'match_join', null, null, s.guestId, 'customer', `Đội vào kèo, phần ${money(guestAmount)}`, joinedAt);
      const guest = await tx.one('SELECT full_name FROM users WHERE id = ?', [s.guestId]);
      await note(venue.ownerId, bookingId, `${guest.fullName} vào kèo ${court.name} ${label}, chuyển ${money(guestAmount)} nội dung ${payContent(code, 'guest')}. Nhận được tiền thì bấm xác nhận trước ${msToVn(vnToMs(joinedAt) + RULES.holdMinutes * 60000).slice(11, 16)}.`, joinedAt);
    }
    if (confirmed) {
      await hist(bookingId, 'match_part_paid', null, null, venue.ownerId, 'owner', `Đã nhận phần đội vào kèo ${money(guestAmount)}`, guestPaidAt);
      await hist(bookingId, 'match_confirm', 'matching', 'confirmed', venue.ownerId, 'owner', 'Đủ hai phần tiền, chốt sân', guestPaidAt);
    }
    if (s.played && confirmed) {
      // Kèo đã đá xong: chờ hai đội báo kết quả, hoặc đã chốt và đội thua chưa trả phần chênh.
      const reportBy = msToVn(vnToMs(endAt) + REPORT_HOURS * 3600000);
      await tx.query("UPDATE matches SET result_status = 'awaiting', report_by = ?, host_report = ? WHERE id = ?", [reportBy, s.hostReport || null, matchId]);
      if (s.winner) {
        const full = { price, loserPercent: s.loserPercent };
        const loser = s.winner === 'host' ? 'guest' : 'host';
        const topup = s.winner === 'draw' ? 0 : Math.max(0, loserShareOf(full) - (loser === 'host' ? hostAmount : guestAmount));
        const bank = s.winnerBank;
        await tx.query(
          `UPDATE matches SET result_status = 'settled', host_report = ?, guest_report = ?, winner = ?, settled_by = 'agree', settled_at = ?,
             topup_from = ?, topup_to = ?, topup_amount = ?, topup_status = ?, topup_due_by = ?,
             ${s.winner === 'draw' ? 'host_bank_bin = host_bank_bin' : `${s.winner}_bank_bin = ?, ${s.winner}_bank_account = ?, ${s.winner}_bank_name = ?`} WHERE id = ?`,
          [s.winner, s.winner, s.winner, ago(60), topup ? loser : null, topup ? s.winner : null, topup || null, topup ? 'unpaid' : null, topup ? msToVn(nowMs - 60 * 60000 + TOPUP_HOURS * 3600000) : null,
            ...(s.winner !== 'draw' && bank ? [bank.bin, bank.account, bank.accountName] : s.winner === 'draw' ? [] : [null, null, null]), matchId],
        );
        await hist(bookingId, 'match_result', null, null, null, 'system', `Kết quả ${stakeText(s.loserPercent)}: ${winnerText(s.winner)}, hai đội khớp nhau`, ago(60));
      }
    }
    if (s.state === 'open') await note(venue.ownerId, bookingId, `Kèo ${court.name} ${label} đang tìm đội đá cùng.`, hostPaidAt || created, 1);
    count += 1;
  }
  return { matches: count };
}

module.exports = { seedMatches };
