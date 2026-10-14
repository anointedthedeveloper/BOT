# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-slim
ENV NODE_ENV=production \
    AUTH_DIR=/data/auth \
    MEDIA_DIR=/data/media \
    HEALTH_HOST=0.0.0.0 \
    HEALTH_PORT=3000
# ffmpeg is required for /sticker on video/GIF input (static image stickers work without it).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY assets ./assets
# Session credentials and saved media live in /data: mount a volume here.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `node` as PID 1 receives SIGTERM from `docker stop` and shuts down gracefully.
CMD ["node", "src/index.js"]
