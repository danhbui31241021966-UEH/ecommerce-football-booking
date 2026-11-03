const { sweepTransfers } = require('../services/transfers');

async function sweepTransferDue(req, res, next) {
  try {
    await sweepTransfers();
  } catch (err) {
    console.error('Quét pass hết hạn lỗi:', err.message);
  }
  next();
}

module.exports = sweepTransferDue;
