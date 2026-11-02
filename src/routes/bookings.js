const express = require('express');
const { requireRole } = require('../middleware/auth');
const { createBooking } = require('../services/bookingCore');

const router = express.Router();

// Phần đặt sân đầy đủ (mine, reliability, chi tiết, hủy...) thêm vào router này.
router.post('/', requireRole('customer'), async (req, res) => {
  const { booking, created } = await createBooking(req.user, req.body);
  res.status(created ? 201 : 200).json(booking);
});

module.exports = router;
