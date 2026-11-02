// Đồng hồ duy nhất của hệ thống. Mọi luật theo thời gian (hết hạn giữ chỗ, giờ đã qua, giảm giờ chót...) phải lấy
// "bây giờ" từ đây, KHÔNG dùng NOW() của SQL hay new Date() rải rác, để route dev (/api/dev/clock) tua được đồng hồ.
// Độ lệch chỉ đổi được khi route dev được gắn (không bao giờ khi NODE_ENV=production).
const { msToVn } = require('./lib/time');

let offsetMs = 0;

const nowMs = () => Date.now() + offsetMs;
const now = () => msToVn(nowMs()); // 'YYYY-MM-DD HH:mm:ss' giờ VN
const today = () => now().slice(0, 10);
const getOffsetMinutes = () => offsetMs / 60000;
const setOffsetMinutes = (min) => {
  offsetMs = Number(min) * 60000;
};

module.exports = { nowMs, now, today, getOffsetMinutes, setOffsetMinutes };
