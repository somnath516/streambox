# Stream Box Deployment Guide

## 1. Prepare Host

Install Node.js 22 LTS, nginx, PM2, and certbot. Create persistent directories:

```bash
sudo mkdir -p /opt/streambox /srv/streambox-media/{movies,subtitles,thumbnails,"hero banner"}
sudo mkdir -p /var/log/streambox /var/backups/streambox
```

## 2. Configure App

```bash
cp .env.example .env
```

Set:

```env
NODE_ENV=production
STREAMBOX_ADMIN=<long random token>
SD_BASE=/srv/streambox-media
HERO_BANNER_BASE=/srv/streambox-media/hero banner
MEDIA_PATH=/srv/streambox-media
LOG_DIR=/var/log/streambox
ENABLE_CSP=1
```

## 3. PM2 Deployment

```bash
npm ci --omit=dev
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Validate:

```bash
node scripts/health-check.js http://127.0.0.1:3000
node scripts/smoke-test.js http://127.0.0.1:3000
```

## 4. Docker Compose Deployment

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f streambox
```

Volumes persist:

- `./data:/app/data`
- `./logs:/app/logs`
- `./backups:/app/backups`
- `./media:/media`

## 5. nginx HTTPS

Copy:

```bash
sudo cp deploy/nginx/streambox.site.conf /etc/nginx/conf.d/streambox.conf
```

Edit `server_name` and certificate paths. Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Backups

Manual backup:

```bash
node scripts/backup-db.js
```

Cron example:

```bash
cat deploy/backup-cron.example
```

Restore requires app downtime:

```bash
pm2 stop streambox
node scripts/restore-db.js backups/streambox-<timestamp>.db --confirm
pm2 start streambox
```

## 7. Release Verification

Run after every deploy:

```bash
node _phase6_probe.js
node phase6-pro-engine.js
node scripts/smoke-test.js https://streambox.example.com
node scripts/playwright-qa.js https://streambox.example.com
```
