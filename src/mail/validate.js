// Kiểm kiểu/độ dài mọi trường từ client và escape HTML. Không suy diễn nghĩa, chỉ kiểm dạng.
const CTRL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const EMAIL = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function str(v, max, { min = 1 } = {}) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length < min || s.length > max || CTRL.test(s)) return null;
  return s;
}

function email(v) {
  if (typeof v !== 'string' || v.length > 254) return null;
  const e = v.trim().toLowerCase();
  return EMAIL.test(e) ? e : null;
}

const int = (v, min, max) => (Number.isSafeInteger(v) && v >= min && v <= max ? v : null);

function dateTime(v) {
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return v;
}
const hhmm = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
// Đường dẫn tương đối của chính web: bắt đầu "/", không "//" (protocol-relative), không "\".
const link = (v) => (typeof v === 'string' && v.length <= 200 && /^\/(?!\/)[A-Za-z0-9\-._~/?=&%#:@+,]*$/.test(v) ? v : null);

const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

const TYPES = ['booking_held', 'booking_paid', 'booking_cancelled'];
const FIELDS = ['name', 'bookingCode', 'venueName', 'courtName', 'startAt', 'amount', 'deadline', 'refund', 'link'];

// Trả { ok:true, data } hoặc { ok:false }. Trường lạ bị từ chối.
function notifyData(type, raw) {
  if (!TYPES.includes(type) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  if (Object.keys(raw).some((k) => !FIELDS.includes(k))) return { ok: false };
  const d = {
    name: str(raw.name, 60),
    bookingCode: typeof raw.bookingCode === 'string' && /^[A-Z]{2}\d{3,8}$/.test(raw.bookingCode) ? raw.bookingCode : null,
    venueName: str(raw.venueName, 80),
    courtName: str(raw.courtName, 40),
    startAt: dateTime(raw.startAt),
    amount: int(raw.amount, 0, 100000000),
    link: link(raw.link),
  };
  if (Object.values(d).some((v) => v === null)) return { ok: false };
  if (raw.deadline !== undefined) {
    if (type !== 'booking_held' || !(d.deadline = hhmm(raw.deadline))) return { ok: false };
  }
  if (raw.refund !== undefined) {
    if (type !== 'booking_cancelled' || (d.refund = int(raw.refund, 0, 100000000)) === null) return { ok: false };
  }
  return { ok: true, data: d };
}

module.exports = { str, email, notifyData, esc, TYPES };
