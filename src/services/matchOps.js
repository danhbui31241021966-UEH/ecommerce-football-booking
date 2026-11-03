// Ghép kèo (R13) và kèo tiền sân (R15). Trận = một booking `matching` giữ ô + một dòng `matches`; hai đội mỗi bên chuyển
// trước nửa tiền sân cho chủ sân, chủ sân xác nhận từng phần, đủ hai phần thì booking `confirmed` + `paid`.
// Quy tắc đồng thời: mọi thao tác khóa dòng matches TRƯỚC (FOR UPDATE), rồi mới đụng bookings (bookingState.setStatus khóa nó),
// nên hai đội vào cùng lúc, hoặc vào đúng lúc chủ sân từ chối/hết hạn, tuần tự hóa và bên sau nhận 409. Mọi đổi status booking
// đi qua setStatus nên slot_claims luôn khớp. Mốc thời gian chỉ lấy từ src/clock.js (không dùng NOW() của SQL).
// Code ở đây chỉ so dữ liệu có cấu trúc (id, trạng thái, số tiền, mốc giờ, winner ∈ host/guest/draw); không đọc ý nghĩa chữ nào.
const crypto = require('crypto');
const clock = require('../clock');
const { db, withTransaction, isDuplicate } = require('../db');
const { RULES, BANKS, CANCEL_POLICY_TEXT } = require('../rules');
const { vnToMs, msToVn, isDate, isHm, addDays } = require('../lib/time');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { loadCourt } = require('./venueStore');
const { slotGrid, slotEndAt, teamModeAt } = require('./slotGrid');
const { loadOccupancy, slotInfo } = require('./schedule');
const { claimForBooking, setStatus, TAKEN } = require('./bookingState');
const { notify, addHistory, money, shortTs } = require('./notify');
const { offerSlot } = require('./waitlist');
const { reliabilityOf } = require('./reliability');
const { bookingCode } = require('./bookingCore');
const { vietQr } = require('./bookingView');

const STAKES = [50, 60, 70, 100]; // R15: % tiền sân đội thua chịu
const REPORT_HOURS = 48; // hạn hai đội báo kết quả sau giờ đá (R15c)
const TOPUP_HOURS = 48; // hạn trả phần chênh (R15e), chỉ để hiện "quá hạn"
const LIST_LIMIT = 200;
const ACTIVE = ['open', 'joined'];

const roundThousand = (n) => Math.round(n / 1000) * 1000;
const halfOf = (price) => Math.min(price - 1000, Math.max(1000, roundThousand(price / 2)));
const loserShareOf = (m) => roundThousand((m.price * (m.loserPercent ?? 50)) / 100);
const hasStake = (m) => (m.loserPercent ?? 50) > 50;
const otherPart = (p) => (p === 'host' ? 'guest' : 'host');
const partUser = (m, part) => (part === 'host' ? m.hostId : m.guestId);
const partAmount = (m, part) => (part === 'host' ? m.hostAmount : m.guestAmount);
const partName = (part) => (part === 'host' ? 'đội mở kèo' : 'đội vào kèo');
const payContent = (code, part) => `TD${code}${part === 'host' ? 'A' : 'B'}`;
const stakeText = (p) => (p >= 100 ? 'thua bao sân' : `${p / 10}-${10 - p / 10}`);
const winnerText = (w) => (w === 'draw' ? 'hòa' : `${partName(w)} thắng`);
const matchLink = (id) => `/match.html?id=${id}`;
const OWNER_LINK = '/owner-bookings.html#matches';
const actorOf = (user) => (user ? { id: user.id, role: user.role } : null);
const bankName = (bin) => BANKS.find((x) => x.bin === bin)?.name || bin;

const MATCH_SELECT = `SELECT m.*, b.code AS booking_code, b.start_at, b.end_at, b.court_id, b.status AS booking_status,
    v.id AS venue_id, v.name AS venue_name, v.owner_id, v.district, v.bank_bin, v.bank_account, v.bank_account_name,
    c.name AS court_name, c.field_type, hu.full_name AS host_name, hu.phone AS host_phone, gu.full_name AS guest_name, gu.phone AS guest_phone
  FROM matches m JOIN bookings b ON b.id = m.booking_id JOIN courts c ON c.id = b.court_id JOIN venues v ON v.id = b.venue_id
  JOIN users hu ON hu.id = m.host_id LEFT JOIN users gu ON gu.id = m.guest_id`;

const findMatchRow = (id, conn = db) => conn.one(`${MATCH_SELECT} WHERE m.id = ?`, [id]);

/** Khóa dòng matches rồi đọc cả ngữ cảnh. Luôn gọi trước mọi thao tác trên bookings của trận. */
async function lockMatch(tx, id) {
  const m = await tx.one(`${MATCH_SELECT} WHERE m.id = ? FOR UPDATE OF m`, [id]);
  if (!m) throw notFound('Không tìm thấy kèo');
  return m;
}

function matchId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw notFound('Không tìm thấy kèo');
  return id;
}

const slotText = (m) => shortTs(m.startAt);
const bankOf = (m, part) => {
  const bin = m[`${part}BankBin`];
  return bin ? { bin, account: m[`${part}BankAccount`], accountName: m[`${part}BankName`] } : null;
};
const hostPending = (m, nowMs) => m.status === 'open' && !m.hostPaidAt && vnToMs(m.hostPayBy) > nowMs;
const guestPending = (m, nowMs) => m.status === 'joined' && !m.guestPaidAt && vnToMs(m.guestHoldUntil) > nowMs;
const joinable = (m, nowMs) => m.status === 'open' && !!m.hostPaidAt && vnToMs(m.closesAt) > nowMs;

