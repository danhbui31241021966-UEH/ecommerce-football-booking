const express = require('express');
const { db } = require('../db');
const { badRequest, notFound } = require('../utils/errors');
const { isDate, isHm, hmToMin } = require('../lib/time');
const { loadVenues, loadVenue } = require('../services/venueStore');
const { scheduleOf } = require('../services/schedule');
const { venueLeagues } = require('../services/leagueOps');
const { toVenue, toVenueDetail, venueMatches, availableForVenues } = require('../services/venueDto');

const router = express.Router();

const checkDate = (date) => {
  if (!isDate(date)) throw badRequest('Ngày không hợp lệ');
  return date;
};

router.get('/districts', async (req, res) => {
  const rows = await db.query('SELECT DISTINCT district FROM venues WHERE is_active = 1');
  res.json(rows.map((r) => r.district).sort((a, b) => a.localeCompare(b, 'vi')));
});

router.get('/', async (req, res) => {
  const p = req.query;
  const date = p.date ? checkDate(p.date) : null;
  if (p.from && !isHm(p.from)) throw badRequest('Giờ không hợp lệ');
  const venues = (await loadVenues()).filter((v) => venueMatches(v, p));
  const avail = date ? await availableForVenues(venues, date, p, req.user) : null;
  res.json({ date, venues: venues.map((v) => toVenue(v, avail ? { availableSlots: avail.get(v.id) } : {})) });
});

// Tìm theo giờ: slot bắt đầu trong [at-30 phút, at+60 phút], gần giờ chọn nhất lên trước.
router.get('/slots', async (req, res) => {
  const p = req.query;
  const date = checkDate(p.date);
  if (!isHm(p.at)) throw badRequest('Giờ không hợp lệ');
  const at = hmToMin(p.at);
  const venues = (await loadVenues()).filter((v) => venueMatches(v, p));
  const avail = await availableForVenues(venues, date, { ...p, from: '' }, req.user);
  const slots = [];
  for (const v of venues) {
    for (const s of avail.get(v.id)) {
      const m = hmToMin(s.start);
      if (m < at - 30 || m > at + 60) continue;
      if (p.lastMinute && !s.discountPercent) continue;
      slots.push({ venueId: v.id, venueName: v.name, district: v.district, address: v.address, requiresApproval: v.requiresApproval, ...s });
    }
  }
  slots.sort((a, b) => Math.abs(hmToMin(a.start) - at) - Math.abs(hmToMin(b.start) - at) || a.price - b.price);
  res.json({ date, at: p.at, slots });
});

const venueOr404 = async (id) => {
  const v = /^\d+$/.test(id) ? await loadVenue(Number(id)) : null;
  if (!v) throw notFound('Không tìm thấy sân');
  return v;
};

router.get('/:id', async (req, res) => {
  const v = await venueOr404(req.params.id);
  res.json(toVenueDetail(v, await venueLeagues(v.id)));
});

router.get('/:id/schedule', async (req, res) => {
  const v = await venueOr404(req.params.id);
  res.json(await scheduleOf(v, checkDate(req.query.date), req.user, { enforceBookingWindow: true }));
});

module.exports = router;
