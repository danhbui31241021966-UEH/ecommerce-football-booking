// Handler HTTP của service mail (node:http thuần). Chỉ nhận JSON theo hợp đồng, gửi theo mẫu cố định.
const tokens = require('./token');
const { SlidingLimiter, consume } = require('./limiter');
const { str, email: parseEmail, notifyData } = require('./validate');
const templates = require('./templates');

const BODY_MAX = 4096;
const H = 3600 * 1000;
const DAY = 24 * H;
const CONFIRMED_MAX = 5000;
const RID = /^[A-Za-z0-9_-]{20,40}$/;

// Lý do chọn số: người đăng ký thật chỉ cần 1-2 thư xác nhận; 3 lần/giờ/người nhận chặn bom hộp thư người khác.
// Thông báo đặt sân: một người hiếm khi quá 10 thư/giờ. IP: 10 thư xác nhận/giờ (nhiều người chung NAT vẫn đủ).
const DEFAULTS = {
  ipSend: { max: 10, windowMs: H },
  ipNotify: { max: 40, windowMs: H },
  ipRead: { max: 300, windowMs: 10 * 60 * 1000 },
  rcptVerifyHour: { max: 3, windowMs: H },
  rcptVerifyDay: { max: 8, windowMs: DAY },
  rcptNotifyHour: { max: 10, windowMs: H },
  rcptNotifyDay: { max: 30, windowMs: DAY },
};

function clientIp(req, trustProxy) {
  const peer = req.socket.remoteAddress || 'unknown';
  if (!trustProxy) return peer;
  const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Mỗi proxy tin cậy thêm địa chỉ nó thấy vào cuối; phần tử thứ trustProxy tính từ cuối là client thật.
  return parts.length >= trustProxy ? parts[parts.length - trustProxy] : peer;
}

