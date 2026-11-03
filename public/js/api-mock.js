// Backend giả của prototype. CHỈ api.js được import file này (và chỉ khi MODE = 'mock').
// Mô phỏng đúng contract PRD mục 7 và các luật R1–R11 trên dữ liệu trong localStorage; không phải backend thứ hai:
// không phân quyền chi tiết ngoài vai trò/sở hữu, không tối ưu, không xử lý đồng thời.
import { ApiError } from './api.js';
import {
  vnToMs, msToVn, dateOf, timeOf, addDays, hmToMin, minToHm, discountedPrice, refundFor, shortTs, weekdayOf,
} from './ui/format.js';

const STORE_KEY = 'sannhanh.mock.v12';
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
    bankEvents: [], // mọi khoản "ngân hàng báo có tiền" đã nhận (khớp, lệch, trùng), như webhook SePay
    leagues: [], // giải tại một sân (chủ sân tạo)
    leagueTeams: [],
    leagueMatches: [],
    bankQueue: [], // khoản khách bấm "giả lập chuyển khoản", chờ vài giây rồi mới báo về
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
      expiresAt: b.status === 'pending' ? inMin(b.expiresInMin ?? 15) : b.status === 'confirmed' && !b.paid && b.expiresInMin != null ? inMin(b.expiresInMin) : null,
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
  seedPhoneBookings(st);
  seedLeagues(st);
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
          const paid = !pending && rand01(`pay|${key}`) < cfg.paidShare;
          // R3: đơn đã có sân mà chưa trả tiền (sân có VietQR) chỉ đang giữ ô trong hạn chuyển khoản.
          const awaitingPay = !pending && !paid && !!(venue.bank?.bin && venue.bank?.account);
          const slot = slotInfo(court, venue, date, start, null, true);
          const holdLeft = 2 + Math.floor(rand01(`hold|${key}`) * (meta().holdMinutes - 1));
          const createdMin = pending || awaitingPay ? meta().holdMinutes - holdLeft : 40 + Math.floor(rand01(`new|${key}`) * 4000);
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
            expiresAt: pending ? msToVn(t + holdLeft * 60000) : awaitingPay ? msToVn(Math.min(t + holdLeft * 60000, vnToMs(`${date} ${start}:00`))) : null,
            price: slot.basePrice,
            basePrice: slot.basePrice,
            discountPercent: 0,
            paymentStatus: paid ? 'paid' : 'unpaid',
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
// Lịch chủ sân thêm tay (khách gọi điện, nhắn Zalo) không có tài khoản: tên và SĐT nằm trên lịch (walkIn), userId = null.
const customerOf = (b) => (b.walkIn ? { fullName: b.walkIn.name, phone: b.walkIn.phone || '', email: '' } : userOf(b.userId));

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
  if (block?.leagueId) slot.league = { id: block.leagueId, name: S.leagues.find((l) => l.id === block.leagueId)?.name || '' };
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
      const u = customerOf(booking);
      slot.booking = { id: booking.id, code: booking.code, status: booking.status, paymentStatus: booking.paymentStatus, customerName: u.fullName, customerPhone: u.phone, source: booking.walkIn ? 'phone' : 'web' };
    }
    if (block) slot.block = { id: block.id, reason: block.reason, ...(block.leagueId ? { leagueId: block.leagueId } : {}) };
    const waiting = slotWaiters(court.id, date, start).length;
    if (waiting) slot.waitlistCount = waiting;
  }
  return slot;
}

function scheduleOf(venue, date, viewer, detail = false, enforceBookingWindow = false) {
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
        slots: slotGrid(venue).map((s) => {
          const slot = slotInfo(c, venue, date, s, viewer, false, detail);
          const today = dateOf(now());
          if (enforceBookingWindow && slot.status === 'available' &&
              (date < today || date > addDays(today, meta().bookingWindowDays - 1))) {
            slot.status = 'unavailable';
            slot.discountPercent = 0;
            slot.price = slot.basePrice;
            delete slot.teamMode;
          }
          return slot;
        }),
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
    leagues: venueLeagues(v.id),
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
    source: b.walkIn ? 'phone' : 'web',
    paidVia: b.paymentStatus === 'paid' ? b.paidVia || null : null,
  };
  if (admin) {
    const u = customerOf(b);
    out.customerName = u.fullName;
    out.customerPhone = u.phone;
  }
  return out;
}

