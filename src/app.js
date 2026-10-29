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

function createApp() {
  const app = express();
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'img-src': ["'self'", 'data:', 'https:'] },
      },
    }),
  );
  app.use(express.json({ limit: '50kb' }));
  app.use(
    session({
      name: 'fb.sid',
      secret: config.sessionSecret,
      store: new MySQLStore({ createDatabaseTable: true }, pool),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  const api = express.Router();
  api.use(loadUser);
  api.use(csrfProtection);
  api.use('/auth', require('./routes/auth').router);
  api.use('/venues', require('./routes/venues'));
  api.use('/bookings', require('./routes/bookings'));
  api.use('/notifications', require('./routes/notifications'));
  api.use('/owner', require('./routes/owner'));
  api.use('/admin', require('./routes/admin'));
  api.use(apiNotFound);

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
