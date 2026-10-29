const crypto = require('crypto');
const { HttpError } = require('../utils/errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueToken(req) {
  req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

function ensureToken(req) {
  return req.session.csrfToken || issueToken(req);
}

// Synchronizer token: mọi request thay đổi dữ liệu phải gửi header X-CSRF-Token khớp với session.
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = Buffer.from(req.get('X-CSRF-Token') || '');
  const expected = Buffer.from(req.session.csrfToken || '');
  const ok = expected.length > 0 && sent.length === expected.length && crypto.timingSafeEqual(sent, expected);
  if (!ok) return next(new HttpError(403, 'Phiên làm việc đã hết hạn, vui lòng tải lại trang'));
  next();
}

module.exports = { csrfProtection, issueToken, ensureToken };
