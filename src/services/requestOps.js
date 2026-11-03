// Nhu cầu của khách và chào giá của sân (R14). Chào giá KHÔNG giữ ô: chỉ khi khách chọn mới tạo booking, qua đúng luồng đặt
// thường (bookingCore.createBooking: R3, R2/R4, R10, VietQR), nên chống trùng ô vẫn do bookings.slot_lock + slot_claims giữ.
// Đồng thời: thao tác nào đổi trạng thái nhu cầu cũng khóa dòng requests (FOR UPDATE) TRƯỚC rồi mới đụng offers; riêng "chọn"
// khóa requests sau khi chèn booking, trong cùng transaction với booking (callback inTx), nên hai lần chọn cùng lúc chỉ một
// bên thắng (bên kia trùng ô hoặc thấy nhu cầu đã chốt) và không bao giờ có booking mà nhu cầu chưa chốt.
// Code ở đây chỉ so dữ liệu có cấu trúc (id, trạng thái, mốc giờ, số tiền, trạng thái ô); không đọc ý nghĩa chữ nào.
const clock = require('../clock');
const { db, withTransaction, isDuplicate } = require('../db');
const { RULES } = require('../rules');
const { vnToMs, msToVn, isDate, isHm, hmToMin, hm, addDays } = require('../lib/time');
const { HttpError, badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { loadVenues, loadCourt } = require('./venueStore');
const { slotGrid, slotEnd, teamModeAt } = require('./slotGrid');
const { loadOccupancy, slotInfo } = require('./schedule');
const { notify, addHistory, money, shortTs } = require('./notify');
const { reliabilityOf } = require('./reliability');
const { createBooking, toBooking, findBooking } = require('./bookingCore');

const LIST_LIMIT = 200;
const MAX_BUDGET = 5000000;
const OWNER_LINK = '/owner-requests.html';
const requestLink = (id) => `/request.html?id=${id}`;
const lowerFirst = (s) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
const dayLabel = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const reqLabel = (r) => `${r.district}, ${dayLabel(r.wantDate)} ${hm(r.fromTime)}–${hm(r.toTime)}, sân ${r.fieldType}`;

/** Lỗi do chính thao tác chọn (nhu cầu/chào giá đã đổi trạng thái), không phải do ô giờ: không được làm chào giá thành void. */
const stale = (msg) => Object.assign(conflict(msg), { keepOffer: true });

const OFFER_SELECT = `SELECT o.*, v.name AS venue_name, v.address AS venue_address, v.district AS venue_district,
    v.requires_approval, v.owner_id, c.name AS court_name, c.field_type
  FROM offers o JOIN venues v ON v.id = o.venue_id JOIN courts c ON c.id = o.court_id`;

const findRequestRow = (id, conn = db) => conn.one('SELECT * FROM requests WHERE id = ?', [id]);
const lockRequest = async (tx, id) => {
  const r = await tx.one('SELECT * FROM requests WHERE id = ? FOR UPDATE', [id]);
  if (!r) throw notFound('Không tìm thấy tin này');
  return r;
};

function idOf(raw, msg) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw notFound(msg);
  return n;
}

/** Các giờ của sân còn nằm trọn trong khung giờ của nhu cầu. */
const slotsInWindow = (venue, r) => slotGrid(venue).filter((s) => s >= hm(r.fromTime) && slotEnd(venue, s) <= hm(r.toTime));

/** Cụm sân "phù hợp": đang mở, cùng quận, có sân con đang mở đúng loại và có giờ trọn trong khung (điều kiện dữ liệu). */
const venueFits = (venue, r) =>
  venue.isActive && venue.district === r.district && venue.courts.some((c) => c.isActive && c.fieldType === r.fieldType) && slotsInWindow(venue, r).length > 0;

/** Lý do chào giá không dùng được lúc này (null = dùng được). Không giữ giờ: chỉ đọc trạng thái hiện tại. */
async function offerBlock(o, viewer, conn = db) {
  const found = await loadCourt(o.courtId, { conn });
  if (!found) return 'Sân không còn nhận đặt';
  const { venue, court } = found;
  const date = o.startAt.slice(0, 10);
  const start = o.startAt.slice(11, 16);
  const occ = await loadOccupancy([court.id], date, conn);
  const slot = slotInfo(venue, court, date, start, occ, viewer);
  if (slot.status === 'past') return 'Đã quá giờ bắt đầu';
  if (slot.status === 'blocked') return 'Chủ sân đã chặn giờ này';
  if (slot.status === 'booked' || slot.status === 'held') return 'Giờ này đã có người khác đặt';
  if (slot.status === 'offered' && !slot.offeredToYou) return 'Giờ này đang giữ cho người đã đăng ký chờ';
  if (teamModeAt(court, start)) return 'Giờ này chỉ nhận ghép kèo';
  if (slot.basePrice < o.price) return 'Giá thường của sân đã đổi, thấp hơn giá chào';
  return null;
}

