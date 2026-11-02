// Hàm thuần về lưới giờ của một cụm sân (không đụng DB). venue/court là hàng đã qua venueStore.normalizeVenue.
const { hmToMin, minToHm } = require('../lib/time');

/** Giờ bắt đầu của mọi ô trong ngày: ['06:00', '07:00', ...]; ô cuối phải kết thúc trước hoặc đúng giờ đóng cửa. */
function slotGrid(venue) {
  const out = [];
  const step = venue.slotMinutes;
  if (!step || step <= 0) return out;
  for (let m = hmToMin(venue.openTime); m + step <= hmToMin(venue.closeTime); m += step) out.push(minToHm(m));
  return out;
}

const slotEnd = (venue, start) => minToHm(hmToMin(start) + venue.slotMinutes);
const isPeak = (venue, start) => !!venue.peakStart && start >= venue.peakStart && start < venue.peakEnd;
const basePriceOf = (venue, court, start) => (isPeak(venue, start) ? court.peakPrice : court.price);

/** R13: giờ thuộc chế độ chỉ nhận ghép kèo (cả ngày nếu không có khung, hoặc trong khung from–to). */
const teamModeAt = (court, start) =>
  !!court.teamModeEnabled && (!court.teamModeFrom || start >= court.teamModeFrom) && (!court.teamModeTo || start < court.teamModeTo);

module.exports = { slotGrid, slotEnd, isPeak, basePriceOf, teamModeAt };
