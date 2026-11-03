const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const dns = require('node:dns');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, '.demo-state.json');
const LOCK = path.join(ROOT, '.demo-state.lock');
const LOGS = path.join(ROOT, '.demo-logs');
const MYSQLD = path.join(os.homedir(), '.local/mysql-8.4.9/bin/mysqld');
const MYSQL_CNF = path.join(os.homedir(), '.local/mysql.cnf');
const CLOUDFLARED = path.join(os.homedir(), '.local/bin/cloudflared');

function readEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error('Thiếu .env; tạo từ .env.example rồi chạy npm run demo:setup.');
  const fileEnv = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  return { ...fileEnv, ...process.env };
}

function validateProductionEnv(env) {
  const problems = [];
  const secret = (key) => String(env[key] || '');
  for (const key of ['SESSION_SECRET', 'PROXY_SECRET']) {
    const value = secret(key);
    if (value.length < 32 || /^change_me/i.test(value)) problems.push(`${key} thiếu, ngắn hơn 32 ký tự hoặc vẫn là change_me…`);
  }
  for (const key of ['SEPAY_API_KEY', 'DB_PASSWORD']) {
    const value = secret(key);
    if ((key === 'SEPAY_API_KEY' && !value) || /^change_me/i.test(value)) problems.push(`${key} thiếu hoặc vẫn là change_me…`);
  }
  if (secret('HOST') && !['127.0.0.1', '::1', 'localhost'].includes(secret('HOST'))) {
    problems.push('HOST phải là 127.0.0.1, ::1 hoặc localhost');
  }
  if (!secret('DB_USER')) problems.push('DB_USER chưa được cấu hình');
  else if (secret('DB_USER').toLowerCase() === 'root') problems.push('DB_USER không được là root; ứng dụng phải dùng fb_app');
  if (!secret('DB_NAME')) problems.push('DB_NAME chưa được cấu hình');
  if (!fs.existsSync(MYSQL_CNF)) problems.push(`Không thấy cấu hình MySQL ${MYSQL_CNF}`);
  if (!fs.existsSync(MYSQLD)) problems.push(`Không thấy mysqld ${MYSQLD}`);
  if (!fs.existsSync(CLOUDFLARED)) problems.push(`Không thấy cloudflared ${CLOUDFLARED}`);
  if (problems.length) throw new Error('Cấu hình demo chưa sẵn sàng:\n' + problems.map((x) => `- ${x}`).join('\n'));
  return secret('PROXY_SECRET');
}

function ensureLogs() { fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 }); }
function logPath(name) { ensureLogs(); return path.join(LOGS, name); }
function tail(file, count = 25) {
  try { return fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-count).join('\n'); }
  catch { return '(log chưa có)'; }
}
function writeState(state) {
  const tmp = `${STATE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, STATE);
}
function readState() {
  if (!fs.existsSync(STATE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch { throw new Error(`State ${STATE} hỏng; không tự xóa PID để tránh dừng nhầm.`); }
}
function removeState() { fs.rmSync(STATE, { force: true }); }

function processInfo(pid) {
  const common = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  const start = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], common);
  const command = spawnSync('ps', ['-p', String(pid), '-o', 'command='], common);
  const user = spawnSync('ps', ['-p', String(pid), '-o', 'user='], common);
  if (start.status !== 0 || command.status !== 0 || user.status !== 0) return null;
  return { start: start.stdout.trim(), command: command.stdout.trim(), user: user.stdout.trim() };
}
function matches(record) {
  if (!record || !Number.isInteger(Number(record.pid))) return false;
  const info = processInfo(record.pid);
  return !!info && info.user === (process.env.USER || os.userInfo().username)
    && info.start === record.started && info.command.includes(record.expected);
}
function acquireLock(expected) {
  const self = recordProcess(process.pid, expected);
  const attempt = () => {
    const fd = fs.openSync(LOCK, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(self)); } finally { fs.closeSync(fd); }
  };
  try { attempt(); return self; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch {}
    if (matches(existing)) throw new Error(`Another demo command is active (PID ${existing.pid}); no duplicate process started.`);
    fs.rmSync(LOCK, { force: true });
    attempt();
    return self;
  }
}
function releaseLock(self) {
  try {
    const existing = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    if (existing.pid === self.pid && existing.started === self.started) fs.rmSync(LOCK, { force: true });
  } catch {}
}

function recordProcess(pid, expected) {
  for (let i = 0; i < 20; i++) {
    const info = processInfo(pid);
    if (info) {
      if (info.user !== (process.env.USER || os.userInfo().username) || !info.command.includes(expected)) {
        throw new Error(`PID ${pid} không khớp process mong đợi; sẽ không ghi PID đó vào state.`);
      }
      return { pid: Number(pid), started: info.start, expected };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  throw new Error(`Process PID ${pid} không còn sống sau khi khởi chạy.`);
}
function stopExact(record, label, { timeoutMs = 5000 } = {}) {
  if (!record || !Number.isInteger(Number(record.pid))) return 'missing';
  if (!matches(record)) {
    if (!processInfo(record.pid)) return 'already-stopped';
    throw new Error(`${label}: PID ${record.pid} không khớp command/start-time đã ghi; từ chối gửi tín hiệu.`);
  }
  process.kill(record.pid, 'SIGTERM');
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!matches(record)) return 'stopped';
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  if (matches(record)) {
    process.kill(record.pid, 'SIGKILL');
    for (let i = 0; i < 20 && matches(record); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (matches(record)) throw new Error(`${label}: PID ${record.pid} chưa dừng sau SIGKILL.`);
  return 'stopped';
}

function tcpConnect(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let done = false;
    const finish = (open) => { if (done) return; done = true; socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
async function waitForTcp(port, timeoutMs, processRecord, log) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await tcpConnect(port)) return;
    if (processRecord && !matches(processRecord)) throw new Error(`MySQL PID ${processRecord.pid} đã thoát. Log cuối:\n${tail(log)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`MySQL không mở cổng 127.0.0.1:${port} trong ${timeoutMs}ms. Log cuối:\n${tail(log)}`);
}
function listeningMysqlPid() {
  const result = spawnSync('lsof', ['-nP', '-t', '-iTCP:3306', '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const candidate = result.stdout.trim().split(/\s+/).map(Number).find((pid) => Number.isInteger(pid) && pid > 0);
  if (!candidate) return null;
  const info = processInfo(candidate);
  if (!info || !info.command.includes(MYSQLD)) throw new Error(`Cổng 3306 đang bị PID ${candidate} dùng, không phải mysqld đã cấu hình.`);
  return recordProcess(candidate, MYSQLD);
}

function getHttpsStatusWithIps(target, proxySecret, addresses) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const req = https.request({
      hostname: url.hostname,
      servername: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'X-SN-Proxy-Secret': proxySecret },
      timeout: 3500,
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (options?.all) callback(null, addresses.map((address) => ({ address, family: 4 })));
        else callback(null, addresses[0], 4);
      },
    }, (res) => {
      const status = res.statusCode;
      res.resume();
      resolve(status);
    });
    req.once('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.once('error', reject);
    req.end();
  });
}
async function publicDnsProbe(target, proxySecret) {
  const resolver = new dns.promises.Resolver();
  resolver.setServers(['1.1.1.1']);
  let timer;
  let addresses;
  try {
    addresses = await Promise.race([
      resolver.resolve4(new URL(target).hostname),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          resolver.cancel();
          reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
        }, 2000);
      }),
    ]);
  } finally { clearTimeout(timer); }
  if (!addresses.length) throw Object.assign(new Error('no A record from 1.1.1.1'), { code: 'ENODATA' });
  return { status: await getHttpsStatusWithIps(target, proxySecret, addresses), addresses };
}

