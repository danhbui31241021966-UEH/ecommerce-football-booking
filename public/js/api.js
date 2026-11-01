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
  /** Trang giải công khai (không cần đăng nhập): chỉ giải đã công bố. */
  leagues: (district) => get('/api/leagues', district ? { district } : undefined),
  league: (id) => get(`/api/leagues/${id}`),
  leaveWaitlist: (id) => request('DELETE', `/api/waitlist/${id}`),
  /** Pass sân. offerTransfer: body { askPrice } (≤ giá đã trả, làm tròn 1.000đ) → Transfer. */
  offerTransfer: (bookingId, body) => post(`/api/bookings/${bookingId}/transfer`, body),
  /** params: { venueId, date, district } → [Transfer] đang mở nhận. */
  transfers: (params) => get('/api/transfers', params),
  myTransfers: () => get('/api/transfers/mine'),
  transfer: (id) => get(`/api/transfers/${id}`),
  claimTransfer: (id) => post(`/api/transfers/${id}/claim`),
  withdrawTransfer: (id) => request('DELETE', `/api/transfers/${id}`),
  /** Ghép kèo. openMatch: { courtId, date, start, loserPercent (50|60|70|100), closesAt } → Match. */
  openMatch: (body) => post('/api/matches', body),
  /** params: { venueId, date, district } → [Match] đã có phần đội mở kèo và còn nhận đội thứ hai. */
  matches: (params) => get('/api/matches', params),
  myMatches: () => get('/api/matches/mine'),
  match: (id) => get(`/api/matches/${id}`),
  joinMatch: (id) => post(`/api/matches/${id}/join`),
  withdrawMatch: (id) => request('DELETE', `/api/matches/${id}`),
  /** Đội trưởng báo kết quả sau giờ đá: winner = 'host' | 'guest' | 'draw'; bank (tùy chọn) = { bin, account, accountName } tài khoản nhận phần chênh. */
  reportMatchResult: (id, winner, bank) => post(`/api/matches/${id}/result`, { winner, bank }),
  /** Lưu tài khoản ngân hàng của đội mình trong kèo (chỉ hai đội trong kèo xem được). */
  setMatchBank: (id, bank) => request('PUT', `/api/matches/${id}/bank`, { body: bank }),
  /** Đội thắng bấm đã nhận phần chênh. */
  matchTopUpReceived: (id) => post(`/api/matches/${id}/topup-received`),
  /** Tin nhờ báo giá: openRequest { district, date, from, to, fieldType, budget, closesAt, note } → Request. acceptOffer(requestId, offerId) → Booking (qua luồng đặt thường). */
  openRequest: (body) => post('/api/requests', body),
  myRequests: () => get('/api/requests/mine'),
  request: (id) => get(`/api/requests/${id}`),
  cancelRequest: (id) => request('DELETE', `/api/requests/${id}`),
  acceptOffer: (requestId, offerId) => post(`/api/requests/${requestId}/accept`, { offerId }),
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
    /** Thêm lịch cho khách gọi điện/Zalo: { courtId, date, start, customerName, customerPhone?, price?, paid?, note? } → Booking (source: 'phone'). */
    addBooking: (body) => post('/api/owner/bookings', body),
    /** Sửa lịch đặt qua điện thoại: { customerName?, customerPhone?, price?, note? }. Giờ và sân không sửa được. */
    updateBooking: (id, body) => request('PUT', `/api/owner/bookings/${id}`, { body }),
    leagues: (venueId) => get('/api/owner/leagues', { venueId }),
    league: (id) => get(`/api/owner/leagues/${id}`),
    createLeague: (body) => post('/api/owner/leagues', body),
    updateLeague: (id, body) => request('PUT', `/api/owner/leagues/${id}`, { body }),
    deleteLeague: (id) => request('DELETE', `/api/owner/leagues/${id}`),
    addLeagueTeam: (id, body) => post(`/api/owner/leagues/${id}/teams`, body),
    updateLeagueTeam: (id, tid, body) => request('PUT', `/api/owner/leagues/${id}/teams/${tid}`, { body }),
    deleteLeagueTeam: (id, tid) => request('DELETE', `/api/owner/leagues/${id}/teams/${tid}`),
    makeLeagueFixtures: (id) => post(`/api/owner/leagues/${id}/fixtures`),
    saveLeaguePlan: (id, slots) => request('PUT', `/api/owner/leagues/${id}/plan`, { body: { slots } }),
    autoPlanLeague: (id, body) => post(`/api/owner/leagues/${id}/auto-plan`, body),
    publishLeague: (id) => post(`/api/owner/leagues/${id}/publish`),
    rescheduleLeagueMatch: (id, mid, body) => post(`/api/owner/leagues/${id}/matches/${mid}/reschedule`, body),
    scoreLeagueMatch: (id, mid, body) => post(`/api/owner/leagues/${id}/matches/${mid}/score`, body),
    withdrawLeagueTeam: (id, tid, note) => post(`/api/owner/leagues/${id}/teams/${tid}/withdraw`, { note }),
    block: (body) => post('/api/owner/blocks', body),
    unblock: (id) => request('DELETE', `/api/owner/blocks/${id}`),
    /** params: { status, date, venueId, q } */
    bookings: (params) => get('/api/owner/bookings', params),
    approve: (id) => post(`/api/owner/bookings/${id}/approve`),
    reject: (id, reason) => post(`/api/owner/bookings/${id}/reject`, { reason }),
    cancel: (id, reason) => post(`/api/owner/bookings/${id}/cancel`, { reason }),
    /** Pass sân: danh sách cần xử lý, xác nhận đã nhận tiền của đội nhận, từ chối đội nhận. Trả lại cho đội cũ dùng markRefunded(bookingId). */
    bankEvents: () => get('/api/owner/bank-events'),
    resolveBankEvent: (id, note) => post(`/api/owner/bank-events/${id}/resolve`, { note }),
    transfers: () => get('/api/owner/transfers'),
    confirmTransfer: (id, note) => post(`/api/owner/transfers/${id}/confirm`, { note }),
    rejectTransfer: (id, reason) => post(`/api/owner/transfers/${id}/reject`, { reason }),
    /** Trận đủ hai đội: danh sách cần xử lý; confirmMatchPart(id, 'host'|'guest', note); trả lại từng đội: refundMatch(id, part, note). */
    matches: () => get('/api/owner/matches'),
    confirmMatchPart: (id, part, note) => post(`/api/owner/matches/${id}/confirm-part`, { part, note }),
    rejectMatchGuest: (id, reason) => post(`/api/owner/matches/${id}/reject-guest`, { reason }),
    /** Chủ sân chốt kết quả khi hai đội báo lệch hoặc quá hạn: winner = 'host' | 'guest' | 'draw'. */
    settleMatchResult: (id, winner) => post(`/api/owner/matches/${id}/result`, { winner }),
    cancelMatch: (id, reason) => post(`/api/owner/matches/${id}/cancel`, { reason }),
    refundMatch: (id, part, note) => post(`/api/owner/matches/${id}/refund`, { part, note }),
    /** Tin nhờ báo giá của khách ở khu vực sân mình: requests() → [Request kèm options]; sendOffer(requestId, { courtId, start, price, validUntil, note }); withdrawOffer(offerId). */
    requests: () => get('/api/owner/requests'),
    sendOffer: (requestId, body) => post(`/api/owner/requests/${requestId}/offers`, body),
    withdrawOffer: (id) => request('DELETE', `/api/owner/offers/${id}`),
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
    markRefunded: (id, note, part) => post(`/api/admin/bookings/${id}/refund`, { note, part }),
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
          simulateTransfer: async (d) => (await loadMock()).proto.simulateTransfer(d),
          bankReport: async (d) => (await loadMock()).proto.bankReport(d),
          flushBank: async () => (await loadMock()).proto.flushBank(),
          state: async () => (await loadMock()).proto.state(),
        }
      : null,
};
