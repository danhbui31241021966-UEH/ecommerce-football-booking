const { badRequest } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^0\d{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(value, field, { min = 1, max = 255, optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw badRequest(`${field} là bắt buộc`);
  }
  const s = String(value).trim();
  if (s.length < min || s.length > max) throw badRequest(`${field} phải dài từ ${min} đến ${max} ký tự`);
  return s;
}

function email(value) {
  const s = str(value, 'Email', { max: 191 }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw badRequest('Email không đúng định dạng');
  return s;
}

function phone(value, field = 'Số điện thoại') {
  const s = str(value, field, { max: 15 }).replace(/[\s.]/g, '');
  if (!PHONE_RE.test(s)) throw badRequest(`${field} phải gồm 10 chữ số, bắt đầu bằng 0`);
  return s;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    throw badRequest('Mật khẩu phải dài từ 8 đến 72 ký tự');
  }
  return value;
}

function date(value, field = 'Ngày') {
  const s = str(value, field, { max: 10 });
  if (!DATE_RE.test(s) || Number.isNaN(new Date(`${s}T00:00:00`).getTime())) {
    throw badRequest(`${field} không hợp lệ (định dạng YYYY-MM-DD)`);
  }
  return s;
}

function time(value, field = 'Giờ', { optional = false } = {}) {
  const s = str(value, field, { max: 8, optional });
  if (s === null) return null;
  const hhmm = s.slice(0, 5);
  if (!TIME_RE.test(hhmm)) throw badRequest(`${field} không hợp lệ (định dạng HH:MM)`);
  return hhmm;
}

function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw badRequest(`${field} là bắt buộc`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${field} phải là số nguyên từ ${min} đến ${max}`);
  return n;
}

function id(value, field = 'ID') {
  return int(value, field, { min: 1 });
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

// Chỉ nhận ảnh nội bộ hoặc https để tránh javascript:/data: URL.
function imageUrl(value) {
  const s = str(value, 'Ảnh', { max: 500, optional: true });
  if (s === null) return '/img/pitch-1.svg';
  if (!/^https:\/\/\S+$/.test(s) && !/^\/img\/[\w.-]+$/.test(s)) {
    throw badRequest('Ảnh phải là đường dẫn https:// hoặc ảnh có sẵn trong /img/');
  }
  return s;
}

module.exports = { str, email, phone, password, date, time, int, id, bool, imageUrl };
