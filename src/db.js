// Cổng truy cập MySQL duy nhất. Mọi code (route, service, seed, test) dùng `db.query`/`withTransaction` ở đây.
//
// Quy ước chuyển tên: SQL viết cột snake_case; MỌI hàng đọc ra được đổi khóa sang camelCase ở đúng một chỗ này
// (lib/camel.js, chỉ khóa cột, không đụng khóa bên trong cột JSON). Nhờ vậy response không bao giờ lộ snake_case
// và không route nào phải tự đổi. Muốn truy cập thô thì dùng `.raw`, nhưng đừng trả kết quả thô ra JSON.
const mysql = require('mysql2/promise');
const config = require('./config');
const { camelRow } = require('./lib/camel');

const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  // DATETIME giữ dạng chuỗi 'YYYY-MM-DD HH:MM:SS' giờ VN, tránh lệch múi giờ khi đổi sang Date.
  dateStrings: true,
  timezone: '+07:00',
  charset: 'utf8mb4',
});

pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+07:00'");
});

function wrap(executor) {
  return {
    raw: executor,
    /** SELECT -> mảng hàng camelCase; INSERT/UPDATE/DELETE -> ResultSetHeader ({ insertId, affectedRows }). */
    async query(sql, params) {
      const [result] = await executor.query(sql, params);
      return Array.isArray(result) ? result.map(camelRow) : result;
    },
    async one(sql, params) {
      const rows = await this.query(sql, params);
      return rows[0] ?? null;
    },
  };
}

const db = wrap(pool);

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/** Chạy fn(tx) trong một transaction; tx có query/one như db. Tự thử lại tối đa 2 lần khi deadlock. */
async function withTransaction(fn) {
  for (let attempt = 0; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(wrap(conn));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (RETRYABLE.has(err.code) && attempt < 2) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}

/** Lỗi trùng khóa; keyName (tùy chọn) để phân biệt UNIQUE nào bị vi phạm. */
const isDuplicate = (err, keyName) => err?.code === 'ER_DUP_ENTRY' && (!keyName || String(err.sqlMessage || '').includes(keyName));

module.exports = { db, pool, withTransaction, isDuplicate };
