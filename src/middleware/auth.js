const { db } = require('../db');
const { unauthorized, forbidden } = require('../utils/errors');

// Nạp lại user từ DB mỗi request: tài khoản bị khóa hoặc đổi quyền có hiệu lực ngay.
async function loadUser(req, res, next) {
  req.user = null;
  if (req.session?.userId) {
    const u = await db.one('SELECT id, full_name, email, phone, role, is_active FROM users WHERE id = ?', [req.session.userId]);
    if (u && u.isActive) req.user = { id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role };
    else delete req.session.userId;
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (roles.length && !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

module.exports = { loadUser, requireRole };
