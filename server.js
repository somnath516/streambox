const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs').promises;

const config = require('./services/config.service');
const db = require('./services/db.service');
const { createUpload } = require('./services/upload.service');
const createMoviesRouter = require('./routes/movies.routes');
const createUploadRouter = require('./routes/upload.routes');
const createControlRouter = require('./routes/control.routes');
const createHealthRouter = require('./routes/health.routes');
const createMediaRouter = require('./routes/media.routes');
const auth = require('./middleware/auth');
const moviesPathGuard = require('./middleware/moviesPathGuard');
const requestTiming = require('./middleware/requestTiming');
const requestId = require('./middleware/requestId');
const createSecurityHeaders = require('./middleware/securityHeaders');
const { createErrorContractHandler, sendError } = require('./middleware/errorContract');
const logger = require('./utils/logger');

const app = express();
let server;
let shuttingDown = false;

async function ensureDirs() {
  await Promise.all(Object.values(config.dirs).map((dir) => fs.mkdir(dir, { recursive: true })));
}

function jsonOnlyLimiter() {
  return rateLimit({
    windowMs: Number(process.env.API_RATE_WINDOW_MS || 60 * 1000),
    max: Number(process.env.API_RATE_LIMIT || 100),
    message: { error: 'Request failed' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

function isApiLike(req) {
  const p = req.path || '';
  return [
    '/admin',
    '/api',
    '/control',
    '/health',
    '/movies',
    '/remote-commands',
    '/subtitle',
    '/thumbnail',
    '/thumbnail-card',
    '/upload',
    '/video',
  ].some((prefix) => p === prefix || p.startsWith(prefix + '/'));
}

function staticOptions(maxAge) {
  return {
    etag: true,
    maxAge,
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (/\.(html)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  };
}

function createApp() {
  const startup = ensureDirs().then(() => db.initDb());
  const upload = createUpload(config);
  const apiLimiter = jsonOnlyLimiter();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(createSecurityHeaders());
  app.use(cors());
  app.use(requestTiming);
  app.use((req, res, next) => (isApiLike(req) ? apiLimiter(req, res, next) : next()));
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '50mb' }));
  app.use((req, res, next) => {
    startup.then(() => next()).catch(next);
  });

  // This guard is intentionally before routes, static serving, and any frontend fallback.
  app.use(moviesPathGuard);

  app.options('/admin', auth, (req, res) => res.status(204).end());
  app.head('/admin', auth, (req, res) => res.status(204).end());
  app.get('/admin', auth, (req, res) => res.status(200).json({ ok: true }));

  const moviesRouter = createMoviesRouter({ db, upload });
  const uploadRouter = createUploadRouter({ db, upload, config });
  const healthRouter = createHealthRouter({ db });
  const mediaRouter = createMediaRouter({ config });

  app.use('/movies', moviesRouter);
  app.use('/upload', uploadRouter);
  app.use('/health', healthRouter);
  app.use(createControlRouter());
  app.use(mediaRouter);

  const apiRouter = express.Router();
  apiRouter.get('/admin', auth, (req, res) => res.status(200).json({ ok: true }));
  apiRouter.use('/movies', moviesRouter);
  apiRouter.use('/upload', uploadRouter);
  apiRouter.use('/health', healthRouter);
  apiRouter.use((req, res) => sendError(res, 404, 'Not found'));
  app.use('/api', apiRouter);

  // Static/public serving remains after API and media routes.
  app.use(express.static(config.dirs.public, staticOptions('1d')));
  app.use('/logos', express.static(config.dirs.logos, staticOptions('30d')));
  app.use('/uploads', express.static(config.dirs.uploads, staticOptions('1d')));

  app.use((req, res) => sendError(res, 404, 'Not found'));

  app.use(createErrorContractHandler());
  return app;
}

async function gracefulShutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn('shutdown_started', { reason });

  const closeServer = server
    ? new Promise((resolve) => server.close(() => resolve()))
    : Promise.resolve();

  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.race([closeServer, timeout]);
  await db.closeDb().catch((err) => logger.error('db_close_failed', { message: err.message }));
  logger.warn('shutdown_complete', { reason });
}

const ready = Promise.resolve(createApp());

if (require.main === module) {
  ready
    .then(() => {
      server = app.listen(config.port, '0.0.0.0', () => {
        logger.info('server_ready', { url: `http://localhost:${config.port}` });
      });
    })
    .catch((err) => {
      logger.error('startup_failed', { message: err.message });
      process.exit(1);
    });

  process.on('SIGINT', async () => {
    await gracefulShutdown('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await gracefulShutdown('SIGTERM');
    process.exit(0);
  });
  process.on('uncaughtException', async (err) => {
    logger.error('uncaught_exception', { message: err.message });
    await gracefulShutdown('uncaughtException');
    process.exit(1);
  });
  process.on('unhandledRejection', async (reason) => {
    const message = reason && reason.message ? reason.message : String(reason);
    logger.error('unhandled_rejection', { message });
    await gracefulShutdown('unhandledRejection');
    process.exit(1);
  });
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.ready = ready;
