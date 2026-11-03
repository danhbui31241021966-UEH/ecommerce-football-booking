const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./config');
const { pool } = require('./db');
const { loadUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { errorHandler, apiNotFound } = require('./middleware/error');
const { sweepDue } = require('./middleware/sweep');
const { proxyGate } = require('./middleware/proxy');

/**
 * @param {{ production?: boolean }} [opts] production mặc định theo NODE_ENV; chỉ test truyền vào để dựng cả hai chế độ.
 * Ở production KHÔNG gắn router dev (không phải gắn rồi chặn): /api/dev/* khi đó là 404 như mọi đường dẫn lạ.
 */
function createApp({ production = config.isProduction, proxySecret = null } = {}) {
  const app = express();
  if (production) {
    app.set('trust proxy', 1);
    app.disable('x-powered-by'); // cổng proxy 404 chạy trước helmet: đừng lộ "Express" cho người gõ thẳng vào link tunnel
  }
  // Cổng proxy bật ở tiến trình production thật (config.isProduction: thiếu PROXY_SECRET thì chặn hết) hoặc khi test truyền proxySecret.
  if (production && (config.isProduction || proxySecret)) app.use(proxyGate(() => proxySecret || config.proxySecret));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'img-src': ["'self'", 'data:', 'https:'] },
      },
    }),
  );
  app.use(express.json({ limit: '50kb' }));
  // Construct the API router before creating MySQLStore: a synchronous route-module load error must not leak
  // the store's expiry timer and keep startup/test processes alive.
  const api = express.Router();
  api.use('/webhooks', require('./routes/webhooks')); // máy chủ gọi máy chủ: không phiên, không CSRF, tự xác thực bằng khóa API
  api.use(loadUser);
  api.use(csrfProtection);
  api.use(sweepDue);
  api.use(require('./middleware/transfer-sweep'));
  api.use('/meta', require('./routes/meta'));
  api.use('/auth', require('./routes/auth').router);
  api.use('/venues', require('./routes/venues'));
  api.use('/bookings', require('./routes/bookings'));
  api.use('/waitlist', require('./routes/waitlist'));
  api.use('/notifications', require('./routes/notifications'));
  api.use('/owner/bookings', require('./routes/owner-bookings'));
  api.use('/admin/bookings', require('./routes/admin-bookings'));
  api.use('/owner', require('./routes/owner-venues'));
  api.use('/owner', require('./routes/owner-blocks'));
  api.use('/admin', require('./routes/admin'));
  api.use('/matches', require('./routes/matches'));
  api.use('/owner/matches', require('./routes/owner-matches'));
  api.use(require('./routes/transfers'));
  api.use('/requests', require('./routes/requests'));
  api.use('/owner', require('./routes/owner-requests'));
  api.use('/leagues', require('./routes/leagues'));
  api.use('/owner/leagues', require('./routes/owner-leagues'));
  api.use('/owner', require('./routes/owner-bank'));
  if (!production) api.use('/dev', require('./routes/dev'));
  api.use(apiNotFound);

  const store = new MySQLStore({ createDatabaseTable: false }, pool);
  app.use(
    session({
      name: 'fb.sid',
      secret: config.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: production,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use('/api', api);

  // FE do Express phục vụ thì chạy chế độ thật; bản tĩnh (Cloudflare, prototype 4100) dùng public/js/mode.js gốc = mock.
  const devTools = !production;
  app.get('/js/mode.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-store');
    res.send(`export const SERVED_BY_API = true;\nexport const DEV_TOOLS = ${devTools};\n`);
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.use(errorHandler);

  // Đóng store (hẹn giờ dọn session) khi tắt server hoặc kết thúc test. Chờ store khởi tạo xong, nếu không hẹn giờ
  // được đặt sau lúc đóng và giữ tiến trình sống mãi.
  app.shutdown = async () => {
    await store.onReady();
    await store.close();
  };
  return app;
}

module.exports = { createApp };
