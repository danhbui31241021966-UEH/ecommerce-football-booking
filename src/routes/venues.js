const express = require('express');
const { pool } = require('../db');
const v = require('../utils/validate');
const config = require('../config');
const slots = require('../services/slots');
const { getPublicVenue, getDaySchedule, assertBookableDate } = require('../services/schedule');

const router = express.Router();

function mapsUrl(venue) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.address}, ${venue.district}, TP.HCM`)}`;
}

function publicVenue(venue, courts) {
  const prices = courts.flatMap((c) => [c.price, c.peak_price]);
  return {
    id: venue.id,
    name: venue.name,
    district: venue.district,
    address: venue.address,
    phone: venue.phone,
    imageUrl: venue.image_url,
    amenities: venue.amenities ? venue.amenities.split(',').map((s) => s.trim()).filter(Boolean) : [],
    openTime: venue.open_time.slice(0, 5),
    closeTime: venue.close_time.slice(0, 5),
    slotMinutes: venue.slot_minutes,
    requiresApproval: Boolean(venue.requires_approval),
    fieldTypes: [...new Set(courts.map((c) => c.field_type))].sort(),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
  };
}

router.get('/districts', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT v.district FROM venues v JOIN users o ON o.id = v.owner_id
     WHERE v.is_active = 1 AND o.is_active = 1 ORDER BY v.district`,
  );
  res.json(rows.map((r) => r.district));
});

// F01 + F02: tìm theo tên/địa chỉ/khu vực, lọc theo ngày, giờ bắt đầu, giá, loại sân.
router.get('/', async (req, res) => {
  const q = v.str(req.query.q, 'Từ khóa', { max: 100, optional: true });
  const district = v.str(req.query.district, 'Khu vực', { max: 50, optional: true });
  const fieldType = ['5', '7'].includes(req.query.fieldType) ? req.query.fieldType : null;
  const maxPrice = v.int(req.query.maxPrice, 'Giá tối đa', { optional: true });
  const from = v.time(req.query.from, 'Giờ bắt đầu', { optional: true });
  let date = req.query.date ? v.date(req.query.date) : null;
  if (from && !date) date = slots.toDateStr(new Date());
  if (date) assertBookableDate(date);

  const where = ['v.is_active = 1', 'o.is_active = 1'];
  const params = [];
  if (q) {
    where.push('(v.name LIKE ? OR v.address LIKE ? OR v.district LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (district) {
    where.push('v.district = ?');
    params.push(district);
  }
  const [venues] = await pool.query(
    `SELECT v.* FROM venues v JOIN users o ON o.id = v.owner_id WHERE ${where.join(' AND ')} ORDER BY v.name`,
    params,
  );
  const [courts] = venues.length
    ? await pool.query('SELECT * FROM courts WHERE is_active = 1 AND venue_id IN (?)', [venues.map((x) => x.id)])
    : [[]];

  const results = [];
  for (const venue of venues) {
    let venueCourts = courts.filter((c) => c.venue_id === venue.id);
    if (fieldType) venueCourts = venueCourts.filter((c) => c.field_type === fieldType);
    if (!venueCourts.length) continue;

    const item = publicVenue(venue, venueCourts);
    if (date) {
      // Chỉ giữ sân còn ít nhất một slot thực sự trống khớp điều kiện lọc.
      const schedule = await getDaySchedule(venue, date);
      const courtIds = new Set(venueCourts.map((c) => c.id));
      item.availableSlots = schedule.courts
        .filter((c) => courtIds.has(c.id))
        .flatMap((c) => c.slots)
        .filter((s) => s.status === 'available' && (!from || s.start >= from) && (!maxPrice || s.price <= maxPrice))
        .length;
      if (!item.availableSlots) continue;
    } else if (maxPrice && item.minPrice > maxPrice) {
      continue;
    }
    results.push(item);
  }
  res.json({ date, venues: results });
});

// F03: chi tiết sân
router.get('/:id', async (req, res) => {
  const venue = await getPublicVenue(v.id(req.params.id));
  const [courts] = await pool.query('SELECT * FROM courts WHERE venue_id = ? AND is_active = 1 ORDER BY name', [venue.id]);
  res.json({
    ...publicVenue(venue, courts),
    description: venue.description,
    rules: venue.rules,
    paymentInfo: venue.payment_info,
    peakStart: venue.peak_start?.slice(0, 5) || null,
    peakEnd: venue.peak_end?.slice(0, 5) || null,
    cancelPolicy: slots.CANCEL_POLICY_TEXT,
    holdMinutes: config.holdMinutes,
    bookingWindowDays: config.bookingWindowDays,
    mapsUrl: mapsUrl(venue),
    courts: courts.map((c) => ({ id: c.id, name: c.name, fieldType: c.field_type, price: c.price, peakPrice: c.peak_price })),
  });
});

// Lịch trống theo ngày (công khai, không kèm thông tin người đặt)
router.get('/:id/schedule', async (req, res) => {
  const venue = await getPublicVenue(v.id(req.params.id));
  const date = v.date(req.query.date);
  assertBookableDate(date);
  res.json(await getDaySchedule(venue, date));
});

module.exports = router;
