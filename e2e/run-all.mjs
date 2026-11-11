// npm run e2e:all -- [HH:MM]  — chạy mọi flow ở 390 và 1280 (hoặc các khổ trong E2E_WIDTHS, vd E2E_WIDTHS=390); kết quả: e2e/out/out-<flow>-<w>.txt và e2e/out/summary.txt
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const flows = ['f-auth-intent', 'f12', 'f345', 'f-transfer', 'f-match', 'f-request', 'f-stake', 'f-phone', 'f-owner-ux', 'f-league', 'f-leagues-public', 'f-home', 'f-live-smoke', 'adm-refund', 'seo', 'f-autopay', 'b3-search', 'b3-cart'];
const anchor = process.argv[2];
fs.mkdirSync('e2e/out', { recursive: true });
const lines = [];
const widths = process.env.E2E_WIDTHS ? process.env.E2E_WIDTHS.split(",").map(Number) : [390, 1280];
for (const w of widths) for (const f of flows) {
  const r = spawnSync(process.execPath, [`${dir}${f}.mjs`, String(w), ...(anchor ? [anchor] : [])], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(`e2e/out/out-${f}-${w}.txt`, out);
  const n = (re) => out.split('\n').filter((l) => re.test(l)).length;
  const line = `${f} ${w} exit=${r.status} ok=${n(/^OK/)} fail=${n(/^FAIL\s/)}`;
  console.log(line); lines.push(line);
}
fs.writeFileSync('e2e/out/summary.txt', lines.join('\n') + '\nDONE\n');
