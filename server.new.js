// StreamBox (deterministic routing refactor) — server.new.js
// NOTE: This file is not yet wired in; it is a safe staging target.

const express = require("express");
const multer = require("multer");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Minimal trace for Phase 6: only admin/upload-related requests
app.use((req, res, next) => {
  const u = req.url || "";
  if (u.includes("upload") || u.includes("admin")) {
    console.log("🔍 TRACE:", req.method, u);
  }
  next();
});

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

app.use(
  helmet({
    // Disable CSP during tests to avoid interfering with supertest request body parsing
    contentSecurityPolicy: false,
  })
);

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: "Rate limited",
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply limiter only to API/control routes.
app.use((req, res, next) => {
  const p = req.path || "";
  if (
    p.startsWith("/movies") ||
    p.startsWith("/video") ||
    p.startsWith("/subtitle") ||
    p.startsWith("/control") ||
    p.startsWith("/remote-commands") ||
    p === "/upload" ||
    p.startsWith("/health") ||
    p.startsWith("/api")
  ) {
    return globalLimiter(req, res, next);
  }
  return next();
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const auth = require("./middleware/auth");

const SD_BASE = process.env.SD_BASE || "E:\\StreamBox Database";
const DIRS = {
  movies: path.resolve(SD_BASE, "movies"),
  subtitles: path.resolve(SD_BASE, "subtitles"),
  thumbnails: path.resolve(SD_BASE, "thumbnails"),
  heroBanners: path.resolve("E:\\StreamBox Database\\hero banner"),
  data: path.join(__dirname, "data"),
  cardBase: process.env.MEDIA_PATH || SD_BASE,
};

// Init dirs
Object.values(DIRS).forEach(async (dir) => {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
});

console.log("DIRS.movies", DIRS.movies);
console.log("DIRS.thumbnails", DIRS.thumbnails);
console.log("DIRS.subtitles", DIRS.subtitles);

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "movie") cb(null, DIRS.movies);
    else if (file.fieldname === "subtitle") cb(null, DIRS.subtitles);
    else if (file.fieldname === "heroBanner") cb(null, DIRS.heroBanners);
    else cb(null, DIRS.thumbnails);
  },
  filename: (req, file, cb) => {
    const name = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname.replace(
      /[^a-z0-9.-]/gi,
      ""
    )}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 4,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = new Set([
      "video/mp4",
      "video/mkv",
      "image/jpeg",
      "image/png",
      "text/vtt",
    ]);

    const banned = /\.(exe|bat|sh|php|jsp|dll|com|scr)$/i;
    if (banned.test(file.originalname)) return cb(new Error("Upload rejected"), false);
    if (!allowedMimes.has(file.mimetype)) return cb(new Error("Upload rejected"), false);
    cb(null, true);
  },
});

const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// DB
const db = require("./db.js");
const {
  getMovies: readDB,
  addMovie: addMovieDB,
  getMovieById,
  deleteMovie: deleteMovieDB,
  updateMovie: updateMovieDB,
} = db;

function sendError(res, code, message) {
  return res.status(code).json({ error: message });
}

function isValidNumericId(id) {
  return /^\d+$/.test(String(id));
}

// ===== API boundary (deterministic): everything below /api is never allowed to fall through to static HTML =====
const apiRouter = express.Router();

// Auth gates for method edges
apiRouter.options("/admin", auth, (req, res) => res.status(204).end());
apiRouter.head("/admin", auth, (req, res) => res.status(204).end());
apiRouter.options("/upload", auth, (req, res) => res.status(204).end());
apiRouter.head("/upload", auth, (req, res) => res.status(204).end());
apiRouter.options("/movies/:id", auth, (req, res) => res.status(204).end());
apiRouter.head("/movies/:id", auth, (req, res) => res.status(204).end());

apiRouter.get("/admin", auth, async (req, res) => res.status(200).json({ ok: true }));

// Strict numeric validation for any /api/movies/:id
apiRouter.use("/movies/:id", (req, res, next) => {
  const { id } = req.params;
  if (!isValidNumericId(id)) return sendError(res, 400, "Request failed");
  next();
});

apiRouter.get("/movies/:id", async (req, res) => {
  const movie = await getMovieById(req.params.id);
  if (!movie) return sendError(res, 404, "Not found");
  return res.json(movie);
});

apiRouter.delete("/movies/:id", auth, async (req, res) => {
  try {
    const result = await deleteMovieDB(req.params.id);
    if (result.changes === 0) return sendError(res, 404, "Not found");
    return res.json({ success: true });
  } catch {
    return sendError(res, 500, "Internal server error");
  }
});

