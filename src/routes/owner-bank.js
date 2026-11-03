// Chủ sân xem khoản ngân hàng báo về tài khoản sân của mình và đánh dấu đã xử lý (R17).
const express = require('express');
const { requireRole } = require('../middleware/auth');
const bank = require('../services/bankOps');

const router = express.Router();
const owner = requireRole('owner');

router.get('/bank-events', owner, async (req, res) => res.json(await bank.listForOwner(req.user)));
router.post('/bank-events/:id/resolve', owner, async (req, res) => res.json(await bank.resolve(req.user, req.params.id, req.body?.note)));

module.exports = router;
