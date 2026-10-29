const { pool } = require('../db');
const { unauthorized, forbidden } = require('../utils/errors');

// Nạp lại user từ DB mỗi request: tài khoản bị khóa hoặc đổi quyền có hiệu lực ngay.
async function loadUser(req, res, next) {
  req.user = null;
  if (req.session?.userId) {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, phone, role, is_active FROM users WHERE id = ?',
      [req.session.userId],
    );
    if (rows.length && rows[0].is_active) req.user = rows[0];
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
