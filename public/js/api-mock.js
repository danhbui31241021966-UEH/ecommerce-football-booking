// Backend giả của prototype. CHỈ api.js được import file này (và chỉ khi MODE = 'mock').
// Mô phỏng đúng contract PRD mục 7 và các luật R1–R11 trên dữ liệu trong localStorage; không phải backend thứ hai:
// không phân quyền chi tiết ngoài vai trò/sở hữu, không tối ưu, không xử lý đồng thời.
import { ApiError } from './api.js';
import {
  vnToMs, msToVn, dateOf, timeOf, addDays, hmToMin, minToHm, discountedPrice, refundFor, shortTs, weekdayOf,
} from './ui/format.js';

const STORE_KEY = 'sannhanh.mock.v5';
const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled', 'expired', 'completed', 'no_show', 'transferred'];

let S = null; // trạng thái hiện tại (đồng bộ với localStorage)
let seeds = null; // dữ liệu mẫu đã tải từ public/mock/*.json
let seedPromise = null;

const fail = (status, message) => {
  throw new ApiError(status, message);
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const realNow = () => msToVn(Date.now());

/* ---------- Dữ liệu mẫu và lưu trữ ---------- */

async function loadSeeds() {
  if (!seedPromise) {
    seedPromise = Promise.all(
      ['meta', 'users', 'venues', 'bookings'].map((n) => fetch(`/mock/${n}.json`).then((r) => r.json())),
    ).then(([meta, users, venues, bookings]) => {
      seeds = { meta, users, venues, bookings };
    });
  }
  return seedPromise;
}

function nextId(kind) {
  S.ids[kind] = (S.ids[kind] || 0) + 1;
  return S.ids[kind];
}

/** Dựng dữ liệu demo tương đối theo hôm nay: luôn có "tối nay", giờ chót, booking chờ duyệt đang đếm ngược. */
function buildState() {
  const t = Date.now();
  const nowTs = msToVn(t);
  const today = dateOf(nowTs);
  const ago = (min) => msToVn(t - min * 60000);
  const inMin = (min) => msToVn(t + min * 60000);
  const st = {
    seedDay: today,
    clockOffsetMin: 0,
    sessionUserId: null,
    csrf: Math.random().toString(36).slice(2),
    ids: {},
    users: seeds.users.users.map((u) => ({
      ...u,
      password: seeds.users.demoPassword,
      createdAt: ago(u.createdDaysAgo * 1440),
    })),
    venues: clone(seeds.venues),
    bookings: [],
    blocks: [],
    waitlist: [],
    transfers: [],
    notifications: [],
    logs: [],
  };
  S = st;
  for (const u of st.users) delete u.createdDaysAgo;
  st.ids = { user: Math.max(...st.users.map((u) => u.id)), venue: 6, court: 14, booking: 0, block: 0, waitlist: 0, transfer: 0, notification: 0, log: 0 };

  const keyToBooking = {};
  const keyToWait = {};
  const courtMap = () => Object.fromEntries(st.venues.flatMap((v) => v.courts.map((c) => [c.id, [v, c]])));
  const courts = courtMap();

  for (const b of seeds.bookings.bookings) {
    const [venue, court] = courts[b.courtId];
    let date;
    let start;
    if (b.startAfterMin != null) {
      const ms = t + b.startAfterMin * 60000;
      const nowDate = dateOf(msToVn(ms));
      const grid = slotGrid(venue).find((s) => vnToMs(`${nowDate} ${s}`) >= ms);
      if (!grid) continue; // quá muộn trong ngày: bỏ mẫu này
      date = nowDate;
      start = grid;
    } else {
      date = addDays(today, b.day);
      start = b.start;
    }
    const slot = slotInfo(court, venue, date, start, null, true);
    const startAt = `${date} ${start}:00`;
    const rec = {
      id: nextId('booking'),
      code: '',
      userId: b.userId,
      venueId: venue.id,
      courtId: court.id,
      startAt,
      endAt: `${date} ${slot.end}:00`,
      status: b.status,
      expiresAt: b.status === 'pending' ? inMin(b.expiresInMin ?? 15) : null,
      price: slot.basePrice,
      basePrice: slot.basePrice,
      discountPercent: 0,
      paymentStatus: b.paid ? 'paid' : 'unpaid',
      refundStatus: b.refundStatus || 'none',
      refundPercent: b.refundPercent ?? 0,
      refundAmount: 0,
      cancelledBy: b.cancelledBy || null,
      cancelReason: b.cancelReason || null,
      lateCancel: !!b.lateCancel,
      customerNote: b.note || '',
      rulesSnapshot: venue.rules,
      policySnapshot: venue.cancelPolicy,
      idempotencyKey: null,
      createdAt: ago(b.createdMinAgo),
      cancelledAt: null,
    };
    rec.code = bookingCode(rec.id);
    if (rec.status === 'cancelled') {
      rec.cancelledAt = ago(b.cancelledMinAgo ?? Math.max(1, b.createdMinAgo - 60));
      rec.refundAmount = Math.round((rec.price * rec.refundPercent) / 100);
      if (rec.paymentStatus === 'unpaid') rec.refundAmount = 0;
    }
    st.bookings.push(rec);
    keyToBooking[b.key] = rec;
    seedHistory(rec, venue, b);
  }
  seedCrowd(st, t, today, courts);
  for (const k of seeds.bookings.blocks) {
    const [venue] = courts[k.courtId];
    st.blocks.push({ id: nextId('block'), courtId: k.courtId, date: addDays(today, k.day), start: k.start, end: k.end, reason: k.reason, ownerId: venue.ownerId });
  }
  for (const w of seeds.bookings.waitlist) {
    const rec = {
      id: nextId('waitlist'),
      userId: w.userId,
      courtId: w.courtId,
      date: addDays(today, w.day),
      start: w.start,
      status: w.status,
      offerExpiresAt: w.status === 'offered' ? inMin(w.offerExpiresInMin ?? 10) : null,
      createdAt: ago(w.createdMinAgo),
    };
    st.waitlist.push(rec);
    keyToWait[w.key] = rec;
  }
  seedTransfers(st, keyToBooking, ago);
  for (const n of seeds.bookings.notifications) {
    let bookingId = null;
    let link = '/notifications.html';
    if (n.bookingKey) {
      const b = keyToBooking[n.bookingKey];
      bookingId = b?.id ?? null;
      const owner = st.users.find((u) => u.id === n.userId);
      link = b ? (owner?.role === 'customer' ? `/booking.html?id=${b.id}` : `/owner-bookings.html?id=${b.id}`) : link;
    } else if (n.slot) {
      const w = keyToWait[n.slot];
      link = `/venue.html?id=${courts[w.courtId][0].id}&date=${w.date}&slot=${w.start}`;
    }
    st.notifications.push({ id: nextId('notification'), userId: n.userId, bookingId, message: n.message, link, isRead: !!n.isRead, createdAt: ago(n.minAgo) });
  }
  return st;
}

const hash32 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Số ngẫu nhiên tất định trong [0,1) theo khóa: cùng ngày dựng thì cùng kết quả. */
const rand01 = (key) => hash32(key) / 4294967296;

/**
 * Booking nền cho sân thật để lịch trông có người dùng (tham số trong bookings.json → crowd).
 * Không ghi lịch sử, không sinh thông báo. Booking chờ duyệt hết hạn tự nhiên như mọi booking (còn 2–15 phút lúc dựng, so le nhau).
 */
function seedCrowd(st, t, today, courts) {
  const cfg = seeds.bookings.crowd;
  if (!cfg) return;
  const nowTs = msToVn(t);
  const weight = (table, h) => table.reduce((w, [from, v]) => (h >= from ? v : w), 0);
  const taken = new Set();
  for (const venue of st.venues) {
    if (venue.id < cfg.firstVenueId || !venue.isActive) continue;
    const grid = slotGrid(venue);
    const pop = cfg.popularity[0] + rand01(`pop|${today}|${venue.id}`) * (cfg.popularity[1] - cfg.popularity[0]);
    const pendingShare = venue.requiresApproval ? cfg.pendingShare : cfg.pendingShare / 4;
    for (const court of venue.courts) {
      if (!court.isActive) continue;
      for (let d = 0; d <= meta().bookingWindowDays; d++) {
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
          let ci = hash32(`who|${key}`) % cfg.customerIds.length;
          // Một khách nền không đặt hai sân cùng giờ trong cùng một cụm sân (cụm nào cũng ít sân hơn số khách nền).
          while (taken.has(`${venue.id}|${ci}|${date} ${start}`)) ci = (ci + 1) % cfg.customerIds.length;
          taken.add(`${venue.id}|${ci}|${date} ${start}`);
          const pending = rand01(`st|${key}`) < pendingShare;
          const slot = slotInfo(court, venue, date, start, null, true);
          const holdLeft = 2 + Math.floor(rand01(`hold|${key}`) * (meta().holdMinutes - 1));
          const createdMin = pending ? meta().holdMinutes - holdLeft : 40 + Math.floor(rand01(`new|${key}`) * 4000);
          const id = nextId('booking');
          st.bookings.push({
            id,
            code: bookingCode(id),
            userId: cfg.customerIds[ci],
            venueId: venue.id,
            courtId: court.id,
            startAt: `${date} ${start}:00`,
            endAt: `${date} ${slot.end}:00`,
            status: pending ? 'pending' : 'confirmed',
            expiresAt: pending ? msToVn(t + holdLeft * 60000) : null,
            price: slot.basePrice,
            basePrice: slot.basePrice,
            discountPercent: 0,
            paymentStatus: !pending && rand01(`pay|${key}`) < cfg.paidShare ? 'paid' : 'unpaid',
            refundStatus: 'none',
            refundPercent: 0,
            refundAmount: 0,
            cancelledBy: null,
            cancelReason: null,
            lateCancel: false,
            customerNote: '',
            rulesSnapshot: venue.rules,
            policySnapshot: venue.cancelPolicy,
            idempotencyKey: null,
            createdAt: msToVn(t - createdMin * 60000),
            cancelledAt: null,
          });
          filled++;
        }
      }
    }
  }
}

