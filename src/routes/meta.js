const express = require('express');
const { RULES, BANKS } = require('../rules');
const clock = require('../clock');

const router = express.Router();

// `now` là đồng hồ của server (có thể đã bị tua ở môi trường dev); FE dùng nó để đếm ngược.
router.get('/', (req, res) => {
  res.json({ ...RULES, banks: BANKS, now: clock.now() });
});

module.exports = router;
