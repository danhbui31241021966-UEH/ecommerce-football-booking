// Dữ liệu nền của demo, lấy từ public/mock/*.json (cùng nguồn với prototype): tài khoản demo, 34 sân thật + 6 sân demo.
// Không bịa gì thêm: số điện thoại để '' khi nguồn không có; tài khoản ngân hàng của sân là dữ liệu demo của mock.
// ID giữ nguyên như mock (user, sân, sân con) để các luồng kiểm thử viết theo mock vẫn đúng id.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const clock = require('../clock');
const { msToVn } = require('../lib/time');

const MOCK_DIR = path.join(__dirname, '..', '..', 'public', 'mock');
const readMock = (name) => JSON.parse(fs.readFileSync(path.join(MOCK_DIR, `${name}.json`), 'utf8'));

// Vai trò demo -> id user (users.json: demoLogins). Dùng cho route dev đăng nhập nhanh.
const demoLogins = () => readMock('users').demoLogins;

async function seedCore(tx) {
  const { demoPassword, users } = readMock('users');
  const hash = await bcrypt.hash(demoPassword, 10);
  const nowMs = clock.nowMs();
  for (const u of users) {
    await tx.query(
      'INSERT INTO users (id, full_name, email, phone, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [u.id, u.fullName, u.email, u.phone, hash, u.role, u.isActive ? 1 : 0, msToVn(nowMs - u.createdDaysAgo * 86400000)],
    );
  }

  const now = clock.now();
  const venues = readMock('venues');
  for (const v of venues) {
    await tx.query(
      `INSERT INTO venues (id, owner_id, name, district, address, phone, description, rules, amenities, open_time, close_time,
         slot_minutes, peak_start, peak_end, requires_approval, last_minute_percent, maps_url, image_url, image_is_illustrative,
         image_credit, data_source, bank_bin, bank_account, bank_account_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.id, v.ownerId, v.name, v.district, v.address, v.phone || '', v.description || '', v.rules || '', JSON.stringify(v.amenities || []),
        v.openTime, v.closeTime, v.slotMinutes, v.peakStart || null, v.peakEnd || null, v.requiresApproval ? 1 : 0, v.lastMinutePercent || 0,
        v.mapsUrl || '', v.imageUrl, v.imageIsIllustrative === true ? 1 : 0, v.imageCredit ? JSON.stringify(v.imageCredit) : null,
        v.dataSource ? JSON.stringify(v.dataSource) : null, v.bank?.bin || '', v.bank?.account || '', v.bank?.accountName || '',
        v.isActive ? 1 : 0, now, now],
    );
    for (const c of v.courts) {
      await tx.query(
        'INSERT INTO courts (id, venue_id, name, field_type, price, peak_price, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [c.id, v.id, c.name, c.fieldType, c.price, c.peakPrice, c.isActive ? 1 : 0],
      );
    }
  }
  return { users: users.length, venues: venues.length, realVenues: venues.filter((v) => v.dataSource).length, demoVenues: venues.filter((v) => !v.dataSource).length };
}

module.exports = { seedCore, demoLogins, readMock };
