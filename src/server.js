const config = require('./config');
const { createApp } = require('./app');
const { pool } = require('./db');
const { sweep } = require('./services/bookingOps');

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`SânNhanh chạy tại http://localhost:${config.port}`);
});

// Hết hạn giữ chỗ / lượt giữ quyền đặt cũng được quét định kỳ (mỗi request còn tự quét), để thông báo không chờ tới khi có người gọi API.
const sweeper = setInterval(() => sweep().catch((e) => console.error('Quét hết hạn lỗi:', e.message)), 30000);
sweeper.unref();

// Tắt gọn khi nhận SIGINT/SIGTERM để không bỏ lại kết nối MySQL.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(sweeper);
    server.close(() => {
      app.shutdown();
      pool.end().finally(() => process.exit(0));
    });
  });
}
