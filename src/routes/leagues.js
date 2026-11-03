// Giải phủi công khai (R18): không cần đăng nhập, chỉ giải đã công bố (giải nháp 404 và không có trong danh sách).
const express = require('express');
const l = require('../services/leagueOps');

const router = express.Router();

router.get('/', async (req, res) => res.json(await l.listPublic(req.query)));
router.get('/:id', async (req, res) => res.json(await l.getPublic(req.params.id)));

module.exports = router;