/* ---------- Dựng dữ liệu theo contract ---------- */

function resultOut(m, role, staff, nowMs) {
  if (!m.resultStatus) return null;
  const mine = role === 'host' || role === 'guest' ? role : null;
  const out = {
    status: m.resultStatus,
    reportBy: m.reportBy,
    yourReport: mine ? m[`${mine}Report`] : null,
    otherReported: mine ? !!m[`${otherPart(mine)}Report`] : false,
    winner: m.winner || null,
    settledBy: m.settledBy || null,
    settledAt: m.settledAt || null,
    topUp: null,
  };
  if (staff) {
    out.hostReport = m.hostReport;
    out.guestReport = m.guestReport;
  }
  if (m.topupStatus && (mine || staff)) {
    out.topUp = {
      from: m.topupFrom, to: m.topupTo, amount: m.topupAmount, status: m.topupStatus, receivedAt: m.topupReceivedAt, dueBy: m.topupDueBy,
      overdue: m.topupStatus === 'unpaid' && vnToMs(m.topupDueBy) <= nowMs,
      toName: m.topupTo === 'host' ? m.hostName : m.guestName,
      fromName: m.topupFrom === 'host' ? m.hostName : m.guestName,
    };
  }
  return out;
}

/** Match theo contract cho `viewer` (null = chưa đăng nhập). Số tài khoản ngân hàng chỉ lộ cho đúng hai đội (R15f). */
async function present(rows, viewer) {
  if (!rows.length) return [];
  const refunds = await db.query('SELECT * FROM match_refunds WHERE match_id IN (?) ORDER BY id', [rows.map((m) => m.id)]);
  const nowMs = clock.nowMs();
  const out = [];
  for (const m of rows) {
    const isOwner = viewer?.role === 'owner' && viewer.id === m.ownerId;
    const staff = isOwner || viewer?.role === 'admin';
    const role = !viewer ? null : viewer.id === m.hostId ? 'host' : viewer.id === m.guestId ? 'guest' : staff ? 'staff' : null;
    const mine = role === 'host' || role === 'guest' ? role : null;
    const loserAmount = loserShareOf(m);
    const myRefunds = refunds.filter((r) => r.matchId === m.id);
    const dto = {
      id: m.id,
      status: m.status,
      venueId: m.venueId,
      venueName: m.venueName,
      courtId: m.courtId,
      courtName: m.courtName,
      fieldType: m.fieldType,
      startAt: m.startAt,
      endAt: m.endAt,
      price: m.price,
      loserPercent: m.loserPercent,
      loserAmount,
      winnerAmount: m.price - loserAmount,
      hostAmount: m.hostAmount,
      guestAmount: m.guestAmount,
      closesAt: m.closesAt,
      createdAt: m.createdAt,
      hostPaid: !!m.hostPaidAt,
      guestPaid: !!m.guestPaidAt,
      hasGuest: m.guestId != null,
      joinable: joinable(m, nowMs) && role !== 'host',
      role,
      guestHoldUntil: m.status === 'joined' && (role || staff) ? m.guestHoldUntil : null,
      hostPayBy: !m.hostPaidAt && m.status === 'open' && (role === 'host' || staff) ? m.hostPayBy : null,
      endReason: m.endReason || null,
      result: resultOut(m, role, staff, nowMs),
    };
    if (role) {
      dto.bookingId = m.bookingId;
      dto.bookingCode = m.bookingCode;
    }
    if (mine) {
      const amount = partAmount(m, mine);
      const due = mine === 'host' ? hostPending(m, nowMs) : guestPending(m, nowMs);
      const refund = myRefunds.find((r) => r.part === mine);
      dto.yourPart = { part: mine, amount, paid: !!m[`${mine}PaidAt`], refund: refund ? { status: refund.status, amount: refund.amount } : null };
      dto.paymentQr = due ? vietQr({ bin: m.bankBin, account: m.bankAccount, accountName: m.bankAccountName }, amount, payContent(m.bookingCode, mine)) : null;
      const own = bankOf(m, mine);
      dto.yourBank = own ? { ...own, bankName: bankName(own.bin) } : null;
      if (m.topupStatus === 'unpaid' && m.topupFrom === mine) {
        const wb = bankOf(m, m.topupTo);
        dto.topUpQr = wb ? vietQr(wb, m.topupAmount, `KEO${m.bookingCode}`) : null;
      }
    }
    if (staff) {
      dto.hostName = m.hostName;
      dto.hostPhone = m.hostPhone;
      dto.hostReliability = await reliabilityOf(db, m.hostId);
      dto.guestName = m.guestId ? m.guestName : null;
      dto.guestPhone = m.guestId ? m.guestPhone : null;
      dto.guestReliability = m.guestId ? await reliabilityOf(db, m.guestId) : null;
      dto.bookingId = m.bookingId;
      dto.bookingCode = m.bookingCode;
      dto.hostContent = payContent(m.bookingCode, 'host');
      dto.guestContent = payContent(m.bookingCode, 'guest');
      dto.refunds = myRefunds.map((r) => ({ part: r.part, name: r.part === 'host' ? m.hostName : m.guestName, amount: r.amount, status: r.status }));
    }
    out.push(dto);
  }
  return out;
}

