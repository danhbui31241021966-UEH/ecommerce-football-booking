// Cấu hình service mail: đọc hoàn toàn từ biến môi trường, thiếu/sai thì ném lỗi để không khởi động.
const fs = require('fs');
const MIN_SECRET = 32;

// Giá trị bí mật: từ NAME hoặc từ file NAME_FILE (bỏ khoảng trắng/xuống dòng ở cuối). Có cả hai là lỗi.
// Lỗi chỉ nêu tên biến, không bao giờ nêu nội dung hay đường dẫn đọc được từ file.
function secret(env, name) {
  const file = env[`${name}_FILE`];
  if (file && env[name]) throw new Error(`${name} và ${name}_FILE không được đặt cùng lúc`);
  if (!file) return env[name] || '';
  try { return fs.readFileSync(file, 'utf8').trimEnd(); } catch { throw new Error(`không đọc được file của ${name}_FILE`); }
}

function int(env, name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} phải là số nguyên không âm`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`${name} ngoài khoảng ${min}..${max}`);
  return n;
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const tokenSecret = secret(env, 'MAIL_TOKEN_SECRET');
  if (tokenSecret.length < MIN_SECRET) throw new Error(`MAIL_TOKEN_SECRET thiếu hoặc ngắn hơn ${MIN_SECRET} ký tự`);

  const origins = (env.MAIL_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origins.length) throw new Error('MAIL_ALLOWED_ORIGINS trống');
  for (const o of origins) {
    let u;
    try { u = new URL(o); } catch { throw new Error('MAIL_ALLOWED_ORIGINS có giá trị không phải origin'); }
    if (u.origin !== o) throw new Error('MAIL_ALLOWED_ORIGINS chỉ nhận dạng scheme://host[:port], không có đường dẫn hay dấu / cuối');
    if (production && u.protocol !== 'https:') throw new Error('MAIL_ALLOWED_ORIGINS ở production phải là https');
  }

  const transport = env.MAIL_TRANSPORT || '';
  if (transport !== 'smtp' && transport !== 'capture') throw new Error('MAIL_TRANSPORT phải là smtp hoặc capture');
  if (transport === 'capture' && production) throw new Error('MAIL_TRANSPORT=capture bị từ chối khi NODE_ENV=production');

  const dailyCap = int(env, 'MAIL_DAILY_LIMIT', 400, { min: 1 });
  const dailyVerifyCap = int(env, 'MAIL_DAILY_VERIFY_LIMIT', 250, { min: 1 });
  if (dailyVerifyCap >= dailyCap) throw new Error('MAIL_DAILY_VERIFY_LIMIT phải nhỏ hơn MAIL_DAILY_LIMIT (chừa chỗ cho thông báo)');

  const cfg = {
    production,
    port: int(env, 'MAIL_PORT', 4126, { min: 1, max: 65535 }),
    host: env.MAIL_HOST || '0.0.0.0',
    secret: tokenSecret,
    origins,
    // Số proxy tin cậy phía trước (Traefik = 1). 0 = không proxy, bỏ qua X-Forwarded-For.
    trustProxy: int(env, 'MAIL_TRUST_PROXY', 0, { max: 5 }),
    transport,
    captureDir: env.MAIL_CAPTURE_DIR || '',
    smtp: null,
    from: '',
    limits: {
      // Trần tổng/24h: Gmail cá nhân ~500 thư/ngày, chừa dư cho thư gửi tay và lần thử lại.
      dailyCap,
      // Riêng cho thư xác nhận (gửi tới người lạ, dễ bị đốt): chừa phần còn lại của trần chung cho thông báo của người đã xác nhận.
      dailyVerifyCap,
    },
  };
  if (transport === 'capture') {
    if (!cfg.captureDir) throw new Error('MAIL_CAPTURE_DIR trống');
    cfg.from = env.MAIL_FROM || 'GGO <capture@localhost>';
  } else {
    const user = secret(env, 'SMTP_USER');
    const pass = secret(env, 'SMTP_PASS');
    if (!user || !pass) throw new Error('SMTP_USER hoặc SMTP_PASS trống');
    cfg.smtp = {
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: int(env, 'SMTP_PORT', 587, { min: 1, max: 65535 }),
      user, pass,
    };
    cfg.from = env.MAIL_FROM || user;
  }
  return cfg;
}

module.exports = { loadConfig, MIN_SECRET };
