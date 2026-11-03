// Ghép kèo của khách (R13, R15). Xem danh sách kèo đang mở và một kèo không cần đăng nhập; mọi thao tác khác cần vai khách.
const express = require('express');
const { requireRole } = require('../middleware/auth');
const m = require('../services/matchOps');

const router = express.Router();
const customer = requireRole('customer');

router.post('/', customer, async (req, res) => res.status(201).json(await m.openMatch(req.user, req.body)));
router.get('/', async (req, res) => res.json(await m.listOpen(req.query, req.user)));
router.get('/mine', customer, async (req, res) => res.json(await m.listMine(req.user)));
router.get('/:id', async (req, res) => res.json(await m.getMatch(req.params.id, req.user)));
router.post('/:id/join', customer, async (req, res) => res.json(await m.joinMatch(req.user, req.params.id)));
router.post('/:id/result', customer, async (req, res) => res.json(await m.reportResult(req.user, req.params.id, req.body || {})));
router.put('/:id/bank', customer, async (req, res) => res.json(await m.setBank(req.user, req.params.id, req.body || {})));
router.post('/:id/topup-received', customer, async (req, res) => res.json(await m.topUpReceived(req.user, req.params.id)));
router.delete('/:id', customer, async (req, res) => res.json(await m.withdrawMatch(req.user, req.params.id)));

module.exports = router;
