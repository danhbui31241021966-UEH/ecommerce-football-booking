const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tokens = require('../src/mail/token');
const { SlidingLimiter } = require('../src/mail/limiter');
const { notifyData, esc } = require('../src/mail/validate');
const { loadConfig } = require('../src/mail/config');
const { createApp, clientIp } = require('../src/mail/app');
const { createCapture } = require('../src/mail/transport');

const SECRET = 'x'.repeat(40);
const ORIGIN = 'https://ggo.example';
const GOOD = { name: 'An', bookingCode: 'BK12345', venueName: 'Sân A', courtName: 'Sân 1', startAt: '2026-12-01T18:30', amount: 300000, link: '/my-bookings' };

test('token: ký, sai chữ ký, hết hạn, sai purpose', () => {
  let t = 1_000_000_000_000;
  const now = () => t;
  const proof = tokens.issueProof(SECRET, 'a@b.vn', now);
  assert.equal(tokens.verifyToken(SECRET, proof, 'verified', now).payload.email, 'a@b.vn');
  const [p, s] = proof.split('.');
  const forged = Buffer.from(JSON.stringify({ purpose: 'verified', email: 'evil@b.vn', exp: 9999999999 })).toString('base64url');
  assert.equal(tokens.verifyToken(SECRET, `${forged}.${s}`, 'verified', now).reason, 'invalid');
  assert.equal(tokens.verifyToken('y'.repeat(40), proof, 'verified', now).reason, 'invalid');
  assert.equal(tokens.verifyToken(SECRET, `${p}.`, 'verified', now).reason, 'invalid');
  assert.equal(tokens.verifyToken(SECRET, proof, 'verify', now).reason, 'invalid'); // sai purpose
  const v = tokens.issueVerify(SECRET, 'a@b.vn', 'rid1', now);
  assert.equal(tokens.verifyToken(SECRET, v, 'verified', now).reason, 'invalid');
  assert.equal(tokens.verifyToken(SECRET, v, 'verify', now).payload.rid, 'rid1');
  t += (tokens.VERIFY_TTL + 1) * 1000;
  assert.equal(tokens.verifyToken(SECRET, v, 'verify', now).reason, 'expired');
  assert.equal(tokens.verifyToken(SECRET, proof, 'verified', now).ok, true); // proof sống 365 ngày
  t += tokens.PROOF_TTL * 1000;
  assert.equal(tokens.verifyToken(SECRET, proof, 'verified', now).reason, 'expired');
});

test('rate limit: cửa sổ trượt, trả giây chờ, trần số khóa đóng an toàn', () => {
  let t = 0;
  const l = new SlidingLimiter({ max: 2, windowMs: 1000, maxKeys: 2, now: () => t });
  assert.equal(l.wait('a'), 0); l.record('a'); l.record('a');
  assert.equal(l.wait('a'), 1);
  t = 1001; assert.equal(l.wait('a'), 0);
  l.record('a'); l.record('b');
  assert.ok(l.wait('c') > 0); // đầy khóa, không dọn được thì từ chối
  t = 3000; assert.equal(l.wait('c'), 0);
});

