const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const root = path.join(__dirname, '..');

/**
 * Render runs on Linux.
 * The previous default SD_BASE was Windows-only, which breaks media path resolution
 * (/thumbnail/*, /hero-banner/*) inside the container.
 *
 * We preserve backward compatibility by honoring SD_BASE when provided,
 * but we choose Linux-safe defaults matching the container filesystem.
 */
const defaultLinuxBase = path.join(root, 'uploads');

const sdBase =
  process.env.SD_BASE ||
  (process.platform === 'win32' ? 'E:\\StreamBox Database' : defaultLinuxBase);

const config = {
  port: Number(process.env.PORT || 3000),
  adminToken: process.env.STREAMBOX_ADMIN || 'STREAMBOX_ADMIN',
  uploadFileSize: Number(process.env.UPLOAD_FILE_SIZE || 500 * 1024 * 1024),
  uploadMaxFiles: Number(process.env.UPLOAD_MAX_FILES || 4),
  phase6Probe: process.env.PHASE6_PROBE === '1',
  dirs: {
    movies: path.resolve(
      process.env.MOVIES_BASE || path.join(defaultLinuxBase, 'movies')
    ),
    subtitles: path.resolve(
      process.env.SUBTITLES_BASE || path.join(defaultLinuxBase, 'subtitles')
    ),
    thumbnails: path.resolve(
      process.env.THUMBNAILS_BASE || path.join(defaultLinuxBase, 'thumbnails')
    ),

    // Preserve the required “hero banner” directory naming.
    heroBanners: path.resolve(
      process.env.HERO_BANNER_BASE ||
        (process.platform === 'win32'
          ? path.join(sdBase, 'hero banner')
          : '/media/hero banner')
    ),

    data: path.join(root, 'data'),

    // Used by card routes: /thumbnail-card and /subtitle-card
    cardBase: path.resolve(
      process.env.MEDIA_PATH || path.join(defaultLinuxBase)
    ),

    logos: path.join(root, 'logos'),
    public: path.join(root, 'public'),
    uploads: path.join(root, 'uploads'),
  },
};

module.exports = config;