async function toOffer(o, r) {
  const block = o.status === 'open' ? await offerBlock(o, { id: r.userId }) : null;
  return {
    id: o.id,
    requestId: o.requestId,
    status: o.status,
    venueId: o.venueId,
    venueName: o.venueName,
    venueAddress: o.venueAddress,
    venueDistrict: o.venueDistrict,
    requiresApproval: !!o.requiresApproval,
    courtId: o.courtId,
    courtName: o.courtName,
    fieldType: o.fieldType,
    startAt: o.startAt,
    endAt: o.endAt,
    price: o.price,
    listedPrice: o.listedPrice,
    overBudget: o.price > r.budget,
    note: o.note || '',
    validUntil: o.validUntil,
    createdAt: o.createdAt,
    endReason: o.endReason || null,
    usable: o.status === 'open' && !block,
    unusableReason: block,
    bookingId: o.status === 'chosen' ? r.bookingId : null,
  };
}

/** Giờ chủ sân có thể chào: trọn trong khung giờ, còn trống, không thuộc chế độ đủ hai đội. */
async function requestOptions(r, venues) {
  const out = [];
  for (const v of venues) {
    const courts = v.courts.filter((x) => x.isActive && x.fieldType === r.fieldType);
    const occ = await loadOccupancy(courts.map((c) => c.id), r.wantDate);
    for (const c of courts) {
      const slots = [];
      for (const s of slotsInWindow(v, r)) {
        const info = slotInfo(v, c, r.wantDate, s, occ, null);
        if (info.status !== 'available' || info.teamMode) continue;
        slots.push({ start: s, end: info.end, basePrice: info.basePrice });
      }
      if (slots.length) out.push({ venueId: v.id, venueName: v.name, courtId: c.id, courtName: c.name, slots });
    }
  }
  return out;
}

