const express = require('express');
const v = require('../utils/validate');
const { requireRole } = require('../middleware/auth');
const bookings = require('../services/bookings');

const router = express.Router();

// F05: tạo booking (1 sân con + 1 slot)
router.post('/', requireRole('customer'), async (req, res) => {
  if (!v.bool(req.body.agreeTerms)) {
    return res.status(400).json({ error: 'Vui lòng đồng ý điều kiện sử dụng và chính sách hủy' });
  }
  const result = await bookings.createBooking(req.user, {
    courtId: v.id(req.body.courtId, 'Sân con'),
    date: v.date(req.body.date),
    start: v.time(req.body.start, 'Khung giờ'),
    idempotencyKey: String(req.body.idempotencyKey || ''),
    note: v.str(req.body.note, 'Ghi chú', { max: 255, optional: true }),
  });
  res.status(result.duplicate ? 200 : 201).json(await bookings.getDetail(req.user, result.id));
});

// F07: đơn của tôi
router.get('/mine', requireRole('customer'), async (req, res) => {
  res.json(await bookings.list({ customerId: req.user.id }));
});

// Chi tiết: khách (của mình), chủ sân (sân của mình), admin
router.get('/:id', requireRole(), async (req, res) => {
  res.json(await bookings.getDetail(req.user, v.id(req.params.id)));
});

router.post('/:id/cancel', requireRole('customer'), async (req, res) => {
  const refund = await bookings.cancelByCustomer(req.user, v.id(req.params.id));
  res.json({ ok: true, refund });
});

module.exports = router;
