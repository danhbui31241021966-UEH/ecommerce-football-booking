const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
if (!process.argv.slice(2).includes('--yes')) {
  console.error('Tác vụ xóa dữ liệu: nạp lại toàn bộ dữ liệu demo trong DB_NAME. Xác nhận rõ bằng: npm run demo:seed -- --yes');
  process.exit(2);
}
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  console.error('Thiếu .env; không biết DB_NAME mục tiêu.');
  process.exit(1);
}
const env = { ...dotenv.parse(fs.readFileSync(envPath, 'utf8')), ...process.env };
if (!env.DB_NAME || !env.DB_USER) {
  console.error('DB_NAME hoặc DB_USER chưa được cấu hình.');
  process.exit(1);
}
if (env.DB_USER.toLowerCase() === 'root') {
  console.error('Từ chối nạp dữ liệu bằng MySQL root; hãy dùng fb_app trong .env.');
  process.exit(1);
}
console.warn(`CẢNH BÁO: thao tác này xóa toàn bộ dữ liệu hiện có trong database "${env.DB_NAME}" rồi nạp dữ liệu demo.`);
const result = spawnSync(process.execPath, ['scripts/db-seed.js'], {
  cwd: root, env: process.env, stdio: 'inherit', timeout: 120000,
});
if (result.error) {
  console.error(result.error.code === 'ETIMEDOUT' ? 'db:seed vượt quá 120 giây.' : `Không chạy được db:seed (${result.error.code || 'error'}).`);
  process.exit(1);
}
process.exit(result.status ?? 1);
