const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config.service');
const logger = require('../utils/logger');

const dbPath = path.join(config.dirs.data, 'streambox.db');
let db;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function initDb() {
  await fs.mkdir(config.dirs.data, { recursive: true });
  if (db) return db;

  db = new sqlite3.Database(dbPath);
  await run('PRAGMA journal_mode = WAL');
  await run('PRAGMA synchronous = NORMAL');
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA busy_timeout = 5000');

  await run(`CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    movie TEXT NOT NULL,
    subtitle TEXT,
    thumbnail TEXT,
    heroBanner TEXT,
    duration INTEGER DEFAULT 0,
    category TEXT DEFAULT 'Movie',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    views INTEGER DEFAULT 0
  )`);

  await run('ALTER TABLE movies ADD COLUMN heroBanner TEXT').catch((err) => {
    if (!/duplicate column name/i.test(err.message || '')) throw err;
  });
  await run('CREATE INDEX IF NOT EXISTS idx_title ON movies(title)');
  await run('CREATE INDEX IF NOT EXISTS idx_category ON movies(category)');

  const integrity = await get('PRAGMA integrity_check');
  const result = integrity && Object.values(integrity)[0];
  if (result !== 'ok') {
    logger.error('db_integrity_failed', { result: String(result || 'unknown') });
    throw new Error('Database integrity check failed');
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('Database has not been initialized');
  return db;
}

async function getMovies() {
  return all('SELECT * FROM movies ORDER BY createdAt DESC');
}

async function addMovie(movie) {
  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = await run(
      `INSERT INTO movies (title, description, movie, subtitle, thumbnail, heroBanner, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [movie.title, movie.description, movie.movie, movie.subtitle, movie.thumbnail, movie.heroBanner || null, movie.category]
    );
    await run('COMMIT');
    return { id: result.lastID, ...movie };
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function getMovieById(id) {
  return get('SELECT * FROM movies WHERE id = ?', [id]);
}

async function unlinkIfPresent(filename, dir) {
  if (!filename) return false;
  const fullPath = path.join(dir, String(filename));
  try {
    await fs.unlink(fullPath);
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('delete_file_failed', { code: err.code });
    return false;
  }
}

async function deleteMovie(id) {
  const row = await getMovieById(id);
  if (!row) return { deletedId: id, changes: 0, deletedFiles: 0 };

  const results = await Promise.all([
    unlinkIfPresent(row.movie, config.dirs.movies),
    unlinkIfPresent(row.subtitle, config.dirs.subtitles),
    unlinkIfPresent(row.thumbnail, config.dirs.thumbnails),
    unlinkIfPresent(row.heroBanner, config.dirs.heroBanners),
  ]);

  const result = await run('DELETE FROM movies WHERE id = ?', [id]);
  return { deletedId: id, changes: result.changes, deletedFiles: results.filter(Boolean).length };
}

const UPDATE_FIELDS = new Set(['title', 'description', 'category', 'thumbnail', 'heroBanner', 'subtitle']);

async function updateMovie(id, updates) {
  const fields = Object.keys(updates).filter((field) => UPDATE_FIELDS.has(field));
  if (!fields.length) return { id, changes: 0 };

  const values = fields.map((field) => updates[field]);
  values.push(id);
  const sql = `UPDATE movies SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`;
  const result = await run(sql, values);
  return { id, changes: result.changes };
}

async function closeDb() {
  if (!db) return;
  const closing = db;
  db = null;
  await new Promise((resolve, reject) => closing.close((err) => (err ? reject(err) : resolve())));
}

module.exports = {
  addMovie,
  closeDb,
  db: { get instance() { return getDb(); } },
  deleteMovie,
  getMovieById,
  getMovies,
  initDb,
  updateMovie,
};