function reliabilityOf(userId) {
  const m = meta();
  if (userId == null) return { noShows: 0, lateCancels: 0, completed: 0, violations: 0, windowDays: m.reliabilityWindowDays, maxViolations: m.reliabilityMaxViolations, restricted: false };
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
/** R3: hạn chuyển khoản của đơn vừa thành confirmed: payHoldMinutes kể từ bây giờ, không vượt giờ đá; null với lịch điện thoại và sân chưa có VietQR. */
function payByFor(b, venue) {
  if (b.walkIn || !venue.bank?.bin || !venue.bank?.account) return null;
  return msToVn(Math.min(nowMs() + meta().payHoldMinutes * 60000, vnToMs(b.startAt)));
}
function paymentQr(b, venue) {
  if (b.walkIn) return null; // tiền của khách gọi điện nhận ngoài web
  if (b.status !== 'confirmed' || b.paymentStatus !== 'unpaid') return null; // R8
  return qrOf(venue, b.price, b.code);
}

function toBookingDetail(b, viewer) {
  const [venue] = courtOf(b.courtId);
  const customer = customerOf(b);
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
    customerReliability: staff && !b.walkIn ? reliabilityOf(b.userId) : null,
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
  if (userId == null) return; // lịch chủ sân thêm tay: khách không có tài khoản, không có ai để báo
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
    const waitingApproval = b.status === 'pending';
    const waitingPayment = b.status === 'confirmed' && b.paymentStatus === 'unpaid';
    if ((waitingApproval || waitingPayment) && b.expiresAt && vnToMs(b.expiresAt) <= nowMs()) {
      const from = b.status;
      b.status = 'expired';
      addLog(b, 'expire', from, 'expired', null, waitingApproval ? 'Quá hạn giữ chỗ chưa được đồng ý' : 'Quá hạn giữ chỗ chưa chuyển khoản', b.expiresAt);
      if (waitingApproval) {
        notify(b.userId, `Lịch đặt ${b.code} đã quá hạn vì chủ sân chưa kịp đồng ý.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      } else {
        notify(b.userId, `Lịch đặt ${b.code} đã hết hạn giữ chỗ vì chưa nhận được chuyển khoản. Giờ này đã mở lại cho người khác.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
        notify(courtOf(b.courtId)[0].ownerId, `Lịch đặt ${b.code} của ${userOf(b.userId).fullName} đã hết hạn giữ chỗ vì khách chưa chuyển khoản. Giờ này đã mở lại.`, { bookingId: b.id, link: `/owner-bookings.html?id=${b.id}` });
      }
      freeSlot(b);
      changed = true;
    }
  }
  if (tickBank()) changed = true;
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
const userOut = (u) => ({ id: u.id, fullName: u.fullName, email: u.email ?? null, phone: u.phone, role: u.role });

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
    expiresAt: needsApproval ? msToVn(nowMs() + meta().holdMinutes * 60000) : payByFor({ startAt: `${date} ${start}:00` }, venue),
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
    notify(user.id, `${b.expiresAt ? `Đang giữ sân · chuyển khoản trước ${b.expiresAt.slice(11, 16)}` : 'Đã có sân · chưa chuyển khoản'} (mã ${b.code}). Hãy chuyển khoản${b.expiresAt ? ', quá giờ đơn tự hết hạn' : ' theo hướng dẫn của chủ sân'}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  }
  save();
  return b;
}

const PHONE_RE = /^[0-9+().\s-]{6,20}$/;

/** Chủ sân thêm lịch cho khách gọi điện/nhắn Zalo: chiếm giờ như lịch đặt thật, không tài khoản, không thông báo, không tính uy tín. */
function addPhoneBooking(ctx) {
  const owner = need(ctx, 'owner');
  const { courtId, date, start } = ctx.body || {};
  const [venue, court] = courtOf(courtId);
  if (!venue || !court) fail(404, 'Không tìm thấy sân');
  if (venue.ownerId !== owner.id) fail(403, 'Sân này không thuộc tài khoản của bạn');
  if (!court.isActive) fail(409, 'Sân này đang tắt, bạn bật lại ở Cài đặt sân');
  checkDate(date);
  req(slotGrid(venue).includes(start), 'Giờ bắt đầu không khớp lịch của sân');
  const name = String(ctx.body?.customerName || '').trim();
  const phone = String(ctx.body?.customerPhone || '').trim();
  req(name.length >= 1 && name.length <= 80, 'Vui lòng nhập tên khách');
  req(!phone || PHONE_RE.test(phone), 'Số điện thoại chưa đúng');
  const slot = slotInfo(court, venue, date, start, null);
  const price = ctx.body?.price == null || ctx.body.price === '' ? slot.basePrice : Number(ctx.body.price);
  req(Number.isInteger(price) && price >= 0 && price <= 100000000, 'Giá phải là số tiền từ 0đ');
  if (slot.status === 'past') fail(400, 'Giờ này đã qua, không thêm lịch được');
  if (slot.status === 'blocked') fail(409, 'Giờ này đang bị chặn, bạn bỏ chặn trước nhé');
  if (slot.status === 'booked' || slot.status === 'held') fail(409, 'Giờ này đã có lịch đặt');
  if (slot.status === 'offered') fail(409, 'Giờ này đang giữ cho người đã đăng ký chờ, chờ họ đặt hoặc hết hạn rồi thêm lịch');
  if (teamModeAt(court, start)) fail(409, 'Giờ này đang ở chế độ Chỉ nhận ghép kèo. Bạn tắt chế độ này ở Cài đặt sân nếu muốn nhận khách đặt riêng');
  const paid = !!ctx.body?.paid;
  const b = {
    id: nextId('booking'), code: '', userId: null, walkIn: { name, phone }, venueId: venue.id, courtId: court.id,
    startAt: `${date} ${start}:00`, endAt: `${date} ${slot.end}:00`, status: 'confirmed', expiresAt: null,
    price, basePrice: slot.basePrice, discountPercent: 0, offerId: null, paymentStatus: paid ? 'paid' : 'unpaid',
    refundStatus: 'none', refundPercent: 0, refundAmount: 0, cancelledBy: null, cancelReason: null, lateCancel: false,
    customerNote: String(ctx.body?.note || '').slice(0, 300), rulesSnapshot: venue.rules, policySnapshot: venue.cancelPolicy,
    idempotencyKey: null, createdAt: now(), cancelledAt: null,
  };
  b.code = bookingCode(b.id);
  S.bookings.push(b);
  addLog(b, 'phone_create', null, 'confirmed', owner, `Đặt qua điện thoại cho ${name}${phone ? ` (${phone})` : ''}, giá ${vnd(price)}, ${paid ? 'đã nhận tiền' : 'chưa nhận tiền'}`);
  save();
  return toBooking(b, { admin: true });
}

/** Sửa thông tin lịch thêm tay. Giờ và sân không sửa được: hủy rồi thêm lại để giờ cũ trống ngay và kiểm trùng lại từ đầu. */
function updatePhoneBooking(ctx) {
  const owner = need(ctx, 'owner');
  const b = findBooking(ctx.params.id);
  if (courtOf(b.courtId)[0].ownerId !== owner.id) fail(403, 'Lịch đặt này không thuộc sân của bạn');
  if (!b.walkIn) fail(409, 'Chỉ sửa được lịch đặt qua điện thoại');
  if (b.status !== 'confirmed') fail(409, 'Lịch đặt này không sửa được nữa');
  const body = ctx.body || {};
  const name = body.customerName === undefined ? b.walkIn.name : String(body.customerName).trim();
  const phone = body.customerPhone === undefined ? b.walkIn.phone : String(body.customerPhone).trim();
  req(name.length >= 1 && name.length <= 80, 'Vui lòng nhập tên khách');
  req(!phone || PHONE_RE.test(phone), 'Số điện thoại chưa đúng');
  if (body.price !== undefined && Number(body.price) !== b.price) {
    const price = Number(body.price);
    req(Number.isInteger(price) && price >= 0 && price <= 100000000, 'Giá phải là số tiền từ 0đ');
    if (b.paymentStatus === 'paid') fail(409, 'Đã nhận tiền rồi nên không đổi giá nữa');
    b.price = price;
  }
  b.walkIn = { name, phone };
  if (body.note !== undefined) b.customerNote = String(body.note).slice(0, 300);
  addLog(b, 'phone_update', null, null, owner, `Sửa thông tin lịch qua điện thoại, giá ${vnd(b.price)}`);
  save();
  return toBooking(b, { admin: true });
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
  if (b.walkIn) Object.assign(r, { percent: 0, amount: 0 }); // tiền cọc/thanh toán của khách gọi điện xử lý ngoài web, không ghi trả lại
  b.status = 'cancelled';
  b.cancelledBy = by;
  b.cancelReason = String(reason || '').slice(0, 300) || null;
  b.cancelledAt = now();
  b.expiresAt = null;
  b.refundPercent = r.percent;
  b.refundAmount = r.amount;
  b.refundStatus = r.amount > 0 ? 'pending' : 'none';
  b.lateCancel = !b.walkIn && by === 'customer' && from === 'confirmed' && r.hoursLeft < 12;
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
  b.expiresAt = payByFor(b, courtOf(b.courtId)[0]); // hạn chuyển khoản tính từ lúc duyệt (R3)
  addLog(b, 'approve', 'pending', 'confirmed', actor);
  notify(b.userId, `Chủ sân đã đồng ý lịch đặt ${b.code}. ${b.expiresAt ? `Đang giữ sân · chuyển khoản trước ${b.expiresAt.slice(11, 16)}, quá giờ đơn tự hết hạn.` : 'Đã có sân · chưa chuyển khoản.'}`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
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
function doPaid(b, actor, note, via = 'owner') {
  if (b.status === 'expired' && b.paymentStatus === 'unpaid' && !matchOfBooking(b)) fail(409, 'Lịch đặt đã hết hạn giữ chỗ nên không ghi nhận tiền được. Nếu khách đã chuyển khoản, hãy chuyển lại cho khách');
  if (b.status !== 'confirmed' && b.status !== 'completed') fail(409, 'Chỉ ghi nhận được cho lịch đặt đã có sân');
  if (b.paymentStatus === 'paid') fail(409, 'Lịch đặt đã được ghi nhận chuyển khoản');
  b.paymentStatus = 'paid';
  b.expiresAt = null;
  b.paidVia = via;
  addLog(b, via === 'bank' ? 'bank_paid' : 'paid', null, null, actor, note || '');
  notify(b.userId, via === 'bank' ? `Ngân hàng báo đã nhận tiền của lịch đặt ${b.code} (mô phỏng). Đơn của bạn đã ghi nhận chuyển khoản.` : `Chủ sân đã nhận tiền của lịch đặt ${b.code}.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
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
      const c = customerOf(b);
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
    paidVia: owner?.role === 'bank' ? 'bank' : 'owner',
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
  addLog(nb, 'create', null, 'confirmed', userOf(nb.userId), owner?.role === 'bank' ? 'Nhận pass từ lịch đặt cũ, ngân hàng báo đã nhận tiền' : 'Nhận pass từ lịch đặt cũ, chủ sân đã xác nhận nhận tiền');
  if (!silent) {
    notify(a.userId, `Sân ${a.code} đã sang đội khác. Chủ sân sẽ chuyển lại ${vnd(a.refundAmount)} cho bạn và ghi nhận khi xong.`, { bookingId: a.id, link: `/booking.html?id=${a.id}` });
    notify(nb.userId, `Bạn đã nhận pass thành công (mã ${nb.code}): ${courtOf(nb.courtId)[1].name} ${slotLabel(nb)} tại ${venue.name}. ${nb.paidVia === 'bank' ? `Ngân hàng báo đã nhận ${vnd(t.askPrice)} (mô phỏng)` : `Chủ sân đã nhận ${vnd(t.askPrice)}`}.`, { bookingId: nb.id, link: `/booking.html?id=${nb.id}` });
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
  confirmPart(m, b, owner, part, String(ctx.body?.note || '').slice(0, 300));
  return toMatch(m, owner);
}
// Ghi nhận đã nhận phần tiền của một đội: chủ sân bấm tay hoặc ngân hàng báo về (actor = hệ thống).
function confirmPart(m, b, owner, part, note) {
  if (part === 'host') {
    if (m.hostPaidAt) fail(409, 'Đã nhận tiền của đội mở kèo');
    if (!hostPending(m)) fail(409, 'Đội mở kèo đã hết thời gian giữ chỗ hoặc kèo đã kết thúc');
    m.hostPaidAt = now();
    addLog(b, 'match_part_paid', null, null, owner, `Đã nhận phần đội mở kèo ${vnd(m.hostAmount)}${note ? `. ${note}` : ''}`);
    notify(m.hostId, `${owner?.role === 'bank' ? 'Ngân hàng báo đã nhận' : 'Chủ sân đã nhận'} ${vnd(m.hostAmount)} của bạn. Kèo ${slotLabel(b)} đang tìm đội đá cùng đến ${shortTs(m.closesAt)}; sân vẫn được giữ cho bạn.`, { link: `/match.html?id=${m.id}` });
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
    b.paidVia = owner?.role === 'bank' ? 'bank' : 'owner';
    addLog(b, 'match_confirm', from, 'confirmed', owner, 'Đủ hai phần tiền, chốt sân');
    const [venue, court] = courtOf(b.courtId);
    for (const uid of [m.hostId, m.guestId]) notify(uid, `Kèo ${court.name} ${slotLabel(b)} tại ${venue.name} đã chốt: ${owner?.role === 'bank' ? 'ngân hàng báo đã nhận đủ tiền của hai đội (mô phỏng)' : 'chủ sân nhận đủ tiền của hai đội'}.`, { link: `/match.html?id=${m.id}` });
  }
  save();
}
/* ---------- Ngân hàng báo có tiền (mô phỏng SePay) ----------
 * Bản thật: khách chuyển thẳng vào tài khoản chủ sân, SePay gọi webhook về server, server khớp mã đơn + số tiền rồi tự ghi nhận.
 * Bản này chỉ giả lập: một hàm duy nhất `bankReport` nhận dữ liệu giống webhook; cả đồng hồ chờ, nút của khách và nút Demo đều gọi nó,
 * nên luật khớp mã / số tiền chỉ nằm ở đây. Code chỉ đọc mã đơn có cấu trúc và so số tiền, không hiểu ý lời nhắn. */
const BANK_ACTOR = { fullName: 'Ngân hàng báo (mô phỏng)', role: 'bank' };
const BANK_DELAY_MS = 4000; // thời gian thật (không tính đồng hồ tua) từ lúc khách bấm giả lập đến lúc "ngân hàng báo"
// Mã tìm ở bất kỳ đâu trong nội dung (ngân hàng hay dán chữ vào trước mã: KEOSN01238, MBVCB.123.SN01238). Bên trái không cần ranh giới;
// bên phải phải có ranh giới vì mã có đúng 5 chữ số (SN012381 không khớp). Dạng dài nhất thắng: TD…A/B, NH…, SN… trơn.
const BANK_CODE_RE = /(TD|NH)?(SN\d{5})([AB])?(?![A-Z0-9])/gi;
const BANK_REASONS = {
  no_code: 'Nội dung chuyển khoản không có mã đơn hợp lệ',
  multiple_codes: 'Nội dung chuyển khoản có hơn một mã đơn khác nhau',
  unknown_order: 'Không có đơn nào mang mã này ở sân của bạn',
  not_approved: 'Đơn chưa được chủ sân đồng ý nên chưa nhận tiền tự động',
  not_payable: 'Đơn không còn chờ tiền (đã trả, đã hủy hoặc hết hạn)',
  wrong_account: 'Tiền vào tài khoản của sân khác, nội dung lại mang mã đơn của sân này',
  no_account: 'Báo cáo của ngân hàng không có số tài khoản nhận',
  short: 'Số tiền ít hơn số cần chuyển',
  over: 'Số tiền nhiều hơn số cần chuyển',
};

function parseBankCode(content) {
  const found = new Map();
  for (const m of String(content || '').matchAll(BANK_CODE_RE)) {
    const prefix = (m[1] || '').toUpperCase();
    const code = m[2].toUpperCase();
    const part = (m[3] || '').toUpperCase();
    let c = null;
    if (prefix === 'TD' && part) c = { kind: 'match', code, part: part === 'A' ? 'host' : 'guest' };
    else if (prefix === 'NH' && !part) c = { kind: 'transfer', code };
    else if (!prefix && !part) c = { kind: 'booking', code };
    if (c) found.set(`${c.kind}|${c.code}|${c.part || ''}`, c);
  }
  if (!found.size) return null;
  if (found.size > 1) return { ambiguous: true };
  return [...found.values()][0];
}

const AFTER_HOLD_TEXT = 'Khách chuyển sau khi đơn đã hết hạn giữ chỗ';
/** Đơn đã hết hạn vì chưa chuyển khoản (nhật ký `expire` từ confirmed), để đổi lời giải thích của not_payable (R17c). */
const heldExpired = (b) => S.logs.some((l) => l.bookingId === b.id && l.action === 'expire' && l.fromStatus === 'confirmed');
const reasonText = (reason, b) => (reason === 'not_payable' && b && heldExpired(b) ? AFTER_HOLD_TEXT : BANK_REASONS[reason]);

/** Đơn/khoản đang chờ tiền ứng với mã, hoặc lý do không khớp. */
function bankTarget(p) {
  const b = S.bookings.find((x) => x.code === p.code);
  if (!b) return { reason: 'unknown_order' };
  if (p.kind === 'booking') {
    if (b.walkIn) return { b, reason: 'not_payable' };
    if (b.status === 'pending') return { b, reason: 'not_approved' };
    if (b.status === 'expired' && b.paymentStatus === 'unpaid' && heldExpired(b)) return { b, reason: 'not_payable', afterHold: true };
    if (b.status !== 'confirmed' || b.paymentStatus !== 'unpaid') return { b, reason: 'not_payable' };
    return { b, due: b.price, apply: (note) => doPaid(b, BANK_ACTOR, note, 'bank') };
  }
  if (p.kind === 'transfer') {
    const t = S.transfers.find((x) => x.bookingId === b.id && x.status === 'claimed' && vnToMs(x.claimExpiresAt) > nowMs());
    if (!t) return { b, reason: 'not_payable' };
    return { b, due: t.askPrice, apply: (note) => { finishTransfer(t, BANK_ACTOR, note); } };
  }
  const m = matchOfBooking(b);
  const due = m && (p.part === 'host' ? hostPending(m) : guestPending(m));
  if (!due) return { b, reason: 'not_payable' };
  return { b, due: partAmount(m, p.part), apply: (note) => confirmPart(m, b, BANK_ACTOR, p.part, note) };
}

/** Dữ liệu giống webhook: { txId, content, amount, account }. Cùng txId gọi lại thì không ghi thêm gì. */
function bankReport(d) {
  const txId = String(d.txId || '').trim();
  req(txId, 'Thiếu mã giao dịch');
  const old = S.bankEvents.find((e) => e.txId === txId);
  if (old) return { ...old, duplicate: true };
  const amount = Math.round(Number(d.amount));
  req(amount > 0, 'Số tiền không hợp lệ');
  const content = String(d.content || '').slice(0, 200);
  const parsed = parseBankCode(content);
  const account = String(d.account || '').trim();
  const target = parsed?.ambiguous ? { reason: 'multiple_codes' } : parsed ? bankTarget(parsed) : { reason: 'no_code' };
  // Mỗi báo cáo gắn với một tài khoản nhận: tìm sân theo tài khoản trước, đơn chỉ được tự nhận khi thuộc đúng tài khoản đó.
  const accountVenue = account ? S.venues.find((v) => v.bank?.account === account) || null : null;
  const orderVenue = target.b ? courtOf(target.b.courtId)[0] : null;
  if (target.b && !target.reason) {
    if (!account) target.reason = 'no_account';
    else if (orderVenue.bank?.account !== account) target.reason = 'wrong_account';
  }
  const venue = (target.reason === 'wrong_account' ? accountVenue : accountVenue || orderVenue) || orderVenue;
  const ev = {
    id: nextId('bankEvent'),
    txId,
    content,
    amount,
    account: account || null,
    venueId: venue?.id ?? null,
    ownerId: venue?.ownerId ?? null,
    bookingId: target.b?.id ?? null,
    bookingCode: target.b?.code ?? parsed?.code ?? null,
    expected: target.due ?? null,
    status: 'matched',
    reason: null,
    handledBy: null,
    handledAt: null,
    receivedAt: now(),
  };
  let reason = target.reason || null;
  if (!reason && amount !== target.due) reason = amount < target.due ? 'short' : 'over';
  S.bankEvents.push(ev);
  if (!reason) {
    target.apply(`Ngân hàng báo đã nhận ${vnd(amount)}, nội dung "${content}", mã giao dịch ${txId} (mô phỏng SePay)`);
    if (ev.ownerId != null) notify(ev.ownerId, `Ngân hàng báo đã nhận ${vnd(amount)} cho đơn ${ev.bookingCode}. Hệ thống đã tự ghi nhận "Đã nhận tiền" (mô phỏng).`, { bookingId: ev.bookingId, link: '/owner-bookings.html' });
  } else {
    ev.status = 'unmatched';
    ev.reason = reason;
    const b = target.b;
    if (b && reason !== 'wrong_account') addLog(b, 'bank_unmatched', null, null, BANK_ACTOR, `Ngân hàng báo ${vnd(amount)}, nội dung "${content}" nhưng chưa tự ghi nhận: ${reasonText(reason, b)}${target.due ? ` (cần ${vnd(target.due)})` : ''} (mô phỏng SePay)`);
    if (ev.ownerId != null) notify(ev.ownerId, `Ngân hàng báo ${vnd(amount)}, nội dung "${content}" nhưng chưa tự ghi nhận được: ${reasonText(reason, b).toLowerCase()}. Cần bạn xem và xử lý.`, { bookingId: b?.id ?? null, link: '/owner.html' });
    if (b?.userId != null && ['short', 'over'].includes(reason)) notify(b.userId, `Ngân hàng báo đã nhận ${vnd(amount)} cho ${b.code}, chưa khớp số cần chuyển (${vnd(target.due)}). Chủ sân sẽ xem và liên hệ bạn.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
  }
  save();
  return { ...ev, reasonText: ev.reason ? reasonText(ev.reason, target.b) : null, duplicate: false };
}

/** Chạy các khoản giả lập đã đến hạn (hoặc tất cả khi force). */
function tickBank(force = false) {
  let changed = false;
  const due = S.bankQueue.filter((q) => force || q.dueAtReal <= Date.now());
  for (const q of due) {
    S.bankQueue.splice(S.bankQueue.indexOf(q), 1);
    try {
      bankReport(q);
    } catch {
      /* khoản hỏng thì bỏ */
    }
    changed = true;
  }
  return changed;
}

function ownerBankEvents(user) {
  return S.bankEvents
    .filter((e) => e.ownerId === user.id)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id - a.id)
    .map((e) => ({ ...e, reasonText: e.reason ? reasonText(e.reason, S.bookings.find((x) => x.id === e.bookingId)) : null }));
}
function resolveBankEvent(ctx) {
  const user = need(ctx, 'owner');
  const e = S.bankEvents.find((x) => x.id === Number(ctx.params.id));
  if (!e || e.ownerId !== user.id) fail(404, 'Không tìm thấy khoản tiền này');
  if (e.status !== 'unmatched') fail(409, 'Khoản tiền này không cần xử lý');
  e.status = 'resolved';
  e.handledBy = user.fullName;
  e.handledAt = now();
  const note = String(ctx.body?.note || '').slice(0, 300);
  const b = e.bookingId ? S.bookings.find((x) => x.id === e.bookingId) : null;
  if (b) addLog(b, 'bank_resolved', null, null, user, `Đã xử lý khoản ${vnd(e.amount)} ngân hàng báo (${reasonText(e.reason, b).toLowerCase()})${note ? `. ${note}` : ''}`);
  save();
  return { ...e, reasonText: reasonText(e.reason, b) };
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

/**
 * Lịch điện thoại mẫu luôn có mặt, giờ nào mở demo cũng vậy. Giờ ghi trong mẫu là giờ ưu tiên; nếu ô đó đã qua, đang có lịch/chặn hoặc là giờ chỉ ghép kèo
 * thì lấy ô trống chưa bắt đầu gần giờ ưu tiên nhất (cùng cụm sân, trong ngày của mẫu); hết ô thì sang ngày kế tiếp. Chọn theo dữ liệu đã dựng nên kết quả tất định.
 */
function freePhoneSlot(st, spec) {
  const [venue] = courtOf(spec.courtId);
  const free = (court, date, start) => {
    const startAt = `${date} ${start}:00`;
    return vnToMs(startAt) > nowMs()
      && !teamModeAt(court, start)
      && !st.bookings.some((x) => x.courtId === court.id && x.startAt === startAt && ['pending', 'confirmed', 'matching'].includes(x.status))
      && !st.blocks.some((k) => k.courtId === court.id && k.date === date && k.start < slotEnd(venue, start) && k.end > start);
  };
  const grid = slotGrid(venue);
  const want = hmToMin(spec.start);
  const courts = [venue.courts.find((c) => c.id === spec.courtId), ...venue.courts.filter((c) => c.id !== spec.courtId)].filter((c) => c?.isActive);
  for (let d = spec.day; d <= spec.day + 1; d++) {
    const date = addDays(dateOf(now()), d);
    const cands = [];
    for (const [ci, court] of courts.entries()) for (const start of grid) if (free(court, date, start)) cands.push({ court, date, start, key: [Math.abs(hmToMin(start) - want), ci, start] });
    cands.sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1] || x.key[2].localeCompare(y.key[2]));
    if (cands.length) return cands[0];
  }
  return null;
}

function seedPhoneBookings(st) {
  for (const base of seeds.bookings.phoneBookings || []) {
    const [venue] = courtOf(base.courtId);
    const pick = freePhoneSlot(st, base);
    if (!pick) continue;
    const { court, date } = pick;
    const startAt = `${date} ${pick.start}:00`;
    const spec = { ...base, start: pick.start };
    const slot = slotInfo(court, venue, date, spec.start, null, true);
    const b = {
      id: nextId('booking'), code: '', userId: null, walkIn: { name: spec.name, phone: spec.phone || '' }, venueId: venue.id, courtId: court.id,
      startAt, endAt: `${date} ${slot.end}:00`, status: 'confirmed', expiresAt: null, price: spec.price ?? slot.basePrice, basePrice: slot.basePrice, discountPercent: 0, offerId: null,
      paymentStatus: spec.paid ? 'paid' : 'unpaid', refundStatus: 'none', refundPercent: 0, refundAmount: 0, cancelledBy: null, cancelReason: null, lateCancel: false,
      customerNote: spec.note || '', rulesSnapshot: venue.rules, policySnapshot: venue.cancelPolicy, idempotencyKey: null, createdAt: msToVn(nowMs() - 3 * 3600000), cancelledAt: null,
    };
    b.code = bookingCode(b.id);
    st.bookings.push(b);
    addLog(b, 'phone_create', null, 'confirmed', userOf(venue.ownerId), `Đặt qua điện thoại cho ${spec.name}${spec.phone ? ` (${spec.phone})` : ''}, giá ${vnd(b.price)}, ${spec.paid ? 'đã nhận tiền' : 'chưa nhận tiền'}`, b.createdAt);
  }
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
        const b = { id: nextId('booking'), code: '', userId: spec.userId, venueId: venue.id, courtId: picked.c.id, startAt: o.startAt, endAt: o.endAt, status: venue.requiresApproval ? 'pending' : 'confirmed', expiresAt: venue.requiresApproval ? msToVn(Date.now() + meta().holdMinutes * 60000) : venue.bank?.bin && venue.bank?.account ? msToVn(Math.min(Date.now() + 8 * 60000, vnToMs(o.startAt))) : null, price: o.price, basePrice: listed, discountPercent: 0, offerId: o.id, paymentStatus: 'unpaid', refundStatus: 'none', refundPercent: 0, refundAmount: 0, cancelledBy: null, cancelReason: null, lateCancel: false, customerNote: '', rulesSnapshot: venue.rules, policySnapshot: venue.cancelPolicy, idempotencyKey: null, createdAt: ago(spec.minAgo - 20), cancelledAt: null };
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
  return scheduleOf(v, checkDate(c.query.date), c.user, false, true);
});

const normalizeAuthPhone = (value) => {
  let phone = String(value || '').trim().replace(/[\s.]/g, '');
  if (/^\+84\d{9}$/.test(phone)) phone = `0${phone.slice(3)}`;
  else if (/^84\d{9}$/.test(phone)) phone = `0${phone.slice(2)}`;
  req(/^0\d{9}$/.test(phone), 'Số điện thoại phải là số Việt Nam gồm 10 chữ số, bắt đầu bằng 0 hoặc +84');
  return phone;
};
const storedAuthPhone = (value) => {
  try { return normalizeAuthPhone(value); } catch { return null; }
};
route('GET', '/api/auth/csrf', () => ({ csrfToken: S.csrf }));
route('GET', '/api/auth/me', (c) => ({ user: c.user ? userOut(c.user) : null }));
route('POST', '/api/auth/register', (c) => {
  const { fullName = '', email: rawEmail = '', phone: rawPhone = '', password = '' } = c.body || {};
  const email = String(rawEmail ?? '').trim().toLowerCase() || null;
  const phone = normalizeAuthPhone(rawPhone);
  req(String(fullName).trim().length >= 2, 'Vui lòng nhập họ tên');
  req(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Email không hợp lệ');
  req(String(password).length >= 8, 'Mật khẩu cần ít nhất 8 ký tự');
  if (email && S.users.some((u) => u.email?.toLowerCase() === email)) fail(409, 'Email này đã được đăng ký');
  if (S.users.some((u) => storedAuthPhone(u.phone) === phone)) fail(409, 'Số điện thoại này đã được đăng ký');
  const u = { id: nextId('user'), fullName: String(fullName).trim(), email, phone, role: 'customer', isActive: true, password, createdAt: now() };
  S.users.push(u);
  S.sessionUserId = u.id;
  save();
  return { user: userOut(u) };
});
route('POST', '/api/auth/login', (c) => {
  const identifier = String(c.body?.identifier ?? c.body?.email ?? '').trim();
  const password = String(c.body?.password || '');
  req(identifier && password, 'Vui lòng nhập số điện thoại hoặc email và mật khẩu');
  let u;
  if (identifier.includes('@')) {
    u = S.users.find((x) => x.email?.toLowerCase() === identifier.toLowerCase() && x.password === password);
  } else {
    const phone = normalizeAuthPhone(identifier);
    const matches = S.users.filter((x) => storedAuthPhone(x.phone) === phone);
    if (matches.length > 1) fail(409, 'Số điện thoại này đang gắn với nhiều tài khoản; hãy đăng nhập bằng email');
    u = matches[0]?.password === password ? matches[0] : null;
  }
  if (!u) fail(401, 'Số điện thoại/email hoặc mật khẩu không đúng');
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
  if (k.leagueId) fail(409, `Giờ này đang giữ cho giải "${S.leagues.find((l) => l.id === k.leagueId)?.name || ''}". Hoãn trận hoặc xóa giải ở mục Giải đấu để trả giờ.`);
  S.blocks.splice(S.blocks.indexOf(k), 1);
  const [venue] = courtOf(k.courtId);
  for (const s of slotGrid(venue)) if (s >= k.start && s < k.end) offerSlot(k.courtId, k.date, s);
  save();
  return { ok: true };
});
route('GET', '/api/owner/bookings', (c) => listBookings(need(c, 'owner'), c.query));
route('POST', '/api/owner/bookings', addPhoneBooking);
route('PUT', '/api/owner/bookings/:id', updatePhoneBooking);
route('GET', '/api/owner/bank-events', (c) => ownerBankEvents(need(c, 'owner')));
route('POST', '/api/owner/bank-events/:id/resolve', resolveBankEvent);
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

/* ---------- Giải đấu tại một sân (vòng tròn một lượt) ----------
 * Giờ đá của giải được giữ bằng "chặn giờ" có gắn mã giải (block.leagueId), nên lưới khách và lưới chủ sân, kiểm trùng, người chờ giờ
 * đều dùng lại luồng chặn giờ sẵn có. Tỉ số, rút đội là dữ liệu có cấu trúc; code chỉ cộng điểm, không đọc chữ. */
const LEAGUE_WIN = 3;
const LEAGUE_DRAW = 1;
const LEAGUE_RULES_DEFAULT = [
  '1. Đá vòng tròn một lượt: mỗi đội gặp mọi đội còn lại đúng một trận.',
  '2. Thắng 3 điểm, hòa 1 điểm, thua 0 điểm.',
  '3. Xếp hạng theo điểm, rồi hiệu số (bàn thắng trừ bàn thua), rồi tổng bàn thắng. Nếu vẫn bằng nhau thì xếp theo tên đội A–Z.',
  '4. Tỉ số do chủ sân nhập. Sửa tỉ số phải ghi lý do và được lưu lại.',
  '5. Đội rút giữa giải: kết quả đã đá giữ nguyên, các trận còn lại của đội đó bị xử thua 0-3, giờ sân các trận này được trả lại. Bảng xếp hạng ghi "Đã rút".',
  '6. Hoãn trận do chủ sân đổi giờ; mọi đội xem giờ mới trên trang giải.',
  '7. Lệ phí do chủ sân thu ngoài web (tiền mặt hoặc chuyển khoản riêng), web chỉ ghi đội đã nộp hay chưa.',
].join('\n');

const leagueOf = (id) => S.leagues.find((l) => l.id === Number(id));
const teamsOf = (l) => S.leagueTeams.filter((t) => t.leagueId === l.id).sort((a, b) => a.id - b.id);
const lmatchesOf = (l) => S.leagueMatches.filter((m) => m.leagueId === l.id).sort((a, b) => a.id - b.id);
const lmStart = (m) => (m.date && m.start ? `${m.date} ${m.start}:00` : null);
const lmDone = (m) => !!m.score;
const lmStarted = (m) => !!lmStart(m) && vnToMs(lmStart(m)) <= nowMs();
const lmDayText = (m) => `${m.start} ${m.date.slice(8, 10)}/${m.date.slice(5, 7)}`;

function leagueStatus(l) {
  if (!l.publishedAt) return 'draft';
  const ms = lmatchesOf(l);
  if (ms.length && ms.every(lmDone)) return 'finished';
  if (ms.some(lmDone) || ms.some((m) => m.blockId && lmStarted(m))) return 'ongoing';
  return 'published';
}

/** Bảng xếp hạng: điểm, hiệu số, bàn thắng, rồi tên A–Z. Trận xử thua tính 0-3 như tỉ số thật. */
function standingsOf(l) {
  const rows = new Map(teamsOf(l).map((t) => [t.id, { teamId: t.id, name: t.name, withdrawn: !!t.withdrawn, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
  for (const m of lmatchesOf(l)) {
    if (!m.score) continue;
    const h = rows.get(m.homeId);
    const a = rows.get(m.awayId);
    for (const [r, f, g] of [[h, m.score.home, m.score.away], [a, m.score.away, m.score.home]]) {
      r.played += 1;
      r.gf += f;
      r.ga += g;
      if (f > g) { r.won += 1; r.points += LEAGUE_WIN; } else if (f === g) { r.drawn += 1; r.points += LEAGUE_DRAW; } else r.lost += 1;
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.gd = r.gf - r.ga;
  out.sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name, 'vi'));
  return out.map((r, i) => ({ rank: i + 1, ...r }));
}

function toLeagueMatch(m, l, staff) {
  const [, court] = m.courtId ? courtOf(m.courtId) : [null, null];
  const nameOf = (id) => S.leagueTeams.find((t) => t.id === id)?.name || '';
  const venue = venueOf(l.venueId);
  const status = m.forfeitBy ? 'forfeit' : m.score ? 'played' : m.blockId ? 'scheduled' : m.date ? 'planned' : 'unscheduled';
  return {
    id: m.id,
    round: m.round,
    homeId: m.homeId,
    awayId: m.awayId,
    homeName: nameOf(m.homeId),
    awayName: nameOf(m.awayId),
    status,
    courtId: m.courtId || null,
    courtName: court?.name || null,
    date: m.date || null,
    start: m.start || null,
    end: m.start ? slotEnd(venue, m.start) : null,
    held: !!m.blockId,
    score: m.score ? { ...m.score } : null,
    forfeitBy: m.forfeitBy || null,
    rescheduled: m.history.some((h) => h.kind === 'reschedule'),
    started: lmStarted(m),
    ...(staff ? { history: m.history.map((h) => ({ ...h })) } : {}),
  };
}

function toLeague(l, staff = false) {
  const venue = venueOf(l.venueId);
  const ms = lmatchesOf(l);
  return {
    id: l.id,
    venueId: venue.id,
    venueName: venue.name,
    venueAddress: venue.address,
    venueDistrict: venue.district,
    venuePhone: venue.phone || '',
    indexable: !!venue.dataSource,
    name: l.name,
    fieldType: l.fieldType,
    teamCount: l.teamCount,
    rules: l.rules,
    link: l.link || '',
    status: leagueStatus(l),
    publishedAt: l.publishedAt || null,
    createdAt: l.createdAt,
    teams: teamsOf(l).map((t) => ({
      id: t.id, name: t.name, withdrawn: !!t.withdrawn,
      ...(staff ? { contactName: t.contactName, contactPhone: t.contactPhone, feePaid: !!t.feePaid } : {}),
    })),
    matches: ms.map((m) => toLeagueMatch(m, l, staff)),
    standings: standingsOf(l),
    counts: { matches: ms.length, done: ms.filter(lmDone).length, held: ms.filter((m) => m.blockId).length, planned: ms.filter((m) => m.date).length },
  };
}

function ownerLeague(ctx) {
  const u = need(ctx, 'owner');
  const l = leagueOf(ctx.params.id);
  if (!l) fail(404, 'Không tìm thấy giải');
  if (l.ownerId !== u.id) fail(403, 'Giải này không thuộc sân của bạn');
  return [l, u];
}
const draftOnly = (l, what) => {
  if (l.publishedAt) fail(409, `Giải đã công bố, không ${what} được nữa`);
};

function cleanLeagueFields(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) {
    out.name = String(b.name || '').trim().slice(0, 80);
    req(out.name, 'Nhập tên giải');
  }
  if (b.rules !== undefined) {
    out.rules = String(b.rules).trim().slice(0, 3000);
    req(out.rules, 'Điều lệ không được để trống');
  }
  if (b.link !== undefined) {
    out.link = String(b.link || '').trim().slice(0, 300);
    req(!out.link || /^https?:\/\//i.test(out.link), 'Link nhóm Zalo hoặc fanpage phải bắt đầu bằng http:// hoặc https://');
  }
  return out;
}
function cleanTeam(t) {
  const name = String(t.name || '').trim().slice(0, 40);
  req(name, 'Nhập tên đội');
  return { name, contactName: String(t.contactName || '').trim().slice(0, 60), contactPhone: String(t.contactPhone || '').trim().slice(0, 20) };
}
function addLeagueTeam(l, t) {
  const c = cleanTeam(t);
  if (teamsOf(l).some((x) => x.name.toLowerCase() === c.name.toLowerCase())) fail(409, `Đã có đội tên "${c.name}"`);
  const rec = { id: nextId('leagueTeam'), leagueId: l.id, ...c, feePaid: false, withdrawn: false, withdrawnAt: null };
  S.leagueTeams.push(rec);
  return rec;
}

function createLeague(ctx) {
  const u = need(ctx, 'owner');
  const b = ctx.body || {};
  const venue = myVenue(ctx, b.venueId);
  const fieldType = String(b.fieldType || '');
  req(['5', '7'].includes(fieldType), 'Chọn sân 5 hoặc 7 người');
  req(venue.courts.some((c) => c.isActive && c.fieldType === fieldType), `Sân của bạn chưa có sân con ${fieldType} người`);
  const teamCount = Number(b.teamCount);
  req(Number.isInteger(teamCount) && teamCount >= 4 && teamCount <= 8, 'Giải có từ 4 đến 8 đội');
  const f = cleanLeagueFields({ ...b, rules: b.rules || LEAGUE_RULES_DEFAULT });
  const l = { id: nextId('league'), venueId: venue.id, ownerId: u.id, ...f, link: f.link || '', fieldType, teamCount, publishedAt: null, createdAt: now() };
  S.leagues.push(l);
  const names = Array.isArray(b.teams) ? b.teams : [];
  req(names.length <= teamCount, `Giải chỉ có ${teamCount} đội`);
  for (const t of names) addLeagueTeam(l, t);
  save();
  return toLeague(l, true);
}

function ownerLeagues(ctx) {
  const u = need(ctx, 'owner');
  const vid = ctx.query.venueId ? Number(ctx.query.venueId) : null;
  return S.leagues
    .filter((l) => l.ownerId === u.id && (!vid || l.venueId === vid))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .map((l) => {
      const o = toLeague(l, true);
      return { id: o.id, venueId: o.venueId, name: o.name, fieldType: o.fieldType, teamCount: o.teamCount, teams: o.teams.length, status: o.status, matches: o.counts.matches, done: o.counts.done };
    });
}

/** Vòng tròn một lượt (thuật toán xoay vòng). Số đội lẻ thì mỗi vòng một đội nghỉ. */
function roundRobin(ids) {
  const list = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length;
  const out = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a == null || b == null) continue;
      out.push(r % 2 && i === 0 ? { round: r + 1, home: b, away: a } : { round: r + 1, home: a, away: b });
    }
    list.splice(1, 0, list.pop());
  }
  return out;
}

function makeFixtures(ctx) {
  const [l] = ownerLeague(ctx);
  draftOnly(l, 'tạo lại trận');
  const teams = teamsOf(l);
  req(teams.length === l.teamCount, `Cần đủ ${l.teamCount} đội trước khi tạo các trận (đang có ${teams.length})`);
  S.leagueMatches = S.leagueMatches.filter((m) => m.leagueId !== l.id);
  for (const p of roundRobin(teams.map((t) => t.id))) {
    S.leagueMatches.push({ id: nextId('leagueMatch'), leagueId: l.id, round: p.round, homeId: p.home, awayId: p.away, courtId: null, date: null, start: null, blockId: null, score: null, forfeitBy: null, history: [] });
  }
  save();
  return toLeague(l, true);
}

/** Lý do một ô không giữ được cho giải (null nếu giữ được). ownBlockId: ô đang giữ của chính trận này thì bỏ qua. */
function leagueSlotProblem(l, courtId, date, start, ownBlockId = null) {
  const [venue, court] = courtOf(courtId);
  if (!court || venue.id !== l.venueId || !court.isActive) return 'sân con không thuộc sân này';
  if (court.fieldType !== l.fieldType) return `${court.name} là sân ${court.fieldType} người, giải đá sân ${l.fieldType}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !slotGrid(venue).includes(start)) return 'giờ không khớp lịch của sân';
  if (vnToMs(`${date} ${start}`) <= nowMs()) return 'giờ đã qua';
  if (teamModeAt(court, start)) return `${court.name} giờ này chỉ nhận ghép kèo`;
  const bk = activeBookingAt(court.id, date, start);
  if (bk) return `${court.name} đã có lịch đặt ${bk.code}`;
  const end = slotEnd(venue, start);
  const blk = S.blocks.find((k) => k.courtId === court.id && k.date === date && k.start < end && k.end > start && k.id !== ownBlockId);
  if (blk) return `${court.name} đang bị chặn${blk.leagueId ? ' cho giải khác' : ''}`;
  if (activeOffer(court.id, date, start)) return `${court.name} đang giữ cho người chờ giờ này`;
  return null;
}
const lmLabel = (m) => `${S.leagueTeams.find((t) => t.id === m.homeId)?.name} – ${S.leagueTeams.find((t) => t.id === m.awayId)?.name}`;

/** Kiểm cả loạt trước (ô tự trùng nhau, đội đá hai trận cùng giờ, ô đã có lịch) rồi mới giữ; có một lỗi thì không giữ ô nào. */
function leaguePlanProblems(l, matches) {
  const problems = [];
  const seen = new Map();
  const teamAt = new Map();
  for (const m of matches) {
    const label = `Trận ${lmLabel(m)}`;
    if (!m.date) { problems.push(`${label}: chưa chọn giờ`); continue; }
    const why = leagueSlotProblem(l, m.courtId, m.date, m.start, m.blockId);
    if (why) problems.push(`${label} (${lmDayText(m)}): ${why}`);
    const key = `${m.courtId}|${m.date}|${m.start}`;
    if (seen.has(key)) problems.push(`${label} (${lmDayText(m)}): trùng giờ với trận ${lmLabel(seen.get(key))}`);
    else seen.set(key, m);
    for (const tid of [m.homeId, m.awayId]) {
      const tk = `${tid}|${m.date}|${m.start}`;
      if (teamAt.has(tk) && teamAt.get(tk) !== m) problems.push(`${label} (${lmDayText(m)}): một đội phải đá hai trận cùng giờ`);
      teamAt.set(tk, m);
    }
  }
  return problems;
}
const problemText = (ps) => `${ps.slice(0, 3).join('; ')}${ps.length > 3 ? `; và ${ps.length - 3} lỗi nữa` : ''}`;

function holdLeagueSlot(l, m, owner) {
  const venue = venueOf(l.venueId);
  const k = { id: nextId('block'), courtId: m.courtId, date: m.date, start: m.start, end: slotEnd(venue, m.start), reason: `Giải: ${l.name}`, ownerId: owner.id, leagueId: l.id, leagueMatchId: m.id };
  S.blocks.push(k);
  m.blockId = k.id;
}
function releaseLeagueSlot(m) {
  if (!m.blockId) return;
  const k = S.blocks.find((x) => x.id === m.blockId);
  m.blockId = null;
  if (!k) return;
  S.blocks.splice(S.blocks.indexOf(k), 1);
  offerSlot(k.courtId, k.date, k.start);
}

function savePlan(ctx) {
  const [l] = ownerLeague(ctx);
  draftOnly(l, 'xếp lại giờ ở bước nháp');
  const ms = lmatchesOf(l);
  req(ms.length, 'Hãy tạo các trận trước');
  const slots = ctx.body?.slots;
  req(Array.isArray(slots), 'Thiếu danh sách giờ');
  for (const s of slots) {
    const m = ms.find((x) => x.id === Number(s.matchId));
    if (!m) fail(404, 'Không tìm thấy trận');
    if (!s.courtId && !s.date && !s.start) {
      m.courtId = null; m.date = null; m.start = null;
      continue;
    }
    req(courtOf(s.courtId)[1], 'Chọn sân con');
    req(/^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && /^\d{2}:\d{2}$/.test(s.start || ''), 'Chọn ngày và giờ');
    m.courtId = Number(s.courtId); m.date = s.date; m.start = s.start;
  }
  save();
  return toLeague(l, true);
}

/** Xếp tự động: lần lượt các trận chưa có giờ vào ô trống kế tiếp của một sân con, tối đa perDay trận mỗi ngày, từ giờ start trở đi. */
function autoPlan(ctx) {
  const [l] = ownerLeague(ctx);
  draftOnly(l, 'xếp lại giờ ở bước nháp');
  const { courtId, date, start } = ctx.body || {};
  const perDay = Number(ctx.body?.perDay);
  const [venue, court] = courtOf(courtId);
  req(court && venue.id === l.venueId, 'Chọn sân con');
  req(/^\d{4}-\d{2}-\d{2}$/.test(date || ''), 'Chọn ngày bắt đầu');
  req(Number.isInteger(perDay) && perDay >= 1 && perDay <= 8, 'Số trận mỗi ngày từ 1 đến 8');
  const ms = lmatchesOf(l);
  req(ms.length, 'Hãy tạo các trận trước');
  const grid = slotGrid(venue).filter((s) => s >= (start || '00:00'));
  req(grid.length, 'Không có giờ nào từ giờ đó trở đi');
  const todo = ms.filter((m) => !m.date);
  const used = new Set(ms.filter((m) => m.date).map((m) => `${m.courtId}|${m.date}|${m.start}`));
  let d = date;
  for (let day = 0; todo.length && day < 90; day++, d = addDays(d, 1)) {
    let n = 0;
    for (const s of grid) {
      if (!todo.length || n >= perDay) break;
      if (used.has(`${court.id}|${d}|${s}`) || leagueSlotProblem(l, court.id, d, s)) continue;
      const m = todo.shift();
      m.courtId = court.id; m.date = d; m.start = s;
      used.add(`${court.id}|${d}|${s}`);
      n += 1;
    }
  }
  req(!todo.length, 'Không đủ giờ trống trong 90 ngày để xếp hết các trận');
  save();
  return toLeague(l, true);
}

function publishLeague(ctx) {
  const [l, u] = ownerLeague(ctx);
  draftOnly(l, 'công bố lại');
  const ms = lmatchesOf(l);
  req(ms.length, 'Hãy tạo các trận trước');
  const problems = leaguePlanProblems(l, ms);
  if (problems.length) fail(409, `Chưa giữ được giờ nên chưa công bố: ${problemText(problems)}`);
  for (const m of ms) holdLeagueSlot(l, m, u);
  l.publishedAt = now();
  save();
  return toLeague(l, true);
}

function rescheduleLeagueMatch(ctx) {
  const [l, u] = ownerLeague(ctx);
  const m = S.leagueMatches.find((x) => x.id === Number(ctx.params.mid) && x.leagueId === l.id);
  if (!m) fail(404, 'Không tìm thấy trận');
  req(l.publishedAt, 'Giải chưa công bố: đổi giờ ở bước xếp lịch');
  if (m.score || m.forfeitBy) fail(409, 'Trận này đã có kết quả, không hoãn được');
  const { courtId, date, start } = ctx.body || {};
  const note = String(ctx.body?.note || '').trim().slice(0, 300);
  const why = leagueSlotProblem(l, courtId, date, start, m.blockId);
  if (why) fail(409, `Giờ mới không giữ được: ${why}`);
  if (m.courtId === Number(courtId) && m.date === date && m.start === start) fail(409, 'Giờ mới trùng giờ cũ');
  const clash = lmatchesOf(l).find((x) => x.id !== m.id && x.date === date && x.start === start && [m.homeId, m.awayId].some((t) => [x.homeId, x.awayId].includes(t)) && !x.forfeitBy);
  if (clash) fail(409, 'Một trong hai đội đã có trận khác cùng giờ đó');
  const from = `${courtOf(m.courtId)[1].name} ${lmDayText(m)}`;
  releaseLeagueSlot(m);
  m.courtId = Number(courtId); m.date = date; m.start = start;
  holdLeagueSlot(l, m, u);
  m.history.push({ id: nextId('leagueEvent'), kind: 'reschedule', at: now(), by: u.fullName, from, to: `${courtOf(m.courtId)[1].name} ${lmDayText(m)}`, note });
  save();
  return toLeague(l, true);
}

function scoreLeagueMatch(ctx) {
  const [l, u] = ownerLeague(ctx);
  const m = S.leagueMatches.find((x) => x.id === Number(ctx.params.mid) && x.leagueId === l.id);
  if (!m) fail(404, 'Không tìm thấy trận');
  req(l.publishedAt, 'Giải chưa công bố');
  if (m.forfeitBy) fail(409, 'Trận này đã xử thua do đội rút');
  if (!lmStarted(m)) fail(409, 'Trận chưa đến giờ đá nên chưa nhập tỉ số được');
  const home = Number(ctx.body?.home);
  const away = Number(ctx.body?.away);
  req(Number.isInteger(home) && Number.isInteger(away) && home >= 0 && away >= 0 && home <= 99 && away <= 99, 'Tỉ số mỗi đội là số nguyên từ 0 đến 99');
  const note = String(ctx.body?.note || '').trim().slice(0, 300);
  if (m.score) {
    req(note, 'Sửa tỉ số phải ghi lý do');
    if (m.score.home === home && m.score.away === away) fail(409, 'Tỉ số mới giống tỉ số cũ');
  }
  const from = m.score ? `${m.score.home}-${m.score.away}` : null;
  m.score = { home, away };
  m.history.push({ id: nextId('leagueEvent'), kind: 'score', at: now(), by: u.fullName, from, to: `${home}-${away}`, note });
  save();
  return toLeague(l, true);
}

function withdrawLeagueTeam(ctx) {
  const [l, u] = ownerLeague(ctx);
  const t = S.leagueTeams.find((x) => x.id === Number(ctx.params.tid) && x.leagueId === l.id);
  if (!t) fail(404, 'Không tìm thấy đội');
  req(l.publishedAt, 'Giải chưa công bố: xóa đội thay vì cho rút');
  if (t.withdrawn) fail(409, 'Đội này đã rút');
  const note = String(ctx.body?.note || '').trim().slice(0, 300);
  t.withdrawn = true;
  t.withdrawnAt = now();
  for (const m of lmatchesOf(l)) {
    if (m.score || m.forfeitBy || (m.homeId !== t.id && m.awayId !== t.id)) continue;
    releaseLeagueSlot(m);
    m.forfeitBy = t.id;
    m.score = m.homeId === t.id ? { home: 0, away: LEAGUE_WIN } : { home: LEAGUE_WIN, away: 0 };
    m.history.push({ id: nextId('leagueEvent'), kind: 'forfeit', at: now(), by: u.fullName, from: null, to: `${m.score.home}-${m.score.away}`, note: `${t.name} rút khỏi giải, xử thua 0-3${note ? `. ${note}` : ''}` });
  }
  save();
  return toLeague(l, true);
}

function deleteLeague(ctx) {
  const [l] = ownerLeague(ctx);
  for (const m of lmatchesOf(l)) releaseLeagueSlot(m);
  S.leagueMatches = S.leagueMatches.filter((m) => m.leagueId !== l.id);
  S.leagueTeams = S.leagueTeams.filter((t) => t.leagueId !== l.id);
  S.leagues.splice(S.leagues.indexOf(l), 1);
  save();
  return { ok: true };
}

const publicLeague = (id) => {
  const l = leagueOf(id);
  if (!l || !l.publishedAt) fail(404, 'Không tìm thấy giải');
  return l;
};
const venueLeagues = (venueId) =>
  S.leagues
    .filter((l) => l.venueId === venueId && l.publishedAt && leagueStatus(l) !== 'finished')
    .map((l) => ({ id: l.id, name: l.name, fieldType: l.fieldType, status: leagueStatus(l) }));

/** Danh sách giải đã công bố (không cần đăng nhập): đang đá, rồi sắp đá, đã xong để cuối. Giải nháp không bao giờ có mặt. */
const LEAGUE_ORDER = { ongoing: 0, published: 1, finished: 2 };
function publicLeagues(c) {
  const district = String(c.query.district || '');
  return S.leagues
    .filter((l) => l.publishedAt && (!district || venueOf(l.venueId).district === district))
    .map((l) => {
      const o = toLeague(l, false);
      const lead = o.standings[0]?.played > 0 ? o.standings[0] : null;
      const next = o.matches.filter((m) => !m.score && m.date).map((m) => `${m.date} ${m.start}`).sort()[0] || null;
      return { id: o.id, name: o.name, venueId: o.venueId, venueName: o.venueName, venueDistrict: o.venueDistrict, venuePhone: o.venuePhone, indexable: o.indexable, fieldType: o.fieldType, link: o.link, status: o.status, teamCount: o.teams.length, matches: o.counts.matches, done: o.counts.done, nextAt: next, leader: lead ? { teamId: lead.teamId, name: lead.name, points: lead.points, played: lead.played } : null, publishedAt: o.publishedAt };
    })
    .sort((a, b) => LEAGUE_ORDER[a.status] - LEAGUE_ORDER[b.status] || (a.status === 'finished' ? 0 : (a.nextAt || '9').localeCompare(b.nextAt || '9')) || b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id);
}
route('GET', '/api/leagues', publicLeagues);
route('GET', '/api/leagues/:id', (c) => toLeague(publicLeague(c.params.id), false));
route('GET', '/api/owner/leagues', (c) => ownerLeagues(c));
route('POST', '/api/owner/leagues', createLeague);
route('GET', '/api/owner/leagues/:id', (c) => toLeague(ownerLeague(c)[0], true));
route('PUT', '/api/owner/leagues/:id', (c) => {
  const [l] = ownerLeague(c);
  Object.assign(l, cleanLeagueFields(c.body || {}, true));
  for (const k of S.blocks) if (k.leagueId === l.id) k.reason = `Giải: ${l.name}`;
  save();
  return toLeague(l, true);
});
route('DELETE', '/api/owner/leagues/:id', deleteLeague);
route('POST', '/api/owner/leagues/:id/teams', (c) => {
  const [l] = ownerLeague(c);
  draftOnly(l, 'thêm đội');
  if (lmatchesOf(l).length) fail(409, 'Đã tạo các trận, không thêm đội được. Làm lại các trận nếu cần đổi đội');
  req(teamsOf(l).length < l.teamCount, `Giải đã đủ ${l.teamCount} đội`);
  addLeagueTeam(l, c.body || {});
  save();
  return toLeague(l, true);
});
route('PUT', '/api/owner/leagues/:id/teams/:tid', (c) => {
  const [l] = ownerLeague(c);
  const t = S.leagueTeams.find((x) => x.id === Number(c.params.tid) && x.leagueId === l.id);
  if (!t) fail(404, 'Không tìm thấy đội');
  const b = c.body || {};
  if (b.feePaid !== undefined) t.feePaid = !!b.feePaid;
  if (b.name !== undefined || b.contactName !== undefined || b.contactPhone !== undefined) {
    const nx = cleanTeam({ name: b.name ?? t.name, contactName: b.contactName ?? t.contactName, contactPhone: b.contactPhone ?? t.contactPhone });
    if (teamsOf(l).some((x) => x.id !== t.id && x.name.toLowerCase() === nx.name.toLowerCase())) fail(409, `Đã có đội tên "${nx.name}"`);
    Object.assign(t, nx);
  }
  save();
  return toLeague(l, true);
});
route('DELETE', '/api/owner/leagues/:id/teams/:tid', (c) => {
  const [l] = ownerLeague(c);
  draftOnly(l, 'xóa đội');
  if (lmatchesOf(l).length) fail(409, 'Đã tạo các trận, không xóa đội được. Làm lại các trận nếu cần đổi đội');
  const t = S.leagueTeams.find((x) => x.id === Number(c.params.tid) && x.leagueId === l.id);
  if (!t) fail(404, 'Không tìm thấy đội');
  S.leagueTeams.splice(S.leagueTeams.indexOf(t), 1);
  save();
  return toLeague(l, true);
});
route('POST', '/api/owner/leagues/:id/fixtures', makeFixtures);
route('PUT', '/api/owner/leagues/:id/plan', savePlan);
route('POST', '/api/owner/leagues/:id/auto-plan', autoPlan);
route('POST', '/api/owner/leagues/:id/publish', publishLeague);
route('POST', '/api/owner/leagues/:id/matches/:mid/reschedule', rescheduleLeagueMatch);
route('POST', '/api/owner/leagues/:id/matches/:mid/score', scoreLeagueMatch);
route('POST', '/api/owner/leagues/:id/teams/:tid/withdraw', withdrawLeagueTeam);

/** Giải mẫu đang đá dở ở sân của chusan1: các trận đã đá nằm ở những ngày đã qua, các trận còn lại ở ô trống gần nhất từ ngày mai, nên không đổi theo giờ mở demo. */
function seedLeagues(st) {
  for (const cfg of [seeds.bookings.league, ...(seeds.bookings.moreLeagues || [])]) if (cfg) seedOneLeague(st, cfg);
}
function seedOneLeague(st, cfg) {
  const venue = venueOf(cfg.venueId);
  const court = venue.courts.find((c) => c.fieldType === cfg.fieldType && c.isActive);
  const owner = userOf(venue.ownerId);
  const l = { id: nextId('league'), venueId: venue.id, ownerId: owner.id, name: cfg.name, fieldType: cfg.fieldType, teamCount: cfg.teams.length, rules: LEAGUE_RULES_DEFAULT, link: cfg.link, publishedAt: ago0(cfg.publishedDaysAgo), createdAt: ago0(cfg.publishedDaysAgo + 1) };
  st.leagues.push(l);
  for (const t of cfg.teams) st.leagueTeams.push({ id: nextId('leagueTeam'), leagueId: l.id, name: t.name, contactName: t.contact, contactPhone: t.phone || '', feePaid: !!t.feePaid, withdrawn: false, withdrawnAt: null });
  const ids = teamsOf(l).map((t) => t.id);
  const today = dateOf(now());
  let futureDay = 1;
  roundRobin(ids).forEach((p, i) => {
    const m = { id: nextId('leagueMatch'), leagueId: l.id, round: p.round, homeId: p.home, awayId: p.away, courtId: court.id, date: null, start: null, blockId: null, score: null, forfeitBy: null, history: [] };
    const res = cfg.results[i];
    if (res) {
      m.date = addDays(today, -res.daysAgo);
      m.start = res.start;
      m.score = { home: res.home, away: res.away };
      m.history.push({ id: nextId('leagueEvent'), kind: 'score', at: `${m.date} 22:00:00`, by: owner.fullName, from: null, to: `${res.home}-${res.away}`, note: '' });
      if (res.fix) m.history.push({ id: nextId('leagueEvent'), kind: 'score', at: `${m.date} 23:10:00`, by: owner.fullName, from: `${res.home}-${res.away}`, to: `${res.fix[0]}-${res.fix[1]}`, note: res.fix[2] });
      if (res.fix) m.score = { home: res.fix[0], away: res.fix[1] };
    } else {
      // trận còn lại: ô trống gần nhất (sân đúng loại) từ ngày mai, giờ ưu tiên theo mẫu
      const want = hmToMin(cfg.futureStart);
      const cands = [];
      for (let d = futureDay; d <= futureDay + 20 && !cands.length; d++) {
        const date = addDays(today, d);
        for (const c of venue.courts.filter((x) => x.fieldType === cfg.fieldType && x.isActive)) {
          for (const s of slotGrid(venue)) {
            const startAt = `${date} ${s}:00`;
            if (teamModeAt(c, s) || st.bookings.some((x) => x.courtId === c.id && x.startAt === startAt && ['pending', 'confirmed', 'matching'].includes(x.status))) continue;
            if (st.blocks.some((k) => k.courtId === c.id && k.date === date && k.start < slotEnd(venue, s) && k.end > s)) continue;
            cands.push({ c, date, s, key: Math.abs(hmToMin(s) - want) * 10 + venue.courts.indexOf(c) });
          }
        }
        if (cands.length) futureDay = d;
      }
      cands.sort((a, b) => a.key - b.key || a.s.localeCompare(b.s));
      const pick = cands[0];
      if (pick) { m.courtId = pick.c.id; m.date = pick.date; m.start = pick.s; }
    }
    if (m.date) {
      st.blocks.push({ id: nextId('block'), courtId: m.courtId, date: m.date, start: m.start, end: slotEnd(venue, m.start), reason: `Giải: ${l.name}`, ownerId: owner.id, leagueId: l.id, leagueMatchId: m.id });
      m.blockId = st.blocks[st.blocks.length - 1].id;
    }
    st.leagueMatches.push(m);
  });
}
const ago0 = (days) => msToVn(Date.now() - days * 86400000);

/* Admin */
const adminAction = (fn) => (c) => {
  const u = need(c, 'admin');
  fn(findBooking(c.params.id), u, c.body || {});
  return { ok: true };
};
route('GET', '/api/admin/users', (c) => {
  need(c, 'admin');
  return S.users.filter((u) => !c.query.role || u.role === c.query.role).map((u) => ({ id: u.id, fullName: u.fullName, email: u.email ?? null, phone: u.phone, role: u.role, isActive: u.isActive, createdAt: u.createdAt }));
});
route('POST', '/api/admin/owners', (c) => {
  need(c, 'admin');
  const { fullName = '', email = '', phone: rawPhone = '', password = '' } = c.body || {};
  const phone = normalizeAuthPhone(rawPhone);
  req(String(fullName).trim().length >= 2, 'Vui lòng nhập họ tên');
  req(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Email không hợp lệ');
  req(String(password).length >= 8, 'Mật khẩu cần ít nhất 8 ký tự');
  if (S.users.some((u) => u.email?.toLowerCase() === email.toLowerCase())) fail(409, 'Email này đã được đăng ký');
  if (S.users.some((u) => storedAuthPhone(u.phone) === phone)) fail(409, 'Số điện thoại này đã được đăng ký');
  const u = { id: nextId('user'), fullName: String(fullName).trim(), email: email.trim(), phone, role: 'owner', isActive: true, password, createdAt: now() };
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
  /** Khách bấm "giả lập chuyển khoản": vài giây sau ngân hàng mới báo về (mô phỏng SePay). Tiền đúng nội dung/số tiền của mã QR, trừ khi chọn lệch. */
  async simulateTransfer({ content, amount, account, immediate = false }) {
    await ready();
    const tx = `MOCK${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const q = { txId: tx, content, amount, account, dueAtReal: Date.now() + BANK_DELAY_MS };
    S.bankQueue.push(q);
    save();
    if (immediate) tickBank(true);
    else setTimeout(() => { if (S.bankQueue.includes(q)) { tickBank(); save(); } }, BANK_DELAY_MS + 50);
    return { txId: tx, delayMs: immediate ? 0 : BANK_DELAY_MS };
  },
  /** Gọi thẳng "ngân hàng báo có tiền" với dữ liệu giống webhook (dùng cho Demo và kiểm thử). */
  async bankReport(d) {
    await ready();
    return bankReport(d);
  },
  /** Ngân hàng báo ngay mọi khoản đang chờ. */
  async flushBank() {
    await ready();
    const n = S.bankQueue.length;
    tickBank(true);
    save();
    return { reported: n };
  },
  async state() {
    await ready();
    return { now: now(), clockOffsetMin: S.clockOffsetMin, user: sessionUser() ? userOut(sessionUser()) : null, statuses: STATUSES };
  },
};
