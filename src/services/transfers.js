const { db, withTransaction, isDuplicate } = require('../db');
const clock = require('../clock');
const { RULES, BANKS } = require('../rules');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { vnToMs, msToVn, dateOf, timeOf } = require('../lib/time');
const { setStatus, claimForBooking } = require('./bookingState');
const { bookingCode } = require('./bookingCore');
const { addHistory, notify, money, shortTs } = require('./notify');
const { reliabilityOf } = require('./reliability');

const LIST_LIMIT = 200;
const ACTIVE = ['open', 'claimed'];
const actor = (user) => ({ id: user.id, role: user.role });
const transferRow = `SELECT t.*, b.code AS booking_code, b.user_id AS booking_user_id,
       b.venue_id, b.court_id, b.start_at, b.end_at, b.price AS original_price,
       b.refund_status, b.refund_amount, b.refund_percent,
       v.name AS venue_name, v.district, v.owner_id, v.bank_bin, v.bank_account, v.bank_account_name,
       c.name AS court_name, c.field_type
  FROM transfers t
  JOIN bookings b ON b.id = t.booking_id
  JOIN venues v ON v.id = b.venue_id
  JOIN courts c ON c.id = b.court_id`;

function transferQr(row) {
  if (!row.bankBin || !row.bankAccount) return null;
  const q = new URLSearchParams({ amount: String(row.askPrice), addInfo: `NH${row.bookingCode}`, accountName: row.bankAccountName });
  return {
    url: `https://img.vietqr.io/image/${row.bankBin}-${row.bankAccount}-compact2.svg?${q}`,
    bankName: BANKS.find((bank) => bank.bin === row.bankBin)?.name || row.bankBin,
    account: row.bankAccount,
    accountName: row.bankAccountName,
    amount: row.askPrice,
    content: `NH${row.bookingCode}`,
  };
}

async function toTransfer(row, viewer, conn = db) {
  const isOwner = viewer?.role === 'owner' && row.ownerId === viewer.id;
  const staff = isOwner || viewer?.role === 'admin';
  const role = !viewer ? null : viewer.id === row.fromUserId ? 'giver' : viewer.id === row.toUserId ? 'claimer' : staff ? 'staff' : null;
  const waitlist = viewer
    ? await conn.one(
      `SELECT id FROM waitlist
        WHERE user_id = ? AND court_id = ? AND start_at = ? AND status IN ('waiting', 'offered') LIMIT 1`,
      [viewer.id, row.courtId, row.startAt],
    )
    : null;
  const priorityActive = row.priorityUntil && vnToMs(row.priorityUntil) > clock.nowMs();
  const result = {
    id: row.id,
    status: row.status,
    askPrice: row.askPrice,
    originalPrice: row.originalPrice,
    discountPercent: Math.round((1 - row.askPrice / row.originalPrice) * 100),
    venueId: row.venueId,
    venueName: row.venueName,
    courtId: row.courtId,
    courtName: row.courtName,
    fieldType: row.fieldType,
    startAt: row.startAt,
    endAt: row.endAt,
    createdAt: row.createdAt,
    closesAt: row.closesAt,
    priorityUntil: row.status === 'open' && priorityActive ? row.priorityUntil : null,
    priorityLocked: row.status === 'open' && !!priorityActive && !waitlist,
    role,
    claimedAt: row.claimedAt,
    claimExpiresAt: row.status === 'claimed' && role ? row.claimExpiresAt : null,
    endReason: row.endReason || null,
  };

  if (role === 'giver' || staff) {
    result.bookingId = row.bookingId;
    result.bookingCode = row.bookingCode;
    result.refund = row.status === 'completed' ? { status: row.refundStatus, amount: row.refundAmount } : null;
  }
  if (role === 'claimer') {
    result.newBookingId = row.newBookingId;
    result.paymentQr = row.status === 'claimed' ? transferQr(row) : null;
  }
  if (staff) {
    const giver = await conn.one('SELECT full_name FROM users WHERE id = ?', [row.fromUserId]);
    const claimer = row.toUserId ? await conn.one('SELECT full_name, phone FROM users WHERE id = ?', [row.toUserId]) : null;
    result.giverName = giver.fullName;
    result.claimerName = claimer?.fullName || null;
    result.claimerPhone = claimer?.phone || null;
    result.claimerReliability = row.toUserId ? await reliabilityOf(conn, row.toUserId) : null;
    result.newBookingId = row.newBookingId;
    result.paymentContent = `NH${row.bookingCode}`;
  }
  return result;
}

