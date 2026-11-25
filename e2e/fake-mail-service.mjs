// Bản giả nhỏ của service mail, đúng hợp đồng /mail-api, chỉ để chạy e2e khi chưa có (hoặc không muốn dùng) service thật. Không gửi mail ra ngoài:
// mỗi mail "gửi" được ghi thành một dòng JSON vào MAIL_CAPTURE_FILE ({ to, type, link?, data? }).
// Chạy: MAIL_PORT=4126 MAIL_CAPTURE_FILE=e2e/out/mail-capture.jsonl node e2e/fake-mail-service.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const PORT = Number(process.env.MAIL_PORT || 4126);
const FILE = process.env.MAIL_CAPTURE_FILE || 'e2e/out/mail-capture.jsonl';
const SECRET = crypto.randomBytes(16).toString('hex');
const ALLOWED = (process.env.MAIL_ORIGINS || 'http://127.0.0.1:4127,http://127.0.0.1:4100,http://localhost:4127').split(',');
fs.mkdirSync(FILE.replace(/[^/]*$/, '') || '.', { recursive: true });
fs.writeFileSync(FILE, '');

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const sign = (payload) => { const a = b64(payload); return `${a}.${crypto.createHmac('sha256', SECRET).update(a).digest('base64url')}`; };
function open(token, purpose) {
  const [a, sig] = String(token || '').split('.');
  if (!a || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(a).digest();
  const got = Buffer.from(sig, 'base64url');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const p = JSON.parse(Buffer.from(a, 'base64url').toString());
  return p.purpose === purpose ? p : p && { ...p, wrongPurpose: true };
}
const requests = new Map(); // requestId -> { email, confirmed }
const capture = (m) => fs.appendFileSync(FILE, JSON.stringify(m) + '\n');
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const err = (res, code, error, extra = {}) => send(res, code, { error, ...extra });
const exp = (sec) => Math.floor(Date.now() / 1000) + sec;
const TYPES = ['booking_held', 'booking_paid', 'booking_cancelled'];

function validNotify(d) {
  const str = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;
  return d && typeof d === 'object' && str(d.name, 60) && /^[A-Z]{2}\d{3,8}$/.test(d.bookingCode) && str(d.venueName, 80) && str(d.courtName, 40)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.startAt) && Number.isInteger(d.amount) && d.amount >= 0 && d.amount <= 100000000
    && (d.deadline === undefined || /^\d{2}:\d{2}$/.test(d.deadline)) && (d.refund === undefined || Number.isInteger(d.refund))
    && typeof d.link === 'string' && d.link.startsWith('/');
}

http.createServer((req, res) => {
  if (req.url === '/mail-api/health') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return err(res, 404, 'invalid');
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
  req.on('end', () => {
    const origin = req.headers.origin;
    if (!ALLOWED.includes(origin)) return err(res, 403, 'forbidden_origin');
    let body;
    try { body = JSON.parse(raw); } catch { return err(res, 400, 'invalid'); }
    const path = req.url.replace(/^\/mail-api/, '');
    if (path === '/verify/send') {
      const email = String(body.email || '').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'invalid');
      const requestId = crypto.randomUUID();
      requests.set(requestId, { email, confirmed: false });
      capture({ to: email, type: 'verify', link: `${origin}/verify-email.html?t=${sign({ purpose: 'verify', email, exp: exp(86400), rid: requestId })}` });
      return send(res, 202, { requestId });
    }
    if (path === '/verify/confirm') {
      const p = open(body.t, 'verify');
      if (!p || p.wrongPurpose) return err(res, 400, 'invalid');
      if (p.exp < exp(0)) return err(res, 400, 'expired');
      const r = requests.get(p.rid);
      if (r) r.confirmed = true;
      return send(res, 200, { email: p.email, proof: sign({ purpose: 'verified', email: p.email, exp: exp(365 * 86400) }) });
    }
    if (path === '/verify/status') {
      const r = requests.get(body.requestId);
      if (!r) return err(res, 400, 'invalid');
      return send(res, 200, r.confirmed ? { confirmed: true, email: r.email, proof: sign({ purpose: 'verified', email: r.email, exp: exp(365 * 86400) }) } : { confirmed: false });
    }
    if (path === '/notify') {
      const p = open(body.proof, 'verified');
      if (!p || p.wrongPurpose || p.exp < exp(0)) return err(res, 401, 'unverified');
      if (!TYPES.includes(body.type) || !validNotify(body.data)) return err(res, 400, 'invalid');
      capture({ to: p.email, type: body.type, data: body.data, link: origin + body.data.link });
      return send(res, 202, {});
    }
    return err(res, 404, 'invalid');
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake mail service http://127.0.0.1:${PORT}/mail-api -> ${FILE}`));
