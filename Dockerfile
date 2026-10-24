FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s CMD node --import tsx scripts/worker-health.ts
CMD ["node", "--import", "tsx", "scripts/media-worker.ts"]
