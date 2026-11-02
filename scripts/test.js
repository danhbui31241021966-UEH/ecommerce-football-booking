// `npm test`: tạo một CSDL riêng football_booking_test_<ngẫu nhiên> bằng chính tài khoản DB_USER, dựng schema,
// chạy toàn bộ tests/**/*.test.js trên đó (mỗi file tự đặt lại dữ liệu bằng tests/helpers), rồi XÓA CSDL
// kể cả khi test lỗi hoặc bị Ctrl-C. Không bao giờ động tới CSDL DB_NAME.
const { spawn } = require('child_process');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { applySchema } = require('./db-init');

const PREFIX = 'football_booking_test_';

async function main() {
  const name = `${PREFIX}${crypto.randomBytes(4).toString('hex')}`;
  const admin = await mysql.createConnection({ ...config.db, database: undefined, multipleStatements: true });
  let dropped = false;
  const drop = async () => {
    if (dropped) return;
    dropped = true;
    // Chốt an toàn: chỉ xóa đúng CSDL do lần chạy này tạo.
    if (name.startsWith(PREFIX)) await admin.query(`DROP DATABASE IF EXISTS \`${name}\``).catch((e) => console.error('Không xóa được CSDL test:', e.message));
    await admin.end().catch(() => {});
  };

  let code = 1;
  try {
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.query(`USE \`${name}\``);
    await applySchema(admin);
    console.log(`# CSDL test: ${name}`);
    const files = process.argv.slice(2);
    const args = ['--test', '--test-concurrency=1', ...(files.length ? files : ['tests/**/*.test.js'])];
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', DB_NAME: name, FB_TEST_DB: name },
    });
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
    code = await new Promise((resolve) => child.on('exit', (c, s) => resolve(c ?? (s ? 1 : 0))));
  } finally {
    await drop();
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
