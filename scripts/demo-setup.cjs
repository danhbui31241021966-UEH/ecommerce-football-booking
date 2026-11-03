// One-time local demo secrets. Updates only missing/placeholder keys and never prints their values.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');

const envPath = path.resolve('.env');
if (!fs.existsSync(envPath)) {
  console.error('Thiếu .env; tạo từ .env.example rồi chạy lại npm run demo:setup.');
  process.exit(1);
}

const original = fs.readFileSync(envPath, 'utf8');
const values = dotenv.parse(original);
const lines = original.match(/[^\n]*\n|[^\n]+$/g) || [];
let changed = false;
const outcomes = [];

for (const key of ['PROXY_SECRET', 'SEPAY_API_KEY']) {
  const matching = [];
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  lines.forEach((line, index) => { if (pattern.test(line)) matching.push(index); });
  if (matching.length > 1) {
    console.error(`Có nhiều dòng ${key} trong .env; gộp còn một dòng rồi chạy lại để tránh cấu hình mơ hồ.`);
    process.exit(1);
  }

  const current = values[key];
  if (current && !/^change_me/i.test(current)) {
    outcomes.push(`Giữ nguyên ${key} hiện có.`);
    continue;
  }

  const secret = crypto.randomBytes(48).toString('hex');
  const line = `${key}=${secret}`;
  if (matching.length) {
    const index = matching[0];
    const ending = lines[index].endsWith('\r\n') ? '\r\n' : lines[index].endsWith('\n') ? '\n' : '';
    lines[index] = line + ending;
  } else {
    if (lines.length && !lines.at(-1).endsWith('\n')) lines[lines.length - 1] += '\n';
    lines.push(line + (original.includes('\r\n') ? '\r\n' : '\n'));
  }
  changed = true;
  outcomes.push(`Đã tạo ${key} ngẫu nhiên.`);
}

if (changed) {
  const temp = `${envPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, lines.join(''), 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, envPath);
}
for (const outcome of outcomes) console.log(outcome);
console.log('Không in giá trị bí mật. Lệnh đặt PROXY_SECRET lên Pages Preview (chạy ở root worktree; đọc từ .env và gửi qua stdin):');
console.log(`PROXY_SECRET="$(node -e 'const d=require("dotenv"); process.stdout.write(d.parse(require("fs").readFileSync(".env","utf8")).PROXY_SECRET)')" && printf %s "$PROXY_SECRET" | npx --no-install wrangler pages secret put PROXY_SECRET --project-name ggo-datsan --env preview`);
console.log('Khi gắn webhook SePay, lấy SEPAY_API_KEY từ .env và dán vào cấu hình webhook; hiện chưa cấu hình webhook.');
