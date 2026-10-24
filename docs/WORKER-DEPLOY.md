# Media worker on a long-lived host

Production Vercel deployments use the authenticated hosted n8n workflows and Vercel callbacks described in [HOSTED-N8N-VERCEL.md](HOSTED-N8N-VERCEL.md). The dedicated media worker handles the private FFmpeg queue only; n8n does not need to reach its listener or stream videos through it. Local development can retain the private bridge described in [MANAGED-N8N-PUBLISHING.md](MANAGED-N8N-PUBLISHING.md). The native publishing loop below applies only to an explicitly selected native executor.

No worker is deployed by this change. Vercel serves the web app; run the worker separately on an always-on container host with outbound HTTPS, Node 22, FFmpeg/FFprobe and at least 1 GB writable temporary disk. The original-audio workflow works without it.

Build `docker build -t reelready-worker .`, then run `docker run --init --restart unless-stopped --env-file /secure/reelready-worker.env reelready-worker`. Keep the env file outside the repository with permissions 600. Do not bake credentials into images. Health is checked every 30 seconds using the private database heartbeat; inspect Docker's health state. Configure the host to restart unhealthy containers (Docker restart policy by itself restarts exits, not unhealthy containers).

Required: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SESSION_SECRET matching the web server, DEMO_MODE=true. Apply new migrations before starting the new worker. Optional Gemini credentials: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TTS_MODEL, TRANSCRIPTION_MODEL. Set WORKER_POOL identically on web and worker (default `default`); separate pools can isolate testing. Optional MEDIA_TEMP_DIR (writable by node), FFmpeg paths, WORKER_HEARTBEAT_SECONDS=60 and DAILY_PROVIDER_CALL_LIMIT=500. Real direct-platform publishing also needs the official app credentials and stable SOCIAL_TOKEN_ENCRYPTION_KEY.

`npm run worker` runs scripts/media-worker.ts locally. Heartbeats are written every 15 seconds; the public status endpoint returns only online/offline. SIGTERM finishes the current job and removes the worker heartbeat. Interrupted leases fail safely for explicit retry. Cancellation is checked at processing checkpoints and prevents later application to the draft; temporary files are removed and original sources are preserved.

## Native platform publishing

The same long-lived process now also claims durable direct-platform jobs. Set DEMO_MODE=true for a worker that must never deliver real social posts. Configure platform app credentials, encryption key and matching WORKER_POOL only when live delivery is intentionally enabled. Web requests enqueue; the worker uploads/polls each destination. Keep it running for accepted schedules. No worker or hosting deployment has been performed.

## n8n orchestration

With `PUBLISH_EXECUTOR=n8n`, only authenticated n8n ticks advance the publishing queue. The worker's autonomous publishing loop is disabled; media processing remains active. Configure the private bridge secret/host/port and keep its listener behind a private network. See [N8N-PUBLISHING.md](N8N-PUBLISHING.md) for the local container, importable workflow, health reporting and production boundaries.

## Dedicated hosted media container

For the Vercel + hosted n8n setup, use `docker build -f deploy/media-worker/Dockerfile -t reelready-media-worker .`. This image includes Node 22 and FFmpeg and exposes a health-only HTTP endpoint on port 7860. It copies only runtime source files; local environment files, workflow backups, operator work files and Git history are excluded. Keep secrets in the host's runtime secret store.

Set `MEDIA_WORKER_ONLY=true`, `MEDIA_HEALTH_HOST=0.0.0.0`, `MEDIA_HEALTH_PORT=7860` and `WORKER_POOL=production`. Use the same hosted Supabase and Gemini credentials as Vercel. This mode starts no publishing bridge, sends no publishing health callbacks and cannot dispatch social posts. The separate hosted n8n coordinator owns publishing. Its heartbeat does not satisfy media-worker readiness.

The web app checks the media worker's database heartbeat. The container reports HTTP 503 until that heartbeat succeeds and again if it becomes stale. `/` and `/health` accept GET/HEAD only; there are no public job, command or upload endpoints. FFmpeg writes only to temporary disk and persistent media remains in private Supabase storage.

For a Hugging Face Docker Space, use the metadata in `deploy/media-worker/README.md` and the dedicated Dockerfile at the Space repository root. The owner must provide a write-capable Hugging Face token securely to the operator. Configure keys as Space Secrets, never Git files. Check the account's current Docker Space eligibility before creating resources; do not enable paid hardware automatically. Free/eligible basic hardware can sleep, so it is not an always-on production guarantee. A reliably available deployment needs a host whose availability policy suits the workload. See [Docker Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker) and [Space management](https://huggingface.co/docs/huggingface_hub/guides/manage-spaces).

## Writing and video-review request windows

`AI_REQUEST_TIMEOUT_MS=45000` and `AI_MEDIA_TIMEOUT_MS=90000` are per-attempt defaults; valid overrides are 1000–120000 milliseconds. Planning, publishing kits, revisions, video upload registration and video review have a 180-second request budget and a 240-second Vercel function ceiling, allowing schema validation and one retry without the former 18-second cutoff. Explicit user cancellation is preserved. A timeout never replaces a real recording analysis or existing captions with sample output when `ALLOW_SAMPLE_OUTPUT=false`.