apiRouter.patch(
  "/movies/:id",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "heroBanner", maxCount: 1 },
    { name: "subtitle", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const id = req.params.id;
      const updates = {};
      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.category !== undefined) updates.category = req.body.category;

      if (req.files) {
        if (req.files.thumbnail?.[0]?.filename) updates.thumbnail = req.files.thumbnail[0].filename;
        if (req.files.heroBanner?.[0]?.filename) updates.heroBanner = req.files.heroBanner[0].filename;
        if (req.files.subtitle?.[0]?.filename) updates.subtitle = req.files.subtitle[0].filename;
      }

      if (req.body.thumbnail !== undefined) updates.thumbnail = req.body.thumbnail;
      if (req.body.heroBanner !== undefined) updates.heroBanner = req.body.heroBanner;
      if (req.body.subtitle !== undefined) updates.subtitle = req.body.subtitle;

      if (Object.keys(updates).length === 0) return res.json({ success: true, changes: 0 });

      const result = await updateMovieDB(id, updates);
      return res.json({ success: true, result, updated: updates });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  }
);

apiRouter.get("/movies", async (req, res) => {
  try {
    const movies = await readDB();
    return res.json(movies);
  } catch {
    return sendError(res, 500, "Load failed");
  }
});

// /upload (auth required)
apiRouter.post(
  "/upload",
  auth,
  uploadLimiter,
  upload.fields([
    { name: "movie", maxCount: 1 },
    { name: "subtitle", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
    { name: "heroBanner", maxCount: 1 },
  ]),
  async (req, res) => {
    const sendUploadError = (code, msg) => sendError(res, code, msg);

    let uploadedFiles = [];
    const cleanupUploadedFiles = async () => {
      if (!uploadedFiles?.length) return;
      for (const file of uploadedFiles) {
        const dirKey =
          file.fieldname === "movie"
            ? "movies"
            : file.fieldname === "subtitle"
              ? "subtitles"
              : file.fieldname === "heroBanner"
                ? "heroBanners"
                : "thumbnails";
        try {
          await fs.unlink(path.join(DIRS[dirKey], file.filename));
        } catch {}
      }
    };

    try {
      if (!req.files?.movie?.[0]) return sendUploadError(400, "Request failed");

      uploadedFiles = Object.values(req.files || {}).flat();

      const movieFile = req.files.movie[0];
      if (!movieFile?.size || movieFile.size < 1024) return sendUploadError(400, "Request failed");

      const newMovie = {
        title: req.body.title?.trim() || "Untitled",
        description: req.body.description?.trim() || "",
        movie: req.files.movie[0].filename,
        subtitle: req.files.subtitle?.[0]?.filename || null,
        thumbnail: req.files.thumbnail?.[0]?.filename || null,
        heroBanner: req.files.heroBanner?.[0]?.filename || null,
        category: req.body.category || "Movie",
      };

      const savedMovie = await addMovieDB(newMovie);
      return res.status(200).json({ success: true, message: "Upload successful", movie: savedMovie });
    } catch {
      try {
        await cleanupUploadedFiles();
      } catch {}
      return sendUploadError(500, "Internal server error");
    }
  }
);

// API-only 404
apiRouter.use((req, res) => sendError(res, 404, "Not found"));

// API error handler
apiRouter.use((err, req, res, next) => {
  if (err instanceof SyntaxError) return sendError(res, 400, "Request failed");
  const msg = typeof err?.message === "string" ? err.message : "";
  if (err?.name === "MulterError" || msg === "Upload rejected") return sendError(res, 400, "Request failed");
  return sendError(res, 500, "Internal server error");
});

// Mount API boundary
app.use("/api", apiRouter);

// ===== Legacy Phase-6 compatibility (deterministic handlers, no proxy) =====
// Hard guard: any /movies/<segment> that is not purely numeric MUST terminate with JSON 400
// Also applies to any URL-encoded path segment that Express might decode differently.
app.use((req, res, next) => {
  const p = req.path || "";
  if (!p.startsWith("/movies/")) return next();
  const seg = p.slice("/movies/".length);
  if (seg && !/^\d+$/.test(seg)) {
    return sendError(res, 400, "Request failed");
  }
  return next();
});

// If malformed /movies/... contains extra path separators after decoding, ensure it never hits static.
app.get("/movies/:id", (req, res, next) => {
  if (!isValidNumericId(req.params.id)) return sendError(res, 400, "Request failed");
  return next();
});


// Keep /movies/:id implementations single-source (call through apiRouter stack by duplication-free helpers)
const getMovieHandler = async (req, res) => {
  const movie = await getMovieById(req.params.id);
  if (!movie) return sendError(res, 404, 'Not found');
  return res.json(movie);
};

const deleteMovieHandler = async (req, res) => {
  try {
    const result = await deleteMovieDB(req.params.id);
    if (result.changes === 0) return sendError(res, 404, 'Not found');
    return res.json({ success: true });
  } catch {
    return sendError(res, 500, 'Internal server error');
  }
};

const patchMovieHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.category !== undefined) updates.category = req.body.category;

    if (req.files) {
      if (req.files.thumbnail?.[0]?.filename) updates.thumbnail = req.files.thumbnail[0].filename;
      if (req.files.heroBanner?.[0]?.filename) updates.heroBanner = req.files.heroBanner[0].filename;
      if (req.files.subtitle?.[0]?.filename) updates.subtitle = req.files.subtitle[0].filename;
    }

    if (req.body.thumbnail !== undefined) updates.thumbnail = req.body.thumbnail;
    if (req.body.heroBanner !== undefined) updates.heroBanner = req.body.heroBanner;
    if (req.body.subtitle !== undefined) updates.subtitle = req.body.subtitle;

    if (Object.keys(updates).length === 0) return res.json({ success: true, changes: 0 });

    const result = await updateMovieDB(id, updates);
    return res.json({ success: true, result, updated: updates });
  } catch {
    return sendError(res, 500, 'Internal server error');
  }
};

