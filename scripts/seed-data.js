// Dữ liệu mẫu cho demo. Tên sân, địa chỉ, SĐT là giả lập, không phải sân thật.
const bcrypt = require('bcryptjs');
const slots = require('../src/services/slots');

const DEMO_PASSWORD = 'Matkhau@123';

const USERS = [
  ['Quản trị viên', 'admin@datsan.local', '0900000001', 'admin'],
  ['Nguyễn Văn Chủ', 'chusan1@datsan.local', '0900000002', 'owner'],
  ['Trần Thị Sân', 'chusan2@datsan.local', '0900000003', 'owner'],
  ['Lê Minh Khách', 'khach1@datsan.local', '0900000004', 'customer'],
  ['Phạm Đội Trưởng', 'khach2@datsan.local', '0900000005', 'customer'],
];

const RULES = 'Mang giày đinh dăm/TF, không dùng giày đinh sắt. Có mặt trước giờ đá 10 phút. Không hút thuốc trong sân.';

const VENUES = [
  {
    owner: 'chusan1@datsan.local', name: 'Cụm sân Hoàng Gia', district: 'Tân Bình', address: '12 Đường Cộng Hòa, Phường 4',
    phone: '0281234561', image: '/img/pitch-1.svg', amenities: 'Bãi giữ xe, Nước uống, Phòng thay đồ, Đèn LED',
    open: '06:00', close: '23:00', slot: 60, peak: ['17:00', '21:00'], approval: 0,
    payment: 'Chuyển khoản Vietcombank 0123456789 - CTY SAN HOANG GIA, nội dung: mã booking. Hoặc trả tiền mặt tại quầy.',
    courts: [['Sân A', '5', 300000, 450000], ['Sân B', '5', 300000, 450000], ['Sân C', '7', 500000, 700000]],
  },
  {
    owner: 'chusan1@datsan.local', name: 'Sân bóng Thành Công', district: 'Gò Vấp', address: '45 Đường Phan Văn Trị, Phường 10',
    phone: '0281234562', image: '/img/pitch-2.svg', amenities: 'Bãi giữ xe, Nước uống, Wifi',
    open: '06:00', close: '22:30', slot: 90, peak: ['17:00', '20:00'], approval: 1,
    payment: 'Thanh toán tiền mặt tại sân trước giờ đá.',
    courts: [['Sân 1', '7', 600000, 850000], ['Sân 2', '7', 600000, 850000]],
  },
  {
    owner: 'chusan2@datsan.local', name: 'Sân mini Bình Thạnh Xanh', district: 'Bình Thạnh', address: '88 Đường Điện Biên Phủ, Phường 15',
    phone: '0281234563', image: '/img/pitch-3.svg', amenities: 'Nước uống, Phòng thay đồ, Căng tin',
    open: '07:00', close: '23:00', slot: 60, peak: ['18:00', '22:00'], approval: 0,
    payment: 'Chuyển khoản MB Bank 9876543210 - TRAN THI SAN.',
    courts: [['Sân 1', '5', 250000, 400000], ['Sân 2', '5', 250000, 400000], ['Sân 3', '5', 280000, 420000], ['Sân 4', '7', 450000, 650000]],
  },
  {
    owner: 'chusan2@datsan.local', name: 'Sân Phú Nhuận Arena', district: 'Phú Nhuận', address: '20 Đường Phan Xích Long, Phường 2',
    phone: '0281234564', image: '/img/pitch-2.svg', amenities: 'Bãi giữ xe, Đèn LED, Camera',
    open: '06:00', close: '22:00', slot: 60, peak: ['17:00', '21:00'], approval: 0,
    payment: 'Chuyển khoản hoặc tiền mặt tại sân.',
    courts: [['Sân A', '5', 320000, 480000], ['Sân B', '7', 550000, 750000]],
  },
  {
    owner: 'chusan2@datsan.local', name: 'Sân bóng Thủ Đức Riverside', district: 'TP. Thủ Đức', address: '150 Đường Võ Văn Ngân, Phường Bình Thọ',
    phone: '0281234565', image: '/img/pitch-1.svg', amenities: 'Bãi giữ xe rộng, Nước uống, Phòng thay đồ',
    open: '05:30', close: '22:30', slot: 90, peak: null, approval: 0,
    payment: 'Tiền mặt tại sân.',
    courts: [['Sân 1', '7', 500000, 500000], ['Sân 2', '5', 280000, 280000]],
  },
  {
    owner: 'chusan1@datsan.local', name: 'Sân Quận 7 Sunrise', district: 'Quận 7', address: '33 Đường Nguyễn Thị Thập, Phường Tân Phú',
    phone: '0281234566', image: '/img/pitch-3.svg', amenities: 'Bãi giữ xe, Nước uống, Wifi, Đèn LED',
    open: '06:00', close: '23:00', slot: 60, peak: ['17:00', '22:00'], approval: 1,
    payment: 'Chuyển khoản ACB 1122334455 - SAN SUNRISE, nội dung: mã booking.',
    courts: [['Sân 1', '5', 350000, 500000], ['Sân 2', '5', 350000, 500000]],
  },
];