test('dữ liệu mẫu: kiểm kiểu/độ dài, trường lạ, escape', () => {
  assert.equal(notifyData('booking_paid', GOOD).ok, true);
  const bad = (patch, type = 'booking_paid') => assert.equal(notifyData(type, { ...GOOD, ...patch }).ok, false, JSON.stringify(patch));
  bad({ name: 'a'.repeat(61) }); bad({ name: 5 }); bad({ name: 'x\ny' }); bad({ bookingCode: 'bk123' }); bad({ startAt: '2026-02-30T10:00' });
  bad({ amount: 1.5 }); bad({ amount: -1 }); bad({ amount: '5' }); bad({ amount: 100000001 });
  bad({ link: '//evil.com' }); bad({ link: 'https://evil.com' }); bad({ link: '/a\\b' }); bad({ to: 'x@y.vn' });
  bad({ deadline: '10:00' }, 'booking_paid'); bad({ deadline: '25:00' }, 'booking_held'); bad({ refund: 1 }, 'booking_held');
  assert.equal(notifyData('booking_held', { ...GOOD, deadline: '10:00' }).ok, true);
  assert.equal(notifyData('booking_cancelled', { ...GOOD, refund: 0 }).ok, true);
  assert.equal(notifyData('other', GOOD).ok, false);
  assert.equal(notifyData('booking_paid', null).ok, false);
  assert.equal(esc(`<img src=x onerror="a">&'`), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('cấu hình: thiếu/ngắn secret, capture ở production, origin sai đều từ chối', () => {
  const base = { MAIL_TOKEN_SECRET: SECRET, MAIL_ALLOWED_ORIGINS: ORIGIN, MAIL_TRANSPORT: 'capture', MAIL_CAPTURE_DIR: '/tmp/x' };
  assert.equal(loadConfig(base).transport, 'capture');
  assert.throws(() => loadConfig({ ...base, MAIL_TOKEN_SECRET: undefined }), /MAIL_TOKEN_SECRET/);
  assert.throws(() => loadConfig({ ...base, MAIL_TOKEN_SECRET: 'short' }), /MAIL_TOKEN_SECRET/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /capture/);
  assert.throws(() => loadConfig({ ...base, MAIL_ALLOWED_ORIGINS: '' }), /ORIGINS/);
  assert.throws(() => loadConfig({ ...base, MAIL_ALLOWED_ORIGINS: `${ORIGIN}/` }), /ORIGINS/);
  assert.throws(() => loadConfig({ ...base, MAIL_TRANSPORT: 'smtp' }), /SMTP_/);
  assert.throws(() => loadConfig({ ...base, MAIL_TRANSPORT: 'smtp', SMTP_USER: 'u', SMTP_PASS: 'p', NODE_ENV: 'production', MAIL_ALLOWED_ORIGINS: 'http://a.vn' }), /https/);
  assert.equal(loadConfig({ ...base, MAIL_TRANSPORT: 'smtp', SMTP_USER: 'u@g.com', SMTP_PASS: 'p', NODE_ENV: 'production' }).from, 'u@g.com');
});

test('IP: chỉ tin đúng số proxy đã cấu hình', () => {
  const req = (xff) => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '10.0.0.1' } });
  assert.equal(clientIp(req('6.6.6.6'), 0), '10.0.0.1');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), 1), '1.2.3.4'); // 6.6.6.6 do client tự thêm
  assert.equal(clientIp(req('1.2.3.4, 5.6.7.8'), 2), '1.2.3.4');
  assert.equal(clientIp(req(''), 1), '10.0.0.1');
});

