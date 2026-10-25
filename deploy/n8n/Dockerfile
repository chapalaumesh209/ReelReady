FROM node:24-alpine

# Set user to root for installation
USER root

# Arguments that can be passed at build time
ARG BASE_PATH=/root/.n8n
# Install system dependencies
RUN apk add --no-cache \
    git \
    python3 \
    py3-pip \
    make \
    g++ \
    build-base \
    cairo-dev \
    pango-dev \
    chromium \
    postgresql-client \
    yt-dlp

# Set environment variables
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser


# Install n8n globally
RUN npm install -g n8n@2.44.6

# Create necessary directories (<<<<< this is the line that was modified)
RUN mkdir -p $BASE_PATH \
    && chmod -R 777 $BASE_PATH

# Set working directory
WORKDIR /data

# Start n8n
COPY --from=n8nio/runners:2.44.6 /usr/local/bin/task-runner-launcher /usr/local/bin/task-runner-launcher
RUN apk add --no-cache libc6-compat ca-certificates \
    && addgroup -g 1001 -S reelready-runner \
    && adduser -u 1001 -S -G reelready-runner -h /home/reelready-runner -D reelready-runner \
    && mkdir -p /opt/reelready \
    && node -e "require('fs').symlinkSync(require.resolve('@n8n/task-runner/start', {paths:['/usr/local/lib/node_modules/n8n']}), '/opt/reelready/runner-start.js')"
COPY task-runners.json /etc/n8n-task-runners.json
COPY environment.mjs start.mjs supabase-prod-ca-2021.crt /opt/reelready/
CMD ["node", "/opt/reelready/start.mjs"]
