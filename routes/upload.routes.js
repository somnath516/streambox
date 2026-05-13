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
    upload.fields([
      { name: 'movie', maxCount: 1 },
      { name: 'subtitle', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
      { name: 'heroBanner', maxCount: 1 },
    ]),
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
