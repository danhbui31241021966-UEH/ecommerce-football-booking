// Nhu cầu nhờ báo giá của khách (R14). Khách chỉ thấy và thao tác trên nhu cầu của chính mình (404 nếu không phải của mình).
const express = require('express');
const { requireRole } = require('../middleware/auth');
const r = require('../services/requestOps');

const router = express.Router();
const customer = requireRole('customer');

router.post('/', customer, async (req, res) => res.status(201).json(await r.openRequest(req.user, req.body)));
router.get('/mine', customer, async (req, res) => res.json(await r.listMine(req.user)));
router.get('/:id', customer, async (req, res) => res.json(await r.getRequest(req.user, req.params.id)));
router.delete('/:id', customer, async (req, res) => res.json(await r.cancelRequest(req.user, req.params.id)));
router.post('/:id/accept', customer, async (req, res) => res.json(await r.acceptOffer(req.user, req.params.id, req.body || {})));

module.exports = router;
