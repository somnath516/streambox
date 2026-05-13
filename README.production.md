# Stream Box Production Operations

Stream Box is packaged as a Node.js OTT streaming service with SQLite WAL storage, filesystem media storage, hardened JSON API contracts, and range-safe media streaming.

## Runtime

- Node.js LTS: 22.x recommended
- Process manager: PM2 or Docker Compose
- Reverse proxy: nginx with HTTPS
- Database: SQLite in `data/streambox.db`
- Media: `SD_BASE` with `movies`, `subtitles`, `thumbnails`, and `hero banner`
- Logs: structured JSON in `logs/streambox.log`

## Required Environment

Copy `.env.example` to `.env` and set:

- `STREAMBOX_ADMIN`: long random bearer token
- `SD_BASE`: persistent media root
- `PORT`: app port, default `3000`
- `UPLOAD_FILE_SIZE`: max upload bytes
- `ENABLE_CSP=1` for production CSP

## Commands

```bash
npm ci --omit=dev
npm start
npm run health
npm run smoke
npm run backup:db
npm run cleanup:media
```

`cleanup:media` is dry-run by default. Use `node scripts/cleanup-media.js --apply` only after reviewing the output.

## Locked Contracts

These must remain stable after every deployment:

- `GET /admin` without auth -> `401 {"error":"Unauthorized"}`
- `POST /upload` without auth -> `401 {"error":"Unauthorized"}`
- `DELETE /movies/:id` without auth -> `401 {"error":"Unauthorized"}`
- malformed `/movies/%2F%2F%2E%2E` -> `400 {"error":"Request failed"}`
- no HTML response for malformed API/media paths

Run:

```bash
node _phase6_probe.js
node phase6-pro-engine.js
```

Expected: `RESULT: PASS` and every category `SAFE`.
