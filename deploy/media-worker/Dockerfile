FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY lib ./lib
COPY scripts/media-worker.ts scripts/worker-health.ts ./scripts/
ENV NODE_ENV=production MEDIA_WORKER_ONLY=true MEDIA_HEALTH_HOST=0.0.0.0 MEDIA_HEALTH_PORT=7860
USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s CMD node --import tsx scripts/worker-health.ts
CMD ["node", "--import", "tsx", "scripts/media-worker.ts"]
