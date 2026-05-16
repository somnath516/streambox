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

function logBootSummary() {
  logger.info('[BOOT]', {
    pid: process.pid,
    node_version: process.version,
    platform: process.platform,
    port: config.port,
    cwd: process.cwd(),
  });
}

if (require.main === module) {
  // Required: deterministic boot logs at process start.
  logger.info('[BOOT] process_start', {
    pid: process.pid,
    node_version: process.version,
    platform: process.platform,
    port: config.port,
    cwd: process.cwd(),
    module_main: require.main && require.main.filename ? require.main.filename : undefined,
  });
  logBootSummary();

  process.on('uncaughtException', async (err) => {
    logger.error('[UNCAUGHT] uncaughtException', { message: err && err.message ? err.message : String(err), stack: err && err.stack });
    await gracefulShutdown('uncaughtException');
    // Never silently exit.
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    const message = reason && reason.message ? reason.message : String(reason);
    logger.error('[UNHANDLED REJECTION] unhandledRejection', { message, stack: reason && reason.stack });
    await gracefulShutdown('unhandledRejection');
    process.exit(1);
  });

  ready
    .then(async () => {
      // DB init should already be triggered inside createApp(), but we wrap it deterministically
      // to catch and classify failures.
      logger.info('[DB INIT START]', { port: config.port });
      try {
        // createApp schedules db.initDb via `startup`; if it already completed, this is still safe.
        // We call db.initDb() explicitly again to guarantee visibility in logs if it previously failed.
        await db.initDb();
        logger.info('[DB INIT SUCCESS]', { port: config.port });
      } catch (err) {
        logger.error('[DB INIT FAILURE]', { message: err && err.message ? err.message : String(err), stack: err && err.stack });
        throw err;
      }

      logger.info('[SERVER START]', { host: '0.0.0.0', port: config.port });
      try {
        server = app.listen(config.port, '0.0.0.0');

        // Required: server error instrumentation.
        server.on('error', (err) => {
          const code = err && err.code ? err.code : undefined;
          let classification = 'SERVER_ERROR';
          if (code === 'EADDRINUSE') classification = 'EADDRINUSE';
          else if (code === 'EACCES') classification = 'EACCES';
          else if (code === 'ENOENT') classification = 'ENOENT';

          logger.error('[SERVER ERROR]', {
            classification,
            code,
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack,
            port: config.port,
          });
        });

        server.on('listening', () => {
          const addr = server.address && server.address();
          logger.info('[SERVER LISTENING VERIFIED]', {
            host: '0.0.0.0',
            port: config.port,
            address: addr,
            url: `http://0.0.0.0:${config.port}`,
            local_url: `http://127.0.0.1:${config.port}`,
          });
        });

        // Keep existing semantics/loggers (do not remove current logger line).
        logger.info('server_ready', { url: `http://localhost:${config.port}` });
      } catch (err) {
        // Required: wrap app.listen in try/catch to avoid silent failures.
        logger.error('[SERVER START FAILURE]', { message: err && err.message ? err.message : String(err), stack: err && err.stack });
        throw err;
      }
    })
    .catch((err) => {
      logger.error('[BOOT FAILURE] startup_failed', { message: err && err.message ? err.message : String(err), stack: err && err.stack });
      // Never silently exit.
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
}


module.exports = app;
module.exports.createApp = createApp;
module.exports.ready = ready;
