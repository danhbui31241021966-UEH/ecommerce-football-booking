// Kiểm thử nghiệp vụ booking trên database riêng (TEST_DB_NAME, mặc định football_booking_test).
// Cần MySQL đang chạy; tự bỏ qua nếu không kết nối được.
process.env.DB_NAME = process.env.TEST_DB_NAME || 'football_booking_test';
process.env.HOLD_MINUTES = '5';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { pool } = require('../src/db');
const bookings = require('../src/services/bookings');
const slots = require('../src/services/slots');

let ids;
let dbReady = true;

test.before(async () => {
  try {
    const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
    await conn.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
    const user = async (email, role) =>
      (await conn.query(`INSERT INTO users (full_name, email, phone, password_hash, role) VALUES ('Test', ?, '0900000000', 'x', ?)`, [email, role]))[0].insertId;
    const owner = await user('owner@test.local', 'owner');
    const customers = [];
    for (let i = 0; i < 10; i++) customers.push(await user(`c${i}@test.local`, 'customer'));
    const venue = async (approval) =>
      (await conn.query(
        `INSERT INTO venues (owner_id, name, district, address, phone, open_time, close_time, slot_minutes, peak_start, peak_end, requires_approval)
         VALUES (?, 'Sân test', 'Q1', 'Địa chỉ', '0900000000', '06:00', '23:00', 60, '17:00', '21:00', ?)`,
        [owner, approval],
      ))[0].insertId;
    const autoVenue = await venue(0);
    const approvalVenue = await venue(1);
    const court = async (v) =>
      (await conn.query(`INSERT INTO courts (venue_id, name, field_type, price, peak_price) VALUES (?, 'Sân A', '5', 300000, 450000)`, [v]))[0].insertId;
    ids = { owner, customers, autoCourt: await court(autoVenue), approvalCourt: await court(approvalVenue) };
    await conn.end();
  } catch (err) {
    dbReady = false;
    console.warn(`Bỏ qua integration test: ${err.message}`);
  }
});

test.after(() => pool.end());

const customer = (i) => ({ id: ids.customers[i], role: 'customer' });
const owner = () => ({ id: ids.owner, role: 'owner' });
const tomorrow = () => slots.addDays(slots.toDateStr(new Date()), 1);
const book = (i, courtId, start, key = crypto.randomUUID()) =>
  bookings.createBooking(customer(i), { courtId, date: tomorrow(), start, idempotencyKey: key });

test('10 khách đặt cùng một slot cùng lúc: chỉ đúng 1 booking thành công', async (t) => {
  if (!dbReady) return t.skip();
  const results = await Promise.allSettled(ids.customers.map((_, i) => book(i, ids.autoCourt, '18:00')));
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 1);
  for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.status, 409);
  const [[b]] = await pool.query('SELECT status, price FROM bookings WHERE id = ?', [ok[0].value.id]);
  assert.equal(b.status, 'confirmed'); // sân không bật duyệt -> tự xác nhận
  assert.equal(b.price, 450000); // 18:00 nằm trong giờ vàng, giá tính ở server
});

test('gửi lặp cùng mã chống trùng chỉ tạo một booking', async (t) => {
  if (!dbReady) return t.skip();
  const first = await book(0, ids.autoCourt, '08:00', 'same-key-123');
  const again = await book(0, ids.autoCourt, '08:00', 'same-key-123');
  assert.equal(again.id, first.id);
  assert.equal(again.duplicate, true);
});

test('booking chờ duyệt giữ slot, quá hạn thì hết hạn và slot được giải phóng', async (t) => {
  if (!dbReady) return t.skip();
  const { id } = await book(0, ids.approvalCourt, '10:00');
  const [[b]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [id]);
  assert.equal(b.status, 'pending');
  await assert.rejects(book(1, ids.approvalCourt, '10:00'), { status: 409 }); // đang giữ chỗ

  await pool.query('UPDATE bookings SET expires_at = NOW() - INTERVAL 1 SECOND WHERE id = ?', [id]);
  await assert.rejects(bookings.approve(owner(), id), { status: 409 }); // quá hạn thì không duyệt được
  const [[expired]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [id]);
  assert.equal(expired.status, 'expired');

  const second = await book(1, ids.approvalCourt, '10:00');
  await bookings.approve(owner(), second.id);
  const [[approved]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [second.id]);
  assert.equal(approved.status, 'confirmed');
});

test('không đặt được slot đã bị chủ sân chặn', async (t) => {
  if (!dbReady) return t.skip();
  await pool.query(
    'INSERT INTO slot_blocks (court_id, start_at, end_at, reason, created_by) VALUES (?, ?, ?, ?, ?)',
    [ids.autoCourt, `${tomorrow()} 12:00:00`, `${tomorrow()} 13:00:00`, 'Bảo trì', ids.owner],
  );
  await assert.rejects(book(2, ids.autoCourt, '12:00'), { status: 409 });
});

test('khách hủy booking đã thanh toán: tính mức hoàn và giải phóng slot', async (t) => {
  if (!dbReady) return t.skip();
  const { id } = await book(3, ids.autoCourt, '07:00');
  await bookings.markPaid(owner(), id);
  // Ngày mai 07:00 cách hiện tại 7–31 giờ, nên mức hoàn phải khớp chính sách.
  const expected = slots.customerRefundPercent(new Date(`${tomorrow()}T07:00:00`));
  const refund = await bookings.cancelByCustomer(customer(3), id);
  assert.equal(refund.percent, expected);
  const [[b]] = await pool.query('SELECT status, refund_amount, refund_status FROM bookings WHERE id = ?', [id]);
  assert.equal(b.status, 'cancelled');
  assert.equal(b.refund_amount, Math.round((300000 * expected) / 100));
  assert.equal(b.refund_status, expected ? 'pending' : 'none');
  await book(4, ids.autoCourt, '07:00'); // slot trống lại
});

test('khách khác và chủ sân khác không truy cập được booking', async (t) => {
  if (!dbReady) return t.skip();
  const { id } = await book(5, ids.autoCourt, '09:00');
  await assert.rejects(bookings.getDetail(customer(6), id), { status: 404 });
  await assert.rejects(bookings.cancelByCustomer(customer(6), id), { status: 404 });
  await assert.rejects(bookings.markPaid({ id: 999999, role: 'owner' }, id), { status: 404 });
});

test('chủ sân hủy bắt buộc có lý do và hoàn 100%', async (t) => {
  if (!dbReady) return t.skip();
  const { id } = await book(7, ids.autoCourt, '15:00');
  await bookings.markPaid(owner(), id);
  await assert.rejects(bookings.cancelByStaff(owner(), id, ''), { status: 400 });
  await bookings.cancelByStaff(owner(), id, 'Sân hỏng đèn');
  const [[b]] = await pool.query('SELECT refund_percent, refund_amount FROM bookings WHERE id = ?', [id]);
  assert.equal(b.refund_percent, 100);
  assert.equal(b.refund_amount, 300000);
});