const presentOne = async (id, viewer) => (await present([await findMatchRow(id)], viewer))[0];

async function getMatch(id, viewer) {
  const row = await findMatchRow(matchId(id));
  if (!row) throw notFound('Không tìm thấy kèo');
  return (await present([row], viewer))[0];
}

/** Kèo đang nhận đội thứ hai (chủ sân đã xác nhận phần của đội mở, chưa hết hạn, chưa có đội vào). Xem được khi chưa đăng nhập. */
async function listOpen({ venueId, date, district } = {}, viewer) {
  const where = ["m.status = 'open'", 'm.host_paid_at IS NOT NULL', 'm.closes_at > ?'];
  const params = [clock.now()];
  if (venueId) { where.push('v.id = ?'); params.push(Number(venueId) || 0); }
  if (date) {
    if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
    where.push('b.start_at >= ? AND b.start_at < ?');
    params.push(`${date} 00:00:00`, `${addDays(date, 1)} 00:00:00`);
  }
  if (district) { where.push('v.district = ?'); params.push(String(district)); }
  return present(await db.query(`${MATCH_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.start_at, m.id LIMIT ${LIST_LIMIT}`, params), viewer);
}

async function listMine(user) {
  return present(await db.query(`${MATCH_SELECT} WHERE m.host_id = ? OR m.guest_id = ? ORDER BY m.id DESC LIMIT ${LIST_LIMIT}`, [user.id, user.id]), user);
}

/** Kèo của sân mình cần xử lý: đang mở/chờ, còn khoản trả lại đang chờ, hoặc đang chờ báo/chốt kết quả. */
async function listForOwner(user) {
  const rows = await db.query(
    `${MATCH_SELECT} WHERE v.owner_id = ? AND (m.status IN ('open','joined') OR m.result_status IN ('awaiting','needs_owner')
        OR EXISTS (SELECT 1 FROM match_refunds r WHERE r.match_id = m.id AND r.status = 'pending'))
      ORDER BY b.start_at, m.id LIMIT ${LIST_LIMIT}`,
    [user.id],
  );
  return present(rows, user);
}

/* ---------- Mở kèo, vào kèo, rút ---------- */

