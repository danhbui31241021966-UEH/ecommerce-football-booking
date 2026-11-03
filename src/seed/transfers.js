const clock = require('../clock');
const { RULES } = require('../rules');
const { vnToMs, msToVn, addDays } = require('../lib/time');
const { bookingCode } = require('../services/bookingCore');
const { setStatus, claimForBooking } = require('../services/bookingState');
const { addHistory, notify, money, shortTs } = require('../services/notify');
const { readMock } = require('./core');

const roundThousand = (amount) => Math.round(amount / 1000) * 1000;

async function seedTransfers(tx) {
  const mock = readMock('bookings');
  const nowMs = clock.nowMs();
  const ago = (minutes) => msToVn(nowMs - minutes * 60000);
  const today = clock.today();
  let seeded = 0;

  for (const template of mock.bookings) {
    const spec = template.transfer;
    if (!spec) continue;

    const date = addDays(today, template.day);
    const startAt = `${date} ${template.start}:00`;
    const booking = await tx.one(
      'SELECT * FROM bookings WHERE user_id = ? AND court_id = ? AND start_at = ?',
      [template.userId, template.courtId, startAt],
    );
    if (!booking) continue;

    const askPrice = Math.min(booking.price, roundThousand((booking.price * spec.askPercent) / 100));
    const createdAt = ago(spec.minAgo);
    const closesAtMs = vnToMs(booking.startAt) - RULES.transferCloseMinutes * 60000;
    const waiters = await tx.query(
      "SELECT user_id FROM waitlist WHERE court_id = ? AND start_at = ? AND status IN ('waiting', 'offered') ORDER BY id",
      [booking.courtId, booking.startAt],
    );
    const priorityUntil = waiters.length
      ? msToVn(Math.min(vnToMs(createdAt) + RULES.waitlistOfferMinutes * 60000, closesAtMs))
      : null;
    const inserted = await tx.query(
      `INSERT INTO transfers (booking_id, from_user_id, ask_price, status, created_at, closes_at, priority_until)
       VALUES (?, ?, ?, 'open', ?, ?, ?)`,
      [booking.id, booking.userId, askPrice, createdAt, msToVn(closesAtMs), priorityUntil],
    );
    const transferId = inserted.insertId;
    const venue = await tx.one('SELECT name, owner_id FROM venues WHERE id = ?', [booking.venueId]);
    const court = await tx.one('SELECT name FROM courts WHERE id = ?', [booking.courtId]);
    await addHistory(tx, booking.id, 'transfer_open', {
      actor: { id: booking.userId, role: 'customer' }, note: `Giá pass ${money(askPrice)}`, at: createdAt,
    });
    for (const waiter of waiters) {
      await notify(tx, waiter.userId,
        `Có đội đăng pass giờ ${shortTs(booking.startAt)} tại ${venue.name} · ${court.name}, giá ${money(askPrice)}. Bạn đang chờ giờ này nên được ưu tiên nhận đến ${priorityUntil.slice(11, 16)}.`,
        { link: `/transfer.html?id=${transferId}`, at: createdAt });
    }

    if (spec.claimedBy) {
      const claimedAt = ago(spec.claimedMinAgo);
      const claimExpiresAt = msToVn(vnToMs(claimedAt) + RULES.holdMinutes * 60000);
      await tx.query(
        `UPDATE transfers SET status = 'claimed', to_user_id = ?, claimed_at = ?, claim_expires_at = ? WHERE id = ?`,
        [spec.claimedBy, claimedAt, claimExpiresAt, transferId],
      );
      await addHistory(tx, booking.id, 'transfer_claim', {
        note: 'Có đội nhận, chờ chủ sân xác nhận đã nhận tiền', at: claimedAt,
      });
      if (!spec.done) {
        const claimer = await tx.one('SELECT full_name FROM users WHERE id = ?', [spec.claimedBy]);
        await notify(tx, venue.ownerId,
          `${claimer.fullName} nhận pass sân ${booking.code} (${court.name} ${shortTs(booking.startAt)}), chuyển ${money(askPrice)} nội dung NH${booking.code}. Nhận được tiền thì bấm xác nhận trước ${claimExpiresAt.slice(11, 16)}.`,
          { bookingId: booking.id, link: '/owner-bookings.html#transfers', at: claimedAt });
      }
    }

    if (spec.done) {
      const completedAt = clock.now();
      await setStatus(tx, booking.id, 'transferred', {
        cancel_reason: 'Đã pass cho đội khác',
        cancelled_at: completedAt,
        late_cancel: 0,
        refund_amount: askPrice,
        refund_percent: Math.round((askPrice / booking.price) * 100),
        refund_status: 'pending',
      });
      const newBooking = await tx.query(
        `INSERT INTO bookings (
           code, user_id, venue_id, court_id, start_at, end_at, status, source, price, base_price,
           discount_percent, payment_status, paid_at, paid_via, refund_status, refund_percent,
           refund_amount, late_cancel, customer_note, rules_snapshot, policy_snapshot,
           transfer_from_booking_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', 'web', ?, ?, 0, 'paid', ?, 'owner',
                   'none', 0, 0, 0, '', ?, ?, ?, ?, ?)`,
        [
          `T${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`,
          spec.claimedBy,
          booking.venueId,
          booking.courtId,
          booking.startAt,
          booking.endAt,
          askPrice,
          askPrice,
          completedAt,
          booking.rulesSnapshot,
          booking.policySnapshot,
          booking.id,
          completedAt,
          completedAt,
        ],
      );
      const newBookingId = newBooking.insertId;
      await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [bookingCode(newBookingId), newBookingId]);
      await claimForBooking(tx, { id: newBookingId, courtId: booking.courtId, startAt: booking.startAt });
      await tx.query(
        `UPDATE transfers SET status = 'completed', new_booking_id = ?, completed_at = ?, claim_expires_at = NULL
          WHERE id = ?`,
        [newBookingId, completedAt, transferId],
      );
      await addHistory(tx, booking.id, 'transfer_done', {
        from: 'confirmed', to: 'transferred', actor: { id: venue.ownerId, role: 'owner' },
        note: `Chủ sân xác nhận đã nhận ${money(askPrice)} của đội nhận`, at: completedAt,
      });
      await addHistory(tx, newBookingId, 'create', {
        to: 'confirmed', actor: { id: spec.claimedBy, role: 'customer' },
        note: 'Nhận pass từ lịch đặt cũ, chủ sân đã xác nhận nhận tiền', at: completedAt,
      });
    }
    seeded += 1;
  }
  return { transfers: seeded };
}

module.exports = { seedTransfers };
