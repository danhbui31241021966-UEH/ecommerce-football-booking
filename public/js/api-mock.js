// Backend giả của prototype. CHỈ api.js được import file này (và chỉ khi MODE = 'mock').
// Mô phỏng đúng contract PRD mục 7 và các luật R1–R11 trên dữ liệu trong localStorage; không phải backend thứ hai:
// không phân quyền chi tiết ngoài vai trò/sở hữu, không tối ưu, không xử lý đồng thời.
import { ApiError } from './api.js';
import {
  vnToMs, msToVn, dateOf, timeOf, addDays, hmToMin, minToHm, discountedPrice, refundFor, shortTs, weekdayOf,
} from './ui/format.js';

const STORE_KEY = 'sannhanh.mock.v8';
const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled', 'expired', 'completed', 'no_show', 'transferred', 'matching'];

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
      ['meta', 'users', 'venues', 'bookings', 'matches', 'requests'].map((n) => fetch(`/mock/${n}.json`).then((r) => r.json())),
    ).then(([meta, users, venues, bookings, matches, requests]) => {
      seeds = { meta, users, venues, bookings, matches, requests };
    });
  }
  return seedPromise;
}

function nextId(kind) {
  S.ids[kind] = (S.ids[kind] || 0) + 1;
  return S.ids[kind];
}

/** Dựng dữ liệu demo tương đối theo hôm nay: luôn có "tối nay", giờ chót, lịch đặt chờ chủ sân đồng ý đang đếm ngược. */
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
    matches: [],
    requests: [],
    offers: [],
    notifications: [],
    logs: [],
  };
  S = st;
  for (const u of st.users) delete u.createdDaysAgo;
  st.ids = { user: Math.max(...st.users.map((u) => u.id)), venue: 6, court: 14, booking: 0, block: 0, waitlist: 0, transfer: 0, match: 0, request: 0, offer: 0, notification: 0, log: 0 };

  const keyToBooking = {};
  const keyToWait = {};
  const courtMap = () => Object.fromEntries(st.venues.flatMap((v) => v.courts.map((c) => [c.id, [v, c]])));
  const courts = courtMap();
  for (const k of seeds.matches.courtModes) courts[k.courtId][1].teamMode = { enabled: true, from: k.from || null, to: k.to || null };

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
  seedMatches(st, ago);
  seedRequests(st, ago);
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
 * Lịch đặt nền cho sân thật để lịch trông có người dùng (tham số trong bookings.json → crowd).
 * Không ghi lịch sử, không sinh thông báo. Lịch đặt chờ chủ sân đồng ý hết hạn tự nhiên như mọi booking (còn 2–15 phút lúc dựng, so le nhau).
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

