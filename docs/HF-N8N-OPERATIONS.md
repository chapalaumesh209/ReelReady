# Hosted n8n container repair

The existing Hugging Face Space uses `deploy/n8n/Dockerfile` and the four companion files in that directory. Upload these files together to the Space repository root. Preserve its existing README, database credentials, encryption key, other secrets, and workflows. Do not factory-reset the Space or initialize a replacement database.

The image pins n8n and its official task-runner launcher to 2.44.6. A separate unprivileged JavaScript runner connects only to the loopback broker. Its environment excludes database, provider, and administrative secrets. Existing workflows use JavaScript; Python Code nodes require a separately configured runner.

Startup normalizes the public HTTPS origin from `N8N_WEBHOOK_URL` (or legacy `WEBHOOK_URL`), fixes the hostname, and verifies PostgreSQL TLS with the bundled public Supabase CA. Global certificate verification stays enabled. Runtime database/encryption credentials remain unchanged.

Default database settings (overridable as Space variables):

| Variable                                  | Default   |
| ----------------------------------------- | --------- |
| DB_POSTGRESDB_POOL_SIZE                   | 5         |
| DB_POSTGRESDB_CONNECTION_TIMEOUT          | 10000 ms  |
| DB_PING_TIMEOUT_MS                        | 15000 ms  |
| DB_PING_INTERVAL_SECONDS                  | 15        |
| DB_POSTGRESDB_MAX_CONNECTION_LIFETIME_MS  | 300000 ms |
| DB_POSTGRESDB_KEEP_ALIVE_INITIAL_DELAY_MS | 5000 ms   |
| DB_CONNECTION_ACQUISITION_TIMEOUT_MS      | 15000 ms  |

The connection acquisition timeout must be below the ping timeout. The additional pool headroom prevents short health probes competing with workflow/database work from immediately marking the whole instance unavailable. Pool size must remain within the database's connection budget; monitor connection counts and readiness failures after changes.

Before rollout, back up workflows privately and record workflow/credential counts and hashes. Test the image with an isolated database and a nonce-bearing Webhook → Code → Response workflow. After rollout, verify `/healthz/readiness`, authenticated ReelReady health webhooks, active workflow registration, and the Vercel coordinator heartbeat. Compare the database hashes. Health probes must never invoke publishing or connection workflows.

Production ReelReady keeps `DEMO_MODE=false` and `ALLOW_SAMPLE_OUTPUT=false`; sample shortcuts and sample URL seeds are unavailable. Provider errors must preserve drafts and report an error rather than silently producing canned captions.

The separate FFmpeg media worker is not part of this container. Its deployment is deferred. Creators can keep original audio; hosted audio rendering requires that worker to be provisioned later.