const byOpenThenPrice = (a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.price - b.price || a.id - b.id;

/** viewer = khách chủ tin (thấy mọi chào giá) hoặc chủ sân (chỉ chào giá của cụm sân mình, cần mineVenues). */
async function present(r, viewer, { mineVenues = null, offerRows = null } = {}) {
  const rows = offerRows || (await db.query(`${OFFER_SELECT} WHERE o.request_id = ? ORDER BY o.id`, [r.id]));
  const mineIds = mineVenues && new Set(mineVenues.map((v) => v.id));
  const shown = mineIds ? rows.filter((o) => mineIds.has(o.venueId)) : rows;
  const out = {
    id: r.id,
    status: r.status,
    district: r.district,
    date: r.wantDate,
    from: hm(r.fromTime),
    to: hm(r.toTime),
    fieldType: r.fieldType,
    budget: r.budget,
    note: r.note,
    closesAt: r.closesAt,
    createdAt: r.createdAt,
    endReason: r.endReason || null,
    bookingId: r.status === 'chosen' ? r.bookingId : null,
    offers: (await Promise.all(shown.map((o) => toOffer(o, r)))).sort(byOpenThenPrice),
  };
  if (mineVenues) {
    const customer = await db.one('SELECT full_name FROM users WHERE id = ?', [r.userId]);
    out.customerName = customer?.fullName || '';
    out.customerReliability = await reliabilityOf(db, r.userId);
    out.venues = mineVenues.map((v) => ({ id: v.id, name: v.name }));
    out.openOfferCount = rows.filter((o) => o.status === 'open').length;
    out.maxOffers = RULES.requestMaxOffers;
    out.options = r.status === 'open' ? await requestOptions(r, mineVenues) : [];
  }
  return out;
}

/* ---------- Khách ---------- */

async function openRequest(user, body = {}) {
  const { district, date, from, to, closesAt } = body;
  const fieldType = String(body.fieldType ?? '');
  const budget = Number(body.budget);
  const note = String(body.note ?? '').slice(0, 300);
  const nowMs = clock.nowMs();
  const venues = await loadVenues();
  if (!venues.some((v) => v.district === district)) throw badRequest('Chưa có sân nào ở quận này');
  if (!['5', '7'].includes(fieldType)) throw badRequest('Loại sân là 5 hoặc 7');
  if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
  const today = clock.today();
  if (date < today || date > addDays(today, RULES.bookingWindowDays - 1)) throw badRequest(`Chỉ nhờ sân báo giá trong ${RULES.bookingWindowDays} ngày tới`);
  if (!isHm(from) || !isHm(to)) throw badRequest('Khung giờ không hợp lệ');
  if (hmToMin(to) - hmToMin(from) < 60) throw badRequest('Khung giờ cần dài ít nhất 60 phút');
  if (!Number.isInteger(budget) || budget < 1000 || budget > MAX_BUDGET || budget % 1000 !== 0) {
    throw badRequest('Mức giá bạn muốn phải là số tròn nghìn đồng, tối đa 5.000.000đ');
  }
  const latest = vnToMs(`${date} ${from}`) - RULES.requestCloseMinutes * 60000;
  const earliest = nowMs + RULES.requestMinOpenMinutes * 60000;
  if (latest < earliest) throw badRequest('Còn quá ít thời gian: cần ít nhất 90 phút từ bây giờ đến giờ bắt đầu để sân kịp báo giá');
  const closeRaw = String(closesAt ?? '');
  const closeMs = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(closeRaw) ? vnToMs(closeRaw) : NaN;
  if (!Number.isFinite(closeMs) || closeMs < earliest || closeMs > latest) {
    throw badRequest(`Hạn nhận báo giá cần từ ${RULES.requestMinOpenMinutes} phút sau bây giờ đến ${RULES.requestCloseMinutes} phút trước giờ bắt đầu`);
  }
  const probe = { district, wantDate: date, fromTime: from, toTime: to, fieldType };
  const fitting = venues.filter((v) => venueFits(v, probe));
  if (!fitting.length) throw badRequest('Chưa có sân nào ở quận này có sân loại này và giờ mở cửa phù hợp khung giờ bạn chọn');

  const now = clock.now();
  const id = await withTransaction(async (tx) => {
    await tx.one('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]); // tuần tự hóa các lần đăng của cùng một khách
    const open = await tx.one("SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND status = 'open'", [user.id]);
    if (Number(open.n) >= RULES.requestMaxOpen) {
      throw conflict(`Bạn đang có ${RULES.requestMaxOpen} tin nhờ báo giá chưa xong. Hãy chọn hoặc hủy bớt rồi nhờ tiếp`);
    }
    const r = await tx.query(
      `INSERT INTO requests (user_id, district, want_date, from_time, to_time, field_type, budget, note, status, closes_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [user.id, district, date, `${from}:00`, `${to}:00`, fieldType, budget, note, msToVn(closeMs), now],
    );
    const label = reqLabel({ ...probe, fromTime: from, toTime: to });
    for (const ownerId of new Set(fitting.map((v) => v.ownerId))) {
      await notify(tx, ownerId, `Có khách nhờ báo giá: ${label}, khách muốn ${money(budget)}/giờ. Gửi báo giá trước ${msToVn(closeMs).slice(11, 16)}.`, { link: OWNER_LINK });
    }
    return r.insertId;
  });
  return present(await findRequestRow(id), user);
}

async function ownRequestRow(user, rawId, conn = db) {
  const r = await findRequestRow(idOf(rawId, 'Không tìm thấy tin này'), conn);
  if (!r || r.userId !== user.id) throw notFound('Không tìm thấy tin này');
  return r;
}

async function getRequest(user, rawId) {
  return present(await ownRequestRow(user, rawId), user);
}

async function listMine(user) {
  const rows = await db.query('SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [user.id, LIST_LIMIT]);
  const out = [];
  for (const r of rows) out.push(await present(r, user));
  return out;
}

/** Đóng một nhu cầu chưa chốt (hết hạn hoặc khách hủy): chào giá đang mở đóng theo, chủ sân được báo. Gọi khi đã khóa dòng requests. */
async function closeRequest(tx, r, status, reason, { notifyCustomer = false } = {}) {
  const open = await tx.query(`${OFFER_SELECT} WHERE o.request_id = ? AND o.status = 'open' ORDER BY o.id FOR UPDATE OF o`, [r.id]);
  const cancelled = status === 'cancelled';
  await tx.query('UPDATE requests SET status = ?, end_reason = ? WHERE id = ?', [status, reason, r.id]);
  for (const o of open) {
    await tx.query('UPDATE offers SET status = ?, end_reason = ? WHERE id = ?', [
      cancelled ? 'void' : 'expired', cancelled ? 'Khách đã hủy tin nhờ báo giá' : 'Tin nhờ báo giá đã quá hạn nhận báo giá', o.id,
    ]);
    await notify(tx, o.ownerId, `Tin nhờ báo giá ${reqLabel(r)} ${cancelled ? 'đã được khách hủy' : 'đã quá hạn'}, báo giá ${money(o.price)} của bạn cũng đóng.`, { link: OWNER_LINK });
  }
  if (notifyCustomer) {
    await notify(tx, r.userId, `Tin nhờ báo giá ${reqLabel(r)} đã quá hạn nhận báo giá${open.length ? `, bạn chưa chọn ${open.length} báo giá` : ''}.`, { link: requestLink(r.id) });
  }
}

async function cancelRequest(user, rawId) {
  const id = (await ownRequestRow(user, rawId)).id;
  await withTransaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (r.status === 'chosen') throw conflict('Tin này đã được chọn và đặt sân, hãy hủy lịch đặt nếu cần');
    if (r.status !== 'open') throw conflict('Tin này đã kết thúc');
    await closeRequest(tx, r, 'cancelled', 'Khách đã hủy tin nhờ báo giá');
  });
  return present(await findRequestRow(id), user);
}

/** Cùng một lần chọn: chốt nhu cầu + chào giá trong transaction của booking (xem createBooking opts.inTx). */
async function settleAccept(tx, user, requestId, offerId, bookingId) {
  const r = await lockRequest(tx, requestId);
  if (r.status !== 'open') throw stale('Tin này đã kết thúc');
  const o = await tx.one(`${OFFER_SELECT} WHERE o.id = ? FOR UPDATE OF o`, [offerId]);
  if (!o || o.status !== 'open') throw stale('Báo giá này không còn hiệu lực');
  const b = await tx.one('SELECT code, status, start_at FROM bookings WHERE id = ?', [bookingId]);
  await tx.query("UPDATE offers SET status = 'chosen' WHERE id = ?", [o.id]);
  await tx.query("UPDATE requests SET status = 'chosen', chosen_offer_id = ?, booking_id = ? WHERE id = ?", [o.id, bookingId, r.id]);
  await addHistory(tx, bookingId, 'offer_accept', {
    to: b.status, actor: { id: user.id, role: 'customer' },
    note: `Báo giá #${o.id} của sân: ${money(o.price)} (giá thường ${money(o.listedPrice)})`,
  });
  await notify(tx, o.ownerId, `${user.fullName} đã chọn báo giá ${money(o.price)} của bạn: ${o.courtName} ${shortTs(b.startAt)} (mã ${b.code}).`, { bookingId, link: `/owner-bookings.html?id=${bookingId}` });
  const others = await tx.query(`${OFFER_SELECT} WHERE o.request_id = ? AND o.status = 'open' AND o.id <> ? ORDER BY o.id FOR UPDATE OF o`, [r.id, o.id]);
  for (const x of others) {
    await tx.query("UPDATE offers SET status = 'lost', end_reason = 'Đội đã chọn báo giá khác' WHERE id = ?", [x.id]);
    await notify(tx, x.ownerId, `Khách đã chọn sân khác cho tin nhờ báo giá ${reqLabel(r)}, báo giá ${money(x.price)} của bạn đã đóng.`, { link: OWNER_LINK });
  }
}

async function voidOffer(offerId, reason) {
  await db.query("UPDATE offers SET status = 'void', end_reason = ? WHERE id = ? AND status = 'open'", [reason, offerId]);
}

async function acceptOffer(user, rawId, body = {}) {
  const r0 = await ownRequestRow(user, rawId);
  const offerId = Number(body.offerId);
  const o = Number.isInteger(offerId) && offerId > 0 ? await db.one(`${OFFER_SELECT} WHERE o.id = ?`, [offerId]) : null;
  if (!o || o.requestId !== r0.id) throw notFound('Không tìm thấy báo giá');
  const existing = async () => {
    const fresh = await findRequestRow(r0.id);
    return fresh.status === 'chosen' && fresh.chosenOfferId === o.id && fresh.bookingId ? toBooking(await findBooking(fresh.bookingId)) : null;
  };
  const again = await existing(); // bấm lặp: trả đúng booking cũ
  if (again) return again;
  if (r0.status !== 'open') throw conflict('Tin này đã kết thúc');
  if (o.status !== 'open') throw conflict('Báo giá này không còn hiệu lực');
  if (vnToMs(o.validUntil) <= clock.nowMs()) {
    await db.query("UPDATE offers SET status = 'expired', end_reason = 'Giá báo đã quá hạn hiệu lực' WHERE id = ? AND status = 'open'", [o.id]);
    throw conflict('Báo giá này đã quá hạn');
  }
  // Kiểm lại ô và giá ngay lúc chọn: chào giá không giữ ô nên người khác có thể đã đặt trước.
  const unusable = async (reason) => {
    await voidOffer(o.id, reason);
    return conflict(`Chào giá này không còn dùng được: ${lowerFirst(reason)}`);
  };
  const block = await offerBlock(o, user);
  if (block) throw await unusable(block);
  try {
    const { booking } = await createBooking(
      user,
      { courtId: o.courtId, date: o.startAt.slice(0, 10), start: o.startAt.slice(11, 16) },
      { offer: { id: o.id, price: o.price }, inTx: (tx, bookingId) => settleAccept(tx, user, r0.id, o.id, bookingId) },
    );
    return booking;
  } catch (err) {
    if (!(err instanceof HttpError) || ![400, 404, 409].includes(err.status)) throw err;
    const won = await existing(); // hai lần bấm đồng thời: bên thua trùng ô nhưng chào giá đã chọn xong
    if (won) return won;
    if (err.keepOffer) throw err;
    throw await unusable(err.message);
  }
}

/* ---------- Chủ sân ---------- */

async function ownerVenues(user) {
  const ids = (await db.query('SELECT id FROM venues WHERE owner_id = ? AND is_active = 1', [user.id])).map((v) => v.id);
  return loadVenues({ ids });
}

async function listForOwner(user) {
  const mine = await ownerVenues(user);
  if (!mine.length) return [];
  const rows = await db.query(
    `SELECT * FROM requests r WHERE r.district IN (?)
        AND (r.status = 'open' OR EXISTS (SELECT 1 FROM offers o WHERE o.request_id = r.id AND o.venue_id IN (?)))
      ORDER BY (r.status = 'open') DESC, r.closes_at ASC, r.id DESC LIMIT ?`,
    [[...new Set(mine.map((v) => v.district))], mine.map((v) => v.id), LIST_LIMIT],
  );
  const out = [];
  for (const r of rows) {
    const fit = mine.filter((v) => venueFits(v, r));
    if (!fit.length) continue;
    const offerRows = await db.query(`${OFFER_SELECT} WHERE o.request_id = ? ORDER BY o.id`, [r.id]);
    if (r.status !== 'open' && !offerRows.some((o) => fit.some((v) => v.id === o.venueId))) continue;
    out.push(await present(r, user, { mineVenues: fit, offerRows }));
  }
  return out;
}

async function sendOffer(user, rawId, body = {}) {
  const requestId = idOf(rawId, 'Không tìm thấy tin này');
  if (!(await findRequestRow(requestId))) throw notFound('Không tìm thấy tin này');
  const { start, validUntil } = body;
  const note = String(body.note ?? '').slice(0, 200);
  const courtId = Number(body.courtId);
  const found = Number.isInteger(courtId) ? await loadCourt(courtId, { activeOnly: false }) : null;
  if (!found) throw notFound('Không tìm thấy sân');
  const { venue, court } = found;
  if (venue.ownerId !== user.id) throw forbidden('Sân này không thuộc tài khoản của bạn');
  const offerId = await withTransaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!venueFits(venue, r) || court.fieldType !== r.fieldType || !court.isActive) throw forbidden('Tin này không phù hợp với sân của bạn');
    if (r.status !== 'open') throw conflict('Tin này đã kết thúc');
    if (!slotsInWindow(venue, r).includes(start)) throw badRequest('Giờ chào phải nằm trọn trong khung giờ khách chọn');
    if (teamModeAt(court, start)) throw conflict('Giờ này chỉ nhận ghép kèo, không báo giá riêng được');
    const slot = slotInfo(venue, court, r.wantDate, start, await loadOccupancy([court.id], r.wantDate, tx), null);
    if (slot.status !== 'available') throw conflict('Giờ này không còn trống');
    const price = Number(body.price);
    if (!Number.isInteger(price) || price < 1000 || price % 1000 !== 0) throw badRequest('Giá báo là số tròn nghìn đồng');
    if (price > slot.basePrice) throw badRequest(`Giá báo không được cao hơn giá thường của giờ (${money(slot.basePrice)})`);
    const untilRaw = String(validUntil ?? '');
    const untilMs = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(untilRaw) ? vnToMs(untilRaw) : NaN;
    if (!Number.isFinite(untilMs) || untilMs < clock.nowMs() + RULES.offerMinMinutes * 60000 || untilMs > vnToMs(r.closesAt)) {
      throw badRequest(`Hiệu lực báo giá từ ${RULES.offerMinMinutes} phút sau bây giờ đến hết hạn nhận báo giá (${r.closesAt.slice(11, 16)})`);
    }
    const open = await tx.query("SELECT venue_id FROM offers WHERE request_id = ? AND status = 'open' FOR UPDATE", [r.id]);
    if (open.some((x) => x.venueId === venue.id)) throw conflict('Sân của bạn đã có báo giá đang mở cho tin nhờ báo giá này. Hãy rút báo giá cũ rồi báo lại');
    if (open.length >= RULES.requestMaxOffers) throw conflict(`Tin này đã đủ ${RULES.requestMaxOffers} báo giá`);
    let ins;
    try {
      ins = await tx.query(
        `INSERT INTO offers (request_id, venue_id, court_id, start_at, end_at, price, listed_price, valid_until, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        [r.id, venue.id, court.id, `${r.wantDate} ${start}:00`, `${r.wantDate} ${slot.end}:00`, price, slot.basePrice, msToVn(untilMs), note, clock.now()],
      );
    } catch (err) {
      if (isDuplicate(err)) throw conflict('Sân của bạn đã có báo giá đang mở cho tin nhờ báo giá này. Hãy rút báo giá cũ rồi báo lại');
      throw err;
    }
    await notify(tx, r.userId, `${venue.name} báo giá ${money(price)} cho ${court.name} ${start}–${slot.end}${price > r.budget ? ' (cao hơn mức bạn muốn)' : ''}. Xem và chọn trước ${msToVn(untilMs).slice(11, 16)}.`, { link: requestLink(r.id) });
    return ins.insertId;
  });
  const row = await db.one(`${OFFER_SELECT} WHERE o.id = ?`, [offerId]);
  return toOffer(row, await findRequestRow(requestId));
}

async function withdrawOffer(user, rawId) {
  const o0 = await db.one(`${OFFER_SELECT} WHERE o.id = ?`, [idOf(rawId, 'Không tìm thấy báo giá')]);
  if (!o0) throw notFound('Không tìm thấy báo giá');
  if (o0.ownerId !== user.id) throw forbidden('Báo giá này không thuộc sân của bạn');
  await withTransaction(async (tx) => {
    const r = await lockRequest(tx, o0.requestId);
    const o = await tx.one('SELECT status FROM offers WHERE id = ? FOR UPDATE', [o0.id]);
    if (o.status !== 'open') throw conflict('Báo giá này đã kết thúc');
    await tx.query("UPDATE offers SET status = 'withdrawn', end_reason = 'Sân đã rút báo giá' WHERE id = ?", [o0.id]);
    await notify(tx, r.userId, `${o0.venueName} đã rút báo giá ${o0.courtName} ${shortTs(o0.startAt)}.`, { link: requestLink(r.id) });
  });
  return toOffer(await db.one(`${OFFER_SELECT} WHERE o.id = ?`, [o0.id]), await findRequestRow(o0.requestId));
}

/* ---------- Hết hạn (gọi từ bookingOps.sweep) ---------- */

async function sweepRequests() {
  const now = clock.now();
  for (const { id } of await db.query("SELECT id FROM requests WHERE status = 'open' AND closes_at <= ? ORDER BY id", [now])) {
    await withTransaction(async (tx) => {
      const r = await lockRequest(tx, id);
      if (r.status === 'open' && r.closesAt <= now) await closeRequest(tx, r, 'expired', 'Quá hạn nhận báo giá', { notifyCustomer: true });
    });
  }
  // Chào giá quá hiệu lực riêng của nó (nhu cầu vẫn mở).
  for (const o of await db.query("SELECT id, request_id FROM offers WHERE status = 'open' AND valid_until <= ? ORDER BY id", [now])) {
    await withTransaction(async (tx) => {
      await lockRequest(tx, o.requestId);
      await tx.query("UPDATE offers SET status = 'expired', end_reason = 'Giá báo đã quá hạn hiệu lực' WHERE id = ? AND status = 'open' AND valid_until <= ?", [o.id, now]);
    });
  }
}

module.exports = {
  openRequest, getRequest, listMine, cancelRequest, acceptOffer, listForOwner, sendOffer, withdrawOffer, sweepRequests,
  venueFits, slotsInWindow, reqLabel,
};
