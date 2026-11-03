// Chủ sân xử lý kèo ghép của sân mình (R13, R15). Kiểm quyền sở hữu nằm ở matchOps (403 nếu kèo của sân khác).
const express = require('express');
const { requireRole } = require('../middleware/auth');
const m = require('../services/matchOps');

const router = express.Router();
const owner = requireRole('owner');

router.get('/', owner, async (req, res) => res.json(await m.listForOwner(req.user)));
router.post('/:id/confirm-part', owner, async (req, res) => res.json(await m.confirmPart(req.user, req.params.id, req.body?.part, req.body?.note)));
router.post('/:id/reject-guest', owner, async (req, res) => res.json(await m.rejectGuest(req.user, req.params.id, req.body?.reason)));
router.post('/:id/result', owner, async (req, res) => res.json(await m.ownerSettle(req.user, req.params.id, req.body?.winner)));
router.post('/:id/cancel', owner, async (req, res) => res.json(await m.cancelByStaff(req.user, req.params.id, req.body?.reason)));
router.post('/:id/refund', owner, async (req, res) => res.json(await m.refundPart(req.user, req.params.id, req.body?.part, req.body?.note)));

module.exports = router;
