const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');

const { normalizeToUtf8AndValidateVtt } = require('../utils/subtitle');


function dirKeyForField(fieldname) {
  if (fieldname === 'movie') return 'movies';
  if (fieldname === 'subtitle') return 'subtitles';
  if (fieldname === 'heroBanner') return 'heroBanners';
  return 'thumbnails';
}

function createUpload(config) {
  const effectiveDirs = config.dirs;

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dirKey = dirKeyForField(file.fieldname);
      const dest = path.resolve(effectiveDirs[dirKey]);
      // TEMP deterministic proof: upload destination resolved inside container.
      logger.info('[MEDIA DEBUG] uploadDestination', {
        fieldname: file.fieldname,
        originalname: file.originalname,
        dest,
        existsSync: fsSync.existsSync(dest),
        effectiveDirs,
      });
      cb(null, dest);
    },

    filename: (req, file, cb) => {
      const clean = String(file.originalname || 'upload').replace(/[^a-z0-9.-]/gi, '');
      // Force filename to a safe, portable basename (no path separators leaking into DB).
      // This prevents /thumbnail/<filename> 404 when DB rows contain Windows-style path fragments.
      const finalName = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${clean}`;
      logger.info('[MEDIA DEBUG] uploadFilename', {
        fieldname: file.fieldname,
        originalname: file.originalname,
        finalName,
      });
      cb(null, finalName);
    },

  });

  return multer({
    storage,
    limits: {
      fileSize: config.uploadFileSize,
      files: config.uploadMaxFiles,
    },
    fileFilter: (req, file, cb) => {
      const allowedMimes = new Set(['video/mp4', 'video/mkv', 'video/x-matroska', 'image/jpeg', 'image/png', 'text/vtt']);
      const banned = /\.(exe|bat|sh|php|jsp|dll|com|scr)$/i;
      if (banned.test(file.originalname || '')) return cb(new Error('Upload rejected'), false);
      if (!allowedMimes.has(file.mimetype)) return cb(new Error('Upload rejected'), false);
      return cb(null, true);
    },
  });
}

function heapSnapshot() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
  };
}

module.exports.heapSnapshot = heapSnapshot;


function flattenUploadedFiles(req) {
  return Object.values(req.files || {}).flat();
}

async function cleanupUploadedFiles(files, dirs) {
  await Promise.allSettled(
    (files || []).map((file) => {
      const dirKey = dirKeyForField(file.fieldname);
      return fs.unlink(path.join(dirs[dirKey], file.filename));
    })
  );
}

async function validateUpload(req, dirs) {
  const uploadedFiles = flattenUploadedFiles(req);
  if (!req.files?.movie?.[0]) {
    await cleanupUploadedFiles(uploadedFiles, dirs);
    const err = new Error('Request failed');
    err.statusCode = 400;
    throw err;
  }

  for (const file of uploadedFiles) {
    const dirKey = dirKeyForField(file.fieldname);
    try {
      const stat = await fs.stat(path.join(dirs[dirKey], file.filename));
      if (!stat.isFile()) throw new Error('not file');
    } catch {
      await cleanupUploadedFiles(uploadedFiles, dirs);
      const err = new Error('Request failed');
      err.statusCode = 400;
      throw err;
    }
  }

  const movieFile = req.files.movie[0];
  if (!movieFile.size || movieFile.size < 1024) {
    await cleanupUploadedFiles(uploadedFiles, dirs);
    const err = new Error('Request failed');
    err.statusCode = 400;
    throw err;
  }

  if (req.files?.subtitle?.[0]) {
    try {
      await normalizeToUtf8AndValidateVtt(path.join(dirs.subtitles, req.files.subtitle[0].filename));
    } catch (err) {
      await cleanupUploadedFiles(uploadedFiles, dirs);
      throw err;
    }
  }

  return uploadedFiles;
}

module.exports = {
  cleanupUploadedFiles,
  createUpload,
  flattenUploadedFiles,
  validateUpload,
};
