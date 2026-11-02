// Đọc cụm sân + sân con từ DB và chuẩn hóa kiểu dữ liệu (TIME -> 'HH:mm', TINYINT -> boolean, JSON -> đối tượng).
const { db } = require('../db');
const { hm } = require('../lib/time');

const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === 'string') return JSON.parse(v);
  return v;
};

function normalizeCourt(c) {
  return {
    id: c.id,
    venueId: c.venueId,
    name: c.name,
    fieldType: c.fieldType,
    price: c.price,
    peakPrice: c.peakPrice,
    isActive: !!c.isActive,
    teamModeEnabled: !!c.teamModeEnabled,
    teamModeFrom: hm(c.teamModeFrom),
    teamModeTo: hm(c.teamModeTo),
  };
}

function normalizeVenue(v, courts) {
  return {
    id: v.id,
    ownerId: v.ownerId,
    name: v.name,
    district: v.district,
    address: v.address,
    phone: v.phone,
    description: v.description,
    rules: v.rules,
    amenities: parseJson(v.amenities, []),
    openTime: hm(v.openTime),
    closeTime: hm(v.closeTime),
    slotMinutes: v.slotMinutes,
    peakStart: hm(v.peakStart),
    peakEnd: hm(v.peakEnd),
    requiresApproval: !!v.requiresApproval,
    lastMinutePercent: v.lastMinutePercent,
    mapsUrl: v.mapsUrl,
    imageUrl: v.imageUrl,
    imageIsIllustrative: !!v.imageIsIllustrative,
    imageCredit: parseJson(v.imageCredit, null),
    dataSource: parseJson(v.dataSource, null),
    bank: { bin: v.bankBin, account: v.bankAccount, accountName: v.bankAccountName },
    isActive: !!v.isActive,
    courts: courts.map(normalizeCourt),
  };
}

/** Mọi cụm sân (kèm sân con) thỏa where; xếp theo id. Mặc định chỉ cụm đang hoạt động. */
async function loadVenues({ ids = null, activeOnly = true, conn = db } = {}) {
  const where = [];
  const params = [];
  if (activeOnly) where.push('is_active = 1');
  if (ids) {
    if (!ids.length) return [];
    where.push('id IN (?)');
    params.push(ids);
  }
  const venues = await conn.query(`SELECT * FROM venues ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`, params);
  if (!venues.length) return [];
  const courts = await conn.query('SELECT * FROM courts WHERE venue_id IN (?) ORDER BY id', [venues.map((v) => v.id)]);
  return venues.map((v) => normalizeVenue(v, courts.filter((c) => c.venueId === v.id)));
}

async function loadVenue(id, opts = {}) {
  const [v] = await loadVenues({ ...opts, ids: [id] });
  return v || null;
}

/** Sân con kèm cụm sân của nó (đều phải đang hoạt động nếu activeOnly). */
async function loadCourt(courtId, { activeOnly = true, conn = db } = {}) {
  const row = await conn.one('SELECT venue_id FROM courts WHERE id = ?', [courtId]);
  if (!row) return null;
  const venue = await loadVenue(row.venueId, { activeOnly, conn });
  const court = venue?.courts.find((c) => c.id === Number(courtId));
  if (!court || (activeOnly && !court.isActive)) return null;
  return { venue, court };
}

module.exports = { loadVenues, loadVenue, loadCourt, normalizeVenue, normalizeCourt };
