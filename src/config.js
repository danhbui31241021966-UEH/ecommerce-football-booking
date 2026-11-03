// Toàn bộ thời gian trong hệ thống tính theo giờ TP.HCM.
process.env.TZ = 'Asia/Ho_Chi_Minh';
require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name} (xem .env.example)`);
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

// Luật nghiệp vụ (giữ chỗ 15 phút, đặt trước 3 ngày...) nằm ở src/rules.js, không cấu hình bằng .env.
module.exports = {
  isProduction,
  port: Number(process.env.PORT || 3000),
  // Luôn nghe ở localhost (kể cả production): ra mạng chỉ qua tunnel cloudflared tới cổng này. productionCheck từ chối HOST khác loopback.
  host: process.env.HOST || '127.0.0.1',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME'),
  },
  sessionSecret: required('SESSION_SECRET'),
  // Khóa API SePay (R17); đọc lúc gọi để đổi/đặt trong test. Không đặt thì webhook từ chối mọi yêu cầu.
  // Bí mật chung với Pages Function (header X-SN-Proxy-Secret); đọc lúc gọi như sepayApiKey.
  get proxySecret() {
    return process.env.PROXY_SECRET || '';
  },
  get sepayApiKey() {
    return process.env.SEPAY_API_KEY || '';
  },
};