function createApp({ config, transport, now = Date.now, limits = {}, log = () => {} }) {
  const L = {};
  const lim = { ...DEFAULTS, ...limits };
  for (const [k, v] of Object.entries(lim)) L[k] = new SlidingLimiter({ ...v, now });
  const daily = new SlidingLimiter({ max: config.limits.dailyCap, windowMs: DAY, maxKeys: 1, now });
  const confirmed = new Map(); // rid -> {email, proof, exp(ms)}; trong bộ nhớ, mất khi restart (người dùng gửi lại).

  const remember = (rid, email, proof) => {
    const t = now();
    for (const [k, v] of confirmed) { if (v.exp <= t) confirmed.delete(k); else break; }
    while (confirmed.size >= CONFIRMED_MAX) confirmed.delete(confirmed.keys().next().value);
    confirmed.set(rid, { email, proof, exp: t + tokens.VERIFY_TTL * 1000 });
  };

  function send(res, status, body, cors) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(cors ? { 'Access-Control-Allow-Origin': cors, Vary: 'Origin' } : { Vary: 'Origin' }),
    });
    res.end(json);
  }

  function readJson(req) {
    return new Promise((resolve) => {
      if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return resolve(null);
      const chunks = []; let size = 0; let over = false;
      req.on('data', (c) => { size += c.length; if (size > BODY_MAX) over = true; else chunks.push(c); });
      req.on('end', () => {
        if (over) return resolve(null);
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : null); } catch { resolve(null); }
      });
      req.on('error', () => resolve(null));
    });
  }

  async function deliver(msg) {
    try { await transport.send({ from: config.from, ...msg }); return true; } catch (e) { log(`send_failed code=${e && e.code ? e.code : 'unknown'}`); return false; }
  }

  // Hạn mức tổng trước, rồi giới hạn từng người nhận; qua hết mới ghi cả hai.
  function reserve(res, origin, rcptKeys) {
    const dw = daily.wait('all');
    if (dw) { send(res, 503, { error: 'daily_cap', retryAfter: dw }, origin); return false; }
    const w = consume(rcptKeys);
    if (w) { send(res, 429, { error: 'rate_limited', retryAfter: w }, origin); return false; }
    daily.record('all');
    return true;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const origin = req.headers.origin;
    const allowed = typeof origin === 'string' && config.origins.includes(origin) ? origin : null;

    if (p === '/mail-api/health' && req.method === 'GET') return send(res, 200, { ok: true });

    const routes = ['/mail-api/verify/send', '/mail-api/verify/confirm', '/mail-api/verify/status', '/mail-api/notify'];
    if (!routes.includes(p)) return send(res, 404, { error: 'invalid' });

    if (req.method === 'OPTIONS') {
      if (!allowed) return send(res, 403, { error: 'forbidden_origin' });
      res.writeHead(204, {
        'Access-Control-Allow-Origin': allowed, Vary: 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'invalid' });
    if (!allowed) return send(res, 403, { error: 'forbidden_origin' });

    const ip = clientIp(req, config.trustProxy);
    const ipLimiter = p === '/mail-api/verify/send' ? L.ipSend : p === '/mail-api/notify' ? L.ipNotify : L.ipRead;
    const w = consume([{ limiter: ipLimiter, key: ip }]);
    if (w) return send(res, 429, { error: 'rate_limited', retryAfter: w }, allowed);

    const body = await readJson(req);
    if (!body) return send(res, 400, { error: 'invalid' }, allowed);

    if (p === '/mail-api/verify/send') {
      const to = parseEmail(body.email); const name = str(body.name, 60);
      if (!to || !name) return send(res, 400, { error: 'invalid' }, allowed);
      if (!reserve(res, allowed, [{ limiter: L.rcptVerifyHour, key: to }, { limiter: L.rcptVerifyDay, key: to }])) return;
      const rid = tokens.newRequestId();
      const t = tokens.issueVerify(config.secret, to, rid, now);
      const msg = templates.verifyEmail({ name, url: `${allowed}/verify-email.html?t=${t}` });
      if (!(await deliver({ to, ...msg }))) return send(res, 503, { error: 'unavailable' }, allowed);
      return send(res, 202, { requestId: rid }, allowed);
    }

    if (p === '/mail-api/verify/confirm') {
      const r = tokens.verifyToken(config.secret, body.t, 'verify', now);
      if (!r.ok) return send(res, 400, { error: r.reason }, allowed);
      const { email, rid } = r.payload;
      const existing = confirmed.get(rid);
      const proof = existing ? existing.proof : tokens.issueProof(config.secret, email, now);
      if (!existing) remember(rid, email, proof);
      return send(res, 200, { email, proof }, allowed);
    }

    if (p === '/mail-api/verify/status') {
      if (typeof body.requestId !== 'string' || !RID.test(body.requestId)) return send(res, 400, { error: 'invalid' }, allowed);
      const c = confirmed.get(body.requestId);
      if (!c || c.exp <= now()) return send(res, 200, { confirmed: false }, allowed);
      return send(res, 200, { confirmed: true, email: c.email, proof: c.proof }, allowed);
    }

    // notify
    const r = tokens.verifyToken(config.secret, body.proof, 'verified', now);
    if (!r.ok) return send(res, 401, { error: 'unverified' }, allowed);
    const d = notifyData(body.type, body.data);
    if (!d.ok) return send(res, 400, { error: 'invalid' }, allowed);
    const to = r.payload.email;
    if (!reserve(res, allowed, [{ limiter: L.rcptNotifyHour, key: to }, { limiter: L.rcptNotifyDay, key: to }])) return;
    const msg = templates.booking(body.type, d.data, `${allowed}${d.data.link}`);
    if (!(await deliver({ to, ...msg }))) return send(res, 503, { error: 'unavailable' }, allowed);
    return send(res, 202, {}, allowed);
  }

  return (req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: 'unavailable' }); else res.end(); });
  };
}

module.exports = { createApp, clientIp, BODY_MAX };
