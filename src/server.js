const config = require('./config');

// Production: dừng ngay (trước khi nạp app/DB) nếu cấu hình còn yếu.
if (config.isProduction) {
  const bad = require('./productionCheck').problems(process.env);
  if (bad.length) {
    console.error(`Không khởi động production vì cấu hình chưa an toàn:\n${bad.map((b) => `  - ${b}`).join('\n')}`);
    process.exit(1);
  }
}

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