// ---- HTTP end-to-end trong tiến trình với transport capture ----
async function boot(over = {}, limits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailcap-'));
  const config = { ...loadConfig({ MAIL_TOKEN_SECRET: SECRET, MAIL_ALLOWED_ORIGINS: `${ORIGIN},https://b.example`, MAIL_TRANSPORT: 'capture', MAIL_CAPTURE_DIR: dir }), ...over };
  const clock = { t: 1_800_000_000_000 };
  let failSend = false;
  const cap = createCapture(dir);
  const transport = { send: (m) => (failSend ? Promise.reject(Object.assign(new Error('boom a@b.vn'), { code: 'ECONN' })) : cap.send(m)) };
  const logs = [];
  const server = http.createServer(createApp({ config, transport, now: () => clock.t, limits, log: (m) => logs.push(m) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, body, { origin = ORIGIN, method = 'POST', headers = {}, raw } = {}) => {
    const res = await fetch(base + p, { method, headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined });
    return { status: res.status, body: await res.json().catch(() => null), cors: res.headers.get('access-control-allow-origin'), headers: res.headers };
  };
  const mails = () => fs.readdirSync(dir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  return { call, mails, clock, logs, setFail: (v) => { failSend = v; }, close: () => server.close() };
}

const tokenOf = (m) => new URL(/https?:\/\/[^\s"]+verify-email\.html\?t=[^\s"<]+/.exec(m.text)[0]).searchParams.get('t');

test('luồng xác nhận: status trước/sau confirm, notify chỉ tới email trong proof', async (t) => {
  const s = await boot(); t.after(s.close);
  const sent = await s.call('/mail-api/verify/send', { email: 'User@Mail.vn', name: '<b>An</b>' });
  assert.equal(sent.status, 202);
  const rid = sent.body.requestId;
  assert.ok(rid.length >= 20);
  const [m] = s.mails();
  assert.equal(m.to, 'user@mail.vn');
  assert.ok(m.text.includes(`${ORIGIN}/verify-email.html?t=`));
  assert.ok(m.html.includes('&lt;b&gt;An&lt;/b&gt;') && !m.html.includes('<b>An</b>'));
  assert.deepEqual((await s.call('/mail-api/verify/status', { requestId: rid })).body, { confirmed: false });
  assert.deepEqual((await s.call('/mail-api/verify/status', { requestId: 'a'.repeat(24) })).body, { confirmed: false });
  const conf = await s.call('/mail-api/verify/confirm', { t: tokenOf(m) });
  assert.equal(conf.status, 200); assert.equal(conf.body.email, 'user@mail.vn');
  const st = await s.call('/mail-api/verify/status', { requestId: rid });
  assert.deepEqual(st.body, { confirmed: true, email: 'user@mail.vn', proof: conf.body.proof });
  assert.equal((await s.call('/mail-api/verify/confirm', { t: tokenOf(m) })).body.proof, conf.body.proof); // bấm lại không đổi
  const n = await s.call('/mail-api/notify', { proof: conf.body.proof, type: 'booking_held', data: { ...GOOD, name: '<script>x</script>', deadline: '10:15', to: undefined } });
  assert.equal(n.status, 202);
  const mail = s.mails()[1];
  assert.equal(mail.to, 'user@mail.vn');
  assert.ok(mail.html.includes('&lt;script&gt;') && !mail.html.includes('<script>'));
  assert.ok(mail.text.includes(`${ORIGIN}/my-bookings`));
  const extra = await s.call('/mail-api/notify', { proof: conf.body.proof, type: 'booking_paid', data: { ...GOOD, to: 'victim@x.vn' } });
  assert.equal(extra.status, 400);
  assert.equal(s.mails().length, 2);
});

test('proof giả/sai purpose/hết hạn bị chặn, token confirm xấu', async (t) => {
  const s = await boot(); t.after(s.close);
  const data = GOOD;
  const bad = async (proof) => s.call('/mail-api/notify', { proof, type: 'booking_paid', data });
  assert.deepEqual((await bad('abc.def')).body, { error: 'unverified' });
  assert.equal((await bad(undefined)).status, 401);
  assert.equal((await bad(tokens.issueProof('z'.repeat(40), 'a@b.vn'))).status, 401);
  assert.equal((await bad(tokens.issueVerify(SECRET, 'a@b.vn', 'r'))).status, 401);
  const old = tokens.issueProof(SECRET, 'a@b.vn', () => s.clock.t - 400 * 86400 * 1000);
  assert.equal((await bad(old)).status, 401);
  assert.equal((await s.call('/mail-api/verify/confirm', { t: 'x.y' })).body.error, 'invalid');
  const exp = tokens.issueVerify(SECRET, 'a@b.vn', 'r', () => s.clock.t - 2 * 86400 * 1000);
  assert.deepEqual((await s.call('/mail-api/verify/confirm', { t: exp })).body, { error: 'expired' });
  assert.equal((await s.call('/mail-api/verify/confirm', { t: tokens.issueProof(SECRET, 'a@b.vn') })).status, 400);
  assert.equal(s.mails().length, 0);
});

test('CORS và Origin: lạ/thiếu bị 403, preflight, health', async (t) => {
  const s = await boot(); t.after(s.close);
  const body = { email: 'a@b.vn', name: 'An' };
  assert.deepEqual((await s.call('/mail-api/verify/send', body, { origin: 'https://evil.example' })).body, { error: 'forbidden_origin' });
  assert.equal((await s.call('/mail-api/verify/send', body, { origin: null })).status, 403);
  assert.equal((await s.call('/mail-api/verify/send', body, { origin: `${ORIGIN}.evil.example` })).status, 403);
  assert.equal(s.mails().length, 0);
  const ok = await s.call('/mail-api/verify/send', body, { origin: 'https://b.example' });
  assert.equal(ok.status, 202); assert.equal(ok.cors, 'https://b.example');
  assert.ok(s.mails()[0].text.includes('https://b.example/verify-email.html?t='));
  const bad = await s.call('/mail-api/verify/send', body, { origin: 'https://evil.example' });
  assert.equal(bad.cors, null);
  const pre = await s.call('/mail-api/notify', null, { method: 'OPTIONS' });
  assert.equal(pre.status, 204); assert.equal(pre.cors, ORIGIN);
  assert.equal((await s.call('/mail-api/notify', null, { method: 'OPTIONS', origin: 'https://evil.example' })).status, 403);
  const h = await s.call('/mail-api/health', null, { method: 'GET', origin: null });
  assert.deepEqual(h.body, { ok: true });
});

test('body: chỉ JSON, tối đa 4 KB, kiểu sai', async (t) => {
  const s = await boot({}, { ipSend: { max: 1000, windowMs: 3600000 } }); t.after(s.close);
  const p = '/mail-api/verify/send';
  assert.equal((await s.call(p, null, { raw: 'x'.repeat(5000) })).body.error, 'invalid');
  assert.equal((await s.call(p, null, { raw: '{bad' })).status, 400);
  assert.equal((await s.call(p, null, { raw: '[]' })).status, 400);
  assert.equal((await s.call(p, { email: 'a@b.vn', name: 'An' }, { headers: { 'Content-Type': 'text/plain' } })).status, 400);
  for (const email of ['a@b', 'a@b.vn,c@d.vn', '"x"@b.vn', 'a b@c.vn', 5, 'a@b.vn\r\nBcc: x@y.vn']) assert.equal((await s.call(p, { email, name: 'An' })).status, 400, String(email));
  assert.equal((await s.call(p, { email: 'a@b.vn', name: 'a'.repeat(61) })).status, 400);
  assert.equal(s.mails().length, 0);
});

test('rate limit: theo IP, theo người nhận, retryAfter, mở lại sau cửa sổ', async (t) => {
  const s = await boot({}, { ipSend: { max: 5, windowMs: 3600000 } }); t.after(s.close);
  const send = (email) => s.call('/mail-api/verify/send', { email, name: 'An' });
  for (let i = 0; i < 3; i++) assert.equal((await send('a@b.vn')).status, 202);
  const r = await send('a@b.vn');
  assert.equal(r.status, 429); assert.equal(r.body.error, 'rate_limited'); assert.ok(r.body.retryAfter > 0);
  assert.equal((await send('c@d.vn')).status, 202); // người nhận khác, IP còn 0 lượt sau lần này
  const ip = await send('e@f.vn');
  assert.equal(ip.status, 429); // IP hết lượt dù người nhận mới
  assert.equal(s.mails().length, 4);
  s.clock.t += 3600 * 1000 + 1000;
  assert.equal((await send('c@d.vn')).status, 202);
});

test('hạn mức tổng ngày: daily_cap riêng, lỗi gửi là unavailable và vẫn tính hạn mức', async (t) => {
  const cfg = { limits: { dailyCap: 3 } };
  const s = await boot(cfg); t.after(s.close);
  const send = (email) => s.call('/mail-api/verify/send', { email, name: 'An' });
  assert.equal((await send('a1@b.vn')).status, 202);
  s.setFail(true);
  const f = await send('a2@b.vn');
  assert.deepEqual(f.body, { error: 'unavailable' }); assert.equal(f.status, 503);
  assert.ok(s.logs.every((l) => !l.includes('@')));
  s.setFail(false);
  assert.equal((await send('a3@b.vn')).status, 202);
  const cap = await send('a4@b.vn');
  assert.equal(cap.status, 503); assert.equal(cap.body.error, 'daily_cap'); assert.ok(cap.body.retryAfter > 0);
  s.clock.t += 86400 * 1000 + 1000;
  assert.equal((await send('a4@b.vn')).status, 202);
});

test('capture bị từ chối ở production, route lạ 404', async (t) => {
  assert.throws(() => require('../src/mail/transport').createTransport({ transport: 'capture', production: true, captureDir: '/tmp/x' }), /production/);
  const s = await boot(); t.after(s.close);
  assert.equal((await s.call('/mail-api/nope', {})).status, 404);
  assert.equal((await s.call('/mail-api/verify/send', null, { method: 'GET' })).status, 405);
});