async function seed(conn) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userIds = {};
  for (const [name, email, phone, role] of USERS) {
    const [r] = await conn.query(
      'INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone, hash, role],
    );
    userIds[email] = r.insertId;
  }

  const courtIds = [];
  for (const x of VENUES) {
    const [r] = await conn.query('INSERT INTO venues SET ?', [{
      owner_id: userIds[x.owner],
      name: x.name,
      district: x.district,
      address: x.address,
      phone: x.phone,
      description: `${x.name} - sân cỏ nhân tạo chất lượng tại ${x.district}, phù hợp đá phong trào và giao lưu.`,
      amenities: x.amenities,
      open_time: x.open,
      close_time: x.close,
      slot_minutes: x.slot,
      peak_start: x.peak?.[0] ?? null,
      peak_end: x.peak?.[1] ?? null,
      requires_approval: x.approval,
      rules: RULES,
      payment_info: x.payment,
      image_url: x.image,
    }]);
    for (const [name, type, price, peak] of x.courts) {
      const [c] = await conn.query(
        'INSERT INTO courts (venue_id, name, field_type, price, peak_price) VALUES (?, ?, ?, ?, ?)',
        [r.insertId, name, type, price, peak],
      );
      courtIds.push({ id: c.insertId, venueId: r.insertId, venue: x, name, type, price, peak });
    }
  }

  // Một booking đã xác nhận và một slot bị chặn vào ngày mai để lịch có dữ liệu minh họa.
  const tomorrow = slots.addDays(slots.toDateStr(new Date()), 1);
  const c = courtIds[0];
  const [b] = await conn.query(
    `INSERT INTO bookings (code, customer_id, venue_id, court_id, start_at, end_at, status, price, venue_name,
       court_name, field_type, rules_snapshot, policy_snapshot, payment_info_snapshot, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['BKDEMO0001', userIds['khach1@datsan.local'], c.venueId, c.id, `${tomorrow} 18:00:00`, `${tomorrow} 19:00:00`,
      c.peak, c.venue.name, c.name, c.type, RULES, slots.CANCEL_POLICY_TEXT, c.venue.payment, 'seed-demo-booking-1'],
  );
  await conn.query(
    `INSERT INTO booking_history (booking_id, action, to_status, actor_id) VALUES (?, 'create', 'confirmed', ?)`,
    [b.insertId, userIds['khach1@datsan.local']],
  );
  await conn.query(
    'INSERT INTO slot_blocks (court_id, start_at, end_at, reason, created_by) VALUES (?, ?, ?, ?, ?)',
    [courtIds[1].id, `${tomorrow} 19:00:00`, `${tomorrow} 20:00:00`, 'Khách quen đặt qua điện thoại', userIds['chusan1@datsan.local']],
  );
}

module.exports = { seed, DEMO_PASSWORD, USERS };
