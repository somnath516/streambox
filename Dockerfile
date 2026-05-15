FROM node:20-bookworm AS runtime

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    sqlite3 \
    dumb-init \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev && \
    npm rebuild sqlite3 --build-from-source

COPY . .

RUN mkdir -p \
    /app/data \
    /app/logs \
    /app/backups \
    /media/movies \
    /media/subtitles \
    /media/thumbnails \
    "/media/hero banner" && \
    chown -R node:node /app /media

USER node

EXPOSE 10000

CMD ["dumb-init", "npm", "start"]