async function waitForApi(url, proxySecret, timeoutMs, record, log, label, monitor = null, intervalMs = 1000) {
  const target = new URL('/api/venues', url).toString();
  const startedAt = Date.now();
  const until = startedAt + timeoutMs;
  let last = 'chưa có phản hồi';
  let firstFailure = '';
  let attempts = 0;
  while (Date.now() < until) {
    if (record && !matches(record)) throw new Error(`${label} PID ${record.pid} đã thoát. Log cuối:\n${tail(log)}`);
    if (monitor && !matches(monitor.record)) throw new Error(`${monitor.label} PID ${monitor.record.pid} đã thoát. Log cuối:\n${tail(monitor.log)}`);
    try {
      attempts++;
      const res = await fetch(target, { headers: { 'X-SN-Proxy-Secret': proxySecret }, signal: AbortSignal.timeout(4000) });
      if (res.status === 200) {
        await res.body?.cancel();
        return { elapsedMs: Date.now() - startedAt, attempts, firstFailure };
      }
      last = `HTTP ${res.status}`;
      if (!firstFailure) firstFailure = last;
      await res.body?.cancel();
    } catch (error) {
      const cause = error.cause?.code || error.cause?.name || '';
      last = error.name === 'TimeoutError' ? 'timeout' : `${error.message}${cause ? ` (${cause})` : ''}`;
      if (!firstFailure) firstFailure = last;
      if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') {
        try {
          const fallback = await publicDnsProbe(target, proxySecret);
          const detail = `DNS 1.1.1.1 ${fallback.addresses.join(',')}, HTTP ${fallback.status}`;
          if (fallback.status === 200) return { elapsedMs: Date.now() - startedAt, attempts, firstFailure, fallback: detail };
          last = `${last}; fallback ${detail}`;
        } catch (publicError) {
          last = `${last}; fallback 1.1.1.1 ${publicError.code || publicError.message}`;
        }
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`${label} chưa sẵn sàng sau ${timeoutMs}ms (lỗi đầu: ${firstFailure}; lỗi cuối: ${last}; lần thử: ${attempts}). Log cuối:\n${tail(log)}`);
}

module.exports = {
  ROOT, STATE, LOCK, LOGS, MYSQLD, MYSQL_CNF, CLOUDFLARED,
  readEnv, validateProductionEnv, logPath, tail, writeState, readState, removeState,
  processInfo, matches, recordProcess, acquireLock, releaseLock, stopExact,
  tcpConnect, waitForTcp, listeningMysqlPid, waitForApi,
};
