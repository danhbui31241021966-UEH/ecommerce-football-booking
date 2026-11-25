// Token ký HMAC-SHA256: base64url(JSON payload) + "." + base64url(chữ ký). Chỉ ký/kiểm, không giữ trạng thái.
const crypto = require('crypto');

const VERIFY_TTL = 24 * 3600;
const PROOF_TTL = 90 * 24 * 3600;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (secret, part) => crypto.createHmac('sha256', secret).update(part).digest();
const nowSec = (now) => Math.floor(now() / 1000);

function issue(secret, payload) {
  const part = b64(JSON.stringify(payload));
  return `${part}.${b64(sign(secret, part))}`;
}

// Trả { ok:true, payload } hoặc { ok:false, reason: 'invalid' | 'expired' }.
function verifyToken(secret, token, purpose, now = Date.now) {
  if (typeof token !== 'string' || token.length > 1024) return { ok: false, reason: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return { ok: false, reason: 'invalid' };
  const given = Buffer.from(parts[1], 'base64url');
  const want = sign(secret, parts[0]);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return { ok: false, reason: 'invalid' };
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'invalid' }; }
  if (!p || typeof p !== 'object' || p.purpose !== purpose || typeof p.email !== 'string' || !Number.isInteger(p.exp)) return { ok: false, reason: 'invalid' };
  if (purpose === 'verify' && (typeof p.rid !== 'string' || !p.rid)) return { ok: false, reason: 'invalid' };
  if (p.exp <= nowSec(now)) return { ok: false, reason: 'expired' };
  return { ok: true, payload: p };
}

const newRequestId = () => crypto.randomBytes(18).toString('base64url');

function issueVerify(secret, email, rid, now = Date.now) {
  return issue(secret, { purpose: 'verify', email, rid, exp: nowSec(now) + VERIFY_TTL });
}
function issueProof(secret, email, now = Date.now) {
  return issue(secret, { purpose: 'verified', email, exp: nowSec(now) + PROOF_TTL });
}

module.exports = { issue, verifyToken, issueVerify, issueProof, newRequestId, VERIFY_TTL, PROOF_TTL };
