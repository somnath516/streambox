const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const LOG_FILE = process.env.LOG_FILE || path.join(LOG_DIR, 'streambox.log');
const LOG_MAX_BYTES = Number(process.env.LOG_MAX_BYTES || 10 * 1024 * 1024);

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {}
}

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < LOG_MAX_BYTES) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(LOG_FILE, path.join(LOG_DIR, `streambox-${stamp}.log`));
  } catch {}
}

function appendLine(line) {
  ensureLogDir();
  rotateIfNeeded();
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}

function sanitize(details = {}) {
  const copy = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|secret|authorization|password/i.test(key)) continue;
    if (typeof value === 'string' && value.length > 500) copy[key] = value.slice(0, 500);
    else copy[key] = value;
  }
  return copy;
}

function write(level, event, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitize(details),
  };

  const line = JSON.stringify(entry);
  appendLine(line);
  if (level === 'error') return console.error(line);
  if (level === 'warn') return console.warn(line);
  return console.log(line);
}

module.exports = {
  info: (event, details) => write('info', event, details),
  warn: (event, details) => write('warn', event, details),
  error: (event, details) => write('error', event, details),
};