async function openMatch(user, body = {}) {
  const courtId = Number(body.courtId);
  const { date, start } = body;
  if (!Number.isInteger(courtId) || courtId < 1) throw badRequest('Thiếu sân cần mở kèo');
  if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
  if (!isHm(start)) throw badRequest('Giờ không hợp lệ');
  const found = await loadCourt(courtId);
  if (!found) throw notFound('Không tìm thấy sân');
  const { venue, court } = found;
  if (!slotGrid(venue).includes(start)) throw badRequest('Giờ bắt đầu không khớp lịch của sân');
  const today = clock.today();
  if (date < today || date > addDays(today, RULES.bookingWindowDays - 1)) throw badRequest(`Chỉ đặt trước tối đa ${RULES.bookingWindowDays} ngày`);
  if (!teamModeAt(court, start)) throw conflict('Giờ này không ghép kèo, bạn đặt sân như bình thường nhé');
  const occ = await loadOccupancy([court.id], date);
  const slot = slotInfo(venue, court, date, start, occ, user);
  if (slot.status === 'past') throw badRequest('Giờ này đã qua giờ bắt đầu');
  if (slot.status === 'blocked') throw conflict('Giờ này chủ sân đang chặn');
  if (slot.status === 'booked' || slot.status === 'held') throw conflict(TAKEN);
  if (slot.status === 'offered' && !slot.offeredToYou) throw conflict('Giờ này đang giữ cho người đã đăng ký chờ');
  const nowMs = clock.nowMs();
  const startMs = vnToMs(`${date} ${start}`);
  const latest = startMs - RULES.matchCloseMinutes * 60000;
  const earliest = nowMs + RULES.matchMinOpenMinutes * 60000;
  if (latest < earliest) throw badRequest('Còn quá ít thời gian để tìm đủ hai đội cho giờ này');
  const closesRaw = String(body.closesAt ?? '');
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(closesRaw)) throw badRequest('Vui lòng chọn hạn tìm đội');
  const closesMs = vnToMs(closesRaw);
  if (!Number.isFinite(closesMs)) throw badRequest('Vui lòng chọn hạn tìm đội');
  if (closesMs < earliest || closesMs > latest) throw badRequest(`Hạn tìm đội phải từ ${RULES.matchMinOpenMinutes} phút sau bây giờ đến ${RULES.matchCloseMinutes} phút trước giờ đá`);
  const loserPercent = Number(body.loserPercent);
  if (!STAKES.includes(loserPercent)) throw badRequest('Kèo tiền sân chỉ có 5-5, 6-4, 7-3 hoặc thua bao sân');

  const price = slot.basePrice; // R13a: giá thường, không giảm giờ chót
  const hostAmount = halfOf(price);
  const now = clock.now();
  const startAt = `${date} ${start}:00`;
  const closesAt = msToVn(closesMs);
  const hostPayBy = msToVn(Math.min(nowMs + RULES.holdMinutes * 60000, closesMs));
  try {
    const id = await withTransaction(async (tx) => {
      const r = await tx.query(
        `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, price, base_price, discount_percent,
           customer_note, rules_snapshot, policy_snapshot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'matching', 'web', ?, ?, 0, '', ?, ?, ?, ?)`,
        [`T${crypto.randomBytes(8).toString('hex')}`, user.id, venue.id, court.id, startAt, slotEndAt(venue, date, start), price, price, venue.rules, CANCEL_POLICY_TEXT, now, now],
      );
      const bookingId = r.insertId;
      const code = bookingCode(bookingId);
      await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [code, bookingId]);
      await claimForBooking(tx, { id: bookingId, courtId: court.id, startAt });
      const m = await tx.query(
        `INSERT INTO matches (booking_id, host_id, price, loser_percent, host_amount, guest_amount, status, created_at, closes_at, host_pay_by)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
        [bookingId, user.id, price, loserPercent, hostAmount, price - hostAmount, now, closesAt, hostPayBy],
      );
      await tx.query('UPDATE bookings SET match_id = ? WHERE id = ?', [m.insertId, bookingId]);
      await tx.query('DELETE FROM waitlist WHERE user_id = ? AND court_id = ? AND start_at = ?', [user.id, court.id, startAt]);
      const label = shortTs(startAt);
      await addHistory(tx, bookingId, 'create', { to: 'matching', actor: actorOf(user), at: now, note: `Mở kèo ${stakeText(loserPercent)}, phần của đội mở kèo ${money(hostAmount)}, hạn tìm đội ${shortTs(closesAt)}` });
      await notify(tx, venue.ownerId, `${user.fullName} mở kèo ${court.name} ${label} và sẽ chuyển ${money(hostAmount)}, nội dung ${payContent(code, 'host')}. Nhận được tiền thì bấm xác nhận trước ${hostPayBy.slice(11, 16)}.`, { bookingId, link: OWNER_LINK });
      await notify(tx, user.id, `Đã giữ ${court.name} ${label} cho kèo của bạn. Hãy chuyển ${money(hostAmount)} cho chủ sân trước ${hostPayBy.slice(11, 16)} để kèo hiện cho đội khác.`, { link: matchLink(m.insertId) });
      return m.insertId;
    });
    return await presentOne(id, user);
  } catch (err) {
    if (isDuplicate(err)) throw conflict(TAKEN); // ô vừa bị người khác lấy giữa lúc kiểm và lúc ghi
    throw err;
  }
}

async function joinMatch(user, rawId) {
  const id = matchId(rawId);
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    if (m.hostId === user.id) throw badRequest('Bạn là đội mở kèo này');
    if (m.guestId != null) throw conflict('Đã có đội khác vào kèo này');
    if (m.status !== 'open') throw conflict('Kèo này không còn mở');
    if (!m.hostPaidAt) throw conflict('Chủ sân chưa nhận tiền của đội mở kèo nên bạn chưa vào được');
    const nowMs = clock.nowMs();
    if (vnToMs(m.closesAt) <= nowMs) throw conflict('Kèo đã quá hạn tìm đội');
    const now = clock.now();
    const hold = msToVn(Math.min(nowMs + RULES.holdMinutes * 60000, vnToMs(m.closesAt)));
    // Lớp thứ hai sau khóa dòng: chỉ ghi khi kèo vẫn còn trống.
    const r = await tx.query(
      "UPDATE matches SET guest_id = ?, status = 'joined', joined_at = ?, guest_hold_until = ? WHERE id = ? AND status = 'open' AND guest_id IS NULL",
      [user.id, now, hold, id],
    );
    if (r.affectedRows !== 1) throw conflict('Đã có đội khác vào kèo này');
    await tx.query('DELETE FROM waitlist WHERE user_id = ? AND court_id = ? AND start_at = ?', [user.id, m.courtId, m.startAt]);
    await addHistory(tx, m.bookingId, 'match_join', { actor: actorOf(user), note: `Đội vào kèo, phần ${money(m.guestAmount)}` });
    await notify(tx, m.hostId, `Đã có đội vào kèo ${slotText(m)}. Kèo chốt khi đội đó chuyển ${money(m.guestAmount)} và chủ sân nhận được.`, { link: matchLink(id) });
    await notify(tx, m.ownerId, `${user.fullName} vào kèo ${m.courtName} ${slotText(m)} và sẽ chuyển ${money(m.guestAmount)}, nội dung ${payContent(m.bookingCode, 'guest')}. Nhận được tiền thì bấm xác nhận trước ${hold.slice(11, 16)}.`, { bookingId: m.bookingId, link: OWNER_LINK });
  });
  return presentOne(id, user);
}

/** Đội vào rời trận (chủ sân từ chối, hoặc hết hạn giữ chỗ): trận mở lại cho đội khác. Gọi trong transaction đã khóa matches. */
async function releaseGuest(tx, m, reasonForGuest, actor = null) {
  await tx.query("UPDATE matches SET guest_id = NULL, guest_hold_until = NULL, joined_at = NULL, status = 'open' WHERE id = ?", [m.id]);
  await addHistory(tx, m.bookingId, 'match_release', { actor, note: 'Đội vào kèo đã rút, kèo mở lại cho đội khác' });
  await notify(tx, m.guestId, `Bạn không còn trong kèo ${slotText(m)}. ${reasonForGuest}`, { link: matchLink(m.id) });
  await notify(tx, m.hostId, `Đội vào kèo đã rút khỏi kèo ${slotText(m)}; kèo mở lại cho đội khác đến ${shortTs(m.closesAt)}.`, { link: matchLink(m.id) });
}

/**
 * Trận kết thúc không đủ hai đội: nhả ô, ghi khoản trả lại cho từng đội đã được chủ sân xác nhận nhận tiền (refundPercent theo đội).
 * by = 'customer' | 'owner' | 'admin' (hủy) hoặc null (hết hạn). Gọi trong transaction đã khóa matches.
 */
async function endMatch(tx, m, status, reason, { actor = null, by = null, refundPercent = { host: 100, guest: 100 }, lateCancel = false, at = null } = {}) {
  const now = at || clock.now();
  await tx.query("UPDATE matches SET status = ?, end_reason = ?, ended_at = ?, guest_hold_until = NULL WHERE id = ?", [status, reason.slice(0, 300), now, m.id]);
  const refunds = [];
  for (const part of ['host', 'guest']) {
    const paid = m[`${part}PaidAt`];
    const amount = paid ? Math.round((partAmount(m, part) * (refundPercent[part] ?? 100)) / 100) : 0;
    if (amount > 0) {
      refunds.push({ part, userId: partUser(m, part), amount });
      await tx.query('INSERT INTO match_refunds (match_id, part, user_id, amount, status) VALUES (?, ?, ?, ?, ?)', [m.id, part, partUser(m, part), amount, 'pending']);
    }
  }
  const total = refunds.reduce((s, r) => s + r.amount, 0);
  await setStatus(tx, m.bookingId, by ? 'cancelled' : 'expired', {
    cancelled_by: by, cancel_reason: reason.slice(0, 255), cancelled_at: now, late_cancel: lateCancel ? 1 : 0,
    refund_amount: total, refund_percent: m.price ? Math.round((total / m.price) * 100) : 0, refund_status: total > 0 ? 'pending' : 'none',
  });
  await addHistory(tx, m.bookingId, by ? 'match_cancel' : 'match_expire', { from: m.bookingStatus, to: by ? 'cancelled' : 'expired', actor, note: reason, at: now });
  for (const r of refunds) {
    await notify(tx, r.userId, `Kèo ${slotText(m)} tại ${m.venueName} không thành: ${reason} Chủ sân sẽ chuyển lại ${money(r.amount)} cho bạn và ghi nhận khi xong.`, { link: matchLink(m.id) });
  }
  for (const uid of [m.hostId, m.guestId]) {
    if (uid != null && !refunds.some((r) => r.userId === uid)) {
      await notify(tx, uid, `Kèo ${slotText(m)} tại ${m.venueName} không thành: ${reason} Chủ sân chưa nhận tiền của bạn nên không có tiền để trả lại.`, { link: matchLink(m.id) });
    }
  }
  if (refunds.length) {
    await notify(tx, m.ownerId, `Kèo ${m.bookingCode} (${slotText(m)}) không thành. Bạn cần chuyển lại ${refunds.map((r) => money(r.amount)).join(' và ')} cho các đội đã trả.`, { link: OWNER_LINK, bookingId: m.bookingId });
  }
  await offerSlot(tx, m.courtId, m.startAt);
}

/** Đội mở kèo rút. Chưa có đội vào: miễn phí, hoàn đủ phần đã được xác nhận. Đã có đội vào: hoàn phần của đội mở theo R7, dưới 12 giờ là hủy muộn (R10). */
async function withdrawMatch(user, rawId) {
  const id = matchId(rawId);
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    if (m.hostId !== user.id) throw notFound('Không tìm thấy kèo');
    if (!ACTIVE.includes(m.status)) throw conflict('Kèo này đã kết thúc');
    const withGuest = m.status === 'joined';
    let percent = 100;
    let late = false;
    if (withGuest) {
      const hoursLeft = (vnToMs(m.startAt) - clock.nowMs()) / 3600000;
      percent = hoursLeft >= 24 ? 100 : hoursLeft >= 12 ? 50 : 0;
      late = hoursLeft < 12;
    }
    await endMatch(tx, m, 'cancelled', withGuest ? 'Đội mở kèo đã rút sau khi có đội vào.' : 'Đội mở kèo đã rút trước khi có đội vào.', {
      actor: actorOf(user), by: 'customer', refundPercent: { host: percent, guest: 100 }, lateCancel: late,
    });
  });
  return { ok: true };
}

/* ---------- Chủ sân ---------- */

function assertOwns(user, m) {
  if (user.role === 'admin') return;
  if (m.ownerId !== user.id) throw forbidden('Kèo này không thuộc sân của bạn');
}

async function confirmPart(user, rawId, part, note) {
  const id = matchId(rawId);
  if (!['host', 'guest'].includes(part)) throw badRequest('part phải là host hoặc guest');
  const text = typeof note === 'string' ? note.slice(0, 300) : '';
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    assertOwns(user, m);
    const nowMs = clock.nowMs();
    const now = clock.now();
    if (part === 'host') {
      if (m.hostPaidAt) throw conflict('Đã nhận tiền của đội mở kèo');
      if (!hostPending(m, nowMs)) throw conflict('Đội mở kèo đã hết thời gian giữ chỗ hoặc kèo đã kết thúc');
      await tx.query('UPDATE matches SET host_paid_at = ? WHERE id = ?', [now, id]);
      await addHistory(tx, m.bookingId, 'match_part_paid', { actor: actorOf(user), note: `Đã nhận phần đội mở kèo ${money(m.hostAmount)}${text ? `. ${text}` : ''}` });
      await notify(tx, m.hostId, `Chủ sân đã nhận ${money(m.hostAmount)} của bạn. Kèo ${slotText(m)} đang tìm đội đá cùng đến ${shortTs(m.closesAt)}; sân vẫn được giữ cho bạn.`, { link: matchLink(id) });
      const waiters = await tx.query('SELECT user_id FROM waitlist WHERE court_id = ? AND start_at = ? AND user_id <> ?', [m.courtId, m.startAt, m.hostId]);
      for (const w of waiters) {
        await notify(tx, w.userId, `Có kèo ${slotText(m)} tại ${m.courtName} đang tìm đội đá cùng, phần ${money(m.guestAmount)}. Bạn đang chờ giờ này nên có thể vào kèo.`, { link: matchLink(id) });
      }
      return;
    }
    if (m.guestPaidAt) throw conflict('Đã nhận tiền của đội vào kèo');
    if (!guestPending(m, nowMs)) throw conflict('Chưa có đội vào kèo, hoặc đội đó đã hết thời gian giữ chỗ');
    await tx.query('UPDATE matches SET guest_paid_at = ? WHERE id = ?', [now, id]);
    await addHistory(tx, m.bookingId, 'match_part_paid', { actor: actorOf(user), note: `Đã nhận phần đội vào kèo ${money(m.guestAmount)}${text ? `. ${text}` : ''}` });
    if (m.hostPaidAt) {
      // Đủ hai phần: chốt sân. Booking đứng tên đội mở kèo.
      await tx.query("UPDATE matches SET status = 'confirmed', guest_hold_until = NULL WHERE id = ?", [id]);
      await setStatus(tx, m.bookingId, 'confirmed', { payment_status: 'paid', paid_at: now, paid_via: 'owner' });
      await addHistory(tx, m.bookingId, 'match_confirm', { from: 'matching', to: 'confirmed', actor: actorOf(user), note: 'Đủ hai phần tiền, chốt sân' });
      for (const uid of [m.hostId, m.guestId]) {
        await notify(tx, uid, `Kèo ${m.courtName} ${slotText(m)} tại ${m.venueName} đã chốt: chủ sân nhận đủ tiền của hai đội.`, { link: matchLink(id) });
      }
    }
  });
  return presentOne(id, user);
}

async function rejectGuest(user, rawId, reason) {
  const id = matchId(rawId);
  const why = String(reason ?? '').trim();
  if (!why) throw badRequest('Vui lòng nhập lý do từ chối đội vào kèo');
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    assertOwns(user, m);
    if (m.status !== 'joined') throw conflict('Chưa có đội vào kèo để từ chối');
    await releaseGuest(tx, m, `Chủ sân từ chối: ${why.slice(0, 200)}. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân để lấy lại tiền.`, actorOf(user));
  });
  return presentOne(id, user);
}

/**
 * Chủ sân/admin hủy trận. Từ /owner/matches/:id/cancel chỉ hủy được trận đang mở hoặc chờ; từ hủy lịch đặt (allowConfirmed)
 * hủy được cả trận đã chốt, khi đó hoàn 100% cho cả hai đội đã trả (R13e).
 */
async function cancelByStaff(user, rawId, reason, { allowConfirmed = false } = {}) {
  const id = matchId(rawId);
  const why = String(reason ?? '').trim();
  if (!why) throw badRequest('Vui lòng nhập lý do hủy kèo');
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    assertOwns(user, m);
    if (!ACTIVE.includes(m.status) && !(allowConfirmed && m.status === 'confirmed')) throw conflict('Kèo này đã kết thúc');
    await endMatch(tx, m, 'cancelled', `${user.role === 'admin' ? 'Quản trị viên' : 'Chủ sân'} hủy kèo: ${why.slice(0, 200)}.`, { actor: actorOf(user), by: user.role });
  });
  return presentOne(id, user);
}

/** Ghi nhận chủ sân đã chuyển lại tiền cho một đội. Không chọn part thì chỉ hợp lệ khi đúng một khoản đang chờ. */
async function refundPart(user, rawId, part, note) {
  const id = matchId(rawId);
  if (part != null && !['host', 'guest'].includes(part)) throw badRequest('part phải là host hoặc guest');
  const text = typeof note === 'string' ? note.slice(0, 255) : '';
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    assertOwns(user, m);
    const pending = await tx.query("SELECT * FROM match_refunds WHERE match_id = ? AND status = 'pending' ORDER BY id FOR UPDATE", [id]);
    if (!part && pending.length > 1) throw badRequest('Kèo này có hai khoản cần chuyển lại, hãy chọn đội cần ghi nhận');
    const r = part ? pending.find((x) => x.part === part) : pending[0];
    if (!r) throw conflict('Không có khoản nào cần chuyển lại');
    const now = clock.now();
    await tx.query("UPDATE match_refunds SET status = 'done', done_at = ? WHERE id = ?", [now, r.id]);
    const left = pending.length - 1;
    await tx.query(
      'UPDATE bookings SET refund_status = ?, refunded_at = IF(?, ?, refunded_at), refund_note = IF(?, ?, refund_note), updated_at = ? WHERE id = ?',
      [left > 0 ? 'pending' : 'done', left === 0, now, !!text, text, now, m.bookingId],
    );
    await addHistory(tx, m.bookingId, 'refund', { actor: actorOf(user), note: `Đã trả lại ${money(r.amount)} cho ${partName(r.part)}${text ? `. ${text}` : ''}` });
    await notify(tx, r.userId, `Chủ sân đã chuyển lại ${money(r.amount)} cho kèo ${slotText(m)}.`, { link: matchLink(id) });
  });
  return presentOne(id, user);
}

/* ---------- Kết quả và phần chênh (R15) ---------- */

function parseBank(bank) {
  const bin = String(bank?.bin || '');
  const account = String(bank?.account || '').replace(/\s/g, '');
  const accountName = String(bank?.accountName || '').trim().toUpperCase();
  if (!BANKS.some((x) => x.bin === bin)) throw badRequest('Chọn ngân hàng');
  if (!/^\d{6,19}$/.test(account)) throw badRequest('Số tài khoản gồm 6 đến 19 chữ số');
  if (accountName.length < 2 || accountName.length > 60) throw badRequest('Nhập tên chủ tài khoản');
  return { bin, account, accountName };
}
const saveBank = (tx, id, part, b) =>
  tx.query(`UPDATE matches SET ${part}_bank_bin = ?, ${part}_bank_account = ?, ${part}_bank_name = ? WHERE id = ?`, [b.bin, b.account, b.accountName, id]);

const partOf = (m, user) => (user.id === m.hostId ? 'host' : user.id === m.guestId ? 'guest' : null);

async function setBank(user, rawId, body) {
  const id = matchId(rawId);
  const bank = parseBank(body);
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    const part = partOf(m, user);
    if (!part) throw forbidden('Chỉ hai đội trong kèo mới nhập được tài khoản');
    await saveBank(tx, id, part, bank);
  });
  return presentOne(id, user);
}

/** Đưa bước kết quả của trận đã chốt đi tiếp theo đồng hồ: hết giờ đá -> awaiting; quá hạn báo -> needs_owner. Trả true nếu có đổi. */
async function advanceResult(tx, m) {
  if (m.status !== 'confirmed' || !hasStake(m)) return false;
  const nowMs = clock.nowMs();
  let changed = false;
  if (!m.resultStatus && vnToMs(m.endAt) <= nowMs) {
    m.resultStatus = 'awaiting';
    m.reportBy = msToVn(vnToMs(m.endAt) + REPORT_HOURS * 3600000);
    await tx.query("UPDATE matches SET result_status = 'awaiting', report_by = ? WHERE id = ?", [m.reportBy, m.id]);
    for (const uid of [m.hostId, m.guestId]) {
      await notify(tx, uid, `Kèo ${slotText(m)} đã đá xong. Hãy báo kết quả trước ${shortTs(m.reportBy)}.`, { link: matchLink(m.id) });
    }
    changed = true;
  }
  if (m.resultStatus === 'awaiting' && vnToMs(m.reportBy) <= nowMs) {
    m.resultStatus = 'needs_owner';
    await tx.query("UPDATE matches SET result_status = 'needs_owner' WHERE id = ?", [m.id]);
    await needsOwner(tx, m, 'Hai đội chưa báo kết quả khớp nhau trước hạn');
    changed = true;
  }
  return changed;
}

async function needsOwner(tx, m, why) {
  await addHistory(tx, m.bookingId, 'match_result_dispute', { note: why });
  await notify(tx, m.ownerId, `Kèo ${m.courtName} ${slotText(m)} (${stakeText(m.loserPercent)}) cần bạn chốt kết quả. ${why}.`, { bookingId: m.bookingId, link: OWNER_LINK });
}

async function settle(tx, m, winner, by, actor) {
  const now = clock.now();
  let topup = null;
  if (winner !== 'draw') {
    const loser = otherPart(winner);
    const amount = Math.max(0, loserShareOf(m) - partAmount(m, loser));
    if (amount > 0) topup = { from: loser, to: winner, amount, dueBy: msToVn(clock.nowMs() + TOPUP_HOURS * 3600000) };
  }
  await tx.query(
    `UPDATE matches SET result_status = 'settled', winner = ?, settled_by = ?, settled_at = ?,
       topup_from = ?, topup_to = ?, topup_amount = ?, topup_status = ?, topup_due_by = ? WHERE id = ?`,
    [winner, by, now, topup?.from ?? null, topup?.to ?? null, topup?.amount ?? null, topup ? 'unpaid' : null, topup?.dueBy ?? null, m.id],
  );
  await addHistory(tx, m.bookingId, 'match_result', {
    actor, at: now,
    note: `Kết quả ${stakeText(m.loserPercent)}: ${winnerText(winner)}${by === 'owner' ? ', chủ sân chốt' : ', hai đội khớp nhau'}${topup ? `. Đội thua trả thêm ${money(topup.amount)}` : ''}`,
  });
  for (const part of ['host', 'guest']) {
    let msg;
    if (winner === 'draw') msg = `Kèo ${slotText(m)} hòa. Không ai trả thêm.`;
    else if (topup && part === topup.from) msg = `Đội bạn thua kèo ${slotText(m)}. Bạn trả thêm ${money(topup.amount)} cho đội thắng.`;
    else if (topup) msg = `Đội bạn thắng kèo ${slotText(m)}. Đội thua sẽ chuyển thêm ${money(topup.amount)} cho bạn. Hãy nhập tài khoản ngân hàng để nhận.`;
    else msg = `Kèo ${slotText(m)} đã có kết quả.`;
    await notify(tx, partUser(m, part), msg, { link: matchLink(m.id) });
  }
}

const WINNERS = ['host', 'guest', 'draw'];

async function reportResult(user, rawId, body = {}) {
  const id = matchId(rawId);
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    const part = partOf(m, user);
    if (!part) throw forbidden('Chỉ hai đội trong kèo mới báo được kết quả');
    await advanceResult(tx, m);
    if (!m.resultStatus) throw conflict(hasStake(m) ? 'Kèo chưa đá xong nên chưa báo kết quả được' : 'Kèo 5-5 không cần báo kết quả');
    if (m.resultStatus !== 'awaiting') throw conflict(m.resultStatus === 'settled' ? 'Kết quả đã chốt' : 'Kết quả đang chờ chủ sân chốt');
    const winner = body.winner;
    if (!WINNERS.includes(winner)) throw badRequest('Chọn đội thắng hoặc hòa');
    const bank = body.bank ? parseBank(body.bank) : null;
    if (bank) await saveBank(tx, id, part, bank);
    await tx.query(`UPDATE matches SET ${part}_report = ? WHERE id = ?`, [winner, id]);
    m[`${part}Report`] = winner;
    await addHistory(tx, m.bookingId, 'match_report', { actor: actorOf(user), note: `${partName(part)} báo: ${winnerText(winner)}` });
    if (m.hostReport && m.guestReport) {
      if (m.hostReport === m.guestReport) await settle(tx, m, winner, 'agree', null);
      else {
        await tx.query("UPDATE matches SET result_status = 'needs_owner' WHERE id = ?", [id]);
        await needsOwner(tx, m, 'Hai đội báo kết quả khác nhau');
        for (const uid of [m.hostId, m.guestId]) {
          await notify(tx, uid, `Hai đội báo kết quả kèo ${slotText(m)} khác nhau. Chủ sân sẽ chốt.`, { link: matchLink(id) });
        }
      }
    }
  });
  return presentOne(id, user);
}

async function ownerSettle(user, rawId, winner) {
  const id = matchId(rawId);
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    assertOwns(user, m);
    await advanceResult(tx, m);
    if (m.resultStatus !== 'needs_owner') throw conflict(m.resultStatus === 'settled' ? 'Kết quả đã chốt' : 'Kèo này chưa đến bước chủ sân chốt kết quả');
    if (!WINNERS.includes(winner)) throw badRequest('Chọn đội thắng hoặc hòa');
    await settle(tx, m, winner, 'owner', actorOf(user));
  });
  return presentOne(id, user);
}

async function topUpReceived(user, rawId) {
  const id = matchId(rawId);
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    if (!m.topupStatus) throw conflict('Kèo này không có khoản trả thêm');
    if (partUser(m, m.topupTo) !== user.id) throw forbidden('Chỉ đội thắng mới bấm đã nhận');
    if (m.topupStatus === 'received') throw conflict('Đã ghi nhận rồi');
    const now = clock.now();
    await tx.query("UPDATE matches SET topup_status = 'received', topup_received_at = ? WHERE id = ?", [now, id]);
    await addHistory(tx, m.bookingId, 'match_topup', { actor: actorOf(user), note: `Đội thắng đã nhận ${money(m.topupAmount)}` });
    await notify(tx, partUser(m, m.topupFrom), `Đội thắng đã nhận ${money(m.topupAmount)} của kèo ${slotText(m)}. Xong kèo.`, { link: matchLink(id) });
  });
  return presentOne(id, user);
}

/* ---------- Theo thời gian ---------- */

/** Một trận đến hạn: đội mở chưa được xác nhận (hủy), hết hạn tìm đội (expired), đội vào quá hạn giữ chỗ (nhả), bước kết quả. */
async function tickMatch(id) {
  await withTransaction(async (tx) => {
    const m = await lockMatch(tx, id);
    const nowMs = clock.nowMs();
    if (m.status === 'open' && !m.hostPaidAt && vnToMs(m.hostPayBy) <= nowMs) {
      await endMatch(tx, m, 'cancelled', 'Đội mở kèo chưa trả phần của mình trong thời gian giữ chỗ.', { at: m.hostPayBy });
    } else if (ACTIVE.includes(m.status) && vnToMs(m.closesAt) <= nowMs) {
      await endMatch(tx, m, 'expired', 'Hết hạn mà chưa đủ tiền của hai đội.', { at: m.closesAt });
    } else if (m.status === 'joined' && vnToMs(m.guestHoldUntil) <= nowMs) {
      await releaseGuest(tx, m, 'Chủ sân chưa nhận được tiền của bạn trong thời gian giữ chỗ. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân.');
    } else {
      await advanceResult(tx, m);
    }
  });
}

/** Gọi từ bookingOps.sweep: xử lý mọi trận đã đến hạn theo đồng hồ hệ thống. */
async function sweepMatches() {
  const now = clock.now();
  const rows = await db.query(
    `SELECT m.id FROM matches m JOIN bookings b ON b.id = m.booking_id
      WHERE (m.status = 'open' AND m.host_paid_at IS NULL AND m.host_pay_by <= ?)
         OR (m.status IN ('open','joined') AND m.closes_at <= ?)
         OR (m.status = 'joined' AND m.guest_hold_until <= ?)
         OR (m.status = 'confirmed' AND m.loser_percent > 50 AND ((m.result_status IS NULL AND b.end_at <= ?) OR (m.result_status = 'awaiting' AND m.report_by <= ?)))
      ORDER BY m.id`,
    [now, now, now, now, now],
  );
  for (const r of rows) await tickMatch(r.id);
}

module.exports = {
  STAKES, halfOf, loserShareOf, roundThousand, stakeText, payContent, REPORT_HOURS, TOPUP_HOURS,
  getMatch, listOpen, listMine, listForOwner, openMatch, joinMatch, withdrawMatch, confirmPart, rejectGuest, cancelByStaff, refundPart,
  reportResult, ownerSettle, setBank, topUpReceived, sweepMatches, tickMatch,
};
