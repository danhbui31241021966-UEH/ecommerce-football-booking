// Cổng vào khi chạy sau tunnel công khai (production): chỉ Pages Function biết PROXY_SECRET, nên request không mang đúng header
// X-SN-Proxy-Secret (người gọi thẳng link trycloudflare, máy quét) bị chặn trước mọi route, kể cả file tĩnh.
// Request hợp lệ thì tin hai thông tin do Function gửi: IP khách (X-SN-Client-IP) và việc nó đã đi qua HTTPS.
const crypto = require('crypto');
const net = require('net');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

// So sánh hằng thời gian qua băm SHA-256 (cùng độ dài, không lộ độ dài bí mật), như kiểm khóa SePay.
function secretOk(sent, expected) {
  if (!expected || typeof sent !== 'string' || !sent) return false;
  return crypto.timingSafeEqual(digest(sent), digest(expected));
}

let lastWarn = 0;
function proxyGate(getSecret) {
  return (req, res, next) => {
    if (!secretOk(req.get('X-SN-Proxy-Secret'), getSecret())) {
      // 404 trống: người ngoài không biết có gì đứng sau link. Chỉ ghi nhật ký (mỗi phút một lần), không kèm giá trị nào của request.
      if (Date.now() - lastWarn > 60000) {
        lastWarn = Date.now();
        console.warn('Từ chối request không có X-SN-Proxy-Secret hợp lệ (gọi thẳng vào tunnel, hoặc Function đặt sai PROXY_SECRET)');
      }
      return res.status(404).type('text/plain').send('Not Found');
    }
    // Function luôn gọi tunnel qua HTTPS phía trình duyệt; cloudflared không chắc gửi X-Forwarded-Proto nên không dựa vào nó.
    // Đặt ở đây để req.secure (cookie phiên `secure`) đúng; chỉ làm sau khi secret hợp lệ.
    req.headers['x-forwarded-proto'] = 'https';
    // IP khách thật cho giới hạn đăng nhập: không có hoặc không phải IP thì giữ IP kết nối (chung cho mọi khách, nhưng không bị giả mạo).
    const ip = String(req.get('X-SN-Client-IP') || '').trim();
    if (net.isIP(ip)) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    next();
  };
}

module.exports = { proxyGate, secretOk };