/** Đăng nhượng mẫu theo mẫu booking có `transfer` (askPercent, minAgo, claimedBy, claimedMinAgo, done). Thông báo tương ứng sinh kèm. */
function seedTransfers(st, keyToBooking, ago) {
  for (const tpl of seeds.bookings.bookings) {
    const spec = tpl.transfer;
    const b = spec && keyToBooking[tpl.key];
    if (!b) continue;
    const [venue, court] = courtOf(b.courtId);
    const ask = Math.min(b.price, roundThousand((b.price * spec.askPercent) / 100));
    const created = ago(spec.minAgo);
    const closesMs = vnToMs(b.startAt) - meta().transferCloseMinutes * 60000;
    const waiters = slotWaiters(b.courtId, dateOf(b.startAt), timeOf(b.startAt));
    const t = {
      id: nextId('transfer'),
      bookingId: b.id,
      fromUserId: b.userId,
      askPrice: ask,
      status: 'open',
      createdAt: created,
      closesAt: msToVn(closesMs),
      priorityUntil: waiters.length ? msToVn(vnToMs(created) + meta().waitlistOfferMinutes * 60000) : null,
      toUserId: null,
      claimedAt: null,
      claimExpiresAt: null,
      newBookingId: null,
      endReason: null,
    };
    st.transfers.push(t);
    addLog(b, 'transfer_open', null, null, userOf(b.userId), `Giá nhượng ${vnd(ask)}`, created);
    for (const w of waiters) {
      st.notifications.push({ id: nextId('notification'), userId: w.userId, bookingId: null, message: `Có đội đăng nhượng slot ${slotLabel(b)} tại ${venue.name} · ${court.name}, giá ${vnd(ask)}. Bạn đang chờ slot này nên được ưu tiên nhận đến ${timeOf(t.priorityUntil)}.`, link: `/transfer.html?id=${t.id}`, isRead: false, createdAt: created });
    }
    if (spec.claimedBy) {
      t.status = 'claimed';
      t.toUserId = spec.claimedBy;
      t.claimedAt = ago(spec.claimedMinAgo);
      t.claimExpiresAt = msToVn(vnToMs(t.claimedAt) + meta().holdMinutes * 60000);
      addLog(b, 'transfer_claim', null, null, null, 'Có đội nhận, chờ chủ sân xác nhận đã nhận tiền', t.claimedAt);
      if (!spec.done) {
        st.notifications.push({ id: nextId('notification'), userId: venue.ownerId, bookingId: b.id, message: `${userOf(spec.claimedBy).fullName} nhận nhượng booking ${b.code} (${court.name} ${slotLabel(b)}), chuyển ${vnd(ask)} nội dung NH${b.code}. Đối chiếu rồi xác nhận trước ${timeOf(t.claimExpiresAt)}.`, link: '/owner-bookings.html#transfers', isRead: false, createdAt: t.claimedAt });
      }
    }
    if (spec.done) finishTransfer(t, userOf(venue.ownerId), '', true);
  }
}

/** Lịch sử mẫu suy ra từ trạng thái hiện có của booking (đủ để màn chi tiết và nhật ký có nội dung). */
function seedHistory(b, venue, tpl) {
  const t = vnToMs(b.createdAt);
  const customer = S.users.find((u) => u.id === b.userId);
  const owner = S.users.find((u) => u.id === venue.ownerId);
  const at = (min) => msToVn(t + min * 60000);
  const needsApproval = venue.requiresApproval || tpl.note === 'Chờ duyệt do độ tin cậy thấp';
  const created = needsApproval ? 'pending' : 'confirmed';
  addLog(b, 'create', null, created, customer, '', b.createdAt);
  if (b.status === 'pending') return;
  if (needsApproval && !['rejected', 'expired'].includes(b.status)) addLog(b, 'approve', 'pending', 'confirmed', owner, '', at(5));
  if (b.paymentStatus === 'paid') addLog(b, 'paid', null, null, owner, 'Đã nhận chuyển khoản', at(30));
  if (b.status === 'rejected') addLog(b, 'reject', 'pending', 'rejected', owner, b.cancelReason, at(8));
  if (b.status === 'expired') addLog(b, 'expire', 'pending', 'expired', { fullName: 'Hệ thống', role: 'system' }, 'Quá hạn chưa duyệt', at(15));
  if (b.status === 'cancelled') addLog(b, 'cancel', created, 'cancelled', customer, b.cancelReason || '', b.cancelledAt);
  if (b.refundStatus === 'done') addLog(b, 'refund', null, null, owner, '', b.cancelledAt);
  if (b.status === 'no_show') addLog(b, 'attendance', 'confirmed', 'no_show', owner, 'Không đến sân', b.startAt);
  if (b.status === 'completed') addLog(b, 'attendance', 'confirmed', 'completed', owner, '', b.startAt);
}

function bookingCode(id) {
  return `SN${String(id).padStart(5, '0')}`;
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(S));
}

async function ready() {
  if (S) return;
  await loadSeeds();
  let loaded = null;
  try {
    loaded = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    loaded = null;
  }
  // Dữ liệu demo sinh theo ngày: sang ngày mới thì dựng lại để "tối nay" luôn có thật.
  if (loaded && loaded.seedDay === dateOf(realNow())) {
    S = loaded;
  } else {
    const keepSession = loaded?.sessionUserId ?? null;
    buildState();
    S.sessionUserId = keepSession;
    save();
  }
}

/* ---------- Thời gian, lịch, giá ---------- */

const now = () => msToVn(Date.now() + S.clockOffsetMin * 60000);
const nowMs = () => Date.now() + S.clockOffsetMin * 60000;
const meta = () => seeds.meta;

const venueOf = (id) => S.venues.find((v) => v.id === Number(id));
const courtOf = (id) => {
  for (const v of S.venues) {
    const c = v.courts.find((x) => x.id === Number(id));
    if (c) return [v, c];
  }
  return [null, null];
};
const userOf = (id) => S.users.find((u) => u.id === id);

function slotGrid(venue) {
  const out = [];
  for (let m = hmToMin(venue.openTime); m + venue.slotMinutes <= hmToMin(venue.closeTime); m += venue.slotMinutes) out.push(minToHm(m));
  return out;
}
const isPeak = (venue, start) => !!venue.peakStart && start >= venue.peakStart && start < venue.peakEnd;
const slotEnd = (venue, start) => minToHm(hmToMin(start) + venue.slotMinutes);

const activeBookingAt = (courtId, date, start) =>
  S.bookings.find((b) => b.courtId === courtId && b.startAt === `${date} ${start}:00` && ['pending', 'confirmed'].includes(b.status));
const blockAt = (courtId, date, start, end) =>
  S.blocks.find((k) => k.courtId === courtId && k.date === date && k.start < end && k.end > start);
const slotWaiters = (courtId, date, start) =>
  S.waitlist.filter((w) => w.courtId === courtId && w.date === date && w.start === start).sort((a, b) => a.id - b.id);
const activeOffer = (courtId, date, start) =>
  slotWaiters(courtId, date, start).find((w) => w.status === 'offered' && vnToMs(w.offerExpiresAt) > nowMs());

/** Một ô lịch. viewer = user đang xem (có thể null); detail = thêm thông tin chủ sân. */
function slotInfo(court, venue, date, start, viewer, forSeed = false, detail = false) {
  const end = slotEnd(venue, start);
  const peak = isPeak(venue, start);
  const basePrice = peak ? court.peakPrice : court.price;
  const startMs = vnToMs(`${date} ${start}`);
  const slot = { start, end, basePrice, discountPercent: 0, price: basePrice, peak, status: 'available' };
  if (forSeed) return slot;

  const booking = activeBookingAt(court.id, date, start);
  const block = blockAt(court.id, date, start, end);
  const offer = activeOffer(court.id, date, start);
  const mine = viewer && booking && booking.userId === viewer.id;
  if (startMs <= nowMs()) slot.status = 'past';
  else if (block) slot.status = 'blocked';
  else if (booking) slot.status = booking.status === 'confirmed' ? 'booked' : 'held';
  else if (offer) slot.status = 'offered';

  if (viewer) {
    const own = slotWaiters(court.id, date, start).find((w) => w.userId === viewer.id);
    if (own) slot.onWaitlist = true;
    if (offer && offer.userId === viewer.id) {
      slot.offeredToYou = true;
      slot.offerExpiresAt = offer.offerExpiresAt;
    }
  }
  if (mine) slot.mine = true;
  const offerT = booking && S.transfers.find((t) => t.bookingId === booking.id && t.status === 'open');
  if (offerT) slot.transfer = { id: offerT.id, askPrice: offerT.askPrice, originalPrice: booking.price };

  const bookable = slot.status === 'available' || slot.offeredToYou;
  const hoursAhead = (startMs - nowMs()) / 3600000;
  if (bookable && hoursAhead > 0 && hoursAhead <= meta().lastMinuteHours && venue.lastMinutePercent > 0) {
    slot.discountPercent = venue.lastMinutePercent;
    slot.price = discountedPrice(basePrice, venue.lastMinutePercent);
  }

  if (detail) {
    if (booking) {
      const u = userOf(booking.userId);
      slot.booking = { id: booking.id, code: booking.code, status: booking.status, paymentStatus: booking.paymentStatus, customerName: u.fullName, customerPhone: u.phone };
    }
    if (block) slot.block = { id: block.id, reason: block.reason };
    const waiting = slotWaiters(court.id, date, start).length;
    if (waiting) slot.waitlistCount = waiting;
  }
  return slot;
}

function scheduleOf(venue, date, viewer, detail = false) {
  return {
    date,
    slotMinutes: venue.slotMinutes,
    courts: venue.courts
      .filter((c) => c.isActive || detail)
      .map((c) => ({
        id: c.id,
        name: c.name,
        fieldType: c.fieldType,
        ...(detail ? { isActive: c.isActive } : {}),
        slots: slotGrid(venue).map((s) => slotInfo(c, venue, date, s, viewer, false, detail)),
      })),
  };
}

