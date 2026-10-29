// Tạo lại toàn bộ bảng từ db/schema.sql. Thêm --seed để nạp dữ liệu mẫu.
// CẢNH BÁO: xóa sạch dữ liệu hiện có trong database DB_NAME.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { seed } = require('./seed-data');

async function main() {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true, dateStrings: true });
  await conn.query("SET time_zone = '+07:00'");
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  console.log(`Đã tạo bảng trong database "${config.db.database}"`);
  if (process.argv.includes('--seed')) {
    await seed(conn);
    console.log('Đã nạp dữ liệu mẫu');
  }
  await conn.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
