// Chiếm ô giờ cho CHẶN GIỜ (blocks). Lịch đặt không dùng file này: trigger trong db/schema.sql tự chiếm/nhả ô theo status.
// Mỗi ô giờ của sân con chỉ có một chủ nhờ PRIMARY KEY (court_id, start_at) của slot_claims; chèn trùng ném ER_DUP_ENTRY.
const { isDuplicate } = require('../db');
const { conflict } = require('../utils/errors');
const { vnToMs, msToVn, addDays } = require('../lib/time');
const { slotGrid } = require('./slotGrid');

/** Các mốc bắt đầu ('YYYY-MM-DD HH:mm:ss') của mọi ô của lưới venue phủ lên khoảng [startAt, endAt). */
function slotStartsCovering(venue, startAt, endAt) {
  const out = [];
  const from = vnToMs(startAt);
  const to = vnToMs(endAt);
  const stepMs = venue.slotMinutes * 60000;
  const lastDay = msToVn(to).slice(0, 10);
  for (let date = msToVn(from).slice(0, 10); date <= lastDay; date = addDays(date, 1)) {
    for (const hmStart of slotGrid(venue)) {
      const s = vnToMs(`${date} ${hmStart}`);
      if (s < to && s + stepMs > from) out.push(msToVn(s));
    }
  }
  return out;
}

/** Chiếm các ô của một block đã chèn. Có ô đã có chủ thì ném 409 (caller đang trong transaction nên mọi thứ được hoàn tác). */
async function claimBlockSlots(tx, { blockId, courtId, venue, startAt, endAt }) {
  const starts = slotStartsCovering(venue, startAt, endAt);
  if (!starts.length) throw conflict('Khoảng giờ này không trùng ô giờ nào của sân');
  try {
    for (const s of starts) {
      await tx.query("INSERT INTO slot_claims (court_id, start_at, kind, block_id) VALUES (?, ?, 'block', ?)", [courtId, s, blockId]);
    }
  } catch (err) {
    if (isDuplicate(err)) throw conflict('Có giờ trong khoảng này đã có lịch đặt hoặc đã bị chặn');
    throw err;
  }
  return starts;
}

module.exports = { slotStartsCovering, claimBlockSlots };
