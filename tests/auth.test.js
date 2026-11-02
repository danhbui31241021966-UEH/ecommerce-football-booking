const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
test.before(async () => {
  await h.emptyData();
  await h.makeUser({ email: 'khach@test.local', fullName: 'Khách Thử' });
  await h.makeUser({ email: 'khoa@test.local', isActive: 0 });
  app = await h.startApp();
});
test.after(async () => {
  await app.close();
  await h.closeAll();
});

const creds = { email: 'khach@test.local', password: 'Matkhau@123' };

test('CSRF: ghi mà thiếu hoặc sai token thì 403; GET /csrf cấp token', async () => {
  const bare = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds) });
  assert.equal(bare.status, 403);
  const a = app.agent();
  const t = await a.get('/api/auth/csrf');
  assert.equal(t.status, 200);
  assert.match(t.body.csrfToken, /^[0-9a-f]{48}$/);
  const wrong = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'sai', Cookie: `fb.sid=x` },
    body: JSON.stringify(creds),
  });
  assert.equal(wrong.status, 403);
});

test('đăng nhập → me → đăng xuất → me null; session nằm trong MySQL', async () => {
  const a = app.agent();
  assert.deepEqual((await a.get('/api/auth/me')).body, { user: null });
  const login = await a.post('/api/auth/login', creds);
  assert.equal(login.status, 200);
  assert.deepEqual(Object.keys(login.body.user).sort(), ['email', 'fullName', 'id', 'phone', 'role']);
  assert.equal(login.body.user.role, 'customer');
  assert.equal(JSON.stringify(login.body).includes('password'), false);
  const me = await a.get('/api/auth/me');
  assert.equal(me.body.user.email, 'khach@test.local');

  const stored = await h.db.query('SELECT session_id, data FROM sessions');
  assert.ok(stored.some((r) => String(r.data).includes(`"userId":${login.body.user.id}`)), 'session có userId trong bảng sessions');

  assert.equal((await a.post('/api/auth/logout')).status, 200);
  assert.deepEqual((await a.get('/api/auth/me')).body, { user: null });
});

test('đăng nhập sai: 401 cùng một thông báo cho sai email và sai mật khẩu; tài khoản khóa 403', async () => {
  const a = app.agent();
  const wrongPw = await a.post('/api/auth/login', { ...creds, password: 'saisai123' });
  const noUser = await a.post('/api/auth/login', { email: 'khong@test.local', password: 'saisai123' });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPw.body.error, noUser.body.error);
  assert.equal((await a.post('/api/auth/login', { email: 'khoa@test.local', password: 'Matkhau@123' })).status, 403);
  assert.equal((await a.post('/api/auth/login', { email: 'khach@test.local' })).status, 400);
});

test('đăng ký: tạo khách hàng, vào luôn phiên đăng nhập; email trùng (kể cả khác hoa thường) 409; dữ liệu sai 400', async () => {
  const a = app.agent();
  const r = await a.post('/api/auth/register', { fullName: 'Lê Văn Mới', email: 'Moi@Test.local', phone: '0912345678', password: 'matkhau123' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.user.role, 'customer');
  assert.equal((await a.get('/api/auth/me')).body.user.fullName, 'Lê Văn Mới');
  const row = await h.db.one('SELECT password_hash FROM users WHERE id = ?', [r.body.user.id]);
  assert.notEqual(row.passwordHash, 'matkhau123');
  assert.ok(row.passwordHash.startsWith('$2'));

  const b = app.agent();
  assert.equal((await b.post('/api/auth/register', { fullName: 'Ai Đó', email: 'moi@test.local', phone: '0912345679', password: 'matkhau123' })).status, 409);
  assert.equal((await b.post('/api/auth/register', { fullName: 'A', email: 'x@test.local', phone: '0912345679', password: 'matkhau123' })).status, 400);
  assert.equal((await b.post('/api/auth/register', { fullName: 'Ai Đó', email: 'khong-phai-email', phone: '0912345679', password: 'matkhau123' })).status, 400);
  assert.equal((await b.post('/api/auth/register', { fullName: 'Ai Đó', email: 'y@test.local', phone: '123', password: 'matkhau123' })).status, 400);
  assert.equal((await b.post('/api/auth/register', { fullName: 'Ai Đó', email: 'y@test.local', phone: '0912345679', password: 'ngan' })).status, 400);
});

test('tài khoản bị khóa sau khi đã đăng nhập mất hiệu lực ngay ở request kế tiếp', async () => {
  const u = await h.makeUser({ email: 'sapkhoa@test.local' });
  const a = app.agent();
  await a.post('/api/auth/login', { email: 'sapkhoa@test.local', password: 'Matkhau@123' });
  assert.equal((await a.get('/api/auth/me')).body.user.id, u.id);
  await h.db.query('UPDATE users SET is_active = 0 WHERE id = ?', [u.id]);
  assert.deepEqual((await a.get('/api/auth/me')).body, { user: null });
});
