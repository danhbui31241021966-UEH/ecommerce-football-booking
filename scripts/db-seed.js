// Xóa dữ liệu và nạp lại dữ liệu demo (sân thật + sân demo + tài khoản demo). Cần chạy `npm run db:init` trước.
const { pool } = require('../src/db');
const { resetDemo } = require('../src/seed');

resetDemo()
  .then((r) => console.log('Đã nạp dữ liệu demo:', JSON.stringify(r)))
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
