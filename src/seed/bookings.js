// Dữ liệu demo của đặt sân, dựng từ public/mock/bookings.json (cùng nguồn với prototype): lịch mẫu của các tài khoản demo,
// "đám đông" khách nền ở các sân thật (tất định theo ngày), danh sách chờ và thông báo mẫu. Mốc thời gian tính từ đồng hồ
// hệ thống tại lúc nạp. Bỏ qua phần của tính năng chưa có bảng: đăng pass (R12), ghép kèo (R13), báo giá (R14), lịch gọi điện (R16),
// giải (R18); chặn giờ mẫu do phần chủ sân nạp.
const clock = require('../clock');
const { RULES, CANCEL_POLICY_TEXT } = require('../rules');
const { vnToMs, msToVn, addDays, hmToMin } = require('../lib/time');
const { loadVenues } = require('../services/venueStore');
const { slotGrid, slotEndAt, basePriceOf } = require('../services/slotGrid');
const { bookingCode } = require('../services/bookingCore');
const { HOLDING } = require('../services/bookingState');
const { readMock } = require('./core');

const hash32 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Số ngẫu nhiên tất định trong [0,1) theo khóa: cùng ngày dựng thì cùng kết quả. */
const rand01 = (key) => hash32(key) / 4294967296;
const weekdayOf = (date) => new Date(vnToMs(date) + 7 * 3600000).getUTCDay();

