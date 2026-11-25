// Khởi động service mail: node src/mail/server.js. Cấu hình sai thì thoát, không chạy nửa vời.
const http = require('http');
const { loadConfig } = require('./config');
const { createTransport } = require('./transport');
const { createApp } = require('./app');

let config;
try { config = loadConfig(process.env); } catch (e) { console.error(`mail: cấu hình không hợp lệ: ${e.message}`); process.exit(1); }

// Log chỉ có sự kiện vận hành; không bao giờ ghi nội dung thư, email, token hay secret.
const log = (m) => console.log(`${new Date().toISOString()} mail ${m}`);
const server = http.createServer(createApp({ config, transport: createTransport(config), log }));
server.requestTimeout = 20000; server.headersTimeout = 10000;
server.listen(config.port, config.host, () => log(`listening ${config.host}:${config.port} transport=${config.transport} trustProxy=${config.trustProxy}`));
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => server.close(() => process.exit(0)));
