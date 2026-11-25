const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tokens = require('../src/mail/token');
const { SlidingLimiter } = require('../src/mail/limiter');
const { notifyData, esc, rcptKey } = require('../src/mail/validate');
const { loadConfig } = require('../src/mail/config');
const { createApp, clientIp, normalizeIp } = require('../src/mail/app');
const { createCapture, smtpOptions } = require('../src/mail/transport');

const SECRET = 'x'.repeat(40);
const ORIGIN = 'https://ggo.example';
const GOOD = { bookingCode: 'BK12345', startAt: '2026-12-01T18:30', amount: 300000, link: '/my-bookings' };

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
  assert.equal(tokens.verifyToken(SECRET, proof, 'verified', now).ok, true); // proof sống 90 ngày
  assert.equal(tokens.PROOF_TTL, 90 * 86400);
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
  for (const k of ['name', 'venueName', 'courtName']) bad({ [k]: 'Quý khách được hoàn 500.000đ, nhận tại evil.vn' }); bad({ bookingCode: 'bk123' }); bad({ startAt: '2026-02-30T10:00' });
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
  const sent = await s.call('/mail-api/verify/send', { email: 'User@Mail.vn', name: 'Bạn trúng thưởng, vào abc.xyz <b>An</b>' });
  assert.equal(sent.status, 202);
  const rid = sent.body.requestId;
  assert.ok(rid.length >= 20);
  const [m] = s.mails();
  assert.equal(m.to, 'user@mail.vn');
  assert.ok(m.text.includes(`${ORIGIN}/verify-email.html?t=`));
  for (const part of [m.subject, m.text, m.html]) assert.ok(!/trúng thưởng|abc\.xyz/.test(part), 'name do client gửi không được vào thư xác nhận');
  assert.deepEqual((await s.call('/mail-api/verify/status', { requestId: rid })).body, { confirmed: false });
  assert.deepEqual((await s.call('/mail-api/verify/status', { requestId: 'a'.repeat(24) })).body, { confirmed: false });
  const conf = await s.call('/mail-api/verify/confirm', { t: tokenOf(m) });
  assert.equal(conf.status, 200); assert.equal(conf.body.email, 'user@mail.vn');
  const st = await s.call('/mail-api/verify/status', { requestId: rid });
  assert.deepEqual(st.body, { confirmed: true, email: 'user@mail.vn', proof: conf.body.proof });
  assert.equal((await s.call('/mail-api/verify/confirm', { t: tokenOf(m) })).body.proof, conf.body.proof); // bấm lại không đổi
  const n = await s.call('/mail-api/notify', { proof: conf.body.proof, type: 'booking_held', data: { ...GOOD, deadline: '10:15' } });
  assert.equal(n.status, 202);
  const mail = s.mails()[1];
  assert.equal(mail.to, 'user@mail.vn');
  assert.ok(mail.html.includes('BK12345') && mail.text.includes('300.000'));
  const withName = await s.call('/mail-api/notify', { proof: conf.body.proof, type: 'booking_paid', data: { ...GOOD, name: 'Quý khách được hoàn tiền, vào evil.vn' } });
  assert.equal(withName.status, 400);
  for (const part of [mail.subject, mail.text, mail.html]) assert.ok(!/evil|Quý khách/.test(part));
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
  const cfg = { limits: { dailyCap: 3, dailyVerifyCap: 250 } };
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

test('secret từ *_FILE: đọc đúng, bỏ xuống dòng cuối, đặt cả hai hoặc thiếu file thì lỗi, lỗi không lộ nội dung', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailsec-'));
  const w = (n, v) => { const f = path.join(dir, n); fs.writeFileSync(f, v); return f; };
  const base = { MAIL_ALLOWED_ORIGINS: ORIGIN, MAIL_TRANSPORT: 'smtp' };
  const cfg = loadConfig({ ...base, MAIL_TOKEN_SECRET_FILE: w('t', `${SECRET}\n`), SMTP_USER_FILE: w('u', 'u@g.com\r\n'), SMTP_PASS_FILE: w('p', 'pw pw pw pw\n') });
  assert.equal(cfg.secret, SECRET);
  assert.equal(cfg.smtp.user, 'u@g.com'); assert.equal(cfg.smtp.pass, 'pw pw pw pw');
  assert.equal(cfg.from, 'u@g.com');
  const ok = { ...base, MAIL_TOKEN_SECRET: SECRET, SMTP_USER: 'u', SMTP_PASS: 'p' };
  assert.equal(loadConfig(ok).smtp.pass, 'p'); // dùng env như cũ
  assert.throws(() => loadConfig({ ...ok, SMTP_PASS_FILE: w('p2', 'x') }), /SMTP_PASS và SMTP_PASS_FILE/);
  assert.throws(() => loadConfig({ ...ok, MAIL_TOKEN_SECRET_FILE: w('t2', SECRET) }), /MAIL_TOKEN_SECRET và/);
  let err;
  try { loadConfig({ ...ok, SMTP_PASS: undefined, SMTP_PASS_FILE: path.join(dir, 'missing') }); } catch (e) { err = e; }
  assert.match(err.message, /SMTP_PASS_FILE/); assert.ok(!err.message.includes(dir));
  assert.throws(() => loadConfig({ ...ok, MAIL_TOKEN_SECRET: undefined, MAIL_TOKEN_SECRET_FILE: w('short', 'abc\n') }), /MAIL_TOKEN_SECRET/);
  assert.throws(() => loadConfig({ ...ok, SMTP_USER: undefined, SMTP_USER_FILE: w('empty', '\n') }), /SMTP_USER/);
});

