// Máy khách của service mail (hợp đồng: verify/send, verify/confirm, verify/status, notify). Service chỉ trả mã lỗi; câu hiển thị do web quyết định ở mailErrorText.
import { MAIL_API } from './mail-config.js';

export class MailError extends Error {
  constructor(code, retryAfter) {
    super(code);
    this.name = 'MailError';
    this.code = code; // mã của service, hoặc 'network' khi không gọi được
    this.retryAfter = retryAfter;
  }
}

async function call(path, body, { keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(MAIL_API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new MailError('network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MailError(typeof data.error === 'string' ? data.error : 'unavailable', data.retryAfter);
  return data;
}

export const verifySend = (email, name) => call('/verify/send', { email, name: String(name || '').slice(0, 60) });
export const verifyConfirm = (t) => call('/verify/confirm', { t });
export const verifyStatus = (requestId) => call('/verify/status', { requestId });
export const sendNotice = (proof, type, data) => call('/notify', { proof, type, data }, { keepalive: true });

// Lỗi tạm thời: chưa gửi được mail nhưng thử lại sau là được.
export const isTemporary = (e) => e instanceof MailError && ['rate_limited', 'daily_cap', 'unavailable', 'network', 'forbidden_origin'].includes(e.code);

/** Câu trung tính cho người dùng theo mã lỗi; không nói email có tồn tại hay không. */
export function mailErrorText(e) {
  const code = e instanceof MailError ? e.code : 'unavailable';
  if (code === 'expired') return 'Liên kết xác nhận đã hết hạn. Bạn có thể gửi lại mail xác nhận trong trang Tài khoản.';
  if (code === 'invalid') return 'Liên kết xác nhận không hợp lệ. Bạn có thể gửi lại mail xác nhận trong trang Tài khoản.';
  if (code === 'unverified') return 'Email chưa được xác nhận.';
  return 'Tạm thời chưa gửi được mail. Bạn thử lại sau ít phút nhé.';
}
