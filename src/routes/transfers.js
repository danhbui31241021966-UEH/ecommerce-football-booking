const express = require('express');
const { requireRole } = require('../middleware/auth');
const { createTransfer, claimTransfer, withdrawTransfer, confirmTransfer, rejectTransfer, listTransfers, listMine, listForOwner, getTransfer } = require('../services/transfers');

const router = express.Router();

router.post('/bookings/:id/transfer', requireRole('customer'), async (req, res) => {
  res.status(201).json(await createTransfer(req.user, req.params.id, req.body?.askPrice));
});

router.get('/transfers', async (req, res) => {
  res.json(await listTransfers({ ...req.query, viewer: req.user }));
});

router.get('/transfers/mine', requireRole('customer'), async (req, res) => {
  res.json(await listMine(req.user));
});

router.get('/transfers/:id', async (req, res) => {
  res.json(await getTransfer(req.params.id, req.user));
});

router.post('/transfers/:id/claim', requireRole('customer'), async (req, res) => {
  res.json(await claimTransfer(req.user, req.params.id));
});

router.delete('/transfers/:id', requireRole('customer'), async (req, res) => {
  res.json(await withdrawTransfer(req.user, req.params.id));
});

router.get('/owner/transfers', requireRole('owner'), async (req, res) => {
  res.json(await listForOwner(req.user));
});

router.post('/owner/transfers/:id/confirm', requireRole('owner'), async (req, res) => {
  res.json(await confirmTransfer(req.user, req.params.id, req.body?.note));
});

router.post('/owner/transfers/:id/reject', requireRole('owner'), async (req, res) => {
  res.json(await rejectTransfer(req.user, req.params.id, req.body?.reason));
});

module.exports = router;
