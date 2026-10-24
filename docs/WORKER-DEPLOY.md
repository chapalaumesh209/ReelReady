# Media worker on a long-lived host

The current managed-provider mode uses authenticated n8n webhooks for publishing; see [MANAGED-N8N-PUBLISHING.md](MANAGED-N8N-PUBLISHING.md). In that mode the same worker dispatches approved due jobs to n8n and serves the private one-use authorization and ticket-scoped media-stream endpoints. n8n must reach this private listener to read the approved video; no storage credentials leave the worker. The native scheduler-only option below is retained for explicit native mode.

No worker is deployed by this change. Vercel serves the web app; run the worker separately on an always-on container host with outbound HTTPS, Node 22, FFmpeg/FFprobe and at least 1 GB writable temporary disk. The original-audio workflow works without it.

Build `docker build -t reelready-worker .`, then run `docker run --init --restart unless-stopped --env-file /secure/reelready-worker.env reelready-worker`. Keep the env file outside the repository with permissions 600. Do not bake credentials into images. Health is checked every 30 seconds using the private database heartbeat; inspect Docker's health state. Configure the host to restart unhealthy containers (Docker restart policy by itself restarts exits, not unhealthy containers).

Required: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SESSION_SECRET matching the web server, DEMO_MODE=true. Apply new migrations before starting the new worker. Optional Gemini credentials: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TTS_MODEL, TRANSCRIPTION_MODEL. Set WORKER_POOL identically on web and worker (default `default`); separate pools can isolate testing. Optional MEDIA_TEMP_DIR (writable by node), FFmpeg paths, WORKER_HEARTBEAT_SECONDS=60 and DAILY_PROVIDER_CALL_LIMIT=500. Real direct-platform publishing also needs the official app credentials and stable SOCIAL_TOKEN_ENCRYPTION_KEY.

`npm run worker` runs scripts/media-worker.ts locally. Heartbeats are written every 15 seconds; the public status endpoint returns only online/offline. SIGTERM finishes the current job and removes the worker heartbeat. Interrupted leases fail safely for explicit retry. Cancellation is checked at processing checkpoints and prevents later application to the draft; temporary files are removed and original sources are preserved.

## Native platform publishing

The same long-lived process now also claims durable direct-platform jobs. Set DEMO_MODE=true for a worker that must never deliver real social posts. Configure platform app credentials, encryption key and matching WORKER_POOL only when live delivery is intentionally enabled. Web requests enqueue; the worker uploads/polls each destination. Keep it running for accepted schedules. No worker or hosting deployment has been performed.

## n8n orchestration

With `PUBLISH_EXECUTOR=n8n`, only authenticated n8n ticks advance the publishing queue. The worker's autonomous publishing loop is disabled; media processing remains active. Configure the private bridge secret/host/port and keep its listener behind a private network. See [N8N-PUBLISHING.md](N8N-PUBLISHING.md) for the local container, importable workflow, health reporting and production boundaries.
