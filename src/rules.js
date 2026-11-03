// Luật đã chốt trong docs/PRD.md mục 4 (R1–R18) mà FE đọc qua GET /api/meta.
// Là hằng số trong code, không đọc từ .env, để một máy không thể chạy sai luật. tests/meta.test.js so với public/mock/meta.json.
const BANKS = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970422', name: 'MBBank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970443', name: 'SHB' },
  { bin: '970426', name: 'MSB' },
  { bin: '970448', name: 'OCB' },
  { bin: '970440', name: 'SeABank' },
  { bin: '963388', name: 'Timo' },
  { bin: '546034', name: 'CAKE' },
];

const RULES = {
  bookingWindowDays: 3, // R1: hôm nay + 2 ngày tới
  holdMinutes: 15, // R3
  payHoldMinutes: 15, // R3: đơn đã có sân giữ chừng này cho tới khi khách chuyển khoản
  waitlistOfferMinutes: 10, // R9
  lastMinuteHours: 3, // R6
  transferCloseMinutes: 60, // R12
  matchCloseMinutes: 120, // R13
  matchMinOpenMinutes: 60,
  requestCloseMinutes: 60, // R14
  requestMinOpenMinutes: 30,
  requestMaxOpen: 3,
  requestMaxOffers: 5,
  offerMinMinutes: 15,
  reliabilityWindowDays: 60, // R10
  reliabilityMaxViolations: 2,
};

// R7: văn bản chính sách hủy, giống nhau mọi sân.
const CANCEL_POLICY_TEXT = 'Hủy trước 24 giờ hoàn 100%, từ 12 đến dưới 24 giờ hoàn 50%, dưới 12 giờ không hoàn.';

module.exports = { RULES, BANKS, CANCEL_POLICY_TEXT };
