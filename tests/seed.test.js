const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const mock = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'mock', `${n}.json`), 'utf8'));

test.before(async () => {
  await h.loadDemo();
});
test.after(() => h.closeAll());

test('seed: 34 sân thật + 6 sân demo, 18 tài khoản, id như mock', async () => {
  const venues = await h.db.query('SELECT id, data_source FROM venues ORDER BY id');
  assert.equal(venues.length, 40);
  assert.equal(venues.filter((v) => v.dataSource).length, 34);
  assert.equal(venues.filter((v) => !v.dataSource).length, 6);
  assert.deepEqual(venues.map((v) => v.id), mock('venues').map((v) => v.id));
  const courts = await h.db.query('SELECT COUNT(*) AS n FROM courts');
  assert.equal(courts[0].n, mock('venues').reduce((n, v) => n + v.courts.length, 0));
  const users = await h.db.query('SELECT id, email, role FROM users ORDER BY id');
  assert.equal(users.length, 18);
  assert.deepEqual(users.slice(0, 4).map((u) => [u.id, u.email, u.role]), [
    [1, 'admin@datsan.local', 'admin'],
    [2, 'chusan1@datsan.local', 'owner'],
    [3, 'chusan2@datsan.local', 'owner'],
    [4, 'khach1@datsan.local', 'customer'],
  ]);
});

test('seed không bịa dữ liệu sân thật: tên, địa chỉ, số điện thoại, nguồn đúng như mock; không có số thì để rỗng', async () => {
  const rows = await h.db.query('SELECT id, name, address, phone, district, data_source, image_credit, image_is_illustrative FROM venues ORDER BY id');
  for (const m of mock('venues')) {
    const r = rows.find((x) => x.id === m.id);
    assert.equal(r.name, m.name);
    assert.equal(r.address, m.address);
    assert.equal(r.phone, m.phone || '');
    assert.equal(r.district, m.district);
    assert.deepEqual(r.dataSource, m.dataSource || null);
    assert.deepEqual(r.imageCredit, m.imageCredit || null);
    assert.equal(!!r.imageIsIllustrative, m.imageIsIllustrative === true);
  }
  assert.ok(rows.filter((r) => r.dataSource && r.phone === '').length > 0, 'một số sân thật không có số điện thoại trong nguồn');
});

test('tài khoản demo đăng nhập được bằng mật khẩu chung của mock', async () => {
  const app = await h.startApp();
  try {
    for (const [email, role] of [['chusan1@datsan.local', 'owner'], ['khach1@datsan.local', 'customer'], ['admin@datsan.local', 'admin']]) {
      const r = await app.agent().post('/api/auth/login', { email, password: mock('users').demoPassword });
      assert.equal(r.status, 200, email);
      assert.equal(r.body.user.role, role);
    }
  } finally {
    await app.close();
  }
});

test('nạp lại (db:seed / reset-demo) chạy lặp được và đặt lại AUTO_INCREMENT', async () => {
  await h.db.query("INSERT INTO notifications (user_id, message, created_at) VALUES (4, 'x', '2026-01-01 00:00:00')");
  await h.loadDemo();
  assert.equal((await h.db.query('SELECT 1 FROM notifications')).length, 0);
  assert.equal((await h.db.query('SELECT 1 FROM venues')).length, 40);
});
