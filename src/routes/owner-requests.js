// Chủ sân xem nhu cầu phù hợp và gửi/rút chào giá (R14). Kiểm quyền sở hữu sân nằm ở requestOps (403).
const express = require('express');
const { requireRole } = require('../middleware/auth');
const r = require('../services/requestOps');

const router = express.Router();
const owner = requireRole('owner');

router.get('/requests', owner, async (req, res) => res.json(await r.listForOwner(req.user)));
router.post('/requests/:id/offers', owner, async (req, res) => res.status(201).json(await r.sendOffer(req.user, req.params.id, req.body || {})));
router.delete('/offers/:id', owner, async (req, res) => res.json(await r.withdrawOffer(req.user, req.params.id)));

module.exports = router;