async function loadTransfer(id, conn = db, lock = false) {
  return conn.one(`${transferRow} WHERE t.id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
}

async function findTransfer(id) {
  const row = /^\d+$/.test(String(id)) ? await loadTransfer(Number(id)) : null;
  if (!row) throw notFound('Không tìm thấy sân pass này');
  return row;
}

async function createTransfer(user, bookingId, askPrice) {
  if (!/^\d+$/.test(String(bookingId))) throw notFound('Không tìm thấy lịch đặt');
  const id = await withTransaction(async (tx) => {
    const booking = await tx.one('SELECT * FROM bookings WHERE id = ? AND user_id = ? FOR UPDATE', [bookingId, user.id]);
    if (!booking) throw notFound('Không tìm thấy lịch đặt');
    if (booking.matchId) throw conflict('Sân ghép kèo không pass được');
    if (booking.status !== 'confirmed') throw conflict('Chỉ pass được sân đã đặt xong');
    if (booking.paymentStatus !== 'paid') throw conflict('Chỉ pass được sân đã chuyển khoản (tiền bạn được nhận lại lấy từ tiền đội nhận trả)');
    const active = await tx.one("SELECT id FROM transfers WHERE booking_id = ? AND status IN ('open', 'claimed')", [booking.id]);
    if (active) throw conflict('Lịch đặt này đang được đăng pass');
    const closesAtMs = vnToMs(booking.startAt) - RULES.transferCloseMinutes * 60000;
    if (closesAtMs <= clock.nowMs()) throw badRequest(`Đã hết thời gian pass: phải đăng trước giờ đá ${RULES.transferCloseMinutes} phút`);
    const ask = Number(askPrice);
    if (!Number.isInteger(ask) || ask <= 0 || ask % 1000 !== 0) throw badRequest('Giá pass phải là số tròn nghìn đồng');
    if (ask > booking.price) throw badRequest(`Giá pass không được cao hơn số tiền bạn đã trả (${money(booking.price)})`);

    const waiters = await tx.query(
      "SELECT user_id FROM waitlist WHERE court_id = ? AND start_at = ? AND status IN ('waiting', 'offered') ORDER BY id FOR UPDATE",
      [booking.courtId, booking.startAt],
    );
    const now = clock.now();
    const closesAt = msToVn(closesAtMs);
    const priorityUntil = waiters.length
      ? msToVn(Math.min(clock.nowMs() + RULES.waitlistOfferMinutes * 60000, closesAtMs))
      : null;
    const inserted = await tx.query(
      `INSERT INTO transfers (booking_id, from_user_id, ask_price, status, created_at, closes_at, priority_until)
       VALUES (?, ?, ?, 'open', ?, ?, ?)`,
      [booking.id, user.id, ask, now, closesAt, priorityUntil],
    );
    const transferId = inserted.insertId;
    const venue = await tx.one('SELECT name, owner_id FROM venues WHERE id = ?', [booking.venueId]);
    const court = await tx.one('SELECT name FROM courts WHERE id = ?', [booking.courtId]);
    await addHistory(tx, booking.id, 'transfer_open', { actor: actor(user), note: `Giá pass ${money(ask)}`, at: now });
    for (const waiter of waiters) {
      await notify(tx, waiter.userId,
        `Có đội đăng pass giờ ${shortTs(booking.startAt)} tại ${venue.name} · ${court.name}, giá ${money(ask)}. Bạn đang chờ giờ này nên được ưu tiên nhận đến ${timeOf(priorityUntil)}.`,
        { link: `/transfer.html?id=${transferId}`, at: now });
    }
    await notify(tx, venue.ownerId,
      `Đội đặt ${booking.code} đăng pass giờ ${shortTs(booking.startAt)}, giá ${money(ask)} (họ đã trả ${money(booking.price)}). Có đội nhận, bạn sẽ được báo để xác nhận đã nhận tiền.`,
      { bookingId: booking.id, link: '/owner-bookings.html#transfers', at: now });
    return transferId;
  });
  return toTransfer(await loadTransfer(id), user);
}

async function claimTransfer(user, id) {
  await withTransaction(async (tx) => {
    const transfer = await loadTransfer(id, tx, true);
    if (!transfer) throw notFound('Không tìm thấy sân pass này');
    if (transfer.fromUserId === user.id) throw badRequest('Bạn không thể nhận sân do chính mình đăng pass');
    if (transfer.status === 'claimed') throw conflict('Đã có đội khác nhận sân này');
    if (transfer.status !== 'open') throw conflict('Sân pass này không còn mở');
    if (vnToMs(transfer.closesAt) <= clock.nowMs()) throw conflict('Đã hết thời gian nhận pass');

    const isWaiter = await tx.one(
      "SELECT id FROM waitlist WHERE user_id = ? AND court_id = ? AND start_at = ? AND status IN ('waiting', 'offered') LIMIT 1",
      [user.id, transfer.courtId, transfer.startAt],
    );
    if (transfer.priorityUntil && vnToMs(transfer.priorityUntil) > clock.nowMs() && !isWaiter) {
      throw conflict(`Đang ưu tiên cho người đã đăng ký chờ giờ này đến ${timeOf(transfer.priorityUntil)}`);
    }

    const now = clock.now();
    const expiresAt = msToVn(clock.nowMs() + RULES.holdMinutes * 60000);
    await tx.query(
      `UPDATE transfers SET status = 'claimed', to_user_id = ?, claimed_at = ?, claim_expires_at = ?
        WHERE id = ?`,
      [user.id, now, expiresAt, transfer.id],
    );
    await tx.query('DELETE FROM waitlist WHERE user_id = ? AND court_id = ? AND start_at = ?', [user.id, transfer.courtId, transfer.startAt]);
    await addHistory(tx, transfer.bookingId, 'transfer_claim', { note: 'Có đội nhận, chờ chủ sân xác nhận đã nhận tiền', at: now });
    await notify(tx, transfer.bookingUserId,
      `Đã có đội nhận sân ${transfer.bookingCode} với giá ${money(transfer.askPrice)}. Đang chờ chủ sân xác nhận đã nhận tiền, lúc này sân vẫn là của bạn.`,
      { bookingId: transfer.bookingId, link: `/booking.html?id=${transfer.bookingId}`, at: now });
    await notify(tx, transfer.ownerId,
      `${user.fullName} nhận pass sân ${transfer.bookingCode} (${transfer.courtName} ${shortTs(transfer.startAt)}), chuyển ${money(transfer.askPrice)} nội dung NH${transfer.bookingCode}. Nhận được tiền thì bấm xác nhận trước ${timeOf(expiresAt)}.`,
      { bookingId: transfer.bookingId, link: '/owner-bookings.html#transfers', at: now });
  });
  return toTransfer(await findTransfer(id), user);
}

async function closeTransfer(tx, transfer, { status, actor: actingUser = null, reason = '', notifyClaimer = true } = {}) {
  const now = clock.now();
  await tx.query(
    `UPDATE transfers SET status = ?, to_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL,
            end_reason = ? WHERE id = ?`,
    [status, reason || null, transfer.id],
  );
  const action = status === 'expired' ? 'transfer_expire' : 'transfer_withdraw';
  await addHistory(tx, transfer.bookingId, action, { actor: actingUser && actor(actingUser), note: reason, at: now });
  if (notifyClaimer && transfer.toUserId) {
    await notify(tx, transfer.toUserId,
      `Đăng pass ${shortTs(transfer.startAt)} tại ${transfer.venueName} đã đóng${reason ? `: ${reason}` : ''}. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân để lấy lại tiền.`,
      { link: `/transfer.html?id=${transfer.id}`, at: now });
  }
}

async function closeTransferForBookingCancellation(tx, bookingId, user, by) {
  const transfer = await tx.one(
    `${transferRow} WHERE t.booking_id = ? AND t.status IN ('open', 'claimed') FOR UPDATE`,
    [bookingId],
  );
  if (!transfer) return;
  if (transfer.status === 'claimed' && by === 'customer') {
    throw conflict('Đang có đội nhận pass, hãy chờ chủ sân xác nhận hoặc từ chối rồi hủy');
  }
  await closeTransfer(tx, transfer, {
    status: 'cancelled',
    actor: by === 'customer' ? user : null,
    reason: 'Lịch đặt bị hủy nên đóng đăng pass',
  });
}

async function withdrawTransfer(user, id) {
  await withTransaction(async (tx) => {
    const transfer = await loadTransfer(id, tx, true);
    if (!transfer || transfer.fromUserId !== user.id) throw notFound('Không tìm thấy sân pass này');
    if (transfer.status === 'claimed') throw conflict('Đã có đội nhận, đang chờ chủ sân xác nhận hoặc từ chối');
    if (transfer.status !== 'open') throw conflict('Sân pass này không còn mở');
    await closeTransfer(tx, transfer, { status: 'cancelled', actor: user, reason: 'Bạn rút đăng pass' });
  });
  return { ok: true };
}

async function confirmTransfer(user, id, note = '') {
  await withTransaction(async (tx) => {
    const transfer = await loadTransfer(id, tx, true);
    if (!transfer) throw notFound('Không tìm thấy sân pass này');
    if (transfer.ownerId !== user.id) throw forbidden('Sân pass này không thuộc sân của bạn');
    if (transfer.status !== 'claimed') throw conflict('Chưa có đội nhận hoặc sân pass đã xử lý xong');
    if (vnToMs(transfer.claimExpiresAt) <= clock.nowMs()) throw conflict('Lượt nhận đã quá hạn, sân được mở pass lại cho đội khác');

    const booking = await tx.one('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [transfer.bookingId]);
    if (!booking || booking.status !== 'confirmed' || booking.paymentStatus !== 'paid') throw conflict('Lịch đặt không còn hợp lệ để đổi chủ');
    const now = clock.now();
    await setStatus(tx, booking.id, 'transferred', {
      expires_at: null,
      cancel_reason: 'Đã pass cho đội khác',
      cancelled_at: now,
      late_cancel: 0,
      refund_amount: transfer.askPrice,
      refund_percent: Math.round((transfer.askPrice / booking.price) * 100),
      refund_status: 'pending',
    });
    const inserted = await tx.query(
      `INSERT INTO bookings (
         code, user_id, venue_id, court_id, start_at, end_at, status, source, expires_at,
         price, base_price, discount_percent, payment_status, paid_at, paid_via,
         refund_status, refund_percent, refund_amount, cancelled_by, cancelled_at, cancel_reason, late_cancel,
         customer_note, rules_snapshot, policy_snapshot, transfer_from_booking_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', 'web', NULL, ?, ?, 0, 'paid', ?, 'owner',
                 'none', 0, 0, NULL, NULL, NULL, 0, '', ?, ?, ?, ?, ?)`,
      [
        `T${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`,
        transfer.toUserId,
        booking.venueId,
        booking.courtId,
        booking.startAt,
        booking.endAt,
        transfer.askPrice,
        transfer.askPrice,
        now,
        booking.rulesSnapshot,
        booking.policySnapshot,
        booking.id,
        now,
        now,
      ],
    );
    const newBookingId = inserted.insertId;
    const newCode = bookingCode(newBookingId);
    await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [newCode, newBookingId]);
    await claimForBooking(tx, { id: newBookingId, courtId: booking.courtId, startAt: booking.startAt });
    await tx.query(
      `UPDATE transfers SET status = 'completed', new_booking_id = ?, completed_at = ?, claim_expires_at = NULL
        WHERE id = ?`,
      [newBookingId, now, transfer.id],
    );
    await addHistory(tx, booking.id, 'transfer_done', {
      from: 'confirmed', to: 'transferred', actor: actor(user),
      note: String(note || `Chủ sân xác nhận đã nhận ${money(transfer.askPrice)} của đội nhận`), at: now,
    });
    await addHistory(tx, newBookingId, 'create', {
      to: 'confirmed', actor: { id: transfer.toUserId, role: 'customer' },
      note: 'Nhận pass từ lịch đặt cũ, chủ sân đã xác nhận nhận tiền', at: now,
    });
    await notify(tx, booking.userId,
      `Sân ${booking.code} đã sang đội khác. Chủ sân sẽ chuyển lại ${money(transfer.askPrice)} cho bạn và ghi nhận khi xong.`,
      { bookingId: booking.id, link: `/booking.html?id=${booking.id}`, at: now });
    await notify(tx, transfer.toUserId,
      `Bạn đã nhận pass thành công (mã ${newCode}): ${transfer.courtName} ${shortTs(booking.startAt)} tại ${transfer.venueName}. Chủ sân đã nhận ${money(transfer.askPrice)}.`,
      { bookingId: newBookingId, link: `/booking.html?id=${newBookingId}`, at: now });
  });
  return toTransfer(await findTransfer(id), user);
}

async function rejectTransfer(user, id, reason) {
  const text = String(reason || '').trim();
  if (!text) throw badRequest('Vui lòng nhập lý do từ chối đội nhận');
  await withTransaction(async (tx) => {
    const transfer = await loadTransfer(id, tx, true);
    if (!transfer) throw notFound('Không tìm thấy sân pass này');
    if (transfer.ownerId !== user.id) throw forbidden('Sân pass này không thuộc sân của bạn');
    if (transfer.status !== 'claimed') throw conflict('Chưa có đội nhận để từ chối');

    const status = vnToMs(transfer.closesAt) > clock.nowMs() ? 'open' : 'expired';
    const now = clock.now();
    await tx.query(
      `UPDATE transfers SET status = ?, to_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL,
              end_reason = ? WHERE id = ?`,
      [status, text.slice(0, 255), transfer.id],
    );
    await addHistory(tx, transfer.bookingId, 'transfer_reject', { actor: actor(user), note: text.slice(0, 300), at: now });
    await notify(tx, transfer.toUserId,
      `Chủ sân từ chối lượt nhận pass ${shortTs(transfer.startAt)}: ${text.slice(0, 200)}. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân để lấy lại tiền.`,
      { link: `/transfer.html?id=${transfer.id}`, at: now });
    await notify(tx, transfer.bookingUserId,
      `Chủ sân từ chối đội nhận sân ${transfer.bookingCode}${status === 'open' ? '; sân của bạn được mở pass lại' : ''}.`,
      { bookingId: transfer.bookingId, link: `/booking.html?id=${transfer.bookingId}`, at: now });
  });
  return toTransfer(await findTransfer(id), user);
}

async function listTransfers({ venueId, date, district, viewer } = {}) {
  const where = ["t.status = 'open'", 't.closes_at > ?'];
  const values = [clock.now()];
  if (venueId) { where.push('v.id = ?'); values.push(Number(venueId)); }
  if (date) { where.push('DATE(b.start_at) = ?'); values.push(date); }
  if (district) { where.push('v.district = ?'); values.push(district); }
  const rows = await db.query(
    `${transferRow} WHERE ${where.join(' AND ')} ORDER BY b.start_at LIMIT ${LIST_LIMIT}`,
    values,
  );
  return Promise.all(rows.map((row) => toTransfer(row, viewer)));
}

async function listMine(user) {
  const rows = await db.query(
    `${transferRow} WHERE t.from_user_id = ? OR t.to_user_id = ? ORDER BY t.id DESC LIMIT ${LIST_LIMIT}`,
    [user.id, user.id],
  );
  return Promise.all(rows.map((row) => toTransfer(row, user)));
}

async function listForOwner(user) {
  const rows = await db.query(
    `${transferRow}
      WHERE v.owner_id = ? AND (t.status IN ('open', 'claimed') OR (t.status = 'completed' AND b.refund_status = 'pending'))
      ORDER BY CASE t.status WHEN 'claimed' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END, t.closes_at`,
    [user.id],
  );
  return Promise.all(rows.map((row) => toTransfer(row, user)));
}

async function getTransfer(id, viewer) {
  return toTransfer(await findTransfer(id), viewer);
}

async function sweepTransfers() {
  const now = clock.now();
  const due = await db.query(
    `SELECT id FROM transfers
      WHERE (status = 'claimed' AND claim_expires_at <= ?)
         OR (status = 'open' AND closes_at <= ?)
      ORDER BY id`,
    [now, now],
  );
  for (const { id } of due) {
    await withTransaction(async (tx) => {
      const transfer = await loadTransfer(id, tx, true);
      if (!transfer) return;
      const at = clock.now();
      if (transfer.status === 'claimed' && transfer.claimExpiresAt && vnToMs(transfer.claimExpiresAt) <= clock.nowMs()) {
        const claimerId = transfer.toUserId;
        await tx.query(
          `UPDATE transfers SET status = 'open', to_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL
            WHERE id = ?`,
          [transfer.id],
        );
        await addHistory(tx, transfer.bookingId, 'transfer_release', { note: 'Quá hạn chờ chủ sân nhận tiền, mở pass lại cho đội khác', at });
        if (claimerId) {
          await notify(tx, claimerId,
            `Lượt nhận pass ${shortTs(transfer.startAt)} đã quá hạn vì chủ sân chưa xác nhận đã nhận tiền. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân.`,
            { link: `/transfer.html?id=${transfer.id}`, at });
        }
        await notify(tx, transfer.bookingUserId,
          `Đội nhận sân ${transfer.bookingCode} chưa chuyển khoản kịp nên sân của bạn được mở pass lại.`,
          { bookingId: transfer.bookingId, link: `/booking.html?id=${transfer.bookingId}`, at });
        transfer.status = 'open';
      }
      if (transfer.status === 'open' && vnToMs(transfer.closesAt) <= clock.nowMs()) {
        await closeTransfer(tx, transfer, { status: 'expired', reason: 'Không có đội nào nhận trước hạn pass', notifyClaimer: false });
        await notify(tx, transfer.bookingUserId,
          `Không có đội nào nhận sân ${transfer.bookingCode} kịp giờ. Sân vẫn là của bạn; nếu không đá được, bạn có thể hủy đặt sân.`,
          { bookingId: transfer.bookingId, link: `/booking.html?id=${transfer.bookingId}`, at });
      }
    });
  }
}

module.exports = {
  createTransfer,
  claimTransfer,
  withdrawTransfer,
  confirmTransfer,
  rejectTransfer,
  listTransfers,
  listMine,
  listForOwner,
  getTransfer,
  closeTransferForBookingCancellation,
  sweepTransfers,
};
