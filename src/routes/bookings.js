const express = require('express');
const { requireRole } = require('../middleware/auth');
const { createBooking } = require('../services/bookingCore');
const { bookingDetail, myBookings } = require('../services/bookingView');
const { assertAccess, cancelBooking } = require('../services/bookingOps');
const { reliabilityOf } = require('../services/reliability');
const { db } = require('../db');
const { notFound } = require('../utils/errors');

const router = express.Router();

const bookingId = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw notFound('Không tìm thấy lịch đặt');
  return id;
};

router.post('/', requireRole('customer'), async (req, res) => {
  const { booking, created } = await createBooking(req.user, req.body);
  res.status(created ? 201 : 200).json(booking);
});

router.get('/mine', requireRole('customer'), async (req, res) => res.json(await myBookings(req.user.id)));
router.get('/reliability', requireRole('customer'), async (req, res) => res.json(await reliabilityOf(db, req.user.id)));

// Mọi vai trò đã đăng nhập; assertAccess giới hạn theo sở hữu (khách: lịch của mình, chủ sân: cụm sân của mình, admin: tất cả).
router.get('/:id', requireRole(), async (req, res) => {
  const id = bookingId(req);
  await assertAccess(req.user, id);
  res.json(await bookingDetail(id, req.user));
});

router.post('/:id/cancel', requireRole('customer'), async (req, res) => {
  const id = bookingId(req);
  await cancelBooking(req.user, id, req.body?.reason, 'customer');
  res.json(await bookingDetail(id, req.user));
});

module.exports = router;
