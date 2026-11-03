// Cấu hình tối thiểu để chạy NODE_ENV=production: server từ chối khởi động nếu còn giá trị mẫu, khóa yếu hoặc nghe ngoài localhost.
// Hàm thuần theo `env` để test được; chỉ src/server.js gọi nó, và chỉ khi NODE_ENV=production.

// 32 ký tự: chuỗi ngẫu nhiên (hex/base64) từ 32 ký tự có ít nhất ~128 bit, đủ để không dò ra được SESSION_SECRET/PROXY_SECRET.
const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER = /^change_me/i;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function problems(env) {
  const out = [];
  const val = (k) => String(env[k] ?? '');
  for (const k of ['SESSION_SECRET', 'SEPAY_API_KEY', 'DB_PASSWORD', 'PROXY_SECRET']) {
    if (PLACEHOLDER.test(val(k))) out.push(`${k} vẫn là giá trị mẫu (change_me…): đặt giá trị thật trong .env`);
  }
  if (!val('SEPAY_API_KEY')) out.push('Thiếu SEPAY_API_KEY: webhook SePay sẽ từ chối mọi yêu cầu');
  for (const k of ['SESSION_SECRET', 'PROXY_SECRET']) {
    if (!val(k)) {
      out.push(k === 'PROXY_SECRET' ? 'Thiếu PROXY_SECRET: không có gì để xác nhận request đến từ Pages Function' : 'Thiếu SESSION_SECRET: không có khóa ký phiên');
    } else if (!PLACEHOLDER.test(val(k)) && val(k).length < MIN_SECRET_LENGTH) {
      out.push(`${k} quá ngắn (${val(k).length} ký tự, cần ít nhất ${MIN_SECRET_LENGTH}): dùng chuỗi ngẫu nhiên, ví dụ \`openssl rand -hex 32\``);
    }
  }
  if (val('HOST') && !LOOPBACK.has(val('HOST'))) out.push(`HOST: production chỉ được nghe ở 127.0.0.1 (cổng đi ra mạng là tunnel, không phải mạng LAN)`);
  return out;
}

module.exports = { problems, MIN_SECRET_LENGTH };