app.get('/movies/:id', async (req, res) => {
  if (!isValidNumericId(req.params.id)) return sendError(res, 400, 'Request failed');
  return getMovieHandler(req, res);
});

app.delete('/movies/:id', auth, deleteMovieHandler);

app.patch(
  '/movies/:id',
  upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'heroBanner', maxCount: 1 },
    { name: 'subtitle', maxCount: 1 },
  ]),
  patchMovieHandler
);

// /upload (auth required)
app.post('/upload', auth, uploadLimiter, upload.fields([
  { name: 'movie', maxCount: 1 },
  { name: 'subtitle', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'heroBanner', maxCount: 1 },
]), async (req, res) => {

  let uploadedFiles = [];
  const cleanupUploadedFiles = async () => {
    if (!uploadedFiles?.length) return;
    for (const file of uploadedFiles) {
      const dirKey =
        file.fieldname === 'movie'
          ? 'movies'
          : file.fieldname === 'subtitle'
            ? 'subtitles'
            : file.fieldname === 'heroBanner'
              ? 'heroBanners'
              : 'thumbnails';
      try {
        await fs.unlink(path.join(DIRS[dirKey], file.filename));
      } catch {}
    }
  };

  const sendUploadError = (code, msg) => sendError(res, code, msg);

  try {
    if (!req.files?.movie?.[0]) return sendUploadError(400, 'Request failed');
    uploadedFiles = Object.values(req.files || {}).flat();

    const movieFile = req.files.movie[0];
    if (!movieFile?.size || movieFile.size < 1024) return sendUploadError(400, 'Request failed');

    if (req.files?.subtitle?.[0]) {
      const subtitleFile = req.files.subtitle[0];
      const subtitlePath = path.join(DIRS.subtitles, subtitleFile.filename);
      // validate subtitle format if present
      normalizeToUtf8AndValidateVtt(subtitlePath);
    }

    const newMovie = {
      title: req.body.title?.trim() || 'Untitled',
      description: req.body.description?.trim() || '',
      movie: req.files.movie[0].filename,
      subtitle: req.files.subtitle?.[0]?.filename || null,
      thumbnail: req.files.thumbnail?.[0]?.filename || null,
      heroBanner: req.files.heroBanner?.[0]?.filename || null,
      category: req.body.category || 'Movie',
    };

    const savedMovie = await addMovieDB(newMovie);
    return res.status(200).json({ success: true, message: 'Upload successful', movie: savedMovie });
  } catch {
    try { await cleanupUploadedFiles(); } catch {}
    return sendUploadError(500, 'Internal server error');
  }
});

app.get('/admin', auth, async (req, res) => res.status(200).json({ ok: true }));

app.get('/health', async (req, res) => {
  try {
    const movies = await readDB();
    return res.json({ status: 'OK', uptime: process.uptime(), movies: movies.length });
  } catch {
    return sendError(res, 500, 'Internal server error');
  }
});

// ===== Frontend + legacy static =====
// All static middleware MUST run after API boundary.
app.use(express.static('public', { maxAge: '1d', etag: true }));


// Expose logos and media static routes
app.use('/logos', express.static(path.join(__dirname, 'logos'), { maxAge: '1d', etag: true }));
app.use('/uploads', express.static('uploads'));
app.use('/thumbnail', express.static(DIRS.thumbnails));
app.use('/thumbnail-card', express.static(path.join(DIRS.cardBase, 'thumbnails')));
app.use('/subtitle', express.static(DIRS.subtitles));
app.use('/subtitle-card', express.static(path.join(DIRS.cardBase, 'subtitles')));
app.use('/hero-banner', express.static(DIRS.heroBanners));

// Export for tests
module.exports = app;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 StreamBox Server Ready on http://localhost:${PORT}`);
});