test('SMTP: mặc định 587 bắt buộc STARTTLS, 465 TLS ngay từ đầu', () => {
  const env = { MAIL_TOKEN_SECRET: SECRET, MAIL_ALLOWED_ORIGINS: ORIGIN, MAIL_TRANSPORT: 'smtp', SMTP_USER: 'u', SMTP_PASS: 'p' };
  const d = smtpOptions(loadConfig(env).smtp);
  assert.deepEqual([d.host, d.port, d.secure, d.requireTLS], ['smtp.gmail.com', 587, false, true]);
  const i = smtpOptions(loadConfig({ ...env, SMTP_PORT: '465' }).smtp);
  assert.deepEqual([i.port, i.secure, i.requireTLS], [465, true, false]);
});

test('rcptKey: +tag và dấu chấm gmail dùng chung một khóa, thư vẫn tới địa chỉ gốc', async (t) => {
  assert.equal(rcptKey('a+1@gmail.com'), 'a@gmail.com');
  assert.equal(rcptKey('a.b@gmail.com'), rcptKey('ab@gmail.com'));
  assert.equal(rcptKey('a.b+x@gmail.com'), rcptKey('ab@googlemail.com'));
  assert.notEqual(rcptKey('a.b@corp.vn'), rcptKey('ab@corp.vn')); // tên miền khác gmail giữ dấu chấm
  assert.equal(rcptKey('a+1@corp.vn'), 'a@corp.vn');
  const s = await boot({}, { ipSend: { max: 1000, windowMs: 3600000 } }); t.after(s.close);
  const send = (email) => s.call('/mail-api/verify/send', { email, name: 'An' });
  assert.equal((await send('bomb+0@gmail.com')).status, 202);
  assert.equal((await send('b.omb+1@gmail.com')).status, 202);
  assert.equal((await send('bomb@googlemail.com')).status, 202);
  assert.equal((await send('bomb+3@gmail.com')).status, 429);
  assert.ok(s.mails().some((m) => m.to === 'b.omb+1@gmail.com')); // địa chỉ gốc, không phải khóa chuẩn hóa
});

test('trần ngày riêng cho thư xác nhận: notify của người đã xác nhận vẫn còn chỗ', async (t) => {
  const s = await boot({ limits: { dailyCap: 10, dailyVerifyCap: 2 } }, { ipSend: { max: 1000, windowMs: 3600000 } }); t.after(s.close);
  const send = (email) => s.call('/mail-api/verify/send', { email, name: 'An' });
  assert.equal((await send('a@b.vn')).status, 202);
  assert.equal((await send('c@d.vn')).status, 202);
  const cap = await send('e@f.vn');
  assert.equal(cap.status, 503); assert.equal(cap.body.error, 'daily_cap');
  const proof = tokens.issueProof(SECRET, 'a@b.vn', () => s.clock.t);
  assert.equal((await s.call('/mail-api/notify', { proof, type: 'booking_paid', data: GOOD })).status, 202);
});

test('IP: IPv6 gom về /64, IPv4-mapped coi là IPv4', () => {
  assert.equal(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), normalizeIp('2001:db8:1:2::1'));
  assert.notEqual(normalizeIp('2001:db8:1:2::1'), normalizeIp('2001:db8:1:3::1'));
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('::ffff:102:304'), '1.2.3.4');
  assert.equal(normalizeIp('1.2.3.4'), '1.2.3.4');
  const req = { headers: { 'x-forwarded-for': '2001:db8::5' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, 1), clientIp({ ...req, headers: { 'x-forwarded-for': '2001:db8::9' } }, 1));
});

test('bảng IP đầy: IP mới vẫn qua (đẩy khóa cũ), bảng người nhận vẫn đóng an toàn', () => {
  const ip = new SlidingLimiter({ max: 1, windowMs: 3600000, maxKeys: 3, evictOldest: true });
  for (const k of ['1', '2', '3']) { assert.equal(ip.wait(k), 0); ip.record(k); }
  assert.equal(ip.wait('4'), 0); ip.record('4');
  assert.equal(ip.hits.size, 3);
  const rc = new SlidingLimiter({ max: 1, windowMs: 3600000, maxKeys: 3 });
  for (const k of ['1', '2', '3']) rc.record(k);
  assert.ok(rc.wait('4') > 0);
});

test('body hỏng không tạo khóa IP, nên không làm đầy bảng IP', async (t) => {
  const s = await boot({}, { ipSend: { max: 1, windowMs: 3600000 } }); t.after(s.close);
  for (let i = 0; i < 3; i++) assert.equal((await s.call('/mail-api/verify/send', null, { raw: '{bad' })).status, 400);
  assert.equal((await s.call('/mail-api/verify/send', { email: 'a@b.vn', name: 'An' })).status, 202); // lượt IP chưa bị tiêu
});
