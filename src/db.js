const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  // Giữ DATETIME dạng chuỗi 'YYYY-MM-DD HH:MM:SS' theo giờ VN, tránh lệch múi giờ khi đổi sang Date.
  dateStrings: true,
  timezone: '+07:00',
  charset: 'utf8mb4',
});

// NOW() trong SQL phải cùng múi giờ với dữ liệu.
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+07:00'");
});

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };
