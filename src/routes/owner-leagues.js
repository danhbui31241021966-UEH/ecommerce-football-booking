// Giải phủi của chủ sân (R18). Kiểm quyền sở hữu nằm ở leagueOps (404 không có giải, 403 giải của sân khác).
const express = require('express');
const { requireRole } = require('../middleware/auth');
const l = require('../services/leagueOps');

const router = express.Router();
router.use(requireRole('owner'));

router.get('/', async (req, res) => res.json(await l.listOwn(req.user, req.query)));
router.post('/', async (req, res) => res.status(201).json(await l.createLeague(req.user, req.body || {})));
router.get('/:id', async (req, res) => res.json(await l.getOwn(req.user, req.params.id)));
router.put('/:id', async (req, res) => res.json(await l.updateLeague(req.user, req.params.id, req.body || {})));
router.delete('/:id', async (req, res) => res.json(await l.deleteLeague(req.user, req.params.id)));
router.post('/:id/teams', async (req, res) => res.status(201).json(await l.addTeam(req.user, req.params.id, req.body || {})));
router.put('/:id/teams/:tid', async (req, res) => res.json(await l.updateTeam(req.user, req.params.id, req.params.tid, req.body || {})));
router.delete('/:id/teams/:tid', async (req, res) => res.json(await l.deleteTeam(req.user, req.params.id, req.params.tid)));
router.post('/:id/teams/:tid/withdraw', async (req, res) => res.json(await l.withdrawTeam(req.user, req.params.id, req.params.tid, req.body || {})));
router.post('/:id/fixtures', async (req, res) => res.json(await l.makeFixtures(req.user, req.params.id)));
router.put('/:id/plan', async (req, res) => res.json(await l.savePlan(req.user, req.params.id, req.body || {})));
router.post('/:id/auto-plan', async (req, res) => res.json(await l.autoPlan(req.user, req.params.id, req.body || {})));
router.post('/:id/publish', async (req, res) => res.json(await l.publish(req.user, req.params.id)));
router.post('/:id/matches/:mid/reschedule', async (req, res) => res.json(await l.reschedule(req.user, req.params.id, req.params.mid, req.body || {})));
router.post('/:id/matches/:mid/score', async (req, res) => res.json(await l.score(req.user, req.params.id, req.params.mid, req.body || {})));

module.exports = router;
