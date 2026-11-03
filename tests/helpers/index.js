// Tiện ích dùng chung cho test trên MySQL thật. Bộ chạy `npm test` (scripts/test.js) tạo CSDL test riêng và đặt
// FB_TEST_DB + DB_NAME trước khi chạy các file; mỗi file tự đặt lại dữ liệu bằng các hàm ở đây.
if (!process.env.FB_TEST_DB || process.env.DB_NAME !== process.env.FB_TEST_DB) {
  throw new Error('Chạy test bằng `npm test` (hoặc `npm test -- tests/<file>.test.js`) để có CSDL test riêng.');
}

const bcrypt = require('bcryptjs');
const { db, pool } = require('../../src/db');
const clock = require('../../src/clock');
const { createApp } = require('../../src/app');
const { resetDemo } = require('../../src/seed');
const { addDays, vnToMs } = require('../../src/lib/time');
const { findClaimDrift } = require('../../src/services/bookingState');

/** Xóa sạch dữ liệu mọi bảng (trừ sessions) và đưa đồng hồ về giờ thật. */
async function emptyData() {
  clock.setOffsetMinutes(0);
  const conn = await pool.getConnection();
  try {
    const [tables] = await conn.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t.name}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

/** Dữ liệu demo đầy đủ (34 sân thật + 6 sân demo + tài khoản demo). */
async function loadDemo() {
  clock.setOffsetMinutes(0);
  return resetDemo();
}

let hashCache;
async function passwordHash(pw = 'Matkhau@123') {
  if (!hashCache) hashCache = await bcrypt.hash(pw, 4);
  return hashCache;
}

let seq = 0;
async function makeUser({ role = 'customer', email, fullName = 'Người thử', phone = '0900000000', isActive = 1 } = {}) {
  seq += 1;
  const r = await db.query(
    'INSERT INTO users (full_name, email, phone, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [fullName, email || `u${seq}-${Date.now()}@test.local`, phone, await passwordHash(), role, isActive, clock.now()],
  );
  return { id: r.insertId, role };
}

/** Cụm sân tối thiểu 06:00–23:00, ô 60 phút, cao điểm 17–21h, kèm một sân con. */
async function makeVenueWithCourt({ ownerId, requiresApproval = 0, lastMinutePercent = 0, courts = 1, price = 300000, peakPrice = 450000 } = {}) {
  const now = clock.now();
  const v = await db.query(
    `INSERT INTO venues (owner_id, name, district, address, description, rules, amenities, open_time, close_time, slot_minutes,
       peak_start, peak_end, requires_approval, last_minute_percent, created_at, updated_at)
     VALUES (?, 'Sân thử', 'Quận 1', 'Địa chỉ thử', '', 'Nội quy thử', '[]', '06:00', '23:00', 60, '17:00', '21:00', ?, ?, ?, ?)`,
    [ownerId, requiresApproval, lastMinutePercent, now, now],
  );
  const courtIds = [];
  for (let i = 1; i <= courts; i += 1) {
    const c = await db.query("INSERT INTO courts (venue_id, name, field_type, price, peak_price) VALUES (?, ?, '5', ?, ?)", [v.insertId, `Sân ${i}`, price, peakPrice]);
    courtIds.push(c.insertId);
  }
  return { venueId: v.insertId, courtIds };
}

const tomorrow = () => addDays(clock.today(), 1);
/** Đặt "bây giờ" của hệ thống về một mốc 'YYYY-MM-DD HH:mm' bằng độ lệch đồng hồ. */
const setNow = (stamp) => clock.setOffsetMinutes((vnToMs(stamp) - Date.now()) / 60000);

/** Chạy app trên cổng ngẫu nhiên; trả { base, agent(), close() }. */
async function startApp({ production = false, proxySecret = null } = {}) {
  const app = createApp({ production, proxySecret });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** Một "trình duyệt": giữ cookie, tự lấy và gửi CSRF cho thao tác ghi. */
  const agent = () => {
    let cookie = '';
    let csrf = null;
    const send = async (method, path, body) => {
      if (method !== 'GET' && !csrf) {
        const t = await send('GET', '/api/auth/csrf');
        csrf = t.body.csrfToken;
      }
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          // Production đặt cookie Secure sau proxy HTTPS; giả lập proxy để phiên (và CSRF) vẫn chạy trên http local.
          ...(production ? { 'X-Forwarded-Proto': 'https' } : {}),
          ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const c of res.headers.getSetCookie()) cookie = c.split(';')[0];
      // Đăng nhập/đăng xuất/đổi vai trò dev làm mới session nên token CSRF cũ hết hiệu lực (FE cũng lấy lại).
      if (method === 'POST' && /^\/api\/(auth|dev)\//.test(path)) csrf = null;
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* không phải JSON */
      }
      return { status: res.status, body: json, text, headers: res.headers };
    };
    return {
      get: (p) => send('GET', p),
      post: (p, b = {}) => send('POST', p, b),
      put: (p, b = {}) => send('PUT', p, b),
      del: (p) => send('DELETE', p),
      resetCsrf: () => {
        csrf = null;
      },
    };
  };

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.shutdown();
  };
  return { base, agent, close };
}

/** Mọi khóa trong JSON (đệ quy) có dấu gạch dưới không? Trả danh sách đường dẫn vi phạm. */
function snakeKeys(value, path = '$') {
  const bad = [];
  if (Array.isArray(value)) value.forEach((v, i) => bad.push(...snakeKeys(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.includes('_')) bad.push(`${path}.${k}`);
      bad.push(...snakeKeys(v, `${path}.${k}`));
    }
  }
  return bad;
}

async function closeAll() {
  await pool.end();
}

module.exports = { db, emptyData, loadDemo, makeUser, makeVenueWithCourt, tomorrow, setNow, startApp, snakeKeys, closeAll, clock, findClaimDrift };
