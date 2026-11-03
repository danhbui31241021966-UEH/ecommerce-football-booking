// Thao tác của chủ sân và admin trên lịch đặt dùng chung một bộ xử lý; khác nhau ở phạm vi (chủ sân: cụm sân của mình)
// và `by` ghi vào lịch. Quyền theo sở hữu do bookingOps.assertAccess kiểm.
const express = require('express');
const { requireRole } = require('../middleware/auth');
const { notFound } = require('../utils/errors');
const ops = require('../services/bookingOps');
const { listBookings } = require('../services/bookingView');
const { createPhoneBooking, updatePhoneBooking } = require('../services/phoneBooking');

/** role: 'owner' | 'admin'. Router gắn dưới /api/owner/bookings hoặc /api/admin/bookings. */
function staffBookingRouter(role) {
  const router = express.Router();
  const guard = requireRole(role);
  const act = (name, run) =>
    router.post(`/:id/${name}`, guard, async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw notFound('Không tìm thấy lịch đặt');
      await run(req.user, id, req.body || {});
      res.json({ ok: true });
    });

  router.get('/', guard, async (req, res) => {
    const { status, date, venueId, q } = req.query;
    res.json(await listBookings({ ownerId: role === 'owner' ? req.user.id : null, status, date, venueId, q }));
  });
  if (role === 'owner') {
    router.post('/', guard, async (req, res) => res.status(201).json(await createPhoneBooking(req.user, req.body)));
    router.put('/:id', guard, async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw notFound('Không tìm thấy lịch đặt');
      res.json(await updatePhoneBooking(req.user, id, req.body));
    });
    act('approve', (u, id) => ops.approveBooking(u, id));
    act('reject', (u, id, p) => ops.rejectBooking(u, id, p.reason));
  }
  act('cancel', (u, id, p) => ops.cancelBooking(u, id, p.reason, role));
  act('paid', (u, id, p) => ops.markPaid(u, id, p.note));
  act('refund', (u, id, p) => ops.markRefunded(u, id, p.note, p.part));
  act('attendance', (u, id, p) => ops.markAttendance(u, id, p.result));
  return router;
}

module.exports = { staffBookingRouter };