async function seedBookings(tx) {
  const seeds = readMock('bookings');
  const t = clock.nowMs();
  const today = clock.today();
  const ago = (min) => msToVn(t - min * 60000);
  const inMin = (min) => msToVn(t + min * 60000);
  const venues = await loadVenues({ activeOnly: false, conn: tx });
  const courts = Object.fromEntries(venues.flatMap((v) => v.courts.map((c) => [c.id, [v, c]])));
  const users = Object.fromEntries((await tx.query('SELECT id, full_name, role FROM users')).map((u) => [u.id, u]));
  const claimed = new Set();
  const byKey = {};
  const count = { templates: 0, crowd: 0, waitlist: 0, notifications: 0 };

  async function insert(b, venue, history = []) {
    const r = await tx.query(
      `INSERT INTO bookings (code, user_id, venue_id, court_id, start_at, end_at, status, source, expires_at, price, base_price, discount_percent,
         payment_status, paid_at, paid_via, refund_status, refund_percent, refund_amount, cancelled_by, cancelled_at, cancel_reason, late_cancel,
         customer_note, rules_snapshot, policy_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`T${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`, b.userId, venue.id, b.courtId, b.startAt, b.endAt, b.status, b.expiresAt, b.price, b.price,
        b.paid ? 'paid' : 'unpaid', b.paid ? msToVn(vnToMs(b.createdAt) + 30 * 60000) : null, b.paid ? 'owner' : null,
        b.refundStatus, b.refundPercent, b.refundAmount, b.cancelledBy, b.cancelledAt, b.cancelReason, b.lateCancel ? 1 : 0,
        b.note, venue.rules, CANCEL_POLICY_TEXT, b.createdAt, b.createdAt],
    );
    const id = r.insertId;
    await tx.query('UPDATE bookings SET code = ? WHERE id = ?', [bookingCode(id), id]);
    if (HOLDING.includes(b.status)) {
      await tx.query("INSERT INTO slot_claims (court_id, start_at, kind, booking_id) VALUES (?, ?, 'booking', ?)", [b.courtId, b.startAt, id]);
      claimed.add(`${b.courtId} ${b.startAt}`);
    }
    for (const h of history) {
      await tx.query(
        'INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, h.action, h.from || null, h.to || null, h.actor?.id ?? null, h.actor?.role ?? 'system', h.note || '', h.at],
      );
    }
    return id;
  }

  // Lịch sử mẫu suy ra từ trạng thái hiện có của lịch (đủ để màn chi tiết và nhật ký có nội dung).
  function historyOf(b, venue) {
    const t0 = vnToMs(b.createdAt);
    const at = (min) => msToVn(t0 + min * 60000);
    const customer = { id: b.userId, role: 'customer' };
    const owner = { id: venue.ownerId, role: 'owner' };
    const needsApproval = venue.requiresApproval || b.status === 'pending';
    const created = needsApproval ? 'pending' : 'confirmed';
    const h = [{ action: 'create', to: created, actor: customer, at: b.createdAt }];
    if (b.status === 'pending') return h;
    if (needsApproval && !['rejected', 'expired'].includes(b.status)) h.push({ action: 'approve', from: 'pending', to: 'confirmed', actor: owner, at: at(5) });
    if (b.paid) h.push({ action: 'paid', actor: owner, note: 'Đã nhận chuyển khoản', at: at(30) });
    if (b.status === 'rejected') h.push({ action: 'reject', from: 'pending', to: 'rejected', actor: owner, note: b.cancelReason, at: at(8) });
    if (b.status === 'expired') h.push({ action: 'expire', from: 'pending', to: 'expired', note: 'Quá hạn chưa đồng ý', at: at(15) });
    if (b.status === 'cancelled') h.push({ action: 'cancel', from: created, to: 'cancelled', actor: customer, note: b.cancelReason || '', at: b.cancelledAt });
    if (b.refundStatus === 'done') h.push({ action: 'refund', actor: owner, at: b.cancelledAt });
    if (b.status === 'no_show') h.push({ action: 'attendance', from: 'confirmed', to: 'no_show', actor: owner, note: 'Không đến sân', at: b.startAt });
    if (b.status === 'completed') h.push({ action: 'attendance', from: 'confirmed', to: 'completed', actor: owner, at: b.startAt });
    return h;
  }

  // 1) Lịch mẫu (id tăng theo thứ tự trong bookings.json như mock).
  for (const tpl of seeds.bookings) {
    const [venue, court] = courts[tpl.courtId];
    let date;
    let start;
    if (tpl.startAfterMin != null) {
      const ms = t + tpl.startAfterMin * 60000;
      const d = msToVn(ms).slice(0, 10);
      const grid = slotGrid(venue).find((s) => vnToMs(`${d} ${s}`) >= ms);
      if (!grid) continue; // quá muộn trong ngày: bỏ mẫu này
      date = d;
      start = grid;
    } else {
      date = addDays(today, tpl.day);
      start = tpl.start;
    }
    const price = basePriceOf(venue, court, start);
    const b = {
      userId: tpl.userId, courtId: court.id, startAt: `${date} ${start}:00`, endAt: slotEndAt(venue, date, start), status: tpl.status,
      expiresAt: tpl.status === 'pending' ? inMin(tpl.expiresInMin ?? RULES.holdMinutes) : null, price, paid: !!tpl.paid,
      refundStatus: tpl.refundStatus || 'none', refundPercent: tpl.refundPercent ?? 0, refundAmount: 0,
      cancelledBy: tpl.cancelledBy || null, cancelReason: tpl.cancelReason || null, lateCancel: !!tpl.lateCancel,
      cancelledAt: null, note: tpl.note || '', createdAt: ago(tpl.createdMinAgo),
    };
    if (b.status === 'cancelled') {
      b.cancelledAt = ago(tpl.cancelledMinAgo ?? Math.max(1, tpl.createdMinAgo - 60));
      b.refundAmount = b.paid ? Math.round((price * b.refundPercent) / 100) : 0;
    }
    byKey[tpl.key] = { id: await insert(b, venue, historyOf(b, venue)), booking: b, venue };
    count.templates += 1;
  }

  // 2) Đám đông khách nền ở các sân thật: xác suất một ô có người đặt theo giờ, độ hút khách của sân, số ngày tới.
  const cfg = seeds.crowd;
  const weight = (table, h) => table.reduce((w, [from, v]) => (h >= from ? v : w), 0);
  const taken = new Set();
  for (const venue of venues) {
    if (venue.id < cfg.firstVenueId || !venue.isActive) continue;
    const grid = slotGrid(venue);
    const pop = cfg.popularity[0] + rand01(`pop|${today}|${venue.id}`) * (cfg.popularity[1] - cfg.popularity[0]);
    const pendingShare = venue.requiresApproval ? cfg.pendingShare : cfg.pendingShare / 4;
    for (const court of venue.courts) {
      if (!court.isActive) continue;
      for (let d = 0; d <= RULES.bookingWindowDays; d++) {
        const date = addDays(today, d);
        const table = [0, 6].includes(weekdayOf(date)) ? cfg.hourWeights.weekend : cfg.hourWeights.weekday;
        const future = grid.filter((s) => vnToMs(`${date} ${s}`) > t);
        let filled = 0;
        for (const start of future) {
          if (filled >= Math.floor(future.length * cfg.maxFill)) break;
          const hoursAhead = (vnToMs(`${date} ${start}`) - t) / 3600000;
          let p = weight(table, hmToMin(start) / 60) * pop * (1 - cfg.dayDecay * d);
          if (hoursAhead <= cfg.soonHours) p *= cfg.soonFactor;
          const key = `${today}|${court.id}|${date}|${start}`;
          if (rand01(`fill|${key}`) >= Math.min(p, 0.92)) continue;
          if (claimed.has(`${court.id} ${date} ${start}:00`)) continue; // ô đã có lịch mẫu
          let ci = hash32(`who|${key}`) % cfg.customerIds.length;
          while (taken.has(`${venue.id}|${ci}|${date} ${start}`)) ci = (ci + 1) % cfg.customerIds.length;
          taken.add(`${venue.id}|${ci}|${date} ${start}`);
          const pending = rand01(`st|${key}`) < pendingShare;
          const holdLeft = 2 + Math.floor(rand01(`hold|${key}`) * (RULES.holdMinutes - 1));
          const createdMin = pending ? RULES.holdMinutes - holdLeft : 40 + Math.floor(rand01(`new|${key}`) * 4000);
          await insert({
            userId: cfg.customerIds[ci], courtId: court.id, startAt: `${date} ${start}:00`, endAt: slotEndAt(venue, date, start),
            status: pending ? 'pending' : 'confirmed', expiresAt: pending ? inMin(holdLeft) : null, price: basePriceOf(venue, court, start),
            paid: !pending && rand01(`pay|${key}`) < cfg.paidShare, refundStatus: 'none', refundPercent: 0, refundAmount: 0,
            cancelledBy: null, cancelReason: null, lateCancel: false, cancelledAt: null, note: '', createdAt: ago(createdMin),
          }, venue);
          count.crowd += 1;
          filled++;
        }
      }
    }
  }

  // 3) Danh sách chờ mẫu.
  const waitByKey = {};
  for (const w of seeds.waitlist) {
    const r = await tx.query(
      'INSERT INTO waitlist (user_id, court_id, start_at, status, offer_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [w.userId, w.courtId, `${addDays(today, w.day)} ${w.start}:00`, w.status, w.status === 'offered' ? inMin(w.offerExpiresInMin ?? RULES.waitlistOfferMinutes) : null, ago(w.createdMinAgo)],
    );
    waitByKey[w.key] = { id: r.insertId, ...w };
    count.waitlist += 1;
  }

  // 4) Thông báo mẫu.
  for (const n of seeds.notifications) {
    let bookingId = null;
    let link = '/notifications.html';
    if (n.bookingKey) {
      const k = byKey[n.bookingKey];
      bookingId = k?.id ?? null;
      if (k) link = users[n.userId]?.role === 'customer' ? `/booking.html?id=${k.id}` : `/owner-bookings.html?id=${k.id}`;
    } else if (n.slot) {
      const w = waitByKey[n.slot];
      link = `/venue.html?id=${courts[w.courtId][0].id}&date=${addDays(today, w.day)}&slot=${w.start}`;
    }
    await tx.query('INSERT INTO notifications (user_id, booking_id, message, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      n.userId, bookingId, n.message, link, n.isRead ? 1 : 0, ago(n.minAgo),
    ]);
    count.notifications += 1;
  }
  return count;
}

module.exports = { seedBookings };
