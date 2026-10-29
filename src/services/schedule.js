const { pool } = require('../db');
const config = require('../config');
const { badRequest, notFound } = require('../utils/errors');
const slots = require('./slots');

async function getPublicVenue(venueId) {
  const [rows] = await pool.query(
    `SELECT v.* FROM venues v JOIN users o ON o.id = v.owner_id
     WHERE v.id = ? AND v.is_active = 1 AND o.is_active = 1`,
    [venueId],
  );
  if (!rows.length) throw notFound('Không tìm thấy sân hoặc sân đang tạm ngưng');
  return rows[0];
}

// Ngày được phép xem/đặt: từ hôm nay đến hôm nay + BOOKING_WINDOW_DAYS.
function assertBookableDate(date) {
  const today = slots.toDateStr(new Date());
  const last = slots.addDays(today, config.bookingWindowDays);
  if (date < today) throw badRequest('Không thể chọn ngày trong quá khứ');
  if (date > last) throw badRequest(`Chỉ được đặt trước tối đa ${config.bookingWindowDays} ngày`);
}

// Booking đang giữ slot: đã xác nhận, hoặc chờ xác nhận và chưa quá hạn giữ chỗ.
const HOLDING_SQL = `b.slot_lock = 1 AND (b.status = 'confirmed' OR b.expires_at > NOW())`;

/**
 * Lịch trong ngày của một cụm sân: mỗi sân con x mỗi slot kèm trạng thái
 * available | held | booked | blocked | past.
 * withDetails=true (chủ sân/admin) trả thêm thông tin booking và lý do chặn.
 */
async function getDaySchedule(venue, date, { withDetails = false } = {}) {
  const dayStart = `${date} 00:00:00`;
  const dayEnd = `${slots.addDays(date, 1)} 00:00:00`;

  const [courts] = await pool.query(
    'SELECT * FROM courts WHERE venue_id = ? AND is_active = 1 ORDER BY name',
    [venue.id],
  );
  const [bookings] = await pool.query(
    `SELECT b.id, b.code, b.court_id, b.start_at, b.end_at, b.status, b.expires_at, b.payment_status,
            u.full_name AS customer_name, u.phone AS customer_phone
     FROM bookings b JOIN users u ON u.id = b.customer_id
     WHERE b.venue_id = ? AND b.start_at < ? AND b.end_at > ? AND ${HOLDING_SQL}`,
    [venue.id, dayEnd, dayStart],
  );
  const [blocks] = courts.length
    ? await pool.query(
        `SELECT id, court_id, start_at, end_at, reason FROM slot_blocks
         WHERE court_id IN (?) AND start_at < ? AND end_at > ?`,
        [courts.map((c) => c.id), dayEnd, dayStart],
      )
    : [[]];

  const now = slots.toSqlDateTime(new Date());
  const daySlots = slots.generateSlots(venue);

  return {
    date,
    slotMinutes: venue.slot_minutes,
    courts: courts.map((court) => ({
      id: court.id,
      name: court.name,
      fieldType: court.field_type,
      slots: daySlots.map((s) => {
        const startAt = `${date} ${s.start}:00`;
        const endAt = `${date} ${s.end}:00`;
        const overlaps = (x) => x.court_id === court.id && x.start_at < endAt && x.end_at > startAt;
        const booking = bookings.find(overlaps);
        const block = blocks.find(overlaps);

        let status = 'available';
        if (booking) status = booking.status === 'confirmed' ? 'booked' : 'held';
        else if (block) status = 'blocked';
        else if (startAt <= now) status = 'past';

        const cell = {
          start: s.start,
          end: s.end,
          price: slots.slotPrice(venue, court, s.start),
          peak: slots.isPeak(venue, s.start),
          status,
        };
        if (withDetails && booking) {
          cell.booking = {
            id: booking.id,
            code: booking.code,
            status: booking.status,
            paymentStatus: booking.payment_status,
            customerName: booking.customer_name,
            customerPhone: booking.customer_phone,
          };
        }
        if (withDetails && block) cell.block = { id: block.id, reason: block.reason };
        return cell;
      }),
    })),
  };
}

module.exports = { getPublicVenue, getDaySchedule, assertBookableDate, HOLDING_SQL };
