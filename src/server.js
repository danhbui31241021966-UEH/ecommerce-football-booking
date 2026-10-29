const config = require('./config');
const { createApp } = require('./app');
const { expireStale } = require('./services/bookings');

const app = createApp();

app.listen(config.port, config.host, () => {
  console.log(`Football booking chạy tại http://localhost:${config.port}`);
});

// Quét booking chờ duyệt quá hạn mỗi 15 giây để giải phóng slot.
setInterval(() => {
  expireStale().catch((err) => console.error('expireStale lỗi:', err.message));
}, 15_000);
