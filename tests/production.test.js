// Production sau tunnel công khai: từ chối khởi động khi cấu hình yếu, cổng X-SN-Proxy-Secret, IP khách chỉ tin khi secret đúng,
// cookie phiên đặt được khi đi qua proxy. Phần chạy tiến trình thật dùng NODE_ENV=production trên CSDL test.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const h = require('./helpers');
const { problems } = require('../src/productionCheck');
const { proxyGate } = require('../src/middleware/proxy');

const SECRET = 'p'.repeat(40);
const STRONG = {
  SESSION_SECRET: 's'.repeat(40), SEPAY_API_KEY: 'sepay-real-key', DB_PASSWORD: 'real-db-pass', PROXY_SECRET: SECRET,
};
const ROOT = path.join(__dirname, '..');

test.after(() => h.closeAll());

test('kiểm cấu hình production: giá trị mẫu, thiếu, quá ngắn, HOST ngoài localhost', () => {
  assert.deepEqual(problems(STRONG), []);
  assert.deepEqual(problems({ ...STRONG, HOST: '127.0.0.1' }), []);
  assert.deepEqual(problems({ ...STRONG, HOST: 'localhost' }), []);
  const one = (over, re) => {
    const p = problems({ ...STRONG, ...over });
    assert.equal(p.length >= 1, true, JSON.stringify(over));
    assert.match(p.join('\n'), re, JSON.stringify(over));
  };
  for (const k of ['SESSION_SECRET', 'SEPAY_API_KEY', 'DB_PASSWORD', 'PROXY_SECRET']) one({ [k]: 'change_me_please' }, new RegExp(`${k} vẫn là giá trị mẫu`));
  one({ SESSION_SECRET: 'x'.repeat(31) }, /SESSION_SECRET quá ngắn/);
  one({ PROXY_SECRET: 'x'.repeat(31) }, /PROXY_SECRET quá ngắn/);
  assert.deepEqual(problems({ ...STRONG, SESSION_SECRET: 'x'.repeat(32) }), []);
  one({ PROXY_SECRET: '' }, /Thiếu PROXY_SECRET/);
  one({ SESSION_SECRET: '' }, /Thiếu SESSION_SECRET/);
  one({ PROXY_SECRET: undefined }, /Thiếu PROXY_SECRET/);
  one({ SEPAY_API_KEY: '' }, /Thiếu SEPAY_API_KEY/);
  one({ HOST: '0.0.0.0' }, /chỉ được nghe ở 127\.0\.0\.1/);
  one({ HOST: '192.168.1.5' }, /^HOST: /m);
  assert.doesNotMatch(problems({ ...STRONG, HOST: '192.168.1.5' }).join(''), /192\.168/);
  // DB_PASSWORD rỗng (MySQL local không mật khẩu) không bị coi là mẫu
  assert.deepEqual(problems({ ...STRONG, DB_PASSWORD: '' }), []);
});

/** Chạy src/server.js thật với NODE_ENV=production. */
// DB_PASSWORD giữ nguyên của môi trường test để server thật vào được CSDL test.
const env = (over) => ({ ...process.env, NODE_ENV: 'production', HOST: undefined, ...STRONG, DB_PASSWORD: process.env.DB_PASSWORD, ...over });

