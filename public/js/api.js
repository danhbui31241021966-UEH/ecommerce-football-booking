// Điểm duy nhất các trang dùng để lấy và ghi dữ liệu: `import { api } from '/js/api.js'`.
// Mỗi endpoint của PRD mục 7 có đúng một hàm. Lỗi (400/401/403/404/409...) ném ApiError { status, message }.
//
// Chuyển dữ liệu giả ↔ backend thật chỉ ở MỘT chỗ: hằng MODE bên dưới.
//   'mock' = prototype, dữ liệu trong localStorage (public/mock/*.json + js/api-mock.js)
//   'real' = fetch tới /api/... (CSRF từ /api/auth/csrf, header X-CSRF-Token cho POST/PUT/DELETE)
export const MODE = 'mock';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* ---------- Giao vận: chỗ duy nhất phân biệt giả/thật ---------- */

let csrfToken = null;
let mockModule = null;
const loadMock = () => (mockModule ??= import('./api-mock.js'));

async function getCsrf() {
  if (!csrfToken) csrfToken = (await transport('GET', '/api/auth/csrf')).csrfToken;
  return csrfToken;
}

async function transport(method, path, { query, body } = {}, token) {
  if (MODE === 'mock') {
    const m = await loadMock();
    return m.handle(method, path, { query: query || {}, body }, token);
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== '' && v != null) qs.set(k, v);
  const res = await fetch(path + (qs.size ? `?${qs}` : ''), {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Lỗi ${res.status}`);
  return data;
}

async function request(method, path, opts = {}) {
  const token = method === 'GET' ? undefined : await getCsrf();
  try {
    return await transport(method, path, opts, token);
  } catch (e) {
    // Phiên mới (đăng nhập/đăng xuất) có thể làm token cũ hết hiệu lực: lấy lại một lần.
    if (e.status === 403 && /csrf/i.test(e.message) && method !== 'GET') {
      csrfToken = null;
      return transport(method, path, opts, await getCsrf());
    }
    throw e;
  }
}

const get = (path, query) => request('GET', path, { query });
const post = (path, body = {}) => request('POST', path, { body });

/* ---------- Hàm cho các trang ---------- */

export const api = {
  // Công khai
  meta: () => get('/api/meta'),
  districts: () => get('/api/venues/districts'),
  /** params: { q, district, fieldType: '5'|'7', maxPrice, date, from }. Có date → mỗi sân kèm availableSlots. */
  venues: (params) => get('/api/venues', params),
  /** params: { date, at: 'HH:mm', district, fieldType, maxPrice, lastMinute: 1 } */
  searchSlots: (params) => get('/api/venues/slots', params),
  venue: (id) => get(`/api/venues/${id}`),
  schedule: (venueId, date) => get(`/api/venues/${venueId}/schedule`, { date }),

  // Tài khoản
  me: () => get('/api/auth/me'),
  register: async (body) => {
    const r = await post('/api/auth/register', body);
    csrfToken = null;
    return r;
  },
  login: async (body) => {
    const r = await post('/api/auth/login', body);
    csrfToken = null;
    return r;
  },
  logout: async () => {
    const r = await post('/api/auth/logout');
    csrfToken = null;
    return r;
  },

  // Khách hàng
  /** body: { courtId, date, start, note } (idempotencyKey tự thêm nếu thiếu) */
  createBooking: (body) => post('/api/bookings', { idempotencyKey: crypto.randomUUID(), ...body }),
  myBookings: () => get('/api/bookings/mine'),
  myReliability: () => get('/api/bookings/reliability'),
  booking: (id) => get(`/api/bookings/${id}`),
  cancelBooking: (id, reason = '') => post(`/api/bookings/${id}/cancel`, { reason }),
  /** body: { courtId, date, start } → { id, position } */
  joinWaitlist: (body) => post('/api/waitlist', body),
  myWaitlist: () => get('/api/waitlist/mine'),
  leaveWaitlist: (id) => request('DELETE', `/api/waitlist/${id}`),
  /** Nhượng booking. offerTransfer: body { askPrice } (≤ giá đã trả, làm tròn 1.000đ) → Transfer. */
  offerTransfer: (bookingId, body) => post(`/api/bookings/${bookingId}/transfer`, body),
  /** params: { venueId, date, district } → [Transfer] đang mở nhận. */
  transfers: (params) => get('/api/transfers', params),
  myTransfers: () => get('/api/transfers/mine'),
  transfer: (id) => get(`/api/transfers/${id}`),
  claimTransfer: (id) => post(`/api/transfers/${id}/claim`),
  withdrawTransfer: (id) => request('DELETE', `/api/transfers/${id}`),
  notifications: () => get('/api/notifications'),
  readAllNotifications: () => post('/api/notifications/read-all'),

  // Chủ sân
  owner: {
    venues: () => get('/api/owner/venues'),
    createVenue: (body) => post('/api/owner/venues', body),
    updateVenue: (id, body) => request('PUT', `/api/owner/venues/${id}`, { body }),
    addCourt: (venueId, body) => post(`/api/owner/venues/${venueId}/courts`, body),
    updateCourt: (id, body) => request('PUT', `/api/owner/courts/${id}`, { body }),
    schedule: (venueId, date) => get(`/api/owner/venues/${venueId}/schedule`, { date }),
    /** body: { courtId, date, start, end, reason } */
    block: (body) => post('/api/owner/blocks', body),
    unblock: (id) => request('DELETE', `/api/owner/blocks/${id}`),
    /** params: { status, date, venueId, q } */
    bookings: (params) => get('/api/owner/bookings', params),
    approve: (id) => post(`/api/owner/bookings/${id}/approve`),
    reject: (id, reason) => post(`/api/owner/bookings/${id}/reject`, { reason }),
    cancel: (id, reason) => post(`/api/owner/bookings/${id}/cancel`, { reason }),
    /** Nhượng booking: danh sách cần xử lý, xác nhận đã nhận tiền của đội nhận, từ chối đội nhận. Hoàn cho đội cũ dùng markRefunded(bookingId). */
    transfers: () => get('/api/owner/transfers'),
    confirmTransfer: (id, note) => post(`/api/owner/transfers/${id}/confirm`, { note }),
    rejectTransfer: (id, reason) => post(`/api/owner/transfers/${id}/reject`, { reason }),
    markPaid: (id, note) => post(`/api/owner/bookings/${id}/paid`, { note }),
    markRefunded: (id, note) => post(`/api/owner/bookings/${id}/refund`, { note }),
    /** result: 'completed' | 'no_show' */
    attendance: (id, result) => post(`/api/owner/bookings/${id}/attendance`, { result }),
  },

  // Admin
  admin: {
    /** params: { role } */
    users: (params) => get('/api/admin/users', params),
    createOwner: (body) => post('/api/admin/owners', body),
    setActive: (id, active) => post(`/api/admin/users/${id}/active`, { active }),
    /** params: { status, q } */
    bookings: (params) => get('/api/admin/bookings', params),
    cancel: (id, reason) => post(`/api/admin/bookings/${id}/cancel`, { reason }),
    markPaid: (id, note) => post(`/api/admin/bookings/${id}/paid`, { note }),
    markRefunded: (id, note) => post(`/api/admin/bookings/${id}/refund`, { note }),
    attendance: (id, result) => post(`/api/admin/bookings/${id}/attendance`, { result }),
    logs: () => get('/api/admin/logs'),
  },

  // Chỉ có ở prototype (null khi MODE = 'real'): công tắc vai trò, đặt lại demo, tua đồng hồ, giả lập "người khác".
  proto:
    MODE === 'mock'
      ? {
          resetDemo: async () => (await loadMock()).proto.resetDemo(),
          quickLogin: async (role) => {
            csrfToken = null;
            return (await loadMock()).proto.quickLogin(role);
          },
          advanceClock: async (minutes) => (await loadMock()).proto.advanceClock(minutes),
          holderCancels: async () => (await loadMock()).proto.holderCancels(),
          state: async () => (await loadMock()).proto.state(),
        }
      : null,
};
