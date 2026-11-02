// Đổi cụm sân đã chuẩn hóa sang kiểu dữ liệu của contract (PRD mục 7): Venue, VenueDetail, availableSlots.
const { CANCEL_POLICY_TEXT } = require('../rules');
const { hmToMin } = require('../lib/time');
const { slotGrid } = require('./slotGrid');
const { slotInfo, loadOccupancy } = require('./schedule');

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
    vietQr: !!(v.bank.bin && v.bank.account),
    fieldTypes: [...new Set(courts.map((c) => c.fieldType))].sort(),
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    ...extra,
  };
}

const courtOut = (c) => ({
  id: c.id,
  name: c.name,
  fieldType: c.fieldType,
  price: c.price,
  peakPrice: c.peakPrice,
  teamMode: c.teamModeEnabled ? { from: c.teamModeFrom, to: c.teamModeTo } : null,
});

function toVenueDetail(v) {
  return {
    ...toVenue(v),
    description: v.description,
    rules: v.rules,
    peakStart: v.peakStart,
    peakEnd: v.peakEnd,
    cancelPolicy: CANCEL_POLICY_TEXT,
    mapsUrl: v.mapsUrl,
    leagues: [], // R18: nối khi có bảng giải
    ...(v.dataSource ? { dataSource: v.dataSource } : {}),
    courts: activeCourts(v).map(courtOut),
  };
}

/** Điều kiện lọc sân con theo fieldType. */
const courtFilter = (params) => {
  const type = params.fieldType ? String(params.fieldType) : '';
  return (c) => c.isActive && (!type || c.fieldType === type);
};

const num = (v) => (v === '' || v == null ? NaN : Number(v));

function venueMatches(v, params) {
  if (!v.isActive) return false;
  if (params.district && v.district !== params.district) return false;
  if (params.q) {
    const q = String(params.q).toLowerCase();
    if (!`${v.name} ${v.address} ${v.district}`.toLowerCase().includes(q)) return false;
  }
  const cs = v.courts.filter(courtFilter(params));
  if (!cs.length) return false;
  const max = num(params.maxPrice);
  if (max && !cs.some((c) => c.price <= max)) return false;
  return true;
}

/** Giờ trống (hoặc ghép kèo) trong ngày `date` của cụm sân; occ lấy từ loadOccupancy cho đúng ngày đó. */
function availableOn(v, date, params, viewer, occ) {
  const max = num(params.maxPrice);
  const fromMin = params.from ? hmToMin(params.from) : 0;
  const out = [];
  for (const c of v.courts.filter(courtFilter(params))) {
    for (const s of slotGrid(v)) {
      if (hmToMin(s) < fromMin) continue;
      const slot = slotInfo(v, c, date, s, occ, viewer);
      if (!(slot.status === 'available' || slot.offeredToYou)) continue;
      if (max && slot.price > max) continue;
      out.push({
        courtId: c.id,
        courtName: c.name,
        fieldType: c.fieldType,
        start: slot.start,
        end: slot.end,
        price: slot.price,
        basePrice: slot.basePrice,
        discountPercent: slot.discountPercent,
        peak: slot.peak,
        offeredToYou: !!slot.offeredToYou,
        teamMode: !!slot.teamMode,
        match: null, // R13: ô đang có trận chờ đội thứ hai; nối khi có bảng trận
      });
    }
  }
  return out;
}

/** availableOn cho nhiều cụm sân với một lần đọc occupancy. */
async function availableForVenues(venues, date, params, viewer) {
  const courtIds = venues.flatMap((v) => v.courts.filter(courtFilter(params)).map((c) => c.id));
  const occ = await loadOccupancy(courtIds, date);
  return new Map(venues.map((v) => [v.id, availableOn(v, date, params, viewer, occ)]));
}

module.exports = { toVenue, toVenueDetail, venueMatches, availableForVenues };
