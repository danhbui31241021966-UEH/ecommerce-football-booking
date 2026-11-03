const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  ROOT, STATE, MYSQLD, MYSQL_CNF, CLOUDFLARED, readEnv, validateProductionEnv,
  logPath, tail, writeState, readState, removeState, matches,
  recordProcess, acquireLock, releaseLock, stopExact, tcpConnect, waitForTcp, listeningMysqlPid, waitForApi,
} = require('./demo-lib.cjs');
const SERVER_LOG = logPath('server.log');
const TUNNEL_LOG = logPath('cloudflared.log');
const MYSQL_LOG = logPath('mysqld.log');
const args = process.argv.slice(2);
const branchIndex = args.indexOf('--branch');
const branch = branchIndex >= 0 ? args[branchIndex + 1] : '';
const production = args.includes('--production');

function parseBranch() {
  const branchFlags = args.filter((arg) => arg === '--branch').length;
  const productionFlags = args.filter((arg) => arg === '--production').length;
  if (branchFlags !== 1 || !branch || productionFlags !== Number(production) || args.length !== (production ? 3 : 2)) {
    throw new Error('Dùng: npm run demo:up -- --branch <preview-branch> [--production chỉ cho main].');
  }
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.startsWith('-')) throw new Error('Tên branch không hợp lệ.');
  if (production && branch !== 'main') throw new Error('--production chỉ được dùng cùng --branch main.');
  if (branch === 'main' && !production) throw new Error('Từ chối deploy branch production "main" nếu thiếu --production.');
  return { branch, production };
}
function activeState(state, wantedBranch, wantedProduction) {
  if (!state || state.status !== 'running') return false;
  const server = state.services?.server;
  const tunnel = state.services?.tunnel;
  if (!matches(server) || !matches(tunnel)) return false;
  if (state.branch !== wantedBranch || state.production !== wantedProduction) {
    throw new Error(`Demo đang chạy branch ${state.branch}${state.production ? ' (production)' : ''}; chạy npm run demo:down trước khi đổi branch/mode.`);
  }
  return true;
}
function appendChildOutput(file, result) {
  if (result.stdout) fs.appendFileSync(file, result.stdout);
  if (result.stderr) fs.appendFileSync(file, result.stderr);
}
async function run() {
  const lock = acquireLock('scripts/demo-up.cjs');
  let state = null;
  let success = false;
  try {
    const { branch: selectedBranch, production: deployProduction } = parseBranch();
    const env = readEnv();
    const proxySecret = validateProductionEnv(env);
    const deployScript = path.resolve(process.env.DEMO_PAGES_DEPLOY_SCRIPT || path.join(ROOT, 'scripts/pages-deploy.mjs'));
    if (!fs.existsSync(deployScript)) throw new Error(`Thiếu ${deployScript}; cần ghép script pages-deploy của fe-ui trước.`);

    const existing = readState();
    if (activeState(existing, selectedBranch, deployProduction)) {
      await waitForApi('http://127.0.0.1:3000', proxySecret, 8000, existing.services.server, SERVER_LOG, 'Server');
      await waitForApi(existing.tunnelUrl, proxySecret, 15000, existing.services.tunnel, TUNNEL_LOG, 'Tunnel', { record: existing.services.server, log: SERVER_LOG, label: 'Server' });
      await waitForApi(existing.pagesUrl, proxySecret, 15000, null, '', `Pages ${deployProduction ? 'Production' : 'Preview'} API`, { record: existing.services.server, log: SERVER_LOG, label: 'Server' });
      console.log(`Demo đã chạy; không tạo process mới. Pages: ${existing.pagesUrl}`);
      success = true;
      return;
    }
    if (existing) throw new Error(`State ${STATE} còn sót hoặc process lệch. Chạy npm run demo:down để dọn PID còn khớp rồi thử lại.`);

    if (await tcpConnect(3000)) {
      const lsof = spawnSync('lsof', ['-nP', '-t', '-iTCP:3000', '-sTCP:LISTEN'], { encoding: 'utf8' });
      throw new Error(`Cổng 3000 đã bị chiếm${lsof.stdout?.trim() ? ` bởi PID ${lsof.stdout.trim().replace(/\s+/g, ', ')}` : ''}; không đổi cổng và không dừng process đó.`);
    }
    state = { version: 1, status: 'starting', branch: selectedBranch, production: deployProduction, createdAt: new Date().toISOString(), services: {} };
    writeState(state);

    if (await tcpConnect(3306)) {
      const mysql = listeningMysqlPid();
      if (!mysql) throw new Error('Cổng 3306 đã mở nhưng PID không khớp mysqld đã cấu hình.');
      state.services.mysql = { ...mysql, startedByDemo: false };
      writeState(state);
      console.log(`MySQL vẫn chạy sẵn (PID ${mysql.pid}); không đổi trạng thái.`);
    } else {
      console.log('MySQL chưa chạy; bật bằng cấu hình ~/.local/mysql.cnf…');
      const result = spawnSync(MYSQLD, [`--defaults-file=${MYSQL_CNF}`, '--daemonize'], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
      });
      appendChildOutput(MYSQL_LOG, result);
      if (result.error && result.error.code !== 'ETIMEDOUT') throw new Error(`Không khởi chạy được mysqld (${result.error.code || 'error'}). Log cuối:\n${tail(MYSQL_LOG)}`);
      try { await waitForTcp(3306, 45000); }
      catch (error) { throw new Error(`${error.message}\nLog mysqld:\n${tail(MYSQL_LOG)}`); }
      const mysql = listeningMysqlPid();
      if (!mysql) throw new Error('MySQL đã mở cổng nhưng PID không khớp mysqld đã cấu hình.');
      state.services.mysql = { ...mysql, startedByDemo: true };
      writeState(state);
      console.log(`MySQL đã sẵn sàng (PID ${mysql.pid}); demo:down sẽ không tắt MySQL.`);
    }

    const serverLog = fs.openSync(SERVER_LOG, 'w', 0o600);
    let server;
    try {
      server = spawn(process.execPath, ['src/server.js'], {
        cwd: ROOT,
        env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000' },
        detached: true, stdio: ['ignore', serverLog, serverLog],
      });
    } finally { fs.closeSync(serverLog); }
    server.unref();
    if (!server.pid) throw new Error('Không lấy được PID của Express server.');
    state.services.server = recordProcess(server.pid, 'src/server.js');
    writeState(state);
    try { await waitForApi('http://127.0.0.1:3000', proxySecret, 45000, state.services.server, SERVER_LOG, 'Server'); }
    catch (error) { throw new Error(`${error.message}\nLog server:\n${tail(SERVER_LOG)}`); }
    console.log(`Express production sẵn sàng ở 127.0.0.1:3000 (PID ${state.services.server.pid}).`);

    const tunnelLog = fs.openSync(TUNNEL_LOG, 'w', 0o600);
    let tunnel;
    try {
      tunnel = spawn(CLOUDFLARED, ['tunnel', '--url', 'http://127.0.0.1:3000', '--no-autoupdate'], {
        cwd: ROOT, detached: true, stdio: ['ignore', tunnelLog, tunnelLog],
      });
    } finally { fs.closeSync(tunnelLog); }
    tunnel.unref();
    if (!tunnel.pid) throw new Error('Không lấy được PID của cloudflared.');
    state.services.tunnel = recordProcess(tunnel.pid, 'cloudflared tunnel --url http://127.0.0.1:3000');
    writeState(state);

    let tunnelUrl = '';
    const tunnelDeadline = Date.now() + 45000;
    while (Date.now() < tunnelDeadline && matches(state.services.tunnel)) {
      const text = fs.existsSync(TUNNEL_LOG) ? fs.readFileSync(TUNNEL_LOG, 'utf8') : '';
      tunnelUrl = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] || '';
      if (tunnelUrl) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!tunnelUrl) throw new Error(`cloudflared не выдаёт quick tunnel URL. Log cuối:\n${tail(TUNNEL_LOG)}`);
    state.tunnelUrl = tunnelUrl;
    writeState(state);
    const tunnelCheck = await waitForApi(tunnelUrl, proxySecret, 60000, state.services.tunnel, TUNNEL_LOG, 'Tunnel', { record: state.services.server, log: SERVER_LOG, label: 'Server' });
    console.log(`Tunnel /api/venues trả 200 sau ${(tunnelCheck.elapsedMs / 1000).toFixed(1)}s${tunnelCheck.firstFailure ? ` (lỗi đầu: ${tunnelCheck.firstFailure})` : ''}${tunnelCheck.fallback ? `; ${tunnelCheck.fallback}` : ''}: ${tunnelUrl}`);

    const deployArgs = [deployScript, '--branch', selectedBranch, '--backend', tunnelUrl];
    if (deployProduction) deployArgs.push('--production');
    const deployed = spawnSync(process.execPath, deployArgs, {
      cwd: ROOT,
      encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PROXY_SECRET: proxySecret },
    });
    if (deployed.stdout) process.stdout.write(deployed.stdout);
    if (deployed.stderr) process.stderr.write(deployed.stderr);
    if (deployed.error || deployed.status !== 0) {
      const detail = deployed.error?.code === 'ETIMEDOUT' ? 'quá thời gian' : `exit ${deployed.status}`;
      throw new Error(`Pages deploy lỗi (${detail}); server/tunnel sẽ được dừng.`);
    }
    const lines = (deployed.stdout || '').trim().split(/\r?\n/);
    const pagesUrl = lines.at(-1)?.trim() || '';
    const validPreviewUrl = /^https:\/\/[a-z0-9-]+\.sannhanh\.pages\.dev\/?$/i.test(pagesUrl);
    const validProductionUrl = /^https:\/\/sannhanh\.pages\.dev\/?$/i.test(pagesUrl);
    if (deployProduction ? !validProductionUrl : !validPreviewUrl) {
      throw new Error(`Script Pages không trả URL ${deployProduction ? 'production sannhanh.pages.dev' : 'preview sannhanh.pages.dev'} ở dòng cuối stdout.`);
    }
    const targetEnvironment = deployProduction ? 'Production' : 'Preview';
    try { await waitForApi(pagesUrl, proxySecret, 15000, null, '', `Pages ${targetEnvironment} API`, { record: state.services.server, log: SERVER_LOG, label: 'Server' }); }
    catch (error) {
      throw new Error(`Pages ${targetEnvironment} đã deploy nhưng /api/venues chưa trả 200; kiểm tra secret PROXY_SECRET của ${targetEnvironment} và Function. Chi tiết: ${error.message}`);
    }
    state.pagesUrl = pagesUrl;
    state.status = 'running';
    writeState(state);
    console.log(`Demo sẵn sàng trên Pages ${targetEnvironment}: ${pagesUrl}`);
    success = true;
  } finally {
    if (!success && state) {
      for (const [name, record] of [['tunnel', state.services?.tunnel], ['server', state.services?.server]]) {
        if (!record) continue;
        try { stopExact(record, name); } catch (error) { console.error(`Không dừng được ${name}: ${error.message}`); }
      }
      removeState();
      console.error('MySQL không bị demo:up lỗi/cleanup dừng; nếu demo:up vừa khởi động MySQL thì PID được giữ nguyên.');
    }
    releaseLock(lock);
  }
}

run().catch((error) => { console.error(`demo:up: ${error.message}`); process.exitCode = 1; });
