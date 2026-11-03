// npm run e2e -- <flow> [width] [HH:MM]   (vd: npm run e2e -- f12 390 14:00)
// Trang kiểm tra lấy từ env U (mặc định mock http://127.0.0.1:4100). HH:MM là giờ neo của đồng hồ mock.
// Trình duyệt: Chrome ở /Applications, hoặc đặt CHROME_PATH tới tệp chạy Chrome/Chromium khác.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const [flow, ...rest] = process.argv.slice(2);
if (!flow || !fs.existsSync(`${dir}${flow}.mjs`)) {
  console.error('Dùng: npm run e2e -- <flow> [width] [HH:MM]\nFlow:', fs.readdirSync(dir).filter((f) => /^(f|adm|ov|photos|seo)/.test(f) && f.endsWith('.mjs')).map((f) => f.slice(0, -4)).join(' '));
  process.exit(2);
}
process.exit(spawnSync(process.execPath, [`${dir}${flow}.mjs`, ...rest], { stdio: 'inherit' }).status ?? 1);
