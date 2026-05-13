# Deployment Checklist

## Before Deploy

- `.env` exists and `STREAMBOX_ADMIN` is not the default.
- `SD_BASE` points to persistent storage.
- `data`, `logs`, `backups`, and media directories are writable by the app user.
- nginx `client_max_body_size` is larger than `UPLOAD_FILE_SIZE`.
- TLS certificates are valid.
- Recent DB backup exists.

## Deploy

- Install dependencies with `npm ci --omit=dev`.
- Start via PM2 or Docker Compose.
- Confirm `/health` returns `{"status":"OK"}`.
- Confirm `/health/metrics` returns JSON.
- Confirm static pages load over HTTPS.

## Security Smoke

- `GET /admin` unauthenticated returns 401 JSON.
- `POST /upload` unauthenticated returns 401 JSON.
- `DELETE /movies/:id` unauthenticated returns 401 JSON.
- `/movies/%2F%2F%2E%2E` returns 400 JSON.
- Unknown/malformed media paths return JSON, not HTML.

## Media Smoke

- Home posters load.
- Player page renders video element.
- `/video/<file>` supports `Range: bytes=0-99`.
- Subtitles return `text/vtt` when present.
- Upload with valid admin bearer token succeeds.

## After Deploy

- `node phase6-pro-engine.js` reports `RESULT: PASS`.
- Playwright desktop/mobile QA has no console errors or failed requests.
- PM2 process is stable.
- Logs are rotating.
- Backup cron is installed.
