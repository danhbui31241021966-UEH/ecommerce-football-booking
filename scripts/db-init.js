// Tạo lại toàn bộ bảng từ db/schema.sql trong database DB_NAME (đã tồn tại). Nạp dữ liệu demo bằng `npm run db:seed`.
// CẢNH BÁO: xóa sạch dữ liệu hiện có trong database đó.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const SCHEMA = path.join(__dirname, '..', 'db', 'schema.sql');

/** Xóa mọi bảng đang có (kể cả bảng của bản schema cũ) rồi chạy schema.sql trên kết nối đã chọn database. Dùng chung với bộ chạy test. */
async function applySchema(conn) {
  const [tables] = await conn.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await conn.query(`DROP TABLE \`${t.name}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  await conn.query(fs.readFileSync(SCHEMA, 'utf8'));
}

async function main() {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  await applySchema(conn);
  await conn.end();
  console.log(`Đã tạo bảng trong database "${config.db.database}"`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { applySchema, SCHEMA };