/* ---------- Biến đổi sang kiểu dữ liệu của contract ---------- */

const activeCourts = (v) => v.courts.filter((c) => c.isActive);

function toVenue(v, extra = {}) {
  const courts = activeCourts(v);
  const prices = courts.flatMap((c) => [c.price, c.peakPrice]);
  return {
    id: v.id,
    name: v.name,
    district: v.district,
    address: v.address,
    phone: v.phone,
    imageUrl: v.imageUrl,
    imageIsIllustrative: v.imageIsIllustrative === true,
    imageCredit: v.imageCredit || null,
    amenities: v.amenities,
    openTime: v.openTime,
    closeTime: v.closeTime,
    slotMinutes: v.slotMinutes,
    requiresApproval: v.requiresApproval,
    lastMinutePercent: v.lastMinutePercent,
    vietQr: !!(v.bank && v.bank.bin && v.bank.account),
    fieldTypes: [...new Set(courts.map((c) => c.fieldType))].sort(),
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    ...extra,
  };
}
const courtOut = (c, owner = false) => ({
  id: c.id, name: c.name, fieldType: c.fieldType, price: c.price, peakPrice: c.peakPrice, ...(owner ? { isActive: c.isActive } : {}),
});
function toVenueDetail(v, owner = false) {
  return {
    ...toVenue(v),
    description: v.description,
    rules: v.rules,
    peakStart: v.peakStart,
    peakEnd: v.peakEnd,
    cancelPolicy: v.cancelPolicy,
    mapsUrl: v.mapsUrl,
    ...(v.dataSource ? { dataSource: v.dataSource } : {}),
    courts: (owner ? v.courts : activeCourts(v)).map((c) => courtOut(c, owner)),
    ...(owner ? { isActive: v.isActive, bankBin: v.bank?.bin || '', bankAccount: v.bank?.account || '', bankAccountName: v.bank?.accountName || '' } : {}),
  };
}

function toBooking(b, { admin = false } = {}) {
  const [venue, court] = courtOf(b.courtId);
  const out = {
    id: b.id,
    code: b.code,
    venueId: venue.id,
    venueName: venue.name,
    courtId: court.id,
    courtName: court.name,
    fieldType: court.fieldType,
    startAt: b.startAt,
    endAt: b.endAt,
    status: b.status,
    expiresAt: b.expiresAt,
    price: b.price,
    basePrice: b.basePrice,
    discountPercent: b.discountPercent,
    paymentStatus: b.paymentStatus,
    refundStatus: b.refundStatus,
    refundPercent: b.refundPercent,
    refundAmount: b.refundAmount,
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt,
    acquiredByTransfer: !!b.transferFromId,
    transfer: transferBrief(b, admin),
  };
  if (admin) {
    const u = userOf(b.userId);
    out.customerName = u.fullName;
    out.customerPhone = u.phone;
  }
  return out;
}

function reliabilityOf(userId) {
  const m = meta();
  const from = nowMs() - m.reliabilityWindowDays * 86400000;
  const mine = S.bookings.filter((b) => b.userId === userId && vnToMs(b.startAt) >= from);
  const noShows = mine.filter((b) => b.status === 'no_show').length;
  const lateCancels = mine.filter((b) => b.status === 'cancelled' && b.lateCancel).length;
  const completed = mine.filter((b) => b.status === 'completed').length;
  const violations = noShows + lateCancels;
  return { noShows, lateCancels, completed, violations, windowDays: m.reliabilityWindowDays, maxViolations: m.reliabilityMaxViolations, restricted: violations >= m.reliabilityMaxViolations };
}

function qrOf(venue, amount, content) {
  const bank = venue.bank;
  if (!bank?.bin || !bank?.account) return null;
  const q = new URLSearchParams({ amount: String(amount), addInfo: content, accountName: bank.accountName });
  return {
    url: `https://img.vietqr.io/image/${bank.bin}-${bank.account}-compact2.svg?${q}`,
    bankName: meta().banks.find((x) => x.bin === bank.bin)?.name || bank.bin,
    account: bank.account,
    accountName: bank.accountName,
    amount,
    content,
  };
}
function paymentQr(b, venue) {
  if (b.status !== 'confirmed' || b.paymentStatus !== 'unpaid') return null; // R8
  return qrOf(venue, b.price, b.code);
}

function toBookingDetail(b, viewer) {
  const [venue] = courtOf(b.courtId);
  const customer = userOf(b.userId);
  const staff = viewer.role !== 'customer';
  return {
    ...toBooking(b, { admin: staff }),
    customerName: customer.fullName,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    customerNote: b.customerNote,
    rulesSnapshot: b.rulesSnapshot,
    policySnapshot: b.policySnapshot,
    history: S.logs
      .filter((l) => l.bookingId === b.id)
      .sort((x, y) => x.id - y.id)
      .map((l) => ({ action: l.action, fromStatus: l.fromStatus, toStatus: l.toStatus, actorName: l.actorName, note: l.note, createdAt: l.createdAt })),
    paymentQr: paymentQr(b, venue),
    customerReliability: staff ? reliabilityOf(b.userId) : null,
  };
}

/* ---------- Nhật ký, thông báo, danh sách chờ ---------- */

function addLog(b, action, fromStatus, toStatus, actor, note = '', at = null) {
  S.logs.push({
    id: nextId('log'),
    bookingId: b.id,
    code: b.code,
    action,
    fromStatus: fromStatus || null,
    toStatus: toStatus || null,
    note: note || '',
    actorName: actor?.fullName || 'Hệ thống',
    actorRole: actor?.role || 'system',
    createdAt: at || now(),
  });
}

function notify(userId, message, { bookingId = null, link = '/notifications.html' } = {}) {
  S.notifications.push({ id: nextId('notification'), userId, bookingId, message, link, isRead: false, createdAt: now() });
}

/** R9: slot vừa trống thì giữ quyền đặt 10 phút (không quá giờ bắt đầu) cho người chờ sớm nhất. */
function offerSlot(courtId, date, start) {
  const [venue, court] = courtOf(courtId);
  const startMs = vnToMs(`${date} ${start}`);
  if (startMs <= nowMs()) return;
  if (activeBookingAt(courtId, date, start) || blockAt(courtId, date, start, slotEnd(venue, start))) return;
  if (activeOffer(courtId, date, start)) return;
  const next = slotWaiters(courtId, date, start).find((w) => w.status === 'waiting');
  if (!next) return;
  const until = Math.min(nowMs() + meta().waitlistOfferMinutes * 60000, startMs);
  next.status = 'offered';
  next.offerExpiresAt = msToVn(until);
  notify(next.userId, `Slot ${start} ngày ${date.slice(8, 10)}/${date.slice(5, 7)} tại ${venue.name} · ${court.name} đang giữ cho bạn đến ${timeOf(next.offerExpiresAt)}.`, {
    link: `/venue.html?id=${venue.id}&date=${date}&slot=${start}&court=${court.id}`,
  });
}
const freeSlot = (b) => offerSlot(b.courtId, dateOf(b.startAt), timeOf(b.startAt));