test('tiến trình production từ chối khởi động (thoát mã 1, nói rõ lý do, không mở cổng) khi cấu hình yếu', () => {
  for (const [over, re] of [
    [{ SESSION_SECRET: 'change_me_to_a_long_random_string' }, /SESSION_SECRET vẫn là giá trị mẫu/],
    [{ SEPAY_API_KEY: 'change_me_sepay_api_key' }, /SEPAY_API_KEY vẫn là giá trị mẫu/],
    [{ DB_PASSWORD: 'change_me' }, /DB_PASSWORD vẫn là giá trị mẫu/],
    [{ SESSION_SECRET: 'ngan' }, /SESSION_SECRET quá ngắn/],
    [{ PROXY_SECRET: '' }, /Thiếu PROXY_SECRET/],
    [{ HOST: '0.0.0.0' }, /chỉ được nghe ở 127\.0\.0\.1/],
  ]) {
    const r = spawnSync(process.execPath, ['src/server.js'], { cwd: ROOT, env: env({ ...over, PORT: '0' }), encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 1, `${JSON.stringify(over)} → ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /Không khởi động production/);
    assert.match(r.stderr, re);
    assert.doesNotMatch(r.stdout, /chạy tại/);
  }
});

test('cổng proxy (middleware): thiếu/sai secret bị chặn 404 trống; đúng thì đi tiếp, đặt IP khách và https', () => {
  const gate = proxyGate(() => SECRET);
  const run = (headers) => {
    const req = { headers: { ...headers }, ip: '10.0.0.1', get: (k) => headers[k] };
    const res = { code: null, status(c) { this.code = c; return this; }, type() { return this; }, send(b) { this.body = b; } };
    let nexted = false;
    gate(req, res, () => { nexted = true; });
    return { req, res, nexted };
  };
  for (const bad of [{}, { 'X-SN-Proxy-Secret': '' }, { 'X-SN-Proxy-Secret': 'sai' }, { 'X-SN-Proxy-Secret': SECRET + 'x' }, { 'X-SN-Proxy-Secret': SECRET.slice(1) }]) {
    const r = run({ ...bad, 'X-SN-Client-IP': '203.0.113.9' });
    assert.deepEqual([r.nexted, r.res.code, r.res.body], [false, 404, 'Not Found'], JSON.stringify(bad));
    assert.equal(r.req.ip, '10.0.0.1', 'IP từ header không được tin khi secret sai');
  }
  const ok = run({ 'X-SN-Proxy-Secret': SECRET, 'X-SN-Client-IP': '203.0.113.9' });
  assert.deepEqual([ok.nexted, ok.req.ip, ok.req.headers['x-forwarded-proto']], [true, '203.0.113.9', 'https']);
  assert.equal(run({ 'X-SN-Proxy-Secret': SECRET, 'X-SN-Client-IP': '2001:db8::1' }).req.ip, '2001:db8::1');
  for (const junk of ['', 'khong-phai-ip', '1.2.3.4, 5.6.7.8', '999.1.1.1']) assert.equal(run({ 'X-SN-Proxy-Secret': SECRET, 'X-SN-Client-IP': junk }).req.ip, '10.0.0.1', junk);
  // chưa cấu hình secret: chặn hết, kể cả header rỗng
  const none = proxyGate(() => '');
  const res = { status(c) { this.code = c; return this; }, type() { return this; }, send() {} };
  none({ headers: {}, get: () => '' }, res, () => assert.fail('không được cho qua'));
  assert.equal(res.code, 404);
});

test('app production có proxySecret: thiếu/sai secret → 404 trống mọi đường dẫn; đúng thì API chạy, dev vẫn 404, webhook không khóa 401, mode.js đúng', async () => {
  await h.loadDemo();
  const app = await h.startApp({ production: true, proxySecret: SECRET });
  try {
    const call = (p, headers = {}, init = {}) => fetch(app.base + p, { headers, ...init });
    for (const p of ['/api/venues', '/api/dev/state', '/api/webhooks/sepay', '/js/mode.js', '/', '/index.html']) {
      for (const headers of [{}, { 'X-SN-Proxy-Secret': 'sai' }]) {
        const r = await call(p, headers);
        assert.equal(r.status, 404, p);
        assert.equal(await r.text(), 'Not Found');
      }
    }
    const good = { 'X-SN-Proxy-Secret': SECRET };
    const v = await call('/api/venues', good);
    assert.equal(v.status, 200);
    assert.ok((await v.json()).venues.length > 0);
    const dev = await call('/api/dev/state', good);
    assert.deepEqual([dev.status, await dev.json()], [404, { error: 'API không tồn tại' }]);
    const hook = await call('/api/webhooks/sepay', { ...good, 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify({ id: 'x', transferType: 'in', transferAmount: 1, content: 'SN00001' }) });
    assert.equal(hook.status, 401);
    const mode = await (await call('/js/mode.js', good)).text();
    assert.match(mode, /SERVED_BY_API = true/);
    assert.match(mode, /DEV_TOOLS = false/);
    // webhook có khóa SePay đúng nhưng không qua proxy: vẫn bị chặn (chỉ Function mới tới được)
    process.env.SEPAY_API_KEY = 'k';
    const direct = await call('/api/webhooks/sepay', { Authorization: 'Apikey k', 'Content-Type': 'application/json' }, { method: 'POST', body: '{}' });
    assert.equal(direct.status, 404);
  } finally {
    delete process.env.SEPAY_API_KEY;
    await app.close();
  }
});

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

test('server production thật: cookie phiên Secure đặt được qua proxy (không cần X-Forwarded-Proto); giới hạn đăng nhập tính theo IP khách trong X-SN-Client-IP', async () => {
  await h.loadDemo();
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: env({ PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  try {
    for (let i = 0; i < 100 && !/chạy tại/.test(out); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /chạy tại/, out);
    const base = `http://127.0.0.1:${port}`;
    const via = (ip) => ({ 'X-SN-Proxy-Secret': SECRET, 'X-SN-Client-IP': ip });
    // không secret: chặn; thẳng vào cổng bằng IP LAN không có ý nghĩa vì chỉ nghe loopback
    assert.equal((await fetch(`${base}/api/venues`)).status, 404);
    { const r = await fetch(`${base}/api/venues`, { headers: via('203.0.113.1') }); assert.equal(r.status, 200, out + (await r.text())); }
    // phiên + CSRF qua proxy
    const first = await fetch(`${base}/api/auth/csrf`, { headers: via('203.0.113.1') });
    const setCookie = first.headers.getSetCookie().find((c) => c.startsWith('fb.sid='));
    assert.ok(setCookie, 'cookie phiên phải được đặt');
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.doesNotMatch(setCookie, /Domain=/i, 'cookie host-only (first-party trên pages.dev)');
    const cookie = setCookie.split(';')[0];
    const { csrfToken } = await first.json();
    const login = (ip, email = 'khong-co@test.local') => fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { ...via(ip), 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ email, password: 'sai-mat-khau' }),
    });
    for (let i = 0; i < 30; i += 1) assert.equal((await login('203.0.113.50')).status, 401, `lần ${i + 1}`);
    assert.equal((await login('203.0.113.50')).status, 429, 'IP khách A bị giới hạn sau 30 lần');
    assert.equal((await login('203.0.113.51')).status, 401, 'IP khách B không bị khóa theo A');
    // IP trong header khi secret sai không được tin: không secret thì chưa tới được route
    const spoof = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'X-SN-Client-IP': '203.0.113.99', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(spoof.status, 404);
    // đăng nhập đúng qua proxy: phiên mới cũng Secure
    const email = `prod-${Date.now()}@test.local`;
    await h.makeUser({ email });
    const ok = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { ...via('203.0.113.77'), 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ email, password: 'Matkhau@123' }),
    });
    assert.equal(ok.status, 200, out + (await ok.clone().text()));
    assert.match(ok.headers.getSetCookie().find((c) => c.startsWith('fb.sid=')) || '', /Secure/i);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
  }
});
