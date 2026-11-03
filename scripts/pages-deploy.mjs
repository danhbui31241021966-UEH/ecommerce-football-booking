#!/usr/bin/env node
// Deploy bản tĩnh (public/ + functions/) lên Cloudflare Pages, project "ggo-datsan".
//   node scripts/pages-deploy.mjs --branch <tên> [--backend https://xxx.trycloudflare.com]
//   - có --backend: bản trỏ về BE đó (Function /api/* chuyển tới BE, /js/mode.js ra chế độ thật)
//   - không có --backend: bản mock (dữ liệu giả, Function không chuyển gì)
//   - nhánh production (main) chỉ deploy khi có thêm --production
//   Thành công: exit 0 và dòng cuối stdout là URL của bản deploy.
//   Địa chỉ BE được nhúng vào functions/_lib/backend.generated.js (gitignore) cho đúng lần deploy này, rồi trả về rỗng sau khi xong.
//   PROXY_SECRET không do script đặt. Đặt một lần cho mỗi môi trường, giá trị trùng PROXY_SECRET trong .env của BE:
//     printf %s "$PROXY_SECRET" | npx wrangler pages secret put PROXY_SECRET --project-name ggo-datsan --env preview
//     printf %s "$PROXY_SECRET" | npx wrangler pages secret put PROXY_SECRET --project-name ggo-datsan --env production   (không có --env = production)
//   --env không hiện trong --help của wrangler 4.111 nhưng có hiệu lực (kiểm bằng `secret list --env preview|production`). Secret chỉ ăn ở lần deploy KẾ TIẾP:
//   đổi giá trị xong phải deploy lại. Nhánh preview nào cũng dùng chung secret của môi trường preview.
//   --dev [--port 8788]: chạy `wrangler pages dev` tại máy, cần PROXY_SECRET trong môi trường (ghi tạm vào .dev.vars rồi xóa).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = path.join(ROOT, 'functions/_lib/backend.generated.js');
const DEV_VARS = path.join(ROOT, '.dev.vars');
const PROJECT = 'ggo-datsan';
const PRODUCTION_BRANCH = 'main';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const fail = (m) => { console.error(`pages-deploy: ${m}`); process.exit(1); };

const dev = flag('dev');
const backend = (value('backend') || '').replace(/\/+$/, '');
const branch = value('branch');
if (backend) {
  let u; try { u = new URL(backend); } catch { fail(`--backend không phải URL: ${backend}`); }
  if (u.pathname !== '/' || u.search) fail('--backend chỉ gồm địa chỉ gốc, không có đường dẫn');
  if (!dev && u.protocol !== 'https:') fail('--backend phải là https (tunnel)');
}
if (!dev) {
  if (!branch) fail('thiếu --branch <tên>');
  if (branch === PRODUCTION_BRANCH && !flag('production')) fail(`nhánh "${PRODUCTION_BRANCH}" là production: thêm --production nếu thật sự muốn deploy`);
  if (flag('production') && branch !== PRODUCTION_BRANCH) fail(`--production chỉ đi với --branch ${PRODUCTION_BRANCH}`);
}

const writeBackend = (url) => fs.writeFileSync(GENERATED, `export default ${JSON.stringify(url)};\n`);
const cleanup = () => { writeBackend(''); fs.rmSync(DEV_VARS, { force: true }); };
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130));

writeBackend(backend);
const wrangler = (a, opts = {}) => spawn('npx', ['--no-install', 'wrangler', ...a], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

if (dev) {
  if (backend && !process.env.PROXY_SECRET) fail('--dev cần PROXY_SECRET trong môi trường (trùng PROXY_SECRET của BE)');
  fs.writeFileSync(DEV_VARS, `PROXY_SECRET=${process.env.PROXY_SECRET || ''}\n`, { mode: 0o600 });
  const child = wrangler(['pages', 'dev', 'public', '--compatibility-date', '2025-09-01', '--port', value('port') || '8788'], { stdio: 'inherit' });
  process.on('exit', () => child.kill('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const child = wrangler(['pages', 'deploy', 'public', '--project-name', PROJECT, '--branch', branch, '--commit-dirty=true']);
  let out = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; process.stderr.write(d); });
  child.on('exit', (code) => {
    if (code !== 0) fail(`wrangler thoát với mã ${code}`);
    const urls = out.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/g) || [];
    const alias = (out.match(/alias URL:\s*(https:\/\/\S+)/i) || [])[1];
    // Deploy production không in alias URL, chỉ in URL theo mã bản deploy; địa chỉ production là cố định.
    const url = flag('production') ? `https://${PROJECT}.pages.dev` : alias || urls[urls.length - 1];
    if (!url) fail('không đọc được URL từ kết quả wrangler');
    console.log(url);
  });
}
