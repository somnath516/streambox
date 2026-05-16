const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { sendError } = require('../middleware/errorContract');
const asyncHandler = require('../utils/asyncHandler');
const { cleanupUploadedFiles, flattenUploadedFiles, validateUpload } = require('../services/upload.service');

function createUploadRouter({ db, upload, config }) {
  const router = express.Router();
  const uploadLimiter = rateLimit({
    windowMs: Number(process.env.UPLOAD_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.UPLOAD_RATE_LIMIT || 10),
    message: { error: 'Request failed' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.options('/', auth, (req, res) => res.status(204).end());
  router.head('/', auth, (req, res) => res.status(204).end());

  router.post(
    '/',
    auth,
    uploadLimiter,
    // Wrap multer to add deterministic upload metrics + failure classification.
    (req, res, next) => {
      const reqStart = Date.now();
      const startMem = { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, external: process.memoryUsage().external };
      let bytesReceived = 0;
      let uploadStart = null;
      let uploadEnd = null;
      let aborted = false;
      let closed = false;
      let errored = false;

      const logHeap = () => {
        const m = process.memoryUsage();
        logger.info('[UPLOAD DEBUG] heapSnapshot', {
          rss: m.rss,
          heapUsed: m.heapUsed,
          external: m.external,
        });
      };

      const interval = setInterval(logHeap, Number(process.env.UPLOAD_HEAP_SNAPSHOT_MS || 5000));
      const teardown = () => clearInterval(interval);

      req.on('aborted', () => { aborted = true; });
      req.on('close', () => { closed = true; });
      req.on('error', () => { errored = true; });
      res.on('finish', () => {});

      // Bytes received: reliable for slow/proxy clients via request stream length.
      req.on('data', (chunk) => {
        bytesReceived += chunk?.length || 0;
      });

      res.once('finish', () => {
        const end = Date.now();
        teardown();
        logger.info('[UPLOAD COMPLETE]', {
          requestId: req.id,
          aborted,
          closed,
          errored,
          reqDurationMs: end - reqStart,
          uploadStartTs: uploadStart,
          uploadEndTs: uploadEnd,
          uploadDurationMs: uploadStart && uploadEnd ? uploadEnd - uploadStart : null,
          bytesReceived,
          mbPerSec: uploadDurationMsFrom(bytesReceived, uploadStart, uploadEnd),
          responseStatus: res.statusCode,
          memStart: startMem,
          memEnd: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, external: process.memoryUsage().external },
        });
      });

      function uploadDurationMsFrom(bytes, s, e) {
        if (!s || !e) return null;
        const dur = e - s;
        if (dur <= 0) return null;
        const mb = bytes / (1024 * 1024);
        return mb / (dur / 1000);
      }

      // Begin multer
      logger.info('[UPLOAD DEBUG] requestStart', {
        requestId: req.id,
        reqStartTs: reqStart,
        headers: {
          'content-length': req.headers['content-length'],
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 200) : undefined,
        },
      });

      upload.fields([
        { name: 'movie', maxCount: 1 },
        { name: 'subtitle', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
        { name: 'heroBanner', maxCount: 1 },
      ])(req, res, (err) => {
        uploadStart = uploadStart || Date.now();
        uploadEnd = Date.now();

        const end = Date.now();
        teardown();

        if (!err) return next();

        // Failure classification
        const code = err.code || err.name;
        let phase = 'upload';
        let error = 'Upload failed';
        const details = {
          requestId: req.id,
          errorName: err.name,
          errorMessage: err.message,
          code,
          aborted,
          closed,
          errored,
          reqDurationMs: end - reqStart,
          bytesReceived,
          memNow: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, external: process.memoryUsage().external },
        };

        if (err.name === 'MulterError') {
          phase = 'multer';
          error = 'Multer error';
          if (err.code === 'LIMIT_FILE_SIZE') error = 'File too large';
          if (err.code === 'LIMIT_FILE_COUNT') error = 'Too many files';
        } else if (code === 'LIMIT_FILE_SIZE') {
          phase = 'multer';
          error = 'File too large';
        } else if (code === 'ECONNRESET') {
          phase = 'connection';
          error = 'Connection reset';
        } else if (code === 'EPIPE') {
          phase = 'connection';
          error = 'Broken pipe';
        } else if (code === 'ENOSPC') {
          phase = 'disk';
          error = 'No space on device';
        } else if (code === 'ETIMEDOUT') {
          phase = 'timeout';
          error = 'Timed out';
        }

        logger.info('[UPLOAD ERROR]', {
          requestId: req.id,
          phase,
          code,
          error,
          details,
        });

        // Structured JSON error required by task
        return res.status(400).json({
          error,
          code,
          phase,
          details: {
            ...details,
            // reduce noise in prod logs/response
            errorMessage: String(err.message || '').slice(0, 500),
          },
        });
      });
    },
    asyncHandler(async (req, res) => {
      const uploadedFiles = flattenUploadedFiles(req);
      try {
        await validateUpload(req, config.dirs);

        const newMovie = {
          title: req.body.title?.trim() || 'Untitled',
          description: req.body.description?.trim() || '',
          movie: req.files.movie[0].filename,
          subtitle: req.files.subtitle?.[0]?.filename || null,
          thumbnail: req.files.thumbnail?.[0]?.filename || null,
          heroBanner: req.files.heroBanner?.[0]?.filename || null,
          category: req.body.category || 'Movie',
        };

        const savedMovie = await db.addMovie(newMovie);
        return res.status(200).json({ success: true, message: 'Upload successful', movie: savedMovie });
      } catch (err) {
        if (err.statusCode === 400) return sendError(res, 400, 'Request failed');
        await cleanupUploadedFiles(uploadedFiles, config.dirs);
        return sendError(res, 500, 'Internal server error');
      }
    })
  );

  return router;
}

module.exports = createUploadRouter;
