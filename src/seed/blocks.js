const { readMock } = require('./core');
const clock = require('../clock');
const { addDays } = require('../lib/time');
const { loadVenue } = require('../services/venueStore');
const { claimBlockSlots } = require('../services/slotClaims');

async function seedBlocks(tx) {
  const items = readMock('bookings').blocks;
  for (const item of items) {
    const court = await tx.one('SELECT venue_id FROM courts WHERE id = ?', [item.courtId]);
    if (!court) continue;

    const venue = await loadVenue(court.venueId, { activeOnly: false, conn: tx });
    const date = addDays(clock.today(), item.day);
    const startAt = `${date} ${item.start}:00`;
    const endAt = `${date} ${item.end}:00`;
    const result = await tx.query(
      `INSERT INTO blocks (court_id, start_at, end_at, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [item.courtId, startAt, endAt, item.reason, venue.ownerId, clock.now()],
    );
    await claimBlockSlots(tx, {
      blockId: result.insertId,
      courtId: item.courtId,
      venue,
      startAt,
      endAt,
    });
  }
  return { blocks: items.length };
}

module.exports = { seedBlocks };
