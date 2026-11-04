// Route dev chỉ tồn tại khi không phải production, và FE chỉ chạy chế độ thật khi Express phục vụ.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { createApp } = require('../src/app');

test.before(async () => {
  await h.loadDemo();
});
test.after(() => h.closeAll());


test('production: /api/dev/* không tồn tại (404 của API) và router dev không nằm trong app', async () => {
  const prod = await h.startApp({ production: true });
  try {
    const a = prod.agent();
    for (const [m, p] of [['GET', '/api/dev/state'], ['POST', '/api/dev/reset-demo'], ['POST', '/api/dev/clock'], ['POST', '/api/dev/login']]) {
      const r = await (m === 'GET' ? a.get(p) : a.post(p, { role: 'admin', minutes: 5 }));
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.deepEqual(r.body, { error: 'API không tồn tại' });
    }
    // Không có đăng nhập nào qua cửa sau: vẫn là khách.
    assert.deepEqual((await a.get('/api/auth/me')).body, { user: null });
    // Đồng hồ không bị chỉnh được.
    assert.equal(h.clock.getOffsetMinutes(), 0);
    // Và FE nhận mode.js không có công cụ dev.
    const mode = await a.get('/js/mode.js');
    assert.match(mode.text, /SERVED_BY_API = true/);
    assert.match(mode.text, /DEV_TOOLS = false/);
  } finally {
    await prod.close();
  }
});

test("production: router dev không được require khi dựng app (route không được gắn, không chỉ bị chặn)", async () => {
  const dev = require.resolve('../src/routes/dev');
  delete require.cache[dev];
  const app = createApp({ production: true });
  try {
    assert.equal(require.cache[dev], undefined, 'src/routes/dev.js không bị nạp ở production');
  } finally {
    await app.shutdown();
  }
});

test('dev: đăng nhập nhanh theo vai trò demo, tua đồng hồ, đặt lại dữ liệu', async () => {
  const app = await h.startApp();
  try {
    const a = app.agent();
    const mode = await a.get('/js/mode.js');
    assert.match(mode.text, /DEV_TOOLS = true/);

    assert.equal((await a.post('/api/dev/login', { role: 'owner' })).body.user.email, 'chusan1@datsan.local');
    assert.equal((await a.get('/api/auth/me')).body.user.role, 'owner');
    assert.equal((await a.post('/api/dev/login', { role: 'guest' })).body.user, null);
    assert.equal((await a.get('/api/auth/me')).body.user, null);
    assert.equal((await a.post('/api/dev/login', { role: 'hacker' })).status, 400);

    const before = (await a.get('/api/meta')).body.now;
    const after = (await a.post('/api/dev/clock', { minutes: 120 })).body;
    assert.equal(after.clockOffsetMin, 120);
    const diff = (Date.parse(after.now.replace(' ', 'T') + '+07:00') - Date.parse(before.replace(' ', 'T') + '+07:00')) / 60000;
    assert.ok(diff >= 119 && diff <= 121, `đồng hồ tua ${diff} phút`);
    assert.equal((await a.get('/api/meta')).body.now, (await a.get('/api/dev/state')).body.now.slice(0, 19));
    assert.equal((await a.post('/api/dev/clock', { minutes: 'x' })).status, 400);

    await h.db.query("INSERT INTO notifications (user_id, message, created_at) VALUES (4, 'x', '2026-01-01 00:00:00')");
    await a.post('/api/dev/login', { role: 'customer' });
    const reset = await a.post('/api/dev/reset-demo');
    assert.equal(reset.status, 200);
    assert.equal(reset.body.seeded.core.venues, 40);
    assert.equal(h.clock.getOffsetMinutes(), 0);
    assert.equal((await h.db.query("SELECT 1 FROM notifications WHERE message = 'x'")).length, 0, 'dữ liệu cũ bị xóa');
    assert.equal((await a.get('/api/auth/me')).body.user.email, 'khach1@datsan.local', 'phiên đăng nhập sống qua lần đặt lại');
  } finally {
    h.clock.setOffsetMinutes(0);
    await app.close();
  }
});

test('thao tác dev vẫn phải qua CSRF như mọi thao tác ghi', async () => {
  const app = await h.startApp();
  try {
    const r = await fetch(`${app.base}/api/dev/reset-demo`, { method: 'POST' });
    assert.equal(r.status, 403);
  } finally {
    await app.close();
  }
});

test('bản tĩnh: js/mode.js mặc định là mock và api.js mặc định mock', () => {
  const fs = require('fs');
  const path = require('path');
  const mode = fs.readFileSync(path.join(__dirname, '..', 'js', 'mode.js'), 'utf8');
  assert.match(mode, /SERVED_BY_API = false/);
  assert.match(mode, /DEV_TOOLS = false/);
});