/** Đăng pass mẫu theo mẫu lịch đặt có `transfer` (askPercent, minAgo, claimedBy, claimedMinAgo, done). Thông báo tương ứng sinh kèm. */
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
    addLog(b, 'transfer_open', null, null, userOf(b.userId), `Giá pass ${vnd(ask)}`, created);
    for (const w of waiters) {
      st.notifications.push({ id: nextId('notification'), userId: w.userId, bookingId: null, message: `Có đội đăng pass giờ ${slotLabel(b)} tại ${venue.name} · ${court.name}, giá ${vnd(ask)}. Bạn đang chờ giờ này nên được ưu tiên nhận đến ${timeOf(t.priorityUntil)}.`, link: `/transfer.html?id=${t.id}`, isRead: false, createdAt: created });
    }
    if (spec.claimedBy) {
      t.status = 'claimed';
      t.toUserId = spec.claimedBy;
      t.claimedAt = ago(spec.claimedMinAgo);
      t.claimExpiresAt = msToVn(vnToMs(t.claimedAt) + meta().holdMinutes * 60000);
      addLog(b, 'transfer_claim', null, null, null, 'Có đội nhận, chờ chủ sân xác nhận đã nhận tiền', t.claimedAt);
      if (!spec.done) {
        st.notifications.push({ id: nextId('notification'), userId: venue.ownerId, bookingId: b.id, message: `${userOf(spec.claimedBy).fullName} nhận pass sân ${b.code} (${court.name} ${slotLabel(b)}), chuyển ${vnd(ask)} nội dung NH${b.code}. Nhận được tiền thì bấm xác nhận trước ${timeOf(t.claimExpiresAt)}.`, link: '/owner-bookings.html#transfers', isRead: false, createdAt: t.claimedAt });
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
  const needsApproval = venue.requiresApproval || tpl.note === 'Chờ chủ sân đồng ý do uy tín thấp';
  const created = needsApproval ? 'pending' : 'confirmed';
  addLog(b, 'create', null, created, customer, '', b.createdAt);
  if (b.status === 'pending') return;
  if (needsApproval && !['rejected', 'expired'].includes(b.status)) addLog(b, 'approve', 'pending', 'confirmed', owner, '', at(5));
  if (b.paymentStatus === 'paid') addLog(b, 'paid', null, null, owner, 'Đã nhận chuyển khoản', at(30));
  if (b.status === 'rejected') addLog(b, 'reject', 'pending', 'rejected', owner, b.cancelReason, at(8));
  if (b.status === 'expired') addLog(b, 'expire', 'pending', 'expired', { fullName: 'Hệ thống', role: 'system' }, 'Quá hạn chưa đồng ý', at(15));
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
  S.bookings.find((b) => b.courtId === courtId && b.startAt === `${date} ${start}:00` && ['pending', 'confirmed', 'matching'].includes(b.status));
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
  const teamMode = teamModeAt(court, start);
  const matchOf = booking && matchOfBooking(booking);
  if (matchOf) slot.match = { id: matchOf.id, status: matchOf.status, joinable: joinable(matchOf) && !mine };
  else if (teamMode && slot.status === 'available') slot.teamMode = true;
  const offerT = booking && S.transfers.find((t) => t.bookingId === booking.id && t.status === 'open');
  if (offerT) slot.transfer = { id: offerT.id, askPrice: offerT.askPrice, originalPrice: booking.price };

  const bookable = (slot.status === 'available' || slot.offeredToYou) && !slot.teamMode; // giờ đủ hai đội dùng giá gốc, không giảm giờ chót
  const hoursAhead = (startMs - nowMs()) / 3600000;
  if (bookable && hoursAhead > 0 && hoursAhead <= meta().lastMinuteHours && venue.lastMinutePercent > 0) {
    slot.discountPercent = venue.lastMinutePercent;
    slot.price = discountedPrice(basePrice, venue.lastMinutePercent);
  }

  if (detail) {
    if (teamMode) slot.teamMode = true;
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
  id: c.id, name: c.name, fieldType: c.fieldType, price: c.price, peakPrice: c.peakPrice, teamMode: c.teamMode?.enabled ? { from: c.teamMode.from, to: c.teamMode.to } : null, ...(owner ? { isActive: c.isActive } : {}),
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
    match: matchBrief(b, admin),
    fromOffer: !!b.offerId,
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
  return qrBank(venue.bank, amount, content);
}
function qrBank(bank, amount, content) {
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

/** R9: giờ vừa trống thì giữ quyền đặt 10 phút (không quá giờ bắt đầu) cho người chờ sớm nhất. */
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
  notify(next.userId, `Giờ ${start} ngày ${date.slice(8, 10)}/${date.slice(5, 7)} tại ${venue.name} · ${court.name} đang giữ cho bạn đến ${timeOf(next.offerExpiresAt)}.`, {
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
      addLog(b, 'expire', 'pending', 'expired', null, 'Quá hạn giữ chỗ chưa được đồng ý', b.expiresAt);
      notify(b.userId, `Lịch đặt ${b.code} đã quá hạn vì chủ sân chưa kịp đồng ý.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      freeSlot(b);
      changed = true;
    }
  }
  if (tickTransfers()) changed = true;
  if (tickMatches()) changed = true;
  if (tickMatchResults()) changed = true;
  if (tickRequests()) changed = true;
  for (const w of [...S.waitlist]) {
    if (vnToMs(`${w.date} ${w.start}`) <= nowMs()) {
      S.waitlist.splice(S.waitlist.indexOf(w), 1);
      changed = true;
    } else if (w.status === 'offered' && vnToMs(w.offerExpiresAt) <= nowMs()) {
      S.waitlist.splice(S.waitlist.indexOf(w), 1);
      const [venue] = courtOf(w.courtId);
      notify(w.userId, `Bạn không đặt kịp giờ ${w.start} tại ${venue.name}, giờ này đã mở lại cho người khác.`);
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
      // Giờ đủ hai đội vẫn hiện trong kết quả tìm kèm nhãn; ô đang có trận chờ đội thứ hai dẫn tới trận đó.
      const joinableMatch = slot.match?.joinable ? slot.match : null;
      if (!(slot.status === 'available' || slot.offeredToYou) && !joinableMatch) continue;
      if (max && slot.price > max) continue;
      out.push({ courtId: c.id, courtName: c.name, fieldType: c.fieldType, start: slot.start, end: slot.end, price: slot.price, basePrice: slot.basePrice, discountPercent: slot.discountPercent, peak: slot.peak, offeredToYou: !!slot.offeredToYou, teamMode: !!slot.teamMode, match: joinableMatch ? { id: joinableMatch.id } : null });
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
  if (!venue || !court || !court.isActive || !venue.isActive) fail(404, 'Không tìm thấy sân');
  checkDate(date);
  req(slotGrid(venue).includes(start), 'Giờ bắt đầu không khớp lịch của sân');
  const today = dateOf(now());
  req(date >= today && date <= addDays(today, meta().bookingWindowDays - 1), `Chỉ đặt trước tối đa ${meta().bookingWindowDays} ngày`);
  const slot = slotInfo(court, venue, date, start, user);
  if (slot.status === 'past') fail(400, 'Giờ này đã qua giờ bắt đầu');
  if (slot.status === 'blocked') fail(409, 'Giờ này chủ sân đang chặn');
  if (slot.status === 'booked' || slot.status === 'held') fail(409, 'Giờ này vừa có người khác đặt, bạn chọn giờ khác nhé'); // R4
  if (slot.status === 'offered' && !slot.offeredToYou) fail(409, 'Giờ này đang giữ cho người đã đăng ký chờ');
  if (teamModeAt(court, start)) fail(409, 'Giờ này chỉ nhận ghép kèo: hãy mở kèo hoặc vào một kèo có sẵn');

  return toBooking(insertBooking(user, venue, court, date, start, slot, { note, idempotencyKey }));
}

/** Tạo lịch đặt theo luồng đặt chung (R3 chế độ nhận, R6 giá chốt, R10 uy tín). extra: { price, offerId, logNote } cho đặt từ báo giá (R14). */
function insertBooking(user, venue, court, date, start, slot, extra = {}) {
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
    price: extra.price ?? slot.price, // R6: giá chốt tại lúc đặt
    basePrice: slot.basePrice,
    discountPercent: extra.price == null ? slot.discountPercent : 0,
    offerId: extra.offerId || null,
    paymentStatus: 'unpaid',
    refundStatus: 'none',
    refundPercent: 0,
    refundAmount: 0,
    cancelledBy: null,
    cancelReason: null,
    lateCancel: false,
    customerNote: String(extra.note || '').slice(0, 300),
    rulesSnapshot: venue.rules,
    policySnapshot: venue.cancelPolicy,
    idempotencyKey: extra.idempotencyKey || null,
    createdAt: now(),
    cancelledAt: null,
  };
  b.code = bookingCode(b.id);
  S.bookings.push(b);
  // Người đặt được giữ quyền thì lượt chờ coi như đã hoàn tất.
  S.waitlist = S.waitlist.filter((w) => !(w.userId === user.id && w.courtId === court.id && w.date === date && w.start === start));
  addLog(b, 'create', null, b.status, user, extra.logNote || (rel.restricted && !venue.requiresApproval ? 'Chờ chủ sân đồng ý do uy tín của khách' : ''));
  if (needsApproval) {
    notify(venue.ownerId, `${user.fullName} vừa đặt sân (mã ${b.code}) và đang chờ bạn đồng ý, còn ${meta().holdMinutes} phút.`, { bookingId: b.id, link: `/owner-bookings.html?id=${b.id}` });
    notify(user.id, `Bạn đã đặt ${court.name} lúc ${shortTs(b.startAt)}. Chủ sân có ${meta().holdMinutes} phút để đồng ý.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  } else {
    notify(user.id, `Bạn đã có sân (mã ${b.code}). Hãy chuyển khoản bằng mã QR.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  }
  save();
  return b;
}

function findBooking(id) {
  const b = S.bookings.find((x) => x.id === Number(id));
  if (!b) fail(404, 'Không tìm thấy lịch đặt');
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
  if (!canSee(user, b)) fail(403, 'Lịch đặt này không thuộc sân của bạn');
  return b;
}

/** Hủy đặt sân: dùng chung cho khách, chủ sân và admin. trả lại tiền, R10 hủy sát giờ. */
function doCancel(b, actor, reason, by) {
  const mt = matchOfBooking(b);
  if (mt) {
    if (by === 'customer') fail(409, b.status === 'matching' ? 'Lịch đặt này đang chờ ghép kèo: hãy rút khỏi kèo ở trang kèo' : 'Kèo đã chốt: nếu cần hủy, hãy liên hệ chủ sân');
    if (!ACTIVE_MATCH.includes(mt.status) && mt.status !== 'confirmed') fail(409, 'Lịch đặt này không hủy được nữa');
    if (mt.status === 'confirmed') {
      const why = String(reason || '').trim().slice(0, 200) || 'Chủ sân hủy';
      mt.refunds = [];
      mt.status = 'open'; // để endMatch ghi tiền trả lại đủ cho cả hai đội đã trả
      endMatch(mt, 'cancelled', `${why}.`, { actor, by, refundPercent: { host: 100, guest: 100 } });
    } else {
      endMatch(mt, 'cancelled', `${String(reason || '').trim().slice(0, 200) || 'Chủ sân hủy'}.`, { actor, by });
    }
    save();
    return;
  }
  if (!['pending', 'confirmed'].includes(b.status)) fail(409, 'Lịch đặt này không hủy được nữa');
  const tr = activeTransfer(b);
  if (tr?.status === 'claimed' && by === 'customer') fail(409, 'Đang có đội nhận pass, hãy chờ chủ sân xác nhận hoặc từ chối rồi hủy');
  if (tr) closeTransfer(tr, 'cancelled', by === 'customer' ? actor : null, 'Lịch đặt bị hủy nên đóng đăng pass');
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
    notify(venue.ownerId, `Khách ${userOf(b.userId).fullName} đã hủy lịch đặt ${b.code}.${r.amount ? ` Bạn cần chuyển lại ${r.amount.toLocaleString('vi-VN')}đ cho khách.` : ''}`, { bookingId: b.id, link: `/owner-bookings.html?id=${b.id}` });
  } else {
    notify(b.userId, `Lịch đặt ${b.code} đã bị ${by === 'owner' ? 'chủ sân' : 'quản trị viên'} hủy${b.cancelReason ? `: ${b.cancelReason}` : '.'}${r.amount ? ` Bạn sẽ được trả lại ${r.amount.toLocaleString('vi-VN')}đ.` : ''}`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  }
  freeSlot(b);
  save();
}

function doApprove(b, actor) {
  if (b.status !== 'pending') fail(409, 'Chỉ đồng ý được lịch đặt đang chờ chủ sân đồng ý');
  if (b.expiresAt && vnToMs(b.expiresAt) <= nowMs()) fail(409, 'Lịch đặt đã quá hạn giữ chỗ');
  b.status = 'confirmed';
  b.expiresAt = null;
  addLog(b, 'approve', 'pending', 'confirmed', actor);
  notify(b.userId, `Chủ sân đã đồng ý lịch đặt ${b.code}. Hãy chuyển khoản bằng mã QR.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
}
function doReject(b, actor, reason) {
  if (b.status !== 'pending') fail(409, 'Chỉ từ chối được lịch đặt đang chờ chủ sân đồng ý');
  req(String(reason || '').trim(), 'Vui lòng nhập lý do từ chối');
  b.status = 'rejected';
  b.expiresAt = null;
  b.cancelReason = String(reason).slice(0, 300);
  addLog(b, 'reject', 'pending', 'rejected', actor, b.cancelReason);
  notify(b.userId, `Chủ sân từ chối lịch đặt ${b.code}: ${b.cancelReason}`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  freeSlot(b);
  save();
}
function doPaid(b, actor, note) {
  if (b.status !== 'confirmed' && b.status !== 'completed') fail(409, 'Chỉ ghi nhận được cho lịch đặt đã có sân');
  if (b.paymentStatus === 'paid') fail(409, 'Lịch đặt đã được ghi nhận chuyển khoản');
  b.paymentStatus = 'paid';
  addLog(b, 'paid', null, null, actor, note || '');
  notify(b.userId, `Chủ sân đã nhận tiền của lịch đặt ${b.code}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
}
function doRefunded(b, actor, note, part) {
  const mt = matchOfBooking(b);
  if (mt) return refundMatchPart(mt, actor, part, note);
  if (b.refundStatus !== 'pending') fail(409, 'Lịch đặt này không có khoản cần chuyển lại');
  b.refundStatus = 'done';
  addLog(b, 'refund', null, null, actor, note || '');
  notify(b.userId, `Chủ sân đã chuyển lại ${b.refundAmount.toLocaleString('vi-VN')}đ cho lịch đặt ${b.code}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
}
function doAttendance(b, actor, result) {
  req(['completed', 'no_show'].includes(result), 'Kết quả phải là completed hoặc no_show');
  if (b.status !== 'confirmed') fail(409, 'Chỉ ghi nhận được cho lịch đặt đã có sân');
  if (vnToMs(b.startAt) > nowMs()) fail(400, 'Chưa tới giờ đá nên chưa đánh dấu được');
  b.status = result;
  addLog(b, 'attendance', 'confirmed', result, actor, result === 'no_show' ? 'Không đến sân' : '');
  if (result === 'no_show') {
    const r = reliabilityOf(b.userId);
    notify(b.userId, `Bạn bị ghi nhận bùng sân ở lịch đặt ${b.code}. ${r.restricted ? 'Các lần đặt sau của bạn sẽ phải chờ chủ sân đồng ý.' : `Bạn đã vi phạm ${r.violations}/${r.maxViolations} lần trong ${r.windowDays} ngày.`}`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
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


/* ---------- Pass sân ---------- */
// Lịch đặt đã xác nhận và đã chuyển khoản của đội A được đăng pass; đội B nhận và chuyển tiền thẳng chủ sân;
// chủ sân xác nhận đã nhận tiền thì lịch đặt chuyển sang B trong một bước (slot không bao giờ trống).
// Tiền trả lại cho A theo dõi riêng trên lịch đặt cũ (refundStatus pending → done), tách khỏi việc đổi chủ.

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

/** Đóng một đăng pass chưa xong (rút, hết hạn, lịch đặt bị hủy). Báo cho đội đang nhận nếu có. */
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
  if (wasClaimed && claimer) notify(claimer, `Đăng pass ${slotLabel(b)} tại ${courtOf(b.courtId)[0].name} đã đóng${reason ? `: ${reason}` : ''}. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân để lấy lại tiền.`, { link: `/transfer.html?id=${t.id}` });
}

/** Xử lý theo thời gian cho pass sân. Trả true nếu có thay đổi. */
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
      addLog(b, 'transfer_release', null, null, null, 'Quá hạn chờ chủ sân nhận tiền, mở pass lại cho đội khác');
      if (claimer) notify(claimer, `Lượt nhận pass ${slotLabel(b)} đã quá hạn vì chủ sân chưa xác nhận đã nhận tiền. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân.`, { link: `/transfer.html?id=${t.id}` });
      notify(b.userId, `Đội nhận sân ${b.code} chưa chuyển khoản kịp nên sân của bạn được mở pass lại.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      changed = true;
    }
    if (t.status === 'open' && vnToMs(t.closesAt) <= nowMs()) {
      closeTransfer(t, 'expired', null, 'Không có đội nào nhận trước hạn pass');
      notify(b.userId, `Không có đội nào nhận sân ${b.code} kịp giờ. Sân vẫn là của bạn; nếu không đá được, bạn có thể hủy đặt sân.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      changed = true;
    }
  }
  return changed;
}

function offerTransfer(ctx) {
  const user = need(ctx, 'customer');
  const b = findBooking(ctx.params.id);
  if (b.userId !== user.id) fail(404, 'Không tìm thấy lịch đặt');
  if (b.matchId) fail(409, 'Sân ghép kèo không pass được');
  if (b.status !== 'confirmed') fail(409, 'Chỉ pass được sân đã đặt xong');
  if (b.paymentStatus !== 'paid') fail(409, 'Chỉ pass được sân đã chuyển khoản (tiền bạn được nhận lại lấy từ tiền đội nhận trả)');
  if (activeTransfer(b)) fail(409, 'Lịch đặt này đang được đăng pass');
  const closesMs = vnToMs(b.startAt) - meta().transferCloseMinutes * 60000;
  req(closesMs > nowMs(), `Đã hết thời gian pass: phải đăng trước giờ đá ${meta().transferCloseMinutes} phút`);
  const ask = Number(ctx.body?.askPrice);
  req(Number.isInteger(ask) && ask > 0 && ask % 1000 === 0, 'Giá pass phải là số tròn nghìn đồng');
  req(ask <= b.price, `Giá pass không được cao hơn số tiền bạn đã trả (${vnd(b.price)})`);
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
  addLog(b, 'transfer_open', null, null, user, `Giá pass ${vnd(ask)}`);
  for (const w of waiters) {
    notify(w.userId, `Có đội đăng pass giờ ${slotLabel(b)} tại ${venue.name} · ${court.name}, giá ${vnd(ask)}. Bạn đang chờ giờ này nên được ưu tiên nhận đến ${timeOf(t.priorityUntil)}.`, { link: `/transfer.html?id=${t.id}` });
  }
  notify(venue.ownerId, `Đội đặt ${b.code} đăng pass giờ ${slotLabel(b)}, giá ${vnd(ask)} (họ đã trả ${vnd(b.price)}). Có đội nhận, bạn sẽ được báo để xác nhận đã nhận tiền.`, { bookingId: b.id, link: '/owner-bookings.html#transfers' });
  save();
  return toTransfer(t, user);
}

function claimTransfer(ctx) {
  const user = need(ctx, 'customer');
  const t = findTransfer(ctx.params.id);
  const b = S.bookings.find((x) => x.id === t.bookingId);
  if (t.fromUserId === user.id) fail(400, 'Bạn không thể nhận sân do chính mình đăng pass');
  if (t.status === 'claimed') fail(409, 'Đã có đội khác nhận sân này');
  if (t.status !== 'open') fail(409, 'Sân pass này không còn mở');
  if (vnToMs(t.closesAt) <= nowMs()) fail(409, 'Đã hết thời gian nhận pass');
  if (priorityActive(t) && !waitersOfBooking(b).some((w) => w.userId === user.id)) {
    fail(409, `Đang ưu tiên cho người đã đăng ký chờ giờ này đến ${timeOf(t.priorityUntil)}`);
  }
  const [venue, court] = courtOf(b.courtId);
  t.status = 'claimed';
  t.toUserId = user.id;
  t.claimedAt = now();
  t.claimExpiresAt = msToVn(nowMs() + meta().holdMinutes * 60000);
  S.waitlist = S.waitlist.filter((w) => !(w.userId === user.id && w.courtId === b.courtId && w.date === dateOf(b.startAt) && w.start === timeOf(b.startAt)));
  addLog(b, 'transfer_claim', null, null, null, 'Có đội nhận, chờ chủ sân xác nhận đã nhận tiền');
  notify(b.userId, `Đã có đội nhận sân ${b.code} với giá ${vnd(t.askPrice)}. Đang chờ chủ sân xác nhận đã nhận tiền, lúc này sân vẫn là của bạn.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  notify(venue.ownerId, `${user.fullName} nhận pass sân ${b.code} (${court.name} ${slotLabel(b)}), chuyển ${vnd(t.askPrice)} nội dung NH${b.code}. Nhận được tiền thì bấm xác nhận trước ${timeOf(t.claimExpiresAt)}.`, { bookingId: b.id, link: '/owner-bookings.html#transfers' });
  save();
  return toTransfer(t, user);
}

function findTransfer(id) {
  const t = S.transfers.find((x) => x.id === Number(id));
  if (!t) fail(404, 'Không tìm thấy sân pass này');
  return t;
}
function ownerTransfer(ctx) {
  const user = need(ctx, 'owner');
  const t = findTransfer(ctx.params.id);
  const b = S.bookings.find((x) => x.id === t.bookingId);
  if (courtOf(b.courtId)[0].ownerId !== user.id) fail(403, 'Sân pass này không thuộc sân của bạn');
  return [t, b, user];
}

/** Chủ sân xác nhận đã nhận tiền của đội nhận: đổi chủ lịch đặt và mở tiền trả lại cho đội cũ trong một bước. */
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
  a.cancelReason = 'Đã pass cho đội khác';
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
  addLog(nb, 'create', null, 'confirmed', userOf(nb.userId), 'Nhận pass từ lịch đặt cũ, chủ sân đã xác nhận nhận tiền');
  if (!silent) {
    notify(a.userId, `Sân ${a.code} đã sang đội khác. Chủ sân sẽ chuyển lại ${vnd(a.refundAmount)} cho bạn và ghi nhận khi xong.`, { bookingId: a.id, link: `/booking.html?id=${a.id}` });
    notify(nb.userId, `Bạn đã nhận pass thành công (mã ${nb.code}): ${courtOf(nb.courtId)[1].name} ${slotLabel(nb)} tại ${venue.name}. Chủ sân đã nhận ${vnd(t.askPrice)}.`, { bookingId: nb.id, link: `/booking.html?id=${nb.id}` });
  }
  return nb;
}

function doConfirmTransfer(ctx) {
  const [t, , owner] = ownerTransfer(ctx);
  if (t.status !== 'claimed') fail(409, 'Chưa có đội nhận hoặc sân pass đã xử lý xong');
  if (vnToMs(t.claimExpiresAt) <= nowMs()) fail(409, 'Lượt nhận đã quá hạn, sân được mở pass lại cho đội khác');
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
  notify(claimer, `Chủ sân từ chối lượt nhận pass ${slotLabel(b)}: ${reason.slice(0, 200)}. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân để lấy lại tiền.`, { link: `/transfer.html?id=${t.id}` });
  notify(b.userId, `Chủ sân từ chối đội nhận sân ${b.code}${t.status === 'open' ? '; sân của bạn được mở pass lại' : ''}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  save();
  return toTransfer(t, owner);
}

/** Danh sách cho chủ sân: đang đăng, chờ xác nhận tiền, đã đổi chủ mà chưa trả lại cho đội cũ. */
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

/* ---------- Trận đủ hai đội (R13) ---------- */

// Sân bật chế độ này (toàn bộ ngày, hoặc trong khung from–to) thì giờ đó chỉ chốt khi đủ hai đội cùng trả phần của mình.
const teamModeAt = (court, start) => {
  const m = court.teamMode;
  return !!m?.enabled && (!m.from || start >= m.from) && (!m.to || start < m.to);
};
const matchOfBooking = (b) => (b.matchId ? S.matches.find((m) => m.id === b.matchId) : null);
const ACTIVE_MATCH = ['open', 'joined'];
// Kèo tiền sân: % tiền sân đội thua chịu. 50 = hòa vốn (5-5), 100 = thua bao sân. Mỗi đội luôn chuyển trước 50% để giữ sân.
const STAKES = [50, 60, 70, 100];
const stakeText = (p) => (p >= 100 ? 'thua bao sân' : `${p / 10}-${10 - p / 10}`);
const halfOf = (price) => Math.min(price - 1000, Math.max(1000, roundThousand(price / 2)));
const loserShareOf = (m) => roundThousand((m.price * (m.loserPercent ?? 50)) / 100);
const hasStake = (m) => (m.loserPercent ?? 50) > 50;
const REPORT_HOURS = 48; // thời gian hai đội báo kết quả; hết hạn mà chưa khớp thì chủ sân chốt
const TOPUP_HOURS = 48; // hạn đội thua trả phần chênh; quá hạn chỉ hiện chữ "quá hạn", không phạt tự động
const partUser = (m, part) => (part === 'host' ? m.hostId : m.guestId);
const partAmount = (m, part) => (part === 'host' ? m.hostAmount : m.guestAmount);
const partName = (part) => (part === 'host' ? 'đội mở kèo' : 'đội vào kèo');
const matchContent = (b, part) => `TD${b.code}${part === 'host' ? 'A' : 'B'}`;
const matchBooking = (m) => S.bookings.find((x) => x.id === m.bookingId);
const hostPending = (m) => m.status === 'open' && !m.hostPaidAt && vnToMs(m.hostPayBy) > nowMs();
const guestPending = (m) => m.status === 'joined' && !m.guestPaidAt && vnToMs(m.guestHoldUntil) > nowMs();
const joinable = (m) => m.status === 'open' && !!m.hostPaidAt && vnToMs(m.closesAt) > nowMs();

function matchBrief(b, staff = false) {
  const m = matchOfBooking(b);
  if (!m) return null;
  const out = { id: m.id, status: m.status, closesAt: m.closesAt };
  if (staff) out.refunds = m.refunds.map((r) => ({ part: r.part, name: userOf(r.userId).fullName, amount: r.amount, status: r.status }));
  return out;
}

/** Cộng các tiền trả lại của trận vào lịch đặt để các danh sách chung vẫn hiện "chờ trả lại / đã trả lại". Tiền trả lại từng đội nằm ở m.refunds. */
function syncMatchRefund(m) {
  const b = matchBooking(m);
  b.refundAmount = m.refunds.reduce((s, r) => s + r.amount, 0);
  b.refundPercent = b.price ? Math.round((b.refundAmount / b.price) * 100) : 0;
  b.refundStatus = m.refunds.some((r) => r.status === 'pending') ? 'pending' : m.refunds.length ? 'done' : 'none';
}

function toMatch(m, viewer) {
  const b = matchBooking(m);
  const [venue, court] = courtOf(b.courtId);
  const isOwner = viewer?.role === 'owner' && venue.ownerId === viewer.id;
  const staff = isOwner || viewer?.role === 'admin';
  const role = !viewer ? null : viewer.id === m.hostId ? 'host' : viewer.id === m.guestId ? 'guest' : staff ? 'staff' : null;
  const mine = role === 'host' || role === 'guest' ? role : null;
  const out = {
    id: m.id,
    status: m.status,
    venueId: venue.id,
    venueName: venue.name,
    courtId: court.id,
    courtName: court.name,
    fieldType: court.fieldType,
    startAt: b.startAt,
    endAt: b.endAt,
    price: m.price,
    loserPercent: m.loserPercent ?? 50,
    loserAmount: loserShareOf(m),
    winnerAmount: m.price - loserShareOf(m),
    hostAmount: m.hostAmount,
    guestAmount: m.guestAmount,
    closesAt: m.closesAt,
    createdAt: m.createdAt,
    hostPaid: !!m.hostPaidAt,
    guestPaid: !!m.guestPaidAt,
    hasGuest: !!m.guestId,
    joinable: joinable(m) && role !== 'host',
    role,
    guestHoldUntil: m.status === 'joined' && (role || staff) ? m.guestHoldUntil : null,
    hostPayBy: !m.hostPaidAt && m.status === 'open' && (role === 'host' || staff) ? m.hostPayBy : null,
    endReason: m.endReason || null,
    result: resultOut(m, role, staff),
  };
  if (role) {
    out.bookingId = b.id;
    out.bookingCode = b.code;
  }
  if (mine) {
    const amount = partAmount(m, mine);
    const due = mine === 'host' ? hostPending(m) : guestPending(m);
    const refund = m.refunds.find((r) => r.part === mine);
    out.yourPart = { part: mine, amount, paid: mine === 'host' ? !!m.hostPaidAt : !!m.guestPaidAt, refund: refund ? { status: refund.status, amount: refund.amount } : null };
    out.paymentQr = due ? qrOf(venue, amount, matchContent(b, mine)) : null;
    // Số tài khoản chỉ lộ cho hai đội trong kèo: đội nào thấy tài khoản của chính mình; đội thua thấy thêm tài khoản đội thắng để chuyển phần chênh.
    const own = mine === 'host' ? m.hostBank : m.guestBank;
    out.yourBank = own ? { ...own, bankName: bankName(own.bin) } : null;
    const tu = m.result?.topUp;
    if (tu && tu.status === 'unpaid' && tu.from === mine) {
      const wb = tu.to === 'host' ? m.hostBank : m.guestBank;
      out.topUpQr = wb ? qrBank(wb, tu.amount, `KEO${b.code}`) : null;
    }
  }
  if (staff) {
    out.hostName = userOf(m.hostId).fullName;
    out.hostPhone = userOf(m.hostId).phone;
    out.hostReliability = reliabilityOf(m.hostId);
    out.guestName = m.guestId ? userOf(m.guestId).fullName : null;
    out.guestPhone = m.guestId ? userOf(m.guestId).phone : null;
    out.guestReliability = m.guestId ? reliabilityOf(m.guestId) : null;
    out.bookingId = b.id;
    out.bookingCode = b.code;
    out.hostContent = matchContent(b, 'host');
    out.guestContent = matchContent(b, 'guest');
    out.refunds = m.refunds.map((r) => ({ part: r.part, name: userOf(r.userId).fullName, amount: r.amount, status: r.status }));
  }
  return out;
}

const bankName = (bin) => meta().banks.find((x) => x.bin === bin)?.name || bin;
const otherPart = (p) => (p === 'host' ? 'guest' : 'host');
const winnerText = (m, w) => (w === 'draw' ? 'hòa' : `${partName(w)} thắng`);

/** Kết quả của kèo tiền sân. Mỗi đội chỉ thấy báo cáo của mình (và đã có báo cáo của đội kia hay chưa); chủ sân và admin thấy cả hai. */
function resultOut(m, role, staff) {
  const r = m.result;
  if (!r) return null;
  const mine = role === 'host' || role === 'guest' ? role : null;
  const out = {
    status: r.status,
    reportBy: r.reportBy,
    yourReport: mine ? r[`${mine}Report`] : null,
    otherReported: mine ? !!r[`${otherPart(mine)}Report`] : false,
    winner: r.winner || null,
    settledBy: r.settledBy || null,
    settledAt: r.settledAt || null,
    topUp: null,
  };
  if (staff) {
    out.hostReport = r.hostReport;
    out.guestReport = r.guestReport;
  }
  if (r.topUp && (mine || staff)) {
    const t = r.topUp;
    out.topUp = { from: t.from, to: t.to, amount: t.amount, status: t.status, receivedAt: t.receivedAt, dueBy: t.dueBy, overdue: t.status === 'unpaid' && vnToMs(t.dueBy) <= nowMs(), toName: userOf(partUser(m, t.to)).fullName, fromName: userOf(partUser(m, t.from)).fullName };
  }
  return out;
}

/** Hết giờ đá thì kèo có tiền sân sang bước báo kết quả; hai đội báo lệch hoặc quá hạn thì chuyển cho chủ sân chốt. */
function tickMatchResults() {
  let changed = false;
  for (const m of S.matches) {
    if (m.status !== 'confirmed' || !hasStake(m)) continue;
    const b = matchBooking(m);
    if (!m.result && vnToMs(b.endAt) <= nowMs()) {
      m.result = { status: 'awaiting', reportBy: msToVn(vnToMs(b.endAt) + REPORT_HOURS * 3600000), hostReport: null, guestReport: null, winner: null, settledBy: null, settledAt: null, topUp: null };
      for (const uid of [m.hostId, m.guestId]) notify(uid, `Kèo ${slotLabel(b)} đã đá xong. Hãy báo kết quả trước ${shortTs(m.result.reportBy)}.`, { link: `/match.html?id=${m.id}` });
      changed = true;
    }
    if (m.result?.status === 'awaiting' && vnToMs(m.result.reportBy) <= nowMs()) {
      m.result.status = 'needs_owner';
      notifyOwnerResult(m, 'Hai đội chưa báo kết quả khớp nhau trước hạn');
      changed = true;
    }
  }
  return changed;
}

function notifyOwnerResult(m, why) {
  const b = matchBooking(m);
  const [venue, court] = courtOf(b.courtId);
  addLog(b, 'match_result_dispute', null, null, null, why);
  notify(venue.ownerId, `Kèo ${court.name} ${slotLabel(b)} (${stakeText(m.loserPercent)}) cần bạn chốt kết quả. ${why}.`, { bookingId: b.id, link: '/owner-bookings.html#matches' });
}

function settleMatch(m, winner, by, actor) {
  const b = matchBooking(m);
  const r = m.result;
  r.status = 'settled';
  r.winner = winner;
  r.settledBy = by;
  r.settledAt = now();
  if (winner !== 'draw') {
    const loser = otherPart(winner);
    const amount = Math.max(0, loserShareOf(m) - partAmount(m, loser));
    if (amount > 0) r.topUp = { from: loser, to: winner, amount, status: 'unpaid', receivedAt: null, dueBy: msToVn(nowMs() + TOPUP_HOURS * 3600000) };
  }
  addLog(b, 'match_result', null, null, actor, `Kết quả ${stakeText(m.loserPercent)}: ${winnerText(m, winner)}${by === 'owner' ? ', chủ sân chốt' : ', hai đội khớp nhau'}${r.topUp ? `. Đội thua trả thêm ${vnd(r.topUp.amount)}` : ''}`);
  for (const part of ['host', 'guest']) {
    const uid = partUser(m, part);
    let msg;
    if (winner === 'draw') msg = `Kèo ${slotLabel(b)} hòa. Không ai trả thêm.`;
    else if (r.topUp && part === r.topUp.from) msg = `Đội bạn thua kèo ${slotLabel(b)}. Bạn trả thêm ${vnd(r.topUp.amount)} cho đội thắng.`;
    else if (r.topUp) msg = `Đội bạn thắng kèo ${slotLabel(b)}. Đội thua sẽ chuyển thêm ${vnd(r.topUp.amount)} cho bạn. Hãy nhập tài khoản ngân hàng để nhận.`;
    else msg = `Kèo ${slotLabel(b)} đã có kết quả.`;
    notify(uid, msg, { link: `/match.html?id=${m.id}` });
  }
}

function reportResult(ctx) {
  const user = need(ctx, 'customer');
  const m = findMatch(ctx.params.id);
  const part = user.id === m.hostId ? 'host' : user.id === m.guestId ? 'guest' : null;
  if (!part) fail(403, 'Chỉ hai đội trong kèo mới báo được kết quả');
  const r = m.result;
  if (!r) fail(409, hasStake(m) ? 'Kèo chưa đá xong nên chưa báo kết quả được' : 'Kèo 5-5 không cần báo kết quả');
  if (r.status !== 'awaiting') fail(409, r.status === 'settled' ? 'Kết quả đã chốt' : 'Kết quả đang chờ chủ sân chốt');
  const winner = ctx.body?.winner;
  req(['host', 'guest', 'draw'].includes(winner), 'Chọn đội thắng hoặc hòa');
  if (ctx.body?.bank) saveBank(m, part, ctx.body.bank);
  r[`${part}Report`] = winner;
  addLog(matchBooking(m), 'match_report', null, null, user, `${partName(part)} báo: ${winnerText(m, winner)}`);
  if (r.hostReport && r.guestReport) {
    if (r.hostReport === r.guestReport) settleMatch(m, winner, 'agree', null);
    else {
      r.status = 'needs_owner';
      notifyOwnerResult(m, 'Hai đội báo kết quả khác nhau');
      for (const uid of [m.hostId, m.guestId]) notify(uid, `Hai đội báo kết quả kèo ${slotLabel(matchBooking(m))} khác nhau. Chủ sân sẽ chốt.`, { link: `/match.html?id=${m.id}` });
    }
  }
  save();
  return toMatch(m, user);
}

function saveBank(m, part, bank) {
  const bin = String(bank?.bin || '');
  const account = String(bank?.account || '').replace(/\s/g, '');
  const accountName = String(bank?.accountName || '').trim().toUpperCase();
  req(meta().banks.some((x) => x.bin === bin), 'Chọn ngân hàng');
  req(/^\d{6,19}$/.test(account), 'Số tài khoản gồm 6 đến 19 chữ số');
  req(accountName.length >= 2 && accountName.length <= 60, 'Nhập tên chủ tài khoản');
  m[`${part}Bank`] = { bin, account, accountName };
}

function setMatchBank(ctx) {
  const user = need(ctx, 'customer');
  const m = findMatch(ctx.params.id);
  const part = user.id === m.hostId ? 'host' : user.id === m.guestId ? 'guest' : null;
  if (!part) fail(403, 'Chỉ hai đội trong kèo mới nhập được tài khoản');
  saveBank(m, part, ctx.body);
  save();
  return toMatch(m, user);
}

function ownerSettle(ctx) {
  const [m, b, owner] = ownerMatch(ctx);
  const r = m.result;
  if (!r || r.status !== 'needs_owner') fail(409, r?.status === 'settled' ? 'Kết quả đã chốt' : 'Kèo này chưa đến bước chủ sân chốt kết quả');
  const winner = ctx.body?.winner;
  req(['host', 'guest', 'draw'].includes(winner), 'Chọn đội thắng hoặc hòa');
  settleMatch(m, winner, 'owner', owner);
  save();
  return toMatch(m, owner);
}

function topUpReceived(ctx) {
  const user = need(ctx, 'customer');
  const m = findMatch(ctx.params.id);
  const t = m.result?.topUp;
  if (!t) fail(409, 'Kèo này không có khoản trả thêm');
  if (partUser(m, t.to) !== user.id) fail(403, 'Chỉ đội thắng mới bấm đã nhận');
  if (t.status === 'received') fail(409, 'Đã ghi nhận rồi');
  t.status = 'received';
  t.receivedAt = now();
  const b = matchBooking(m);
  addLog(b, 'match_topup', null, null, user, `Đội thắng đã nhận ${vnd(t.amount)}`);
  notify(partUser(m, t.from), `Đội thắng đã nhận ${vnd(t.amount)} của kèo ${slotLabel(b)}. Xong kèo.`, { link: `/match.html?id=${m.id}` });
  save();
  return toMatch(m, user);
}

/** Trận kết thúc không đủ hai đội: nhả giờ, ghi tiền trả lại cho từng đội đã được chủ sân xác nhận nhận tiền. */
function endMatch(m, status, reason, { actor = null, by = null, refundPercent = { host: 100, guest: 100 } } = {}) {
  const b = matchBooking(m);
  const from = b.status;
  const [venue] = courtOf(b.courtId);
  m.status = status;
  m.endReason = reason;
  m.endedAt = now();
  m.guestHoldUntil = null;
  for (const part of ['host', 'guest']) {
    const paid = part === 'host' ? m.hostPaidAt : m.guestPaidAt;
    const percent = refundPercent[part] ?? 100;
    const amount = paid ? Math.round((partAmount(m, part) * percent) / 100) : 0;
    if (amount > 0) m.refunds.push({ part, userId: partUser(m, part), amount, status: 'pending', doneAt: null });
  }
  b.status = by ? 'cancelled' : 'expired';
  b.cancelledBy = by;
  b.cancelReason = reason;
  b.cancelledAt = now();
  syncMatchRefund(m);
  addLog(b, by ? 'match_cancel' : 'match_expire', from, b.status, actor, reason);
  for (const r of m.refunds) {
    notify(r.userId, `Kèo ${slotLabel(b)} tại ${venue.name} không thành: ${reason} Chủ sân sẽ chuyển lại ${vnd(r.amount)} cho bạn và ghi nhận khi xong.`, { link: `/match.html?id=${m.id}` });
  }
  for (const uid of [m.hostId, m.guestId]) {
    if (uid && !m.refunds.some((r) => r.userId === uid)) notify(uid, `Kèo ${slotLabel(b)} tại ${venue.name} không thành: ${reason} Chủ sân chưa nhận tiền của bạn nên không có tiền để trả lại.`, { link: `/match.html?id=${m.id}` });
  }
  if (m.refunds.length) notify(venue.ownerId, `Kèo ${b.code} (${slotLabel(b)}) không thành. Bạn cần chuyển lại ${m.refunds.map((r) => vnd(r.amount)).join(' và ')} cho các đội đã trả.`, { link: '/owner-bookings.html#matches' });
  freeSlot(b);
}

function tickMatches() {
  let changed = false;
  for (const m of S.matches) {
    if (!ACTIVE_MATCH.includes(m.status)) continue;
    if (m.status === 'open' && !m.hostPaidAt && vnToMs(m.hostPayBy) <= nowMs()) {
      endMatch(m, 'cancelled', 'Đội mở kèo chưa trả phần của mình trong thời gian giữ chỗ.');
      changed = true;
    } else if (vnToMs(m.closesAt) <= nowMs()) {
      endMatch(m, 'expired', 'Hết hạn mà chưa đủ tiền của hai đội.');
      changed = true;
    } else if (m.status === 'joined' && vnToMs(m.guestHoldUntil) <= nowMs()) {
      releaseGuest(m, 'Chủ sân chưa nhận được tiền của bạn trong thời gian giữ chỗ. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân.');
      changed = true;
    }
  }
  return changed;
}

function releaseGuest(m, reasonForGuest) {
  const b = matchBooking(m);
  const guest = m.guestId;
  m.guestId = null;
  m.guestHoldUntil = null;
  m.joinedAt = null;
  m.status = 'open';
  addLog(b, 'match_release', null, null, null, 'Đội vào kèo đã rút, kèo mở lại cho đội khác');
  notify(guest, `Bạn không còn trong kèo ${slotLabel(b)}. ${reasonForGuest}`, { link: `/match.html?id=${m.id}` });
  notify(m.hostId, `Đội vào kèo đã rút khỏi kèo ${slotLabel(b)}; kèo mở lại cho đội khác đến ${timeOf(m.closesAt)}.`, { link: `/match.html?id=${m.id}` });
}

function findMatch(id) {
  const m = S.matches.find((x) => x.id === Number(id));
  if (!m) fail(404, 'Không tìm thấy kèo');
  return m;
}
function ownerMatch(ctx) {
  const user = need(ctx, 'owner');
  const m = findMatch(ctx.params.id);
  if (courtOf(matchBooking(m).courtId)[0].ownerId !== user.id) fail(403, 'Kèo này không thuộc sân của bạn');
  return [m, matchBooking(m), user];
}

function openMatch(ctx) {
  const user = need(ctx, 'customer');
  const { courtId, date, start } = ctx.body || {};
  const [venue, court] = courtOf(courtId);
  if (!venue || !court || !court.isActive || !venue.isActive) fail(404, 'Không tìm thấy sân');
  checkDate(date);
  req(slotGrid(venue).includes(start), 'Giờ bắt đầu không khớp lịch của sân');
  const today = dateOf(now());
  req(date >= today && date <= addDays(today, meta().bookingWindowDays - 1), `Chỉ đặt trước tối đa ${meta().bookingWindowDays} ngày`);
  if (!teamModeAt(court, start)) fail(409, 'Giờ này không ghép kèo, bạn đặt sân như bình thường nhé');
  const slot = slotInfo(court, venue, date, start, user);
  if (slot.status === 'past') fail(400, 'Giờ này đã qua giờ bắt đầu');
  if (slot.status === 'blocked') fail(409, 'Giờ này chủ sân đang chặn');
  if (slot.status === 'booked' || slot.status === 'held') fail(409, 'Giờ này vừa có người khác đặt, bạn chọn giờ khác nhé');
  if (slot.status === 'offered' && !slot.offeredToYou) fail(409, 'Giờ này đang giữ cho người đã đăng ký chờ');
  const startMs = vnToMs(`${date} ${start}`);
  const latest = startMs - meta().matchCloseMinutes * 60000;
  const earliest = nowMs() + meta().matchMinOpenMinutes * 60000;
  if (latest < earliest) fail(400, 'Còn quá ít thời gian để tìm đủ hai đội cho giờ này');
  const closesMs = vnToMs(String(ctx.body?.closesAt || '').padEnd(19, ':00').slice(0, 19));
  req(Number.isFinite(closesMs), 'Vui lòng chọn hạn tìm đội');
  req(closesMs >= earliest && closesMs <= latest, `Hạn tìm đội phải từ ${meta().matchMinOpenMinutes} phút sau bây giờ đến ${meta().matchCloseMinutes} phút trước giờ đá`);
  const loserPercent = Number(ctx.body?.loserPercent);
  req(STAKES.includes(loserPercent), 'Kèo tiền sân chỉ có 5-5, 6-4, 7-3 hoặc thua bao sân');
  const price = slot.basePrice;
  const hostAmount = halfOf(price);
  const b = {
    id: nextId('booking'), code: '', userId: user.id, venueId: venue.id, courtId: court.id, startAt: `${date} ${start}:00`, endAt: `${date} ${slot.end}:00`,
    status: 'matching', expiresAt: null, price, basePrice: price, discountPercent: 0, paymentStatus: 'unpaid', refundStatus: 'none', refundPercent: 0, refundAmount: 0,
    cancelledBy: null, cancelReason: null, lateCancel: false, customerNote: '', rulesSnapshot: venue.rules, policySnapshot: venue.cancelPolicy, idempotencyKey: null, createdAt: now(), cancelledAt: null,
  };
  b.code = bookingCode(b.id);
  const m = {
    id: nextId('match'), bookingId: b.id, hostId: user.id, guestId: null, price, loserPercent, hostAmount, guestAmount: price - hostAmount,
    status: 'open', createdAt: now(), closesAt: msToVn(closesMs), hostPayBy: msToVn(Math.min(nowMs() + meta().holdMinutes * 60000, closesMs)),
    hostPaidAt: null, guestPaidAt: null, guestHoldUntil: null, joinedAt: null, refunds: [], endReason: null, result: null, hostBank: null, guestBank: null,
  };
  b.matchId = m.id;
  S.bookings.push(b);
  S.matches.push(m);
  S.waitlist = S.waitlist.filter((w) => !(w.userId === user.id && w.courtId === court.id && w.date === date && w.start === start));
  addLog(b, 'create', null, 'matching', user, `Mở kèo ${stakeText(loserPercent)}, phần của đội mở kèo ${vnd(hostAmount)}, hạn tìm đội ${shortTs(m.closesAt)}`);
  notify(venue.ownerId, `${user.fullName} mở kèo ${court.name} ${slotLabel(b)} và sẽ chuyển ${vnd(hostAmount)}, nội dung ${matchContent(b, 'host')}. Nhận được tiền thì bấm xác nhận trước ${timeOf(m.hostPayBy)}.`, { bookingId: b.id, link: '/owner-bookings.html#matches' });
  notify(user.id, `Đã giữ ${court.name} ${slotLabel(b)} cho kèo của bạn. Hãy chuyển ${vnd(hostAmount)} cho chủ sân trước ${timeOf(m.hostPayBy)} để kèo hiện cho đội khác.`, { link: `/match.html?id=${m.id}` });
  save();
  return toMatch(m, user);
}

function joinMatch(ctx) {
  const user = need(ctx, 'customer');
  const m = findMatch(ctx.params.id);
  if (m.hostId === user.id) fail(400, 'Bạn là đội mở kèo này');
  if (m.guestId) fail(409, 'Đã có đội khác vào kèo này');
  if (m.status !== 'open') fail(409, 'Kèo này không còn mở');
  if (!m.hostPaidAt) fail(409, 'Chủ sân chưa nhận tiền của đội mở kèo nên bạn chưa vào được');
  if (vnToMs(m.closesAt) <= nowMs()) fail(409, 'Kèo đã quá hạn tìm đội');
  const b = matchBooking(m);
  const [venue, court] = courtOf(b.courtId);
  m.guestId = user.id;
  m.status = 'joined';
  m.joinedAt = now();
  m.guestHoldUntil = msToVn(Math.min(nowMs() + meta().holdMinutes * 60000, vnToMs(m.closesAt)));
  S.waitlist = S.waitlist.filter((w) => !(w.userId === user.id && w.courtId === b.courtId && w.date === dateOf(b.startAt) && w.start === timeOf(b.startAt)));
  addLog(b, 'match_join', null, null, user, `Đội vào kèo, phần ${vnd(m.guestAmount)}`);
  notify(m.hostId, `Đã có đội vào kèo ${slotLabel(b)}. Kèo chốt khi đội đó chuyển ${vnd(m.guestAmount)} và chủ sân nhận được.`, { link: `/match.html?id=${m.id}` });
  notify(venue.ownerId, `${user.fullName} vào kèo ${court.name} ${slotLabel(b)} và sẽ chuyển ${vnd(m.guestAmount)}, nội dung ${matchContent(b, 'guest')}. Nhận được tiền thì bấm xác nhận trước ${timeOf(m.guestHoldUntil)}.`, { bookingId: b.id, link: '/owner-bookings.html#matches' });
  save();
  return toMatch(m, user);
}

/** Đội mở kèo rút. Chưa có đội vào: miễn phí, trả lại đủ phần đã trả. Đã có đội vào: trả lại phần đã trả và tính hủy sát giờ như R10. */
function withdrawMatch(ctx) {
  const user = need(ctx, 'customer');
  const m = findMatch(ctx.params.id);
  if (m.hostId !== user.id) fail(404, 'Không tìm thấy kèo');
  if (!ACTIVE_MATCH.includes(m.status)) fail(409, 'Kèo này đã kết thúc');
  const b = matchBooking(m);
  const withGuest = m.status === 'joined';
  let percent = 100;
  if (withGuest) {
    const r = refundFor({ startAt: b.startAt, price: m.hostAmount, paid: !!m.hostPaidAt }, now(), 'customer');
    percent = r.percent;
    b.lateCancel = r.hoursLeft < 12;
  }
  endMatch(m, 'cancelled', withGuest ? 'Đội mở kèo đã rút sau khi có đội vào.' : 'Đội mở kèo đã rút trước khi có đội vào.', { actor: user, by: 'customer', refundPercent: { host: percent, guest: 100 } });
  save();
  return { ok: true };
}

function doConfirmPart(ctx) {
  const [m, b, owner] = ownerMatch(ctx);
  const part = ctx.body?.part;
  req(['host', 'guest'].includes(part), 'part phải là host hoặc guest');
  const note = String(ctx.body?.note || '').slice(0, 300);
  if (part === 'host') {
    if (m.hostPaidAt) fail(409, 'Đã nhận tiền của đội mở kèo');
    if (!hostPending(m)) fail(409, 'Đội mở kèo đã hết thời gian giữ chỗ hoặc kèo đã kết thúc');
    m.hostPaidAt = now();
    addLog(b, 'match_part_paid', null, null, owner, `Đã nhận phần đội mở kèo ${vnd(m.hostAmount)}${note ? `. ${note}` : ''}`);
    notify(m.hostId, `Chủ sân đã nhận ${vnd(m.hostAmount)} của bạn. Kèo ${slotLabel(b)} đang tìm đội đá cùng đến ${shortTs(m.closesAt)}; sân vẫn được giữ cho bạn.`, { link: `/match.html?id=${m.id}` });
    for (const w of waitersOfBooking(b)) {
      notify(w.userId, `Có kèo ${slotLabel(b)} tại ${courtOf(b.courtId)[0].name} đang tìm đội đá cùng, phần ${vnd(m.guestAmount)}. Bạn đang chờ giờ này nên có thể vào kèo.`, { link: `/match.html?id=${m.id}` });
    }
  } else {
    if (m.guestPaidAt) fail(409, 'Đã nhận tiền của đội vào kèo');
    if (!guestPending(m)) fail(409, 'Chưa có đội vào kèo, hoặc đội đó đã hết thời gian giữ chỗ');
    m.guestPaidAt = now();
    addLog(b, 'match_part_paid', null, null, owner, `Đã nhận phần đội vào kèo ${vnd(m.guestAmount)}${note ? `. ${note}` : ''}`);
  }
  if (m.hostPaidAt && m.guestPaidAt) {
    m.status = 'confirmed';
    m.guestHoldUntil = null;
    const from = b.status;
    b.status = 'confirmed';
    b.paymentStatus = 'paid';
    addLog(b, 'match_confirm', from, 'confirmed', owner, 'Đủ hai phần tiền, chốt sân');
    const [venue, court] = courtOf(b.courtId);
    for (const uid of [m.hostId, m.guestId]) notify(uid, `Kèo ${court.name} ${slotLabel(b)} tại ${venue.name} đã chốt: chủ sân nhận đủ tiền của hai đội.`, { link: `/match.html?id=${m.id}` });
  }
  save();
  return toMatch(m, owner);
}
function doRejectGuest(ctx) {
  const [m, , owner] = ownerMatch(ctx);
  if (m.status !== 'joined') fail(409, 'Chưa có đội vào kèo để từ chối');
  const reason = String(ctx.body?.reason || '').trim();
  req(reason, 'Vui lòng nhập lý do từ chối đội vào kèo');
  releaseGuest(m, `Chủ sân từ chối: ${reason.slice(0, 200)}. Nếu bạn đã chuyển khoản, hãy liên hệ chủ sân để lấy lại tiền.`);
  save();
  return toMatch(m, owner);
}
function doOwnerCancelMatch(ctx) {
  const [m, , owner] = ownerMatch(ctx);
  if (!ACTIVE_MATCH.includes(m.status)) fail(409, 'Kèo này đã kết thúc');
  const reason = String(ctx.body?.reason || '').trim();
  req(reason, 'Vui lòng nhập lý do hủy kèo');
  endMatch(m, 'cancelled', `Chủ sân hủy kèo: ${reason.slice(0, 200)}.`, { actor: owner, by: 'owner' });
  save();
  return toMatch(m, owner);
}
/** Ghi nhận chủ sân đã trả lại tiền cho một đội của trận. Không chọn part thì chỉ hợp lệ khi đúng một khoản đang chờ. */
function refundMatchPart(m, actor, part, note) {
  const pending = m.refunds.filter((r) => r.status === 'pending');
  const r = part ? pending.find((x) => x.part === part) : pending.length === 1 ? pending[0] : null;
  if (!r) fail(pending.length > 1 && !part ? 400 : 409, pending.length > 1 && !part ? 'Kèo này có hai khoản cần chuyển lại, hãy chọn đội cần ghi nhận' : 'Không có khoản nào cần chuyển lại');
  r.status = 'done';
  r.doneAt = now();
  const b = matchBooking(m);
  syncMatchRefund(m);
  addLog(b, 'refund', null, null, actor, `Đã trả lại ${vnd(r.amount)} cho ${partName(r.part)}${note ? `. ${note}` : ''}`);
  notify(r.userId, `Chủ sân đã chuyển lại ${vnd(r.amount)} cho kèo ${slotLabel(b)}.`, { link: `/match.html?id=${m.id}` });
  save();
}

function ownerMatches(user) {
  return S.matches
    .filter((m) => courtOf(matchBooking(m).courtId)[0].ownerId === user.id && (ACTIVE_MATCH.includes(m.status) || m.refunds.some((r) => r.status === 'pending') || ['awaiting', 'needs_owner'].includes(m.result?.status)))
    .sort((x, y) => matchBooking(x).startAt.localeCompare(matchBooking(y).startAt))
    .map((m) => toMatch(m, user));
}

function seedMatches(st, ago) {
  for (const spec of seeds.matches.matches) {
    const [venue, court] = courtOf(spec.courtId);
    const date = addDays(dateOf(now()), spec.day);
    const slot = slotInfo(court, venue, date, spec.start, null, true);
    const price = slot.basePrice;
    const hostAmount = halfOf(price);
    const created = ago(spec.minAgo);
    const b = {
      id: nextId('booking'), code: '', userId: spec.hostId, venueId: venue.id, courtId: court.id, startAt: `${date} ${spec.start}:00`, endAt: `${date} ${slot.end}:00`,
      status: 'matching', expiresAt: null, price, basePrice: price, discountPercent: 0, paymentStatus: 'unpaid', refundStatus: 'none', refundPercent: 0, refundAmount: 0,
      cancelledBy: null, cancelReason: null, lateCancel: false, customerNote: '', rulesSnapshot: venue.rules, policySnapshot: venue.cancelPolicy, idempotencyKey: null, createdAt: created, cancelledAt: null,
    };
    b.code = bookingCode(b.id);
    const latest = vnToMs(b.startAt) - meta().matchCloseMinutes * 60000;
    const m = {
      id: nextId('match'), bookingId: b.id, hostId: spec.hostId, guestId: null, price, loserPercent: spec.loserPercent, hostAmount, guestAmount: price - hostAmount,
      status: 'open', createdAt: created, closesAt: msToVn(latest), hostPayBy: msToVn(vnToMs(created) + meta().holdMinutes * 60000),
      hostPaidAt: spec.state === 'host_unpaid' ? null : ago(spec.minAgo - 2), guestPaidAt: null, guestHoldUntil: null, joinedAt: null, refunds: [], endReason: null, result: null, hostBank: null, guestBank: null,
    };
    b.matchId = m.id;
    st.bookings.push(b);
    st.matches.push(m);
    addLog(b, 'create', null, 'matching', userOf(spec.hostId), `Mở kèo ${stakeText(spec.loserPercent)}, phần của đội mở kèo ${vnd(hostAmount)}`, created);
    if (m.hostPaidAt) addLog(b, 'match_part_paid', null, null, userOf(venue.ownerId), `Đã nhận phần đội mở kèo ${vnd(hostAmount)}`, m.hostPaidAt);
    if (spec.state === 'joined' || spec.state === 'confirmed') {
      m.guestId = spec.guestId;
      m.status = 'joined';
      m.joinedAt = ago(spec.joinedMinAgo ?? 2);
      m.guestHoldUntil = msToVn(vnToMs(m.joinedAt) + meta().holdMinutes * 60000);
      addLog(b, 'match_join', null, null, userOf(spec.guestId), `Đội vào kèo, phần ${vnd(m.guestAmount)}`, m.joinedAt);
      st.notifications.push({ id: nextId('notification'), userId: venue.ownerId, bookingId: b.id, message: `${userOf(spec.guestId).fullName} vào kèo ${court.name} ${slotLabel(b)}, chuyển ${vnd(m.guestAmount)} nội dung ${matchContent(b, 'guest')}. Nhận được tiền thì bấm xác nhận trước ${timeOf(m.guestHoldUntil)}.`, link: '/owner-bookings.html#matches', isRead: false, createdAt: m.joinedAt });
    }
    if (spec.state === 'confirmed') {
      m.guestPaidAt = ago(1);
      m.status = 'confirmed';
      m.guestHoldUntil = null;
      b.status = 'confirmed';
      b.paymentStatus = 'paid';
      addLog(b, 'match_part_paid', null, null, userOf(venue.ownerId), `Đã nhận phần đội vào kèo ${vnd(m.guestAmount)}`, m.guestPaidAt);
      addLog(b, 'match_confirm', 'matching', 'confirmed', userOf(venue.ownerId), 'Đủ hai phần tiền, chốt sân', m.guestPaidAt);
    }
    if (spec.played) {
      // Kèo đã đá xong: chờ hai đội báo kết quả, hoặc đã chốt và đội thua chưa trả phần chênh.
      m.result = { status: 'awaiting', reportBy: msToVn(vnToMs(b.endAt) + REPORT_HOURS * 3600000), hostReport: null, guestReport: null, winner: null, settledBy: null, settledAt: null, topUp: null };
      if (spec.hostReport) m.result.hostReport = spec.hostReport;
      if (spec.winner) {
        settleMatch(m, spec.winner, 'agree', null);
        m.result.hostReport = m.result.guestReport = spec.winner;
        if (spec.winnerBank) m[`${spec.winner}Bank`] = spec.winnerBank;
      }
    }
    if (spec.state === 'open') {
      st.notifications.push({ id: nextId('notification'), userId: venue.ownerId, bookingId: b.id, message: `Kèo ${court.name} ${slotLabel(b)} đang tìm đội đá cùng.`, link: '/owner-bookings.html#matches', isRead: true, createdAt: m.hostPaidAt || created });
    }
  }
}

/* ---------- Tin nhờ báo giá và báo giá (R14) ---------- */

const ACTIVE_OFFER = ['open'];
const requestOf = (id) => S.requests.find((r) => r.id === Number(id));
const offerOf = (id) => S.offers.find((o) => o.id === Number(id));
const offerDate = (o) => dateOf(o.startAt);
const offerStart = (o) => timeOf(o.startAt);
const reqLabel = (r) => `${r.district}, ${dayLabelVn(r.date)} ${r.from}–${r.to}, sân ${r.fieldType}`;
const dayLabelVn = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Các giờ của sân còn nằm trọn trong khung giờ của tin nhờ báo giá (dữ liệu, không đọc chữ). */
const slotsInWindow = (venue, r) => slotGrid(venue).filter((s) => s >= r.from && slotEnd(venue, s) <= r.to);

/** Sân "phù hợp" với tin nhờ báo giá: cùng quận, có sân đang mở đúng loại, có giờ trọn trong khung. Mức giá bạn muốn chỉ để hiển thị. */
const venueFits = (venue, r) =>
  venue.isActive && venue.district === r.district && venue.courts.some((c) => c.isActive && c.fieldType === r.fieldType) && slotsInWindow(venue, r).length > 0;

/** Lý do báo giá không dùng được ngay lúc này (null = dùng được). Không giữ giờ: chỉ đọc trạng thái hiện tại. */
function offerBlock(o, viewer) {
  const [venue, court] = courtOf(o.courtId);
  if (!venue || !court || !venue.isActive || !court.isActive) return 'Sân không còn nhận đặt';
  const slot = slotInfo(court, venue, offerDate(o), offerStart(o), viewer);
  if (slot.status === 'past') return 'Đã quá giờ bắt đầu';
  if (slot.status === 'blocked') return 'Chủ sân đã chặn giờ này';
  if (slot.status === 'booked' || slot.status === 'held') return 'Giờ này đã có người khác đặt';
  if (slot.status === 'offered' && !slot.offeredToYou) return 'Giờ này đang giữ cho người đã đăng ký chờ';
  if (teamModeAt(court, offerStart(o))) return 'Giờ này chỉ nhận ghép kèo';
  if (slot.basePrice < o.price) return 'Giá thường của sân đã đổi, thấp hơn giá chào';
  return null;
}

function toOffer(o, viewer, r = requestOf(o.requestId)) {
  const [venue, court] = courtOf(o.courtId);
  const block = o.status === 'open' ? offerBlock(o, userOf(r.userId)) : null;
  return {
    id: o.id,
    requestId: o.requestId,
    status: o.status,
    venueId: venue.id,
    venueName: venue.name,
    venueAddress: venue.address,
    venueDistrict: venue.district,
    requiresApproval: venue.requiresApproval,
    courtId: court.id,
    courtName: court.name,
    fieldType: court.fieldType,
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

function toRequest(r, viewer) {
  const isOwnerView = viewer?.role === 'owner';
  const mineVenues = isOwnerView ? S.venues.filter((v) => v.ownerId === viewer.id && venueFits(v, r)) : [];
  const offers = S.offers.filter((o) => o.requestId === r.id && (!isOwnerView || mineVenues.some((v) => v.id === courtOf(o.courtId)[0].id)));
  const out = {
    id: r.id,
    status: r.status,
    district: r.district,
    date: r.date,
    from: r.from,
    to: r.to,
    fieldType: r.fieldType,
    budget: r.budget,
    note: r.note,
    closesAt: r.closesAt,
    createdAt: r.createdAt,
    endReason: r.endReason || null,
    bookingId: r.status === 'chosen' ? r.bookingId : null,
    offers: offers.map((o) => toOffer(o, viewer, r)).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.price - b.price),
  };
  if (isOwnerView) {
    out.customerName = userOf(r.userId).fullName;
    out.customerReliability = reliabilityOf(r.userId);
    out.venues = mineVenues.map((v) => ({ id: v.id, name: v.name }));
    out.openOfferCount = S.offers.filter((o) => o.requestId === r.id && o.status === 'open').length;
    out.maxOffers = meta().requestMaxOffers;
    out.options = r.status === 'open' ? requestOptions(r, mineVenues) : [];
  }
  return out;
}

/** Giờ chủ sân có thể chào: trọn trong khung giờ, còn trống, không thuộc chế độ đủ hai đội. */
function requestOptions(r, venues) {
  const out = [];
  for (const v of venues) {
    for (const c of v.courts.filter((x) => x.isActive && x.fieldType === r.fieldType)) {
      const slots = [];
      for (const s of slotsInWindow(v, r)) {
        const info = slotInfo(c, v, r.date, s, null);
        if (info.status !== 'available' || info.teamMode) continue;
        slots.push({ start: s, end: info.end, basePrice: info.basePrice });
      }
      if (slots.length) out.push({ venueId: v.id, venueName: v.name, courtId: c.id, courtName: c.name, slots });
    }
  }
  return out;
}

function endOffer(o, status, reason) {
  o.status = status;
  o.endReason = reason;
}

/** Đóng một tin nhờ báo giá chưa chốt: mọi báo giá đang mở đóng theo. */
function closeRequest(r, status, reason, { notifyOwners = true, notifyCustomer = false } = {}) {
  const open = S.offers.filter((o) => o.requestId === r.id && o.status === 'open');
  r.status = status;
  r.endReason = reason;
  for (const o of open) {
    endOffer(o, status === 'cancelled' ? 'void' : 'expired', status === 'cancelled' ? 'Khách đã hủy tin nhờ báo giá' : 'Tin nhờ báo giá đã quá hạn nhận báo giá');
    if (notifyOwners) notify(courtOf(o.courtId)[0].ownerId, `Tin nhờ báo giá ${reqLabel(r)} ${status === 'cancelled' ? 'đã được khách hủy' : 'đã quá hạn'}, báo giá ${o.price.toLocaleString('vi-VN')}đ của bạn cũng đóng.`, { link: '/owner-requests.html' });
  }
  if (notifyCustomer) notify(r.userId, `Tin nhờ báo giá ${reqLabel(r)} đã quá hạn nhận báo giá${open.length ? `, bạn chưa chọn ${open.length} báo giá` : ''}.`, { link: `/request.html?id=${r.id}` });
}

function tickRequests() {
  let changed = false;
  for (const r of S.requests) {
    if (r.status !== 'open') continue;
    if (vnToMs(r.closesAt) <= nowMs()) {
      closeRequest(r, 'expired', 'Quá hạn nhận báo giá', { notifyCustomer: true });
      changed = true;
      continue;
    }
    for (const o of S.offers) {
      if (o.requestId === r.id && o.status === 'open' && vnToMs(o.validUntil) <= nowMs()) {
        endOffer(o, 'expired', 'Giá báo đã quá hạn hiệu lực');
        changed = true;
      }
    }
  }
  return changed;
}

function openRequest(ctx) {
  const user = need(ctx, 'customer');
  const { district, date, from, to, fieldType, budget, closesAt, note = '' } = ctx.body || {};
  const m = meta();
  req(S.venues.some((v) => v.isActive && v.district === district), 'Chưa có sân nào ở quận này');
  req(['5', '7'].includes(String(fieldType)), 'Loại sân là 5 hoặc 7');
  checkDate(date);
  const today = dateOf(now());
  req(date >= today && date <= addDays(today, m.bookingWindowDays - 1), `Chỉ nhờ sân báo giá trong ${m.bookingWindowDays} ngày tới`);
  req(/^\d{2}:\d{2}$/.test(from || '') && /^\d{2}:\d{2}$/.test(to || ''), 'Khung giờ không hợp lệ');
  req(hmToMin(to) - hmToMin(from) >= 60, 'Khung giờ cần dài ít nhất 60 phút');
  const bud = num(budget);
  req(Number.isInteger(bud) && bud >= 1000 && bud <= 5000000 && bud % 1000 === 0, 'Mức giá bạn muốn phải là số tròn nghìn đồng, tối đa 5.000.000đ');
  const startMs = vnToMs(`${date} ${from}`);
  const latest = startMs - m.requestCloseMinutes * 60000;
  const earliest = nowMs() + m.requestMinOpenMinutes * 60000;
  req(latest >= earliest, 'Còn quá ít thời gian: cần ít nhất 90 phút từ bây giờ đến giờ bắt đầu để sân kịp báo giá');
  const closeMs = vnToMs(closesAt || '');
  req(Number.isFinite(closeMs) && closeMs >= earliest && closeMs <= latest, `Hạn nhận báo giá cần từ ${m.requestMinOpenMinutes} phút sau bây giờ đến ${m.requestCloseMinutes} phút trước giờ bắt đầu`);
  if (S.requests.filter((r) => r.userId === user.id && r.status === 'open').length >= m.requestMaxOpen) {
    fail(409, `Bạn đang có ${m.requestMaxOpen} tin nhờ báo giá chưa xong. Hãy chọn hoặc hủy bớt rồi nhờ tiếp`);
  }
  const r = { id: nextId('request'), userId: user.id, district, date, from, to, fieldType: String(fieldType), budget: bud, note: String(note).slice(0, 300), status: 'open', closesAt, createdAt: now(), chosenOfferId: null, bookingId: null, endReason: null };
  req(S.venues.some((v) => venueFits(v, r)), 'Chưa có sân nào ở quận này có sân loại này và giờ mở cửa phù hợp khung giờ bạn chọn');
  S.requests.push(r);
  const owners = new Set(S.venues.filter((v) => venueFits(v, r)).map((v) => v.ownerId));
  for (const id of owners) notify(id, `Có khách nhờ báo giá: ${reqLabel(r)}, khách muốn ${bud.toLocaleString('vi-VN')}đ/giờ. Gửi báo giá trước ${timeOf(r.closesAt)}.`, { link: '/owner-requests.html' });
  save();
  return toRequest(r, user);
}

function ownRequest(ctx) {
  const user = need(ctx, 'customer');
  const r = requestOf(ctx.params.id);
  if (!r || r.userId !== user.id) fail(404, 'Không tìm thấy tin này');
  return r;
}

function cancelRequest(ctx) {
  const r = ownRequest(ctx);
  if (r.status === 'chosen') fail(409, 'Tin này đã được chọn và đặt sân, hãy hủy lịch đặt nếu cần');
  if (r.status !== 'open') fail(409, 'Tin này đã kết thúc');
  closeRequest(r, 'cancelled', 'Khách đã hủy tin nhờ báo giá');
  save();
  return toRequest(r, ctx.user);
}

function acceptOffer(ctx) {
  const user = need(ctx, 'customer');
  const r = ownRequest(ctx);
  const offerId = Number(ctx.body?.offerId);
  const o = offerOf(offerId);
  if (!o || o.requestId !== r.id) fail(404, 'Không tìm thấy báo giá');
  if (r.status === 'chosen' && r.chosenOfferId === o.id) return toBooking(S.bookings.find((b) => b.id === r.bookingId)); // bấm lặp
  if (r.status !== 'open') fail(409, 'Tin này đã kết thúc');
  if (o.status !== 'open') fail(409, 'Báo giá này không còn hiệu lực');
  if (vnToMs(o.validUntil) <= nowMs()) {
    endOffer(o, 'expired', 'Giá báo đã quá hạn hiệu lực');
    save();
    fail(409, 'Báo giá này đã quá hạn');
  }
  // Kiểm lại giờ và giá ngay lúc chọn: báo giá không giữ giờ nên người khác có thể đã đặt trước.
  const block = offerBlock(o, user);
  if (block) {
    endOffer(o, 'void', block);
    save();
    fail(409, `Báo giá này không còn dùng được: ${block.charAt(0).toLowerCase()}${block.slice(1)}`);
  }
  const [venue, court] = courtOf(o.courtId);
  const slot = slotInfo(court, venue, offerDate(o), offerStart(o), user);
  const b = insertBooking(user, venue, court, offerDate(o), offerStart(o), slot, { price: o.price, offerId: o.id });
  addLog(b, 'offer_accept', null, b.status, user, `Báo giá #${o.id} của sân: ${o.price.toLocaleString('vi-VN')}đ (giá thường ${slot.basePrice.toLocaleString('vi-VN')}đ)`);
  r.status = 'chosen';
  r.chosenOfferId = o.id;
  r.bookingId = b.id;
  o.status = 'chosen';
  notify(venue.ownerId, `${user.fullName} đã chọn báo giá ${o.price.toLocaleString('vi-VN')}đ của bạn: ${court.name} ${shortTs(b.startAt)} (mã ${b.code}).`, { bookingId: b.id, link: `/owner-bookings.html?id=${b.id}` });
  for (const other of S.offers.filter((x) => x.requestId === r.id && x.status === 'open')) {
    endOffer(other, 'lost', 'Đội đã chọn báo giá khác');
    notify(courtOf(other.courtId)[0].ownerId, `Khách đã chọn sân khác cho tin nhờ báo giá ${reqLabel(r)}, báo giá ${other.price.toLocaleString('vi-VN')}đ của bạn đã đóng.`, { link: '/owner-requests.html' });
  }
  save();
  return toBooking(b);
}

function ownerRequests(user) {
  const mine = S.venues.filter((v) => v.ownerId === user.id);
  return S.requests
    .filter((r) => mine.some((v) => venueFits(v, r)) && (r.status === 'open' || S.offers.some((o) => o.requestId === r.id && mine.some((v) => v.id === courtOf(o.courtId)[0].id))))
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.closesAt.localeCompare(b.closesAt))
    .map((r) => toRequest(r, user));
}

function sendOffer(ctx) {
  const user = need(ctx, 'owner');
  const r = requestOf(ctx.params.id);
  if (!r) fail(404, 'Không tìm thấy tin này');
  const { courtId, start, price, validUntil, note = '' } = ctx.body || {};
  const [venue, court] = courtOf(courtId);
  if (!venue || !court) fail(404, 'Không tìm thấy sân');
  if (venue.ownerId !== user.id) fail(403, 'Sân này không thuộc tài khoản của bạn');
  if (!venueFits(venue, r) || court.fieldType !== r.fieldType || !court.isActive) fail(403, 'Tin này không phù hợp với sân của bạn');
  if (r.status !== 'open') fail(409, 'Tin này đã kết thúc');
  req(slotsInWindow(venue, r).includes(start), 'Giờ chào phải nằm trọn trong khung giờ khách chọn');
  const slot = slotInfo(court, venue, r.date, start, null);
  if (teamModeAt(court, start)) fail(409, 'Giờ này chỉ nhận ghép kèo, không báo giá riêng được');
  if (slot.status !== 'available') fail(409, 'Giờ này không còn trống');
  const p = num(price);
  req(Number.isInteger(p) && p >= 1000 && p % 1000 === 0, 'Giá báo là số tròn nghìn đồng');
  req(p <= slot.basePrice, `Giá báo không được cao hơn giá thường của giờ (${slot.basePrice.toLocaleString('vi-VN')}đ)`);
  const until = vnToMs(validUntil || '');
  req(Number.isFinite(until) && until >= nowMs() + meta().offerMinMinutes * 60000 && until <= vnToMs(r.closesAt), `Hiệu lực báo giá từ ${meta().offerMinMinutes} phút sau bây giờ đến hết hạn nhận báo giá (${timeOf(r.closesAt)})`);
  const open = S.offers.filter((o) => o.requestId === r.id && o.status === 'open');
  if (open.some((o) => courtOf(o.courtId)[0].id === venue.id)) fail(409, 'Sân của bạn đã có báo giá đang mở cho tin nhờ báo giá này. Hãy rút báo giá cũ rồi báo lại');
  if (open.length >= meta().requestMaxOffers) fail(409, `Tin này đã đủ ${meta().requestMaxOffers} báo giá`);
  const o = { id: nextId('offer'), requestId: r.id, courtId: court.id, startAt: `${r.date} ${start}:00`, endAt: `${r.date} ${slot.end}:00`, price: p, listedPrice: slot.basePrice, validUntil, note: String(note).slice(0, 200), status: 'open', endReason: null, createdAt: now() };
  S.offers.push(o);
  notify(r.userId, `${venue.name} báo giá ${p.toLocaleString('vi-VN')}đ cho ${court.name} ${start}–${slot.end}${p > r.budget ? ' (cao hơn mức bạn muốn)' : ''}. Xem và chọn trước ${timeOf(validUntil)}.`, { link: `/request.html?id=${r.id}` });
  save();
  return toOffer(o, user, r);
}

function withdrawOffer(ctx) {
  const user = need(ctx, 'owner');
  const o = offerOf(ctx.params.id);
  if (!o) fail(404, 'Không tìm thấy báo giá');
  const [venue, court] = courtOf(o.courtId);
  if (venue.ownerId !== user.id) fail(403, 'Báo giá này không thuộc sân của bạn');
  if (o.status !== 'open') fail(409, 'Báo giá này đã kết thúc');
  endOffer(o, 'withdrawn', 'Sân đã rút báo giá');
  const r = requestOf(o.requestId);
  notify(r.userId, `${venue.name} đã rút báo giá ${court.name} ${shortTs(o.startAt)}.`, { link: `/request.html?id=${r.id}` });
  save();
  return toOffer(o, user, r);
}

/** Dữ liệu demo: tin nhờ báo giá mở, tin nhờ báo giá có báo giá, tin nhờ báo giá đã chốt thành booking (chọn giờ trống thật lúc dựng). */
function seedRequests(st, ago) {
  const today = dateOf(now());
  const taken = (courtId, startAt) => st.bookings.some((b) => b.courtId === courtId && b.startAt === startAt && ['pending', 'confirmed', 'matching'].includes(b.status));
  const blocked = (courtId, date, s, e) => st.blocks.some((k) => k.courtId === courtId && k.date === date && k.start < e && k.end > s);
  for (const spec of seeds.requests.requests) {
    const date = addDays(today, spec.day);
    const created = ago(spec.minAgo);
    const startMs = vnToMs(`${date} ${spec.from}`);
    const r = { id: nextId('request'), userId: spec.userId, district: spec.district, date, from: spec.from, to: spec.to, fieldType: spec.fieldType, budget: spec.budget, note: spec.note || '', status: 'open', closesAt: msToVn(startMs - meta().requestCloseMinutes * 60000), createdAt: created, chosenOfferId: null, bookingId: null, endReason: null };
    st.requests.push(r);
    const fitters = st.venues.filter((v) => venueFits(v, r));
    for (const id of new Set(fitters.map((v) => v.ownerId))) {
      st.notifications.push({ id: nextId('notification'), userId: id, bookingId: null, message: `Tin nhờ báo giá mới: ${reqLabel(r)}, mức giá bạn muốn ${spec.budget.toLocaleString('vi-VN')}đ.`, link: '/owner-requests.html', isRead: !!spec.offers?.length, createdAt: created });
    }
    for (const of of spec.offers || []) {
      const venue = st.venues.find((v) => v.id === of.venueId);
      let picked = null;
      for (const c of venue.courts.filter((x) => x.isActive && x.fieldType === r.fieldType && !x.teamMode?.enabled)) {
        for (const s of slotsInWindow(venue, r)) {
          const startAt = `${date} ${s}:00`;
          const e = slotEnd(venue, s);
          if (!picked && !taken(c.id, startAt) && !blocked(c.id, date, s, e) && !teamModeAt(c, s)) picked = { c, s, e, startAt };
        }
      }
      if (!picked) continue;
      const listed = isPeak(venue, picked.s) ? picked.c.peakPrice : picked.c.price;
      const o = { id: nextId('offer'), requestId: r.id, courtId: picked.c.id, startAt: picked.startAt, endAt: `${date} ${picked.e}:00`, price: Math.min(of.price, listed), listedPrice: listed, validUntil: r.closesAt, note: of.note || '', status: 'open', endReason: null, createdAt: ago(of.minAgo) };
      st.offers.push(o);
      st.notifications.push({ id: nextId('notification'), userId: spec.userId, bookingId: null, message: `${venue.name} báo giá ${o.price.toLocaleString('vi-VN')}đ cho ${picked.c.name} ${picked.s}–${picked.e}.`, link: `/request.html?id=${r.id}`, isRead: spec.state === 'chosen', createdAt: o.createdAt });
      if (spec.state === 'chosen' && of.chosen) {
        const b = { id: nextId('booking'), code: '', userId: spec.userId, venueId: venue.id, courtId: picked.c.id, startAt: o.startAt, endAt: o.endAt, status: venue.requiresApproval ? 'pending' : 'confirmed', expiresAt: venue.requiresApproval ? msToVn(Date.now() + meta().holdMinutes * 60000) : null, price: o.price, basePrice: listed, discountPercent: 0, offerId: o.id, paymentStatus: 'unpaid', refundStatus: 'none', refundPercent: 0, refundAmount: 0, cancelledBy: null, cancelReason: null, lateCancel: false, customerNote: '', rulesSnapshot: venue.rules, policySnapshot: venue.cancelPolicy, idempotencyKey: null, createdAt: ago(spec.minAgo - 20), cancelledAt: null };
        b.code = bookingCode(b.id);
        st.bookings.push(b);
        o.status = 'chosen';
        r.status = 'chosen';
        r.chosenOfferId = o.id;
        r.bookingId = b.id;
        addLog(b, 'create', null, b.status, userOf(spec.userId), '', b.createdAt);
        addLog(b, 'offer_accept', null, b.status, userOf(spec.userId), `Báo giá #${o.id} của sân: ${o.price.toLocaleString('vi-VN')}đ (giá thường ${listed.toLocaleString('vi-VN')}đ)`, b.createdAt);
      }
    }
    if (r.status === 'chosen') for (const o of st.offers.filter((x) => x.requestId === r.id && x.status === 'open')) endOffer(o, 'lost', 'Đội đã chọn báo giá khác');
  }
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
route('POST', '/api/matches', openMatch);
route('GET', '/api/matches', (c) => {
  const p = c.query;
  return S.matches
    .filter((m) => joinable(m))
    .filter((m) => {
      const b = matchBooking(m);
      const v = courtOf(b.courtId)[0];
      return (!p.venueId || v.id === Number(p.venueId)) && (!p.date || dateOf(b.startAt) === p.date) && (!p.district || v.district === p.district);
    })
    .sort((x, y) => matchBooking(x).startAt.localeCompare(matchBooking(y).startAt))
    .map((m) => toMatch(m, c.user));
});
route('GET', '/api/matches/mine', (c) => {
  const u = need(c, 'customer');
  return S.matches.filter((m) => m.hostId === u.id || m.guestId === u.id).sort((x, y) => y.id - x.id).slice(0, LIST_LIMIT).map((m) => toMatch(m, u));
});
route('GET', '/api/matches/:id', (c) => toMatch(findMatch(c.params.id), c.user));
route('POST', '/api/matches/:id/join', joinMatch);
route('DELETE', '/api/matches/:id', withdrawMatch);
route('POST', '/api/matches/:id/result', reportResult);
route('PUT', '/api/matches/:id/bank', setMatchBank);
route('POST', '/api/matches/:id/topup-received', topUpReceived);
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
  if (t.fromUserId !== u.id) fail(404, 'Không tìm thấy sân pass này');
  if (t.status === 'claimed') fail(409, 'Đã có đội nhận, đang chờ chủ sân xác nhận hoặc từ chối');
  if (t.status !== 'open') fail(409, 'Sân pass này không còn mở');
  closeTransfer(t, 'cancelled', u, 'Bạn rút đăng pass');
  save();
  return { ok: true };
});
route('GET', '/api/bookings/reliability', (c) => reliabilityOf(need(c, 'customer').id));
route('GET', '/api/bookings/:id', (c) => {
  const u = need(c);
  const b = findBooking(c.params.id);
  if (!canSee(u, b)) fail(u.role === 'customer' ? 404 : 403, u.role === 'customer' ? 'Không tìm thấy lịch đặt' : 'Lịch đặt này không thuộc quyền xem của bạn');
  return toBookingDetail(b, u);
});
route('POST', '/api/bookings/:id/cancel', (c) => {
  const u = need(c, 'customer');
  const b = findBooking(c.params.id);
  if (b.userId !== u.id) fail(404, 'Không tìm thấy lịch đặt');
  doCancel(b, u, c.body?.reason, 'customer');
  return toBookingDetail(b, u);
});

route('POST', '/api/waitlist', (c) => {
  const u = need(c, 'customer');
  const { courtId, date, start } = c.body || {};
  const [venue, court] = courtOf(courtId);
  if (!venue) fail(404, 'Không tìm thấy sân');
  checkDate(date);
  const slot = slotInfo(court, venue, date, start, u);
  if (!['booked', 'held', 'offered'].includes(slot.status)) fail(400, slot.status === 'available' ? 'Giờ này đang trống, bạn đặt luôn nhé' : 'Chỉ đăng ký chờ được giờ đang có người đặt'); // R9
  if (slot.mine) fail(409, 'Bạn đang giữ giờ này');
  if (slotWaiters(court.id, date, start).some((w) => w.userId === u.id)) fail(409, 'Bạn đã trong hàng chờ của giờ này');
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

route('POST', '/api/requests', openRequest);
route('GET', '/api/requests/mine', (c) => {
  const u = need(c, 'customer');
  return S.requests.filter((r) => r.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).map((r) => toRequest(r, u));
});
route('GET', '/api/requests/:id', (c) => toRequest(ownRequest(c), c.user));
route('DELETE', '/api/requests/:id', cancelRequest);
route('POST', '/api/requests/:id/accept', acceptOffer);

/* Chủ sân */
route('GET', '/api/owner/requests', (c) => ownerRequests(need(c, 'owner')));
route('POST', '/api/owner/requests/:id/offers', sendOffer);
route('DELETE', '/api/owner/offers/:id', withdrawOffer);
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
  req(v.slotMinutes >= 30 && v.slotMinutes <= 180, 'Mỗi lượt đá phải dài từ 30 đến 180 phút');
}
function applyCourt(c, b) {
  if (b.name !== undefined) c.name = String(b.name).trim();
  if (b.fieldType !== undefined) c.fieldType = String(b.fieldType);
  if (b.price !== undefined) c.price = Number(b.price);
  if (b.peakPrice !== undefined) c.peakPrice = Number(b.peakPrice);
  if (b.isActive !== undefined) c.isActive = !!b.isActive;
  if (b.teamMode !== undefined) {
    const t = b.teamMode;
    if (!t) c.teamMode = null;
    else {
      const from = t.from || null;
      const to = t.to || null;
      req((!from || /^\d{2}:\d{2}$/.test(from)) && (!to || /^\d{2}:\d{2}$/.test(to)), 'Khung giờ ghép kèo không hợp lệ');
      req(!from || !to || from < to, 'Giờ bắt đầu khung ghép kèo phải trước giờ kết thúc');
      c.teamMode = { enabled: true, from, to };
    }
  }
  req(c.name, 'Vui lòng nhập tên sân');
  req(['5', '7'].includes(c.fieldType), 'Loại sân là 5 hoặc 7 người');
  req(c.price > 0 && c.peakPrice > 0, 'Giá phải lớn hơn 0');
}

route('GET', '/api/owner/venues', (c) => S.venues.filter((v) => v.ownerId === need(c, 'owner').id).map((v) => toVenueDetail(v, true)));
route('POST', '/api/owner/venues', (c) => {
  const u = need(c, 'owner');
  const v = { id: nextId('venue'), ownerId: u.id, name: '', district: '', address: '', phone: '', imageUrl: null, amenities: [], openTime: '06:00', closeTime: '22:00', slotMinutes: 60, requiresApproval: false, lastMinutePercent: 0, peakStart: null, peakEnd: null, isActive: true, description: '', rules: '', cancelPolicy: 'Hủy trước 24 giờ trả lại 100%, từ 12 đến dưới 24 giờ trả lại 50%, dưới 12 giờ không trả lại.', mapsUrl: '', bank: { bin: '', account: '', accountName: '' }, courts: [] };
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
  if (!k) fail(404, 'Không tìm thấy sân');
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
  if (!court) fail(404, 'Không tìm thấy sân');
  myVenue(c, venue.id);
  checkDate(date);
  req(/^\d{2}:\d{2}$/.test(start || '') && /^\d{2}:\d{2}$/.test(end || '') && start < end, 'Khoảng giờ chặn không hợp lệ');
  const clash = S.bookings.find((b) => b.courtId === court.id && ['pending', 'confirmed', 'matching'].includes(b.status) && dateOf(b.startAt) === date && timeOf(b.startAt) < end && timeOf(b.endAt) > start);
  if (clash) fail(409, `Khoảng giờ này đã có lịch đặt ${clash.code}`);
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
route('GET', '/api/owner/matches', (c) => ownerMatches(need(c, 'owner')));
route('POST', '/api/owner/matches/:id/confirm-part', doConfirmPart);
route('POST', '/api/owner/matches/:id/reject-guest', doRejectGuest);
route('POST', '/api/owner/matches/:id/cancel', doOwnerCancelMatch);
route('POST', '/api/owner/matches/:id/result', ownerSettle);
route('POST', '/api/owner/matches/:id/refund', (c) => {
  const [m, , owner] = ownerMatch(c);
  refundMatchPart(m, owner, c.body?.part, String(c.body?.note || '').slice(0, 300));
  return toMatch(m, owner);
});
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
route('POST', '/api/owner/bookings/:id/refund', ownerAction((b, u, p) => doRefunded(b, u, p.note, p.part)));
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
route('POST', '/api/admin/bookings/:id/refund', adminAction((b, u, p) => doRefunded(b, u, p.note, p.part)));
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
  /** Luồng 3: người đang giữ các giờ mà người dùng hiện tại xếp hàng chờ hủy lịch đặt của họ. */
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