/** Xử lý theo thời gian: R3 hết hạn giữ chỗ, R9 hết hạn lượt giữ quyền đặt. Gọi đầu mỗi request. */
function tick() {
  let changed = false;
  const t = now();
  for (const b of S.bookings) {
    if (b.status === 'pending' && b.expiresAt && vnToMs(b.expiresAt) <= nowMs()) {
      b.status = 'expired';
      addLog(b, 'expire', 'pending', 'expired', null, 'Quá hạn giữ chỗ chưa được duyệt', b.expiresAt);
      notify(b.userId, `Booking ${b.code} đã hết hạn vì chủ sân chưa duyệt kịp.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      freeSlot(b);
      changed = true;
    }
  }
  if (tickTransfers()) changed = true;
  for (const w of [...S.waitlist]) {
    if (vnToMs(`${w.date} ${w.start}`) <= nowMs()) {
      S.waitlist.splice(S.waitlist.indexOf(w), 1);
      changed = true;
    } else if (w.status === 'offered' && vnToMs(w.offerExpiresAt) <= nowMs()) {
      S.waitlist.splice(S.waitlist.indexOf(w), 1);
      const [venue] = courtOf(w.courtId);
      notify(w.userId, `Lượt giữ slot ${w.start} tại ${venue.name} của bạn đã hết hạn.`);
      offerSlot(w.courtId, w.date, w.start);
      changed = true;
    }
  }
  if (changed) save();
  return t;
}

/* ---------- Xác thực ---------- */

const sessionUser = () => (S.sessionUserId ? userOf(S.sessionUserId) || null : null);
const userOut = (u) => ({ id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role });

function need(ctx, ...roles) {
  if (!ctx.user) fail(401, 'Vui lòng đăng nhập');
  if (roles.length && !roles.includes(ctx.user.role)) fail(403, 'Bạn không có quyền thực hiện thao tác này');
  return ctx.user;
}
const num = (v) => (v === '' || v == null ? NaN : Number(v));
const req = (cond, msg) => {
  if (!cond) fail(400, msg);
};

/* ---------- Tìm sân ---------- */

function courtFilter(params) {
  const type = params.fieldType ? String(params.fieldType) : '';
  return (c) => c.isActive && (!type || c.fieldType === type);
}
function venueMatches(v, params) {
  if (!v.isActive) return false;
  if (params.district && v.district !== params.district) return false;
  if (params.q) {
    const q = String(params.q).toLowerCase();
    if (!`${v.name} ${v.address} ${v.district}`.toLowerCase().includes(q)) return false;
  }
  const cf = courtFilter(params);
  const cs = v.courts.filter(cf);
  if (!cs.length) return false;
  const max = num(params.maxPrice);
  if (max && !cs.some((c) => c.price <= max)) return false;
  return true;
}
function availableOn(v, date, params, viewer) {
  const cf = courtFilter(params);
  const max = num(params.maxPrice);
  const fromMin = params.from ? hmToMin(params.from) : 0;
  const out = [];
  for (const c of v.courts.filter(cf)) {
    for (const s of slotGrid(v)) {
      if (hmToMin(s) < fromMin) continue;
      const slot = slotInfo(c, v, date, s, viewer);
      if (!(slot.status === 'available' || slot.offeredToYou)) continue;
      if (max && slot.price > max) continue;
      out.push({ courtId: c.id, courtName: c.name, fieldType: c.fieldType, start: slot.start, end: slot.end, price: slot.price, basePrice: slot.basePrice, discountPercent: slot.discountPercent, peak: slot.peak, offeredToYou: !!slot.offeredToYou });
    }
  }
  return out;
}

function checkDate(date) {
  req(/^\d{4}-\d{2}-\d{2}$/.test(date || ''), 'Ngày không hợp lệ');
  return date;
}

/* ---------- Đặt sân, hủy, thao tác trạng thái ---------- */

function createBooking(ctx) {
  const user = need(ctx, 'customer');
  const { courtId, date, start, note = '', idempotencyKey } = ctx.body || {};
  if (idempotencyKey) {
    const dup = S.bookings.find((b) => b.userId === user.id && b.idempotencyKey === idempotencyKey);
    if (dup) return toBooking(dup);
  }
  const [venue, court] = courtOf(courtId);
  if (!venue || !court || !court.isActive || !venue.isActive) fail(404, 'Không tìm thấy sân con');
  checkDate(date);
  req(slotGrid(venue).includes(start), 'Giờ bắt đầu không khớp lịch của sân');
  const today = dateOf(now());
  req(date >= today && date <= addDays(today, meta().bookingWindowDays - 1), `Chỉ đặt trước tối đa ${meta().bookingWindowDays} ngày (R1)`);
  const slot = slotInfo(court, venue, date, start, user);
  if (slot.status === 'past') fail(400, 'Slot này đã qua giờ bắt đầu');
  if (slot.status === 'blocked') fail(409, 'Slot đang bị chủ sân chặn');
  if (slot.status === 'booked' || slot.status === 'held') fail(409, 'Slot vừa có người khác giữ, vui lòng chọn giờ khác'); // R4
  if (slot.status === 'offered' && !slot.offeredToYou) fail(409, 'Slot đang được giữ cho người trong danh sách chờ');

  const rel = reliabilityOf(user.id);
  const needsApproval = venue.requiresApproval || rel.restricted; // R3, R10
  const b = {
    id: nextId('booking'),
    code: '',
    userId: user.id,
    venueId: venue.id,
    courtId: court.id,
    startAt: `${date} ${start}:00`,
    endAt: `${date} ${slot.end}:00`,
    status: needsApproval ? 'pending' : 'confirmed',
    expiresAt: needsApproval ? msToVn(nowMs() + meta().holdMinutes * 60000) : null,
    price: slot.price, // R6: giá chốt tại lúc đặt
    basePrice: slot.basePrice,
    discountPercent: slot.discountPercent,
    paymentStatus: 'unpaid',
    refundStatus: 'none',
    refundPercent: 0,
    refundAmount: 0,
    cancelledBy: null,
    cancelReason: null,
    lateCancel: false,
    customerNote: String(note).slice(0, 300),
    rulesSnapshot: venue.rules,
    policySnapshot: venue.cancelPolicy,
    idempotencyKey: idempotencyKey || null,
    createdAt: now(),
    cancelledAt: null,
  };
  b.code = bookingCode(b.id);
  S.bookings.push(b);
  // Người đặt được giữ quyền thì lượt chờ coi như đã hoàn tất.
  S.waitlist = S.waitlist.filter((w) => !(w.userId === user.id && w.courtId === court.id && w.date === date && w.start === start));
  addLog(b, 'create', null, b.status, user, rel.restricted && !venue.requiresApproval ? 'Chờ duyệt do độ tin cậy của khách' : '');
  if (needsApproval) {
    notify(venue.ownerId, `Booking ${b.code} (${user.fullName}) đang chờ duyệt, còn ${meta().holdMinutes} phút.`, { bookingId: b.id, link: `/owner-bookings.html?id=${b.id}` });
    notify(user.id, `Đã gửi yêu cầu đặt ${court.name} ${shortTs(b.startAt)}, chờ chủ sân duyệt trong ${meta().holdMinutes} phút.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  } else {
    notify(user.id, `Booking ${b.code} đã được xác nhận. Vui lòng thanh toán bằng VietQR.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  }
  save();
  return toBooking(b);
}

function findBooking(id) {
  const b = S.bookings.find((x) => x.id === Number(id));
  if (!b) fail(404, 'Không tìm thấy booking');
  return b;
}
function canSee(user, b) {
  if (user.role === 'admin') return true;
  if (user.role === 'owner') return courtOf(b.courtId)[0].ownerId === user.id;
  return b.userId === user.id;
}
function ownBooking(ctx, id) {
  const user = need(ctx, 'owner');
  const b = findBooking(id);
  if (!canSee(user, b)) fail(403, 'Booking này không thuộc sân của bạn');
  return b;
}

/** Hủy booking: dùng chung cho khách, chủ sân và admin. R7 hoàn tiền, R10 hủy muộn. */
function doCancel(b, actor, reason, by) {
  if (!['pending', 'confirmed'].includes(b.status)) fail(409, 'Booking không còn ở trạng thái có thể hủy');
  const tr = activeTransfer(b);
  if (tr?.status === 'claimed' && by === 'customer') fail(409, 'Booking đang có đội nhận nhượng, chờ chủ sân xác nhận hoặc từ chối rồi hãy hủy');
  if (tr) closeTransfer(tr, 'cancelled', by === 'customer' ? actor : null, 'Booking bị hủy nên đóng đăng nhượng');
  const from = b.status;
  const paid = b.paymentStatus === 'paid';
  const r = refundFor({ startAt: b.startAt, price: b.price, paid }, now(), by);
  b.status = 'cancelled';
  b.cancelledBy = by;
  b.cancelReason = String(reason || '').slice(0, 300) || null;
  b.cancelledAt = now();
  b.expiresAt = null;
  b.refundPercent = r.percent;
  b.refundAmount = r.amount;
  b.refundStatus = r.amount > 0 ? 'pending' : 'none';
  b.lateCancel = by === 'customer' && from === 'confirmed' && r.hoursLeft < 12;
  addLog(b, 'cancel', from, 'cancelled', actor, b.cancelReason || '');
  const [venue] = courtOf(b.courtId);
  if (by === 'customer') {
    notify(venue.ownerId, `Khách ${userOf(b.userId).fullName} đã hủy booking ${b.code}.${r.amount ? ` Cần hoàn ${r.amount.toLocaleString('vi-VN')}đ.` : ''}`, { bookingId: b.id, link: `/owner-bookings.html?id=${b.id}` });
  } else {
    notify(b.userId, `Booking ${b.code} đã bị hủy bởi ${by === 'owner' ? 'chủ sân' : 'quản trị viên'}${b.cancelReason ? `: ${b.cancelReason}` : '.'}${r.amount ? ` Bạn được hoàn ${r.amount.toLocaleString('vi-VN')}đ.` : ''}`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  }
  freeSlot(b);
  save();
}

function doApprove(b, actor) {
  if (b.status !== 'pending') fail(409, 'Chỉ duyệt được booking đang chờ duyệt');
  if (b.expiresAt && vnToMs(b.expiresAt) <= nowMs()) fail(409, 'Booking đã hết hạn giữ chỗ');
  b.status = 'confirmed';
  b.expiresAt = null;
  addLog(b, 'approve', 'pending', 'confirmed', actor);
  notify(b.userId, `Booking ${b.code} đã được duyệt. Vui lòng thanh toán bằng VietQR.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
}
function doReject(b, actor, reason) {
  if (b.status !== 'pending') fail(409, 'Chỉ từ chối được booking đang chờ duyệt');
  req(String(reason || '').trim(), 'Vui lòng nhập lý do từ chối');
  b.status = 'rejected';
  b.expiresAt = null;
  b.cancelReason = String(reason).slice(0, 300);
  addLog(b, 'reject', 'pending', 'rejected', actor, b.cancelReason);
  notify(b.userId, `Booking ${b.code} bị từ chối: ${b.cancelReason}`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  freeSlot(b);
  save();
}
function doPaid(b, actor, note) {
  if (b.status !== 'confirmed' && b.status !== 'completed') fail(409, 'Chỉ ghi nhận thanh toán cho booking đã xác nhận');
  if (b.paymentStatus === 'paid') fail(409, 'Booking đã được ghi nhận thanh toán');
  b.paymentStatus = 'paid';
  addLog(b, 'paid', null, null, actor, note || '');
  notify(b.userId, `Đã ghi nhận thanh toán cho booking ${b.code}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
}
function doRefunded(b, actor, note) {
  if (b.refundStatus !== 'pending') fail(409, 'Booking không có khoản hoàn đang chờ');
  b.refundStatus = 'done';
  addLog(b, 'refund', null, null, actor, note || '');
  notify(b.userId, `Chủ sân đã hoàn ${b.refundAmount.toLocaleString('vi-VN')}đ cho booking ${b.code}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
}
function doAttendance(b, actor, result) {
  req(['completed', 'no_show'].includes(result), 'Kết quả phải là completed hoặc no_show');
  if (b.status !== 'confirmed') fail(409, 'Chỉ đánh dấu cho booking đã xác nhận');
  if (vnToMs(b.startAt) > nowMs()) fail(400, 'Chưa tới giờ đá nên chưa đánh dấu được');
  b.status = result;
  addLog(b, 'attendance', 'confirmed', result, actor, result === 'no_show' ? 'Không đến sân' : '');
  if (result === 'no_show') {
    const r = reliabilityOf(b.userId);
    notify(b.userId, `Bạn bị ghi nhận vắng mặt ở booking ${b.code}. ${r.restricted ? 'Các booking mới của bạn sẽ cần chủ sân duyệt.' : `Đã có ${r.violations}/${r.maxViolations} lần vi phạm trong ${r.windowDays} ngày.`}`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  }
  save();
}

// Backend thật: list() mặc định limit = 200, ORDER BY start_at DESC, dùng chung cho khách, chủ sân và admin.
const LIST_LIMIT = 200;
function listBookings(user, query) {
  let rows = S.bookings.filter((b) => (user.role === 'admin' ? true : courtOf(b.courtId)[0].ownerId === user.id));
  if (query.status) rows = rows.filter((b) => b.status === query.status);
  if (query.date) rows = rows.filter((b) => dateOf(b.startAt) === query.date);
  if (query.venueId) rows = rows.filter((b) => b.venueId === Number(query.venueId));
  if (query.q) {
    const q = String(query.q).toLowerCase();
    rows = rows.filter((b) => {
      const c = userOf(b.userId);
      const v = courtOf(b.courtId)[0];
      return `${b.code} ${c.fullName} ${c.phone} ${v.name}`.toLowerCase().includes(q);
    });
  }
  return rows.sort((a, b) => (a.startAt < b.startAt ? 1 : -1)).slice(0, LIST_LIMIT).map((b) => toBooking(b, { admin: true }));
}


/* ---------- Nhượng booking ---------- */
// Booking đã xác nhận và đã thanh toán của đội A được đăng nhượng; đội B nhận và chuyển tiền thẳng chủ sân;
// chủ sân xác nhận đã nhận tiền thì booking chuyển sang B trong một bước (slot không bao giờ trống).
// Khoản hoàn cho A theo dõi riêng trên booking cũ (refundStatus pending → done), tách khỏi việc đổi chủ.

const ACTIVE_TRANSFER = ['open', 'claimed'];
const activeTransfer = (b) => S.transfers.find((t) => t.bookingId === b.id && ACTIVE_TRANSFER.includes(t.status));
const lastTransfer = (b) => [...S.transfers].reverse().find((t) => t.bookingId === b.id);
const roundThousand = (n) => Math.round(n / 1000) * 1000;
const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const slotLabel = (b) => `${timeOf(b.startAt)} ${dateOf(b.startAt).slice(8, 10)}/${dateOf(b.startAt).slice(5, 7)}`;
const waitersOfBooking = (b) => slotWaiters(b.courtId, dateOf(b.startAt), timeOf(b.startAt)).filter((w) => ['waiting', 'offered'].includes(w.status));
const priorityActive = (t) => !!t.priorityUntil && vnToMs(t.priorityUntil) > nowMs();

function transferBrief(b, staff = false) {
  const t = lastTransfer(b);
  if (!t) return null;
  const out = { id: t.id, status: t.status, askPrice: t.askPrice, closesAt: t.closesAt, claimExpiresAt: t.status === 'claimed' ? t.claimExpiresAt : null };
  if (staff && t.toUserId) out.claimerName = userOf(t.toUserId).fullName;
  return out;
}

function toTransfer(t, viewer) {
  const b = S.bookings.find((x) => x.id === t.bookingId);
  const [venue, court] = courtOf(b.courtId);
  const isOwner = viewer?.role === 'owner' && venue.ownerId === viewer.id;
  const staff = isOwner || viewer?.role === 'admin';
  const role = !viewer ? null : viewer.id === t.fromUserId ? 'giver' : viewer.id === t.toUserId ? 'claimer' : staff ? 'staff' : null;
  const waiter = viewer && waitersOfBooking(b).some((w) => w.userId === viewer.id);
  const out = {
    id: t.id,
    status: t.status,
    askPrice: t.askPrice,
    originalPrice: b.price,
    discountPercent: Math.round((1 - t.askPrice / b.price) * 100),
    venueId: venue.id,
    venueName: venue.name,
    courtId: court.id,
    courtName: court.name,
    fieldType: court.fieldType,
    startAt: b.startAt,
    endAt: b.endAt,
    createdAt: t.createdAt,
    closesAt: t.closesAt,
    priorityUntil: t.status === 'open' && priorityActive(t) ? t.priorityUntil : null,
    priorityLocked: t.status === 'open' && priorityActive(t) && !waiter,
    role,
    claimedAt: t.claimedAt,
    claimExpiresAt: t.status === 'claimed' && role ? t.claimExpiresAt : null,
    endReason: t.endReason || null,
  };
  if (role === 'giver' || staff) {
    out.bookingId = b.id;
    out.bookingCode = b.code;
    out.refund = t.status === 'completed' ? { status: b.refundStatus, amount: b.refundAmount } : null;
  }
  if (role === 'claimer') {
    out.newBookingId = t.newBookingId;
    out.paymentQr = t.status === 'claimed' ? qrOf(venue, t.askPrice, `NH${b.code}`) : null;
  }
  if (staff) {
    out.giverName = userOf(t.fromUserId).fullName;
    out.claimerName = t.toUserId ? userOf(t.toUserId).fullName : null;
    out.claimerPhone = t.toUserId ? userOf(t.toUserId).phone : null;
    out.claimerReliability = t.toUserId ? reliabilityOf(t.toUserId) : null;
    out.newBookingId = t.newBookingId;
    out.paymentContent = `NH${b.code}`;
  }
  return out;
}

/** Đóng một đăng nhượng chưa xong (rút, hết hạn, booking bị hủy). Báo cho đội đang nhận nếu có. */
function closeTransfer(t, status, actor, reason) {
  const b = S.bookings.find((x) => x.id === t.bookingId);
  const wasClaimed = t.status === 'claimed';
  const claimer = t.toUserId;
  t.status = status;
  t.endReason = reason || null;
  t.toUserId = null;
  t.claimExpiresAt = null;
  const action = { cancelled: 'transfer_withdraw', expired: 'transfer_expire' }[status] || 'transfer_withdraw';
  addLog(b, action, null, null, actor, reason || '');
  if (wasClaimed && claimer) notify(claimer, `Đăng nhượng ${slotLabel(b)} tại ${courtOf(b.courtId)[0].name} đã đóng${reason ? `: ${reason}` : ''}. Bạn chưa mất khoản tiền nào qua SânNhanh; nếu đã chuyển khoản thì liên hệ chủ sân.`, { link: `/transfer.html?id=${t.id}` });
}

/** Xử lý theo thời gian cho nhượng booking. Trả true nếu có thay đổi. */
function tickTransfers() {
  let changed = false;
  for (const t of S.transfers) {
    const b = S.bookings.find((x) => x.id === t.bookingId);
    if (t.status === 'claimed' && vnToMs(t.claimExpiresAt) <= nowMs()) {
      const claimer = t.toUserId;
      t.toUserId = null;
      t.claimedAt = null;
      t.claimExpiresAt = null;
      t.status = 'open';
      addLog(b, 'transfer_release', null, null, null, 'Hết hạn chờ chủ sân xác nhận tiền, mở lại cho đội khác');
      if (claimer) notify(claimer, `Lượt nhận nhượng ${slotLabel(b)} đã hết hạn vì chủ sân chưa xác nhận đã nhận tiền. Nếu bạn đã chuyển khoản, liên hệ chủ sân.`, { link: `/transfer.html?id=${t.id}` });
      notify(b.userId, `Đội nhận booking ${b.code} chưa hoàn tất nên đăng nhượng được mở lại.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      changed = true;
    }
    if (t.status === 'open' && vnToMs(t.closesAt) <= nowMs()) {
      closeTransfer(t, 'expired', null, 'Không có đội nào nhận trước hạn nhượng');
      notify(b.userId, `Không có đội nào nhận booking ${b.code} trước hạn nhượng. Booking vẫn của bạn; nếu muốn hủy thì hoàn tiền theo mức R7 hiện tại.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      changed = true;
    }
  }
  return changed;
}

function offerTransfer(ctx) {
  const user = need(ctx, 'customer');
  const b = findBooking(ctx.params.id);
  if (b.userId !== user.id) fail(404, 'Không tìm thấy booking');
  if (b.status !== 'confirmed') fail(409, 'Chỉ nhượng được booking đã xác nhận');
  if (b.paymentStatus !== 'paid') fail(409, 'Chỉ nhượng được booking đã thanh toán (khoản hoàn cho bạn lấy từ tiền đội nhận trả)');
  if (activeTransfer(b)) fail(409, 'Booking này đang được đăng nhượng');
  const closesMs = vnToMs(b.startAt) - meta().transferCloseMinutes * 60000;
  req(closesMs > nowMs(), `Đã quá hạn nhượng: phải đăng trước giờ đá ${meta().transferCloseMinutes} phút`);
  const ask = Number(ctx.body?.askPrice);
  req(Number.isInteger(ask) && ask > 0 && ask % 1000 === 0, 'Giá nhượng phải là số tiền nguyên, làm tròn 1.000đ');
  req(ask <= b.price, `Giá nhượng không được vượt giá bạn đã trả (${vnd(b.price)})`);
  const [venue, court] = courtOf(b.courtId);
  const waiters = waitersOfBooking(b);
  const t = {
    id: nextId('transfer'),
    bookingId: b.id,
    fromUserId: user.id,
    askPrice: ask,
    status: 'open',
    createdAt: now(),
    closesAt: msToVn(closesMs),
    priorityUntil: waiters.length ? msToVn(Math.min(nowMs() + meta().waitlistOfferMinutes * 60000, closesMs)) : null,
    toUserId: null,
    claimedAt: null,
    claimExpiresAt: null,
    newBookingId: null,
    endReason: null,
  };
  S.transfers.push(t);
  addLog(b, 'transfer_open', null, null, user, `Giá nhượng ${vnd(ask)}`);
  for (const w of waiters) {
    notify(w.userId, `Có đội đăng nhượng slot ${slotLabel(b)} tại ${venue.name} · ${court.name}, giá ${vnd(ask)}. Bạn đang chờ slot này nên được ưu tiên nhận đến ${timeOf(t.priorityUntil)}.`, { link: `/transfer.html?id=${t.id}` });
  }
  notify(venue.ownerId, `Đội đặt booking ${b.code} đăng nhượng slot ${slotLabel(b)}, giá ${vnd(ask)} (giá gốc ${vnd(b.price)}). Có đội nhận bạn sẽ được báo để xác nhận tiền.`, { bookingId: b.id, link: '/owner-bookings.html#transfers' });
  save();
  return toTransfer(t, user);
}

function claimTransfer(ctx) {
  const user = need(ctx, 'customer');
  const t = findTransfer(ctx.params.id);
  const b = S.bookings.find((x) => x.id === t.bookingId);
  if (t.fromUserId === user.id) fail(400, 'Bạn không thể nhận booking do chính mình đăng nhượng');
  if (t.status === 'claimed') fail(409, 'Đã có đội khác nhận booking này');
  if (t.status !== 'open') fail(409, 'Đăng nhượng này không còn mở');
  if (vnToMs(t.closesAt) <= nowMs()) fail(409, 'Đã quá hạn nhận nhượng');
  if (priorityActive(t) && !waitersOfBooking(b).some((w) => w.userId === user.id)) {
    fail(409, `Đang ưu tiên cho người trong danh sách chờ slot này đến ${timeOf(t.priorityUntil)}`);
  }
  const [venue, court] = courtOf(b.courtId);
  t.status = 'claimed';
  t.toUserId = user.id;
  t.claimedAt = now();
  t.claimExpiresAt = msToVn(nowMs() + meta().holdMinutes * 60000);
  S.waitlist = S.waitlist.filter((w) => !(w.userId === user.id && w.courtId === b.courtId && w.date === dateOf(b.startAt) && w.start === timeOf(b.startAt)));
  addLog(b, 'transfer_claim', null, null, null, 'Có đội nhận, chờ chủ sân xác nhận đã nhận tiền');
  notify(b.userId, `Đã có đội nhận booking ${b.code} giá ${vnd(t.askPrice)}. Chờ chủ sân xác nhận đã nhận tiền; trước khi đó booking vẫn của bạn và chưa có khoản hoàn nào.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  notify(venue.ownerId, `${user.fullName} nhận nhượng booking ${b.code} (${court.name} ${slotLabel(b)}), chuyển ${vnd(t.askPrice)} nội dung NH${b.code}. Đối chiếu rồi xác nhận trước ${timeOf(t.claimExpiresAt)}.`, { bookingId: b.id, link: '/owner-bookings.html#transfers' });
  save();
  return toTransfer(t, user);
}

function findTransfer(id) {
  const t = S.transfers.find((x) => x.id === Number(id));
  if (!t) fail(404, 'Không tìm thấy đăng nhượng');
  return t;
}
function ownerTransfer(ctx) {
  const user = need(ctx, 'owner');
  const t = findTransfer(ctx.params.id);
  const b = S.bookings.find((x) => x.id === t.bookingId);
  if (courtOf(b.courtId)[0].ownerId !== user.id) fail(403, 'Đăng nhượng này không thuộc sân của bạn');
  return [t, b, user];
}

/** Chủ sân xác nhận đã nhận tiền của đội nhận: đổi chủ booking và mở khoản hoàn cho đội cũ trong một bước. */
function finishTransfer(t, owner, note, silent = false) {
  const a = S.bookings.find((x) => x.id === t.bookingId);
  const [venue] = courtOf(a.courtId);
  const nb = {
    ...a,
    id: nextId('booking'),
    userId: t.toUserId,
    status: 'confirmed',
    expiresAt: null,
    price: t.askPrice,
    basePrice: t.askPrice,
    discountPercent: 0,
    paymentStatus: 'paid',
    refundStatus: 'none',
    refundPercent: 0,
    refundAmount: 0,
    cancelledBy: null,
    cancelReason: null,
    lateCancel: false,
    customerNote: '',
    idempotencyKey: null,
    createdAt: now(),
    cancelledAt: null,
    transferFromId: a.id,
  };
  nb.code = bookingCode(nb.id);
  S.bookings.push(nb);
  a.status = 'transferred';
  a.expiresAt = null;
  a.cancelledBy = 'transfer';
  a.cancelReason = 'Đã nhượng cho đội khác';
  a.cancelledAt = now();
  a.lateCancel = false;
  a.refundAmount = t.askPrice;
  a.refundPercent = Math.round((t.askPrice / a.price) * 100);
  a.refundStatus = 'pending';
  t.status = 'completed';
  t.newBookingId = nb.id;
  t.completedAt = now();
  t.claimExpiresAt = null;
  addLog(a, 'transfer_done', 'confirmed', 'transferred', owner, note || `Chủ sân xác nhận đã nhận ${vnd(t.askPrice)} của đội nhận`);
  addLog(nb, 'create', null, 'confirmed', userOf(nb.userId), 'Nhận nhượng từ booking cũ, chủ sân đã xác nhận nhận tiền');
  if (!silent) {
    notify(a.userId, `Booking ${a.code} đã chuyển sang đội khác. Khoản hoàn ${vnd(a.refundAmount)}: chưa hoàn, chủ sân sẽ chuyển khoản lại cho bạn và ghi nhận khi xong.`, { bookingId: a.id, link: `/booking.html?id=${a.id}` });
    notify(nb.userId, `Booking ${nb.code} đã được xác nhận cho bạn: ${courtOf(nb.courtId)[1].name} ${slotLabel(nb)} tại ${venue.name}, chủ sân đã nhận ${vnd(t.askPrice)}.`, { bookingId: nb.id, link: `/booking.html?id=${nb.id}` });
  }
  return nb;
}

function doConfirmTransfer(ctx) {
  const [t, , owner] = ownerTransfer(ctx);
  if (t.status !== 'claimed') fail(409, 'Chưa có đội nhận hoặc đăng nhượng đã xử lý xong');
  if (vnToMs(t.claimExpiresAt) <= nowMs()) fail(409, 'Lượt nhận đã hết hạn, đăng nhượng được mở lại cho đội khác');
  finishTransfer(t, owner, String(ctx.body?.note || '').slice(0, 300));
  save();
  return toTransfer(t, owner);
}
function doRejectTransfer(ctx) {
  const [t, b, owner] = ownerTransfer(ctx);
  if (t.status !== 'claimed') fail(409, 'Chưa có đội nhận để từ chối');
  const reason = String(ctx.body?.reason || '').trim();
  req(reason, 'Vui lòng nhập lý do từ chối đội nhận');
  const claimer = t.toUserId;
  t.toUserId = null;
  t.claimedAt = null;
  t.claimExpiresAt = null;
  t.status = vnToMs(t.closesAt) > nowMs() ? 'open' : 'expired';
  addLog(b, 'transfer_reject', null, null, owner, reason.slice(0, 300));
  notify(claimer, `Chủ sân không xác nhận lượt nhận nhượng ${slotLabel(b)}: ${reason.slice(0, 200)}. Nếu bạn đã chuyển khoản, liên hệ chủ sân để lấy lại tiền.`, { link: `/transfer.html?id=${t.id}` });
  notify(b.userId, `Chủ sân không xác nhận đội nhận booking ${b.code}${t.status === 'open' ? '; đăng nhượng được mở lại' : ''}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
  return toTransfer(t, owner);
}

/** Danh sách cho chủ sân: đang đăng, chờ xác nhận tiền, đã đổi chủ mà chưa hoàn cho đội cũ. */
function ownerTransfers(user) {
  const rank = { claimed: 0, completed: 1, open: 2 };
  return S.transfers
    .filter((t) => {
      const b = S.bookings.find((x) => x.id === t.bookingId);
      if (courtOf(b.courtId)[0].ownerId !== user.id) return false;
      return ACTIVE_TRANSFER.includes(t.status) || (t.status === 'completed' && b.refundStatus === 'pending');
    })
    .sort((x, y) => rank[x.status] - rank[y.status] || x.closesAt.localeCompare(y.closesAt))
    .map((t) => toTransfer(t, user));
}

/* ---------- Bảng định tuyến ---------- */

const routes = [];
const route = (method, path, handler) => {
  routes.push({ method, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });
};

route('GET', '/api/meta', () => ({ ...meta(), now: now() }));
route('GET', '/api/venues/districts', () => [...new Set(S.venues.filter((v) => v.isActive).map((v) => v.district))].sort((a, b) => a.localeCompare(b, 'vi')));
route('GET', '/api/venues', (c) => {
  const p = c.query;
  const date = p.date ? checkDate(p.date) : null;
  const venues = S.venues.filter((v) => venueMatches(v, p)).map((v) => toVenue(v, date ? { availableSlots: availableOn(v, date, p, c.user) } : {}));
  return { date, venues };
});
route('GET', '/api/venues/slots', (c) => {
  const p = c.query;
  const date = checkDate(p.date);
  req(/^\d{2}:\d{2}$/.test(p.at || ''), 'Giờ không hợp lệ');
  const at = hmToMin(p.at);
  const slots = [];
  for (const v of S.venues.filter((x) => venueMatches(x, p))) {
    for (const s of availableOn(v, date, { ...p, from: '' }, c.user)) {
      const m = hmToMin(s.start);
      if (m < at - 30 || m > at + 60) continue;
      if (p.lastMinute && !s.discountPercent) continue;
      slots.push({ venueId: v.id, venueName: v.name, district: v.district, address: v.address, requiresApproval: v.requiresApproval, ...s });
    }
  }
  slots.sort((a, b) => Math.abs(hmToMin(a.start) - at) - Math.abs(hmToMin(b.start) - at) || a.price - b.price);
  return { date, at: p.at, slots };
});
route('GET', '/api/venues/:id', (c) => {
  const v = venueOf(c.params.id);
  if (!v || !v.isActive) fail(404, 'Không tìm thấy sân');
  return toVenueDetail(v);
});
route('GET', '/api/venues/:id/schedule', (c) => {
  const v = venueOf(c.params.id);
  if (!v || !v.isActive) fail(404, 'Không tìm thấy sân');
  return scheduleOf(v, checkDate(c.query.date), c.user);
});

route('GET', '/api/auth/csrf', () => ({ csrfToken: S.csrf }));
route('GET', '/api/auth/me', (c) => ({ user: c.user ? userOut(c.user) : null }));
route('POST', '/api/auth/register', (c) => {
  const { fullName = '', email = '', phone = '', password = '' } = c.body || {};
  req(String(fullName).trim().length >= 2, 'Vui lòng nhập họ tên');
  req(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Email không hợp lệ');
  req(/^0\d{9}$/.test(String(phone).replace(/\s/g, '')), 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0');
  req(String(password).length >= 8, 'Mật khẩu cần ít nhất 8 ký tự');
  if (S.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) fail(409, 'Email này đã được đăng ký');
  const u = { id: nextId('user'), fullName: String(fullName).trim(), email: email.trim(), phone: String(phone).replace(/\s/g, ''), role: 'customer', isActive: true, password, createdAt: now() };
  S.users.push(u);
  S.sessionUserId = u.id;
  save();
  return { user: userOut(u) };
});
route('POST', '/api/auth/login', (c) => {
  const { email = '', password = '' } = c.body || {};
  req(email && password, 'Vui lòng nhập email và mật khẩu');
  const u = S.users.find((x) => x.email.toLowerCase() === String(email).toLowerCase() && x.password === password);
  if (!u) fail(401, 'Email hoặc mật khẩu không đúng');
  if (!u.isActive) fail(403, 'Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên');
  S.sessionUserId = u.id;
  save();
  return { user: userOut(u) };
});
route('POST', '/api/auth/logout', () => {
  S.sessionUserId = null;
  save();
  return { ok: true };
});

route('POST', '/api/bookings', createBooking);
route('GET', '/api/bookings/mine', (c) => {
  const u = need(c, 'customer');
  return S.bookings.filter((b) => b.userId === u.id).sort((a, b) => (a.startAt < b.startAt ? 1 : -1)).slice(0, LIST_LIMIT).map((b) => toBooking(b));
});
route('POST', '/api/bookings/:id/transfer', offerTransfer);
route('GET', '/api/transfers', (c) => {
  const p = c.query;
  return S.transfers
    .filter((t) => t.status === 'open' && vnToMs(t.closesAt) > nowMs())
    .filter((t) => {
      const b = S.bookings.find((x) => x.id === t.bookingId);
      const v = courtOf(b.courtId)[0];
      return (!p.venueId || v.id === Number(p.venueId)) && (!p.date || dateOf(b.startAt) === p.date) && (!p.district || v.district === p.district);
    })
    .sort((x, y) => S.bookings.find((b) => b.id === x.bookingId).startAt.localeCompare(S.bookings.find((b) => b.id === y.bookingId).startAt))
    .map((t) => toTransfer(t, c.user));
});
route('GET', '/api/transfers/mine', (c) => {
  const u = need(c, 'customer');
  return S.transfers.filter((t) => t.fromUserId === u.id || t.toUserId === u.id).sort((x, y) => y.id - x.id).slice(0, LIST_LIMIT).map((t) => toTransfer(t, u));
});
route('GET', '/api/transfers/:id', (c) => toTransfer(findTransfer(c.params.id), c.user));
route('POST', '/api/transfers/:id/claim', claimTransfer);
route('DELETE', '/api/transfers/:id', (c) => {
  const u = need(c, 'customer');
  const t = findTransfer(c.params.id);
  if (t.fromUserId !== u.id) fail(404, 'Không tìm thấy đăng nhượng');
  if (t.status === 'claimed') fail(409, 'Đã có đội nhận, chờ chủ sân xác nhận hoặc từ chối');
  if (t.status !== 'open') fail(409, 'Đăng nhượng này không còn mở');
  closeTransfer(t, 'cancelled', u, 'Bạn rút đăng nhượng');
  save();
  return { ok: true };
});
route('GET', '/api/bookings/reliability', (c) => reliabilityOf(need(c, 'customer').id));
route('GET', '/api/bookings/:id', (c) => {
  const u = need(c);
  const b = findBooking(c.params.id);
  if (!canSee(u, b)) fail(u.role === 'customer' ? 404 : 403, u.role === 'customer' ? 'Không tìm thấy booking' : 'Booking này không thuộc quyền xem của bạn');
  return toBookingDetail(b, u);
});
route('POST', '/api/bookings/:id/cancel', (c) => {
  const u = need(c, 'customer');
  const b = findBooking(c.params.id);
  if (b.userId !== u.id) fail(404, 'Không tìm thấy booking');
  doCancel(b, u, c.body?.reason, 'customer');
  return toBookingDetail(b, u);
});

route('POST', '/api/waitlist', (c) => {
  const u = need(c, 'customer');
  const { courtId, date, start } = c.body || {};
  const [venue, court] = courtOf(courtId);
  if (!venue) fail(404, 'Không tìm thấy sân con');
  checkDate(date);
  const slot = slotInfo(court, venue, date, start, u);
  if (!['booked', 'held', 'offered'].includes(slot.status)) fail(400, slot.status === 'available' ? 'Slot đang trống, hãy đặt luôn' : 'Chỉ đăng ký chờ được slot đang có người giữ'); // R9
  if (slot.mine) fail(409, 'Bạn đang giữ slot này');
  if (slotWaiters(court.id, date, start).some((w) => w.userId === u.id)) fail(409, 'Bạn đã trong hàng chờ của slot này');
  const w = { id: nextId('waitlist'), userId: u.id, courtId: court.id, date, start, status: 'waiting', offerExpiresAt: null, createdAt: now() };
  S.waitlist.push(w);
  save();
  return { id: w.id, position: slotWaiters(court.id, date, start).filter((x) => x.status === 'waiting' || x.status === 'offered').length };
});
route('GET', '/api/waitlist/mine', (c) => {
  const u = need(c, 'customer');
  return S.waitlist.filter((w) => w.userId === u.id).sort((a, b) => (`${a.date} ${a.start}` < `${b.date} ${b.start}` ? -1 : 1)).map((w) => {
    const [venue, court] = courtOf(w.courtId);
    return {
      id: w.id, venueId: venue.id, venueName: venue.name, courtId: court.id, courtName: court.name, fieldType: court.fieldType,
      startAt: `${w.date} ${w.start}:00`, endAt: `${w.date} ${slotEnd(venue, w.start)}:00`, status: w.status, offerExpiresAt: w.offerExpiresAt,
      offerActive: w.status === 'offered' && vnToMs(w.offerExpiresAt) > nowMs(),
    };
  });
});
route('DELETE', '/api/waitlist/:id', (c) => {
  const u = need(c, 'customer');
  const w = S.waitlist.find((x) => x.id === Number(c.params.id) && x.userId === u.id);
  if (!w) fail(404, 'Không tìm thấy lượt chờ');
  S.waitlist.splice(S.waitlist.indexOf(w), 1);
  if (w.status === 'offered') offerSlot(w.courtId, w.date, w.start);
  save();
  return { ok: true };
});
route('GET', '/api/notifications', (c) => {
  const u = need(c);
  const items = S.notifications.filter((n) => n.userId === u.id).sort((a, b) => b.id - a.id).map(({ userId, ...n }) => n);
  return { unread: items.filter((n) => !n.isRead).length, items };
});
route('POST', '/api/notifications/read-all', (c) => {
  const u = need(c);
  S.notifications.filter((n) => n.userId === u.id).forEach((n) => (n.isRead = true));
  save();
  return { ok: true };
});

/* Chủ sân */
const myVenue = (c, id) => {
  const u = need(c, 'owner');
  const v = venueOf(id);
  if (!v) fail(404, 'Không tìm thấy sân');
  if (v.ownerId !== u.id) fail(403, 'Sân này không thuộc tài khoản của bạn');
  return v;
};
const VENUE_FIELDS = ['name', 'district', 'address', 'phone', 'imageUrl', 'description', 'rules', 'cancelPolicy', 'mapsUrl', 'openTime', 'closeTime', 'peakStart', 'peakEnd'];
function applyVenue(v, b) {
  for (const k of VENUE_FIELDS) if (b[k] !== undefined) v[k] = b[k];
  if (b.amenities !== undefined) v.amenities = Array.isArray(b.amenities) ? b.amenities : String(b.amenities).split(',').map((s) => s.trim()).filter(Boolean);
  if (b.slotMinutes !== undefined) v.slotMinutes = Number(b.slotMinutes);
  if (b.requiresApproval !== undefined) v.requiresApproval = !!b.requiresApproval;
  if (b.isActive !== undefined) v.isActive = !!b.isActive;
  if (b.lastMinutePercent !== undefined) {
    const p = Number(b.lastMinutePercent);
    req(p >= 0 && p <= 90, 'Phần trăm giảm giờ chót từ 0 đến 90');
    v.lastMinutePercent = p;
  }
  if (b.bankBin !== undefined || b.bankAccount !== undefined || b.bankAccountName !== undefined) {
    v.bank = { bin: b.bankBin ?? v.bank?.bin ?? '', account: b.bankAccount ?? v.bank?.account ?? '', accountName: b.bankAccountName ?? v.bank?.accountName ?? '' };
  }
  req(v.name && String(v.name).trim(), 'Vui lòng nhập tên sân');
  req(hmToMin(v.openTime) < hmToMin(v.closeTime), 'Giờ mở phải trước giờ đóng');
  req(v.slotMinutes >= 30 && v.slotMinutes <= 180, 'Độ dài slot từ 30 đến 180 phút');
}
function applyCourt(c, b) {
  if (b.name !== undefined) c.name = String(b.name).trim();
  if (b.fieldType !== undefined) c.fieldType = String(b.fieldType);
  if (b.price !== undefined) c.price = Number(b.price);
  if (b.peakPrice !== undefined) c.peakPrice = Number(b.peakPrice);
  if (b.isActive !== undefined) c.isActive = !!b.isActive;
  req(c.name, 'Vui lòng nhập tên sân con');
  req(['5', '7'].includes(c.fieldType), 'Loại sân là 5 hoặc 7 người');
  req(c.price > 0 && c.peakPrice > 0, 'Giá phải lớn hơn 0');
}

route('GET', '/api/owner/venues', (c) => S.venues.filter((v) => v.ownerId === need(c, 'owner').id).map((v) => toVenueDetail(v, true)));
route('POST', '/api/owner/venues', (c) => {
  const u = need(c, 'owner');
  const v = { id: nextId('venue'), ownerId: u.id, name: '', district: '', address: '', phone: '', imageUrl: null, amenities: [], openTime: '06:00', closeTime: '22:00', slotMinutes: 60, requiresApproval: false, lastMinutePercent: 0, peakStart: null, peakEnd: null, isActive: true, description: '', rules: '', cancelPolicy: 'Hủy trước 24 giờ hoàn 100%, từ 12 đến dưới 24 giờ hoàn 50%, dưới 12 giờ không hoàn.', mapsUrl: '', bank: { bin: '', account: '', accountName: '' }, courts: [] };
  applyVenue(v, c.body || {});
  S.venues.push(v);
  save();
  return toVenueDetail(v, true);
});
route('PUT', '/api/owner/venues/:id', (c) => {
  const v = myVenue(c, c.params.id);
  applyVenue(v, c.body || {});
  save();
  return toVenueDetail(v, true);
});
route('POST', '/api/owner/venues/:id/courts', (c) => {
  const v = myVenue(c, c.params.id);
  const k = { id: nextId('court'), name: '', fieldType: '5', price: 0, peakPrice: 0, isActive: true };
  applyCourt(k, c.body || {});
  v.courts.push(k);
  save();
  return courtOut(k, true);
});
route('PUT', '/api/owner/courts/:id', (c) => {
  const [v, k] = courtOf(c.params.id);
  if (!k) fail(404, 'Không tìm thấy sân con');
  myVenue(c, v.id);
  applyCourt(k, c.body || {});
  save();
  return courtOut(k, true);
});
route('GET', '/api/owner/venues/:id/schedule', (c) => scheduleOf(myVenue(c, c.params.id), checkDate(c.query.date), c.user, true));
route('POST', '/api/owner/blocks', (c) => {
  const u = need(c, 'owner');
  const { courtId, date, start, end, reason = '' } = c.body || {};
  const [venue, court] = courtOf(courtId);
  if (!court) fail(404, 'Không tìm thấy sân con');
  myVenue(c, venue.id);
  checkDate(date);
  req(/^\d{2}:\d{2}$/.test(start || '') && /^\d{2}:\d{2}$/.test(end || '') && start < end, 'Khoảng giờ chặn không hợp lệ');
  const clash = S.bookings.find((b) => b.courtId === court.id && ['pending', 'confirmed'].includes(b.status) && dateOf(b.startAt) === date && timeOf(b.startAt) < end && timeOf(b.endAt) > start);
  if (clash) fail(409, `Khoảng giờ này đã có booking ${clash.code}`);
  const k = { id: nextId('block'), courtId: court.id, date, start, end, reason: String(reason).slice(0, 200), ownerId: u.id };
  S.blocks.push(k);
  save();
  return { id: k.id, courtId: k.courtId, date, start, end, reason: k.reason };
});
route('DELETE', '/api/owner/blocks/:id', (c) => {
  const u = need(c, 'owner');
  const k = S.blocks.find((x) => x.id === Number(c.params.id));
  if (!k) fail(404, 'Không tìm thấy lịch chặn');
  if (k.ownerId !== u.id) fail(403, 'Lịch chặn này không thuộc sân của bạn');
  S.blocks.splice(S.blocks.indexOf(k), 1);
  const [venue] = courtOf(k.courtId);
  for (const s of slotGrid(venue)) if (s >= k.start && s < k.end) offerSlot(k.courtId, k.date, s);
  save();
  return { ok: true };
});
route('GET', '/api/owner/bookings', (c) => listBookings(need(c, 'owner'), c.query));
route('GET', '/api/owner/transfers', (c) => ownerTransfers(need(c, 'owner')));
route('POST', '/api/owner/transfers/:id/confirm', doConfirmTransfer);
route('POST', '/api/owner/transfers/:id/reject', doRejectTransfer);
const ownerAction = (fn) => (c) => {
  fn(ownBooking(c, c.params.id), c.user, c.body || {});
  return { ok: true };
};
route('POST', '/api/owner/bookings/:id/approve', ownerAction((b, u) => doApprove(b, u)));
route('POST', '/api/owner/bookings/:id/reject', ownerAction((b, u, p) => doReject(b, u, p.reason)));
route('POST', '/api/owner/bookings/:id/cancel', ownerAction((b, u, p) => doCancel(b, u, p.reason, 'owner')));
route('POST', '/api/owner/bookings/:id/paid', ownerAction((b, u, p) => doPaid(b, u, p.note)));
route('POST', '/api/owner/bookings/:id/refund', ownerAction((b, u, p) => doRefunded(b, u, p.note)));
route('POST', '/api/owner/bookings/:id/attendance', ownerAction((b, u, p) => doAttendance(b, u, p.result)));

/* Admin */
const adminAction = (fn) => (c) => {
  const u = need(c, 'admin');
  fn(findBooking(c.params.id), u, c.body || {});
  return { ok: true };
};
route('GET', '/api/admin/users', (c) => {
  need(c, 'admin');
  return S.users.filter((u) => !c.query.role || u.role === c.query.role).map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, isActive: u.isActive, createdAt: u.createdAt }));
});
route('POST', '/api/admin/owners', (c) => {
  need(c, 'admin');
  const { fullName = '', email = '', phone = '', password = '' } = c.body || {};
  req(String(fullName).trim().length >= 2, 'Vui lòng nhập họ tên');
  req(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Email không hợp lệ');
  req(/^0\d{9}$/.test(String(phone).replace(/\s/g, '')), 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0');
  req(String(password).length >= 8, 'Mật khẩu cần ít nhất 8 ký tự');
  if (S.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) fail(409, 'Email này đã được đăng ký');
  const u = { id: nextId('user'), fullName: String(fullName).trim(), email: email.trim(), phone: String(phone).replace(/\s/g, ''), role: 'owner', isActive: true, password, createdAt: now() };
  S.users.push(u);
  save();
  return { id: u.id };
});
route('POST', '/api/admin/users/:id/active', (c) => {
  const admin = need(c, 'admin');
  const u = userOf(Number(c.params.id));
  if (!u) fail(404, 'Không tìm thấy người dùng');
  if (u.id === admin.id || u.role === 'admin') fail(400, 'Không thể khóa tài khoản admin');
  u.isActive = !!c.body?.active;
  save();
  return { ok: true };
});
route('GET', '/api/admin/bookings', (c) => {
  need(c, 'admin');
  return listBookings(c.user, { status: c.query.status, q: c.query.q });
});
route('POST', '/api/admin/bookings/:id/cancel', adminAction((b, u, p) => doCancel(b, u, p.reason, 'admin')));
route('POST', '/api/admin/bookings/:id/paid', adminAction((b, u, p) => doPaid(b, u, p.note)));
route('POST', '/api/admin/bookings/:id/refund', adminAction((b, u, p) => doRefunded(b, u, p.note)));
route('POST', '/api/admin/bookings/:id/attendance', adminAction((b, u, p) => doAttendance(b, u, p.result)));
route('GET', '/api/admin/logs', (c) => {
  need(c, 'admin');
  return S.logs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id)).slice(0, 300)
    .map((l) => ({ id: l.id, action: l.action, fromStatus: l.fromStatus, toStatus: l.toStatus, note: l.note, createdAt: l.createdAt, bookingId: l.bookingId, code: l.code, actorName: l.actorName, actorRole: l.actorRole }));
});

/* ---------- Điểm vào cho api.js ---------- */

/** Giả lập một request HTTP tới backend. Trả JSON thuần (đã sao chép) hoặc ném ApiError. */
export async function handle(method, path, { query = {}, body } = {}, csrfToken) {
  await ready();
  tick();
  if (method !== 'GET' && csrfToken !== S.csrf) fail(403, 'Thiếu hoặc sai mã CSRF');
  const r = routes.find((x) => x.method === method && x.re.test(path));
  if (!r) fail(404, 'Không tìm thấy đường dẫn');
  const params = r.re.exec(path).groups || {};
  const result = r.handler({ params, query, body: clone(body), user: sessionUser() });
  return clone(result);
}

/* ---------- Chỉ có trong prototype ---------- */

export const proto = {
  async resetDemo() {
    await loadSeeds();
    const keep = S?.sessionUserId ?? null;
    buildState();
    S.sessionUserId = keep;
    save();
    return { ok: true };
  },
  /** Công tắc vai trò: đăng nhập thẳng vào tài khoản demo của vai trò đó ('guest' = đăng xuất). */
  async quickLogin(role) {
    await ready();
    if (role === 'guest') S.sessionUserId = null;
    else {
      const id = seeds.users.demoLogins[role];
      req(id, 'Vai trò demo không tồn tại');
      S.sessionUserId = id;
    }
    save();
    return { user: sessionUser() ? userOut(sessionUser()) : null };
  },
  /** Tua đồng hồ của mock để thấy hết hạn giữ chỗ (R3) và hết hạn lượt chờ (R9) mà không đợi thật. */
  async advanceClock(minutes) {
    await ready();
    S.clockOffsetMin += Number(minutes) || 0;
    tick();
    save();
    return { now: now() };
  },
  /** Luồng 3: người đang giữ các slot mà người dùng hiện tại xếp hàng chờ hủy booking của họ. */
  async holderCancels() {
    await ready();
    const u = sessionUser();
    if (!u) fail(401, 'Vui lòng đăng nhập');
    const waits = S.waitlist.filter((w) => w.userId === u.id && w.status === 'waiting');
    let n = 0;
    for (const w of waits) {
      const b = activeBookingAt(w.courtId, w.date, w.start);
      if (b && b.userId !== u.id) {
        doCancel(b, userOf(b.userId), 'Đổi lịch (demo)', 'customer');
        n += 1;
      }
    }
    return { cancelled: n };
  },
  async state() {
    await ready();
    return { now: now(), clockOffsetMin: S.clockOffsetMin, user: sessionUser() ? userOut(sessionUser()) : null, statuses: STATUSES };
  },
};
