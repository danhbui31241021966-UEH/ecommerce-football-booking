const config = require('./config');
const { createApp } = require('./app');
const { pool } = require('./db');

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`SânNhanh chạy tại http://localhost:${config.port}`);
});

// Tắt gọn khi nhận SIGINT/SIGTERM để không bỏ lại kết nối MySQL.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      app.shutdown();
      pool.end().finally(() => process.exit(0));
    });
  });
}
