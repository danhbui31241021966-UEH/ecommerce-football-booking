#!/usr/bin/env node
// Dựng bản tĩnh chế độ dữ liệu mẫu (js/mode.js để SERVED_BY_API=false), đúng các file Cloudflare Pages nhận khi deploy không có --backend.
//   node scripts/static-build.mjs [thư-mục-ra=dist] [--nginx-redirects <file>] [--nginx-headers <file>]
//   Thư mục ra bị xóa và dựng lại; chỉ nhận thư mục nằm trong repo, khác gốc repo (mặc định dist/, đã gitignore).
//   --nginx-redirects, --nginx-headers: ghi thêm bảng chuyển hướng và header bảo mật dạng nginx (Dockerfile dùng, xem deploy/static/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { writeDist, nginxRedirects, nginxHeaders } = createRequire(import.meta.url)('../src/static-site.js');
const args = process.argv.slice(2);
const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : null; };
const nginxFile = take('--nginx-redirects');
const headersFile = take('--nginx-headers');
const out = path.resolve(args[0] || path.join(ROOT, 'dist'));
const rel = path.relative(ROOT, out);
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { console.error(`static-build: thư mục ra phải nằm trong repo và khác gốc repo: ${out}`); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
writeDist(out, ROOT);
if (nginxFile) fs.writeFileSync(path.resolve(nginxFile), nginxRedirects());
if (headersFile) fs.writeFileSync(path.resolve(headersFile), nginxHeaders());
console.log(out);
