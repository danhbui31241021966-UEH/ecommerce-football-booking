#!/usr/bin/env node
// Cloudflare Pages (project "ggo-datsan") chỉ còn làm chuyển hướng 301 sang VPS; web chạy trên VPS.
//   node scripts/pages-deploy.mjs --redirect-to https://ggo.srv1741374.hstgr.cloud --branch <tên> [--production]
//   node scripts/pages-deploy.mjs --redirect-to <url> --dev [--port 8790]   (chạy `wrangler pages dev` tại máy để thử)
//   Thư mục deploy chỉ có _redirects (`/* <VPS>/:splat 301`: giữ path và query). Không có trang, _headers hay functions.
//   wrangler lấy functions/ theo cwd, nên chạy wrangler với cwd = chính thư mục tạm đó, không phải gốc repo.
//   nhánh production (main) chỉ deploy khi có thêm --production. Thành công: exit 0 và dòng cuối stdout là URL của bản deploy.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const { writeRedirectDist } = createRequire(import.meta.url)('../src/static-site.js');
const PROJECT = 'ggo-datsan';
const PRODUCTION_BRANCH = 'main';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const fail = (m) => { console.error(`pages-deploy: ${m}`); process.exit(1); };

const target = value('redirect-to');
if (!target) fail('thiếu --redirect-to <https://origin-VPS>; không còn deploy bản đầy đủ lên Pages');
const dev = flag('dev');
const branch = value('branch');
if (!dev) {
  if (!branch) fail('thiếu --branch <tên>');
  if (branch === PRODUCTION_BRANCH && !flag('production')) fail(`nhánh "${PRODUCTION_BRANCH}" là production: thêm --production nếu thật sự muốn deploy`);
  if (flag('production') && branch !== PRODUCTION_BRANCH) fail(`--production chỉ đi với --branch ${PRODUCTION_BRANCH}`);
}

const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'ggo-pages-'));
process.on('exit', () => fs.rmSync(DIST, { recursive: true, force: true }));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130));
try { writeRedirectDist(DIST, target); } catch (e) { fail(e.message); }
if (fs.readdirSync(DIST).join() !== '_redirects') fail('thư mục chuyển hướng phải chỉ có _redirects');

const bin = process.env.WRANGLER_BIN || 'wrangler'; // cần wrangler trong PATH (hoặc đặt WRANGLER_BIN)
const wrangler = (a, opts = {}) => spawn(bin, a, { cwd: DIST, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

if (dev) {
  const child = wrangler(['pages', 'dev', '.', '--compatibility-date', '2025-09-01', '--port', value('port') || '8790'], { stdio: 'inherit' });
  process.on('exit', () => child.kill('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const child = wrangler(['pages', 'deploy', '.', '--project-name', PROJECT, '--branch', branch, '--commit-dirty=true']);
  let out = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; process.stderr.write(d); });
  child.on('exit', (code) => {
    if (code !== 0) fail(`wrangler thoát với mã ${code}`);
    const urls = out.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/g) || [];
    const alias = (out.match(/alias URL:\s*(https:\/\/\S+)/i) || [])[1];
    const url = flag('production') ? `https://${PROJECT}.pages.dev` : alias || urls[urls.length - 1];
    if (!url) fail('không đọc được URL từ kết quả wrangler');
    console.log(url);
  });
}
