# Hosted n8n with Vercel

ReelReady uses the production n8n base `https://umeshchapala-n8n.hf.space/webhook`. Test URLs under `/webhook-test/` are temporary editor listeners and are rejected by the runtime configuration. No browser calls n8n directly.

## Request flow

1. The creator's anonymous Supabase session owns their account profile, reel and confirmed publishing job.
2. Account connection calls the hosted `reelready-provider-connect` workflow. Its authenticated callback to `/api/automation/connect-authorize` consumes the one-use server grant and supplies the canonical profile and return URL.
3. The hosted coordinator calls `/api/automation/tick`. Vercel acknowledges after authentication and heartbeat; `after()` advances one durable confirmed publishing job after the response is sent. This frees n8n's execution slot before the callback calls n8n again, including on a single-slot instance. Database leases protect overlapping ticks. Demo mode records availability but never advances a real publication.
4. Due publication calls `reelready-provider-publish`. Before uploading, n8n calls `/api/automation/authorize` to consume the approved dispatch proof. The callback rechecks ownership, the exact accounts and selected media.
5. n8n sends the signed hosted-storage URL to the publishing service with the platform-specific captions. The large file goes directly from storage to the service, outside Vercel functions.
6. Subsequent ticks poll `reelready-provider-status` and persist per-platform receipts. Interim processing/retryable results never become false terminal failures, and retries check an existing receipt before allowing a resend.

The four hosted webhooks use short-lived JWTs. Callbacks use the separate server-side Header Auth credential and bounded JSON. No provider key, Supabase secret or administrative n8n API key is sent to the browser. The queue's existing confirmation, budget, ownership and duplicate guards remain in place.

## Configure the application

Set the following in Vercel Production and any intended preview environment:

```dotenv
APP_URL=https://reelready-v1.vercel.app
PUBLISH_PROVIDER=uploadpost
PUBLISH_EXECUTOR=n8n
N8N_PROVIDER_WEBHOOK_BASE=https://umeshchapala-n8n.hf.space/webhook
PUBLISH_MEDIA_TRANSPORT=url
WORKER_POOL=production
ALLOW_SAMPLE_OUTPUT=false
DEMO_MODE=true
```

Also configure the actual hosted Supabase URL, publishable and secret keys, stable `SESSION_SECRET`, `N8N_PUBLISHER_SECRET`, publishing service API key and live Gemini credentials. The private `.env.vercel.production.local` prepared during setup is an operator import file, excluded from Git; never paste its contents in chat. It preserves the user's selected real-publishing mode. Checked-in examples default to demo mode. The n8n administrative API key is only for local setup and must not be copied into Vercel.

Apply the versioned application migrations to the hosted Supabase project without a reset. Preserve `reelready_drafts` and its saved records. Enable anonymous sign-ins and configure the private storage bucket. The October 24 rollout applied the 13 existing application migrations with explicit approval. All 16 ReelReady tables have RLS enabled. The three legacy drafts retained the same content checksum. Hosted anonymous Auth, owner isolation and private signed-video access were verified with disposable fixtures.

The existing local development database and drafts remain separate. Pointing a local database at workflows whose callbacks use Vercel cannot work: those callbacks must read the same hosted database as the application. Local anonymous users and profile mappings do not migrate automatically.

## Prepare and apply workflows

Set `N8N_API_KEY` securely in `.env.development.local` (operator access only). The shared callback secret and publishing key must already be set there. Prepare secret-free workflow JSON:

```sh
N8N_PROVIDER_WEBHOOK_BASE=https://umeshchapala-n8n.hf.space/webhook npm run n8n:setup:hosted -- --app-url=https://reelready-v1.vercel.app --with-coordinator
```

Review `.n8n-hosted/`, then apply:

```sh
N8N_PROVIDER_WEBHOOK_BASE=https://umeshchapala-n8n.hf.space/webhook npm run n8n:setup:hosted -- --app-url=https://reelready-v1.vercel.app --with-coordinator --apply
```

The script updates only matching ReelReady workflow paths/names, keeps private timestamped backups, and preserves other workflows. It binds encrypted server credentials without printing them. The four webhook workflows are activated and authenticated health is verified. The coordinator is left inactive until Vercel's authenticated backend health confirms the new routes, configuration and database are available. Rerun after backend deployment to activate it. No test event creates a real social post or approves OAuth.

Do not use `npm run n8n:setup` to deploy the hosted workflows: that command provisions the separate local Docker instance for development/verification. Local workflows and data are retained.

## Media processing

The hosted coordinator handles scheduling and delivery of an already approved original video; it does not run FFmpeg. Instagram still requires verified H.264/AAC/portrait metadata, so new uploads need the media worker for stream inspection before real Instagram preflight can pass. English dubbing and audio rendering still need the long-lived media worker described in `WORKER-DEPLOY.md`. The private `.env.worker.production.local` uses the same hosted database, signing keys, pool and remote webhook base. Original-audio continuation remains usable while FFmpeg is offline.

## Verification and remaining setup

- The four Space workflows were updated and activated; authenticated production health passed. Other workflows were left unchanged.
- Unit/backend tests cover URL normalization, test URL rejection, Vercel callback authentication/body limits, hosted URL transport, coordinator response ordering and demo protection, and host-specific heartbeat isolation.
- Actual n8n runtime verification uses mocked storage/publishing destinations. It validates the hosted multipart mapping and duplicate rejection without social calls.
- Full publishing is ready only after Vercel variables, additive hosted database setup and callback deployment are complete. The coordinator's readiness guard prevents premature activation. Account consent and any real post remain the creator's actions.

References: [n8n webhooks](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [n8n API authentication](https://docs.n8n.io/api/authentication/), [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after), [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Rollout notes

The Space's four production webhooks were installed and authenticated health passed. Its management API subsequently returned intermittent 500/503 responses, including `Database is not ready!`; readiness must be stable before completing the coordinator rollout. Management reads have bounded retries; mutations are never automatically retried.

The initial Vercel token did not have access to the supplied production app, so its environment and deployment remain pending the owning-team credential. A private import file is prepared locally and includes no n8n administrative API key. No real post or OAuth approval was performed during verification.

Supabase's advisor flags anonymous-user policies because this application intentionally has no visible login; those policies are owner-scoped and cross-owner access was tested. Server-only tables intentionally deny client access. The existing leaked-password-protection warning concerns password sign-in, which this app does not use: [Supabase guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Performance advisories about covering indexes are recorded for a later tuning pass: [foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). No security errors or exposed secret tables were introduced.
