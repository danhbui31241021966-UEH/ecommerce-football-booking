const { HttpError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ' });
  console.error(err);
  res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau' });
}

function apiNotFound(req, res) {
  res.status(404).json({ error: 'API không tồn tại' });
}

module.exports = { errorHandler, apiNotFound };
