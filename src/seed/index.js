// Đặt lại toàn bộ dữ liệu về trạng thái demo. Mỗi tính năng thêm hàm nạp của mình vào SEEDERS (chạy theo thứ tự);
// seeder nhận `tx` (transaction) và có thể dùng id cố định của seedCore.
const { pool, withTransaction } = require('../db');
const { seedCore } = require('./core');
const { seedBookings } = require('./bookings');
const { seedBlocks } = require('./blocks');

const SEEDERS = [
  { name: 'core', run: seedCore },
  { name: 'bookings', run: seedBookings },
  { name: 'blocks', run: seedBlocks },
];

/** Xóa mọi dữ liệu (giữ cấu trúc và bảng sessions, đặt lại AUTO_INCREMENT) rồi nạp lại. Trả số liệu của từng seeder. */
async function resetDemo() {
  const conn = await pool.getConnection();
  try {
    const [tables] = await conn.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> 'sessions'",
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t.name || t.NAME || t.TABLE_NAME}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
  return withTransaction(async (tx) => {
    const out = {};
    for (const s of SEEDERS) out[s.name] = await s.run(tx);
    return out;
  });
}

module.exports = { resetDemo, SEEDERS };
