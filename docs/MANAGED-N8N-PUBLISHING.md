# ReelReady → n8n webhook → managed publishing

The account-connection step now also runs through its own n8n webhook, `ReelReadyProviderConnectV1`, called by the current application. See [N8N-TWO-FLOWS.md](N8N-TWO-FLOWS.md) for the current two-flow architecture and one-use account grants. The backend retains session verification/profile ownership while n8n creates missing profiles and starts platform authorization.

This is the latest selected publishing path. It intentionally uses Upload-Post again, following the user's connection template/Connect API plan. It replaces the native platform upload path for new managed jobs; old native grants, jobs and profile records remain preserved. The prior scheduler-only n8n workflow is retained but unpublished locally.

## Account connection

The application keeps its existing account screen. The backend derives the anonymous Supabase owner from the verified session and reads that owner's unique `reelready_profiles.external_profile` mapping. Only Connect creates a missing deterministic `rr_<owner UUID>` provider profile. Dashboard/status reads never allocate profiles. A full provider plan returns a capacity error; there is no shared/default-account fallback.

Using the server API key, the backend calls the provider's Connect API for the selected platform and the owned profile. It returns only a checked official-platform authorization URL to the browser. The provider performs OAuth/token storage and returns the creator to ReelReady. ReelReady then reads the exact provider profile to confirm actual connections. Callback query parameters never grant access. Disconnect removes only the selected network from the owned profile; it does not delete the whole profile or other creators' accounts.

No creator needs a Google/Meta/X developer app in this managed mode. Eligible Instagram professional accounts, provider allowances and platform requirements still apply. Server-returned stable account identifiers are bound at confirmation; legacy connections without an identifier use the provider-returned handle as a conservative fallback, so a changed handle requires a new review.

## Publishing

1. Final confirmation and preflight validate the owned media, captions, exact destination identifiers and the owned provider profile. The database stores a provider snapshot and the idempotency hash. Repeated clicks reuse the same unresolved job.
2. The existing service-role-only leased queue admits the job, with the same combined media/publication caps. The internal `provider_request_id='native'` marker remains the queue-admission marker for compatibility; `payload.publishingProvider` selects the actual adapter. The provider's actual async request ID is stored separately in `provider_job_id`.
3. At the due time, the long-lived worker derives the envelope from owned records and creates a five-minute HMAC dispatch proof. It POSTs to n8n's authenticated publishing webhook. The browser never supplies the profile, media URL, webhook address, provider key or dispatch proof.
4. The n8n workflow calls the private worker's `/authorize` endpoint before posting. This re-derives all fields, rechecks account binding and the private source, issues a ten-minute media ticket bound to that job, owner and approved file and atomically consumes the proof under the current worker lease. It rejects replayed, expired, forged, unowned or changed-account requests. The workflow uses this canonical response and ignores extra caller-supplied profile/media values.
5. n8n first calls private `/media-download` using its bridge credential and media ticket. The worker checks the active committing lease and unchanged audio approval, privately signs storage and streams only that file. n8n's HTTP Request node posts multipart fields to the provider with `async_upload=true`. Separate Instagram/X captions and the YouTube title/description are mapped, along with `platform[]`, the binary video, Reel type and disclosure flags. No AI node/model is involved.
6. n8n returns the async request ID to the worker, which persists it before future status polling. A separate authenticated status workflow reads provider receipts. The worker saves per-platform state/validated receipt links and activity counts; the application reads those saved results. Page refreshes do not post.

Scheduled jobs remain in ReelReady until due. The background worker must stay online. `PUBLISH_MEDIA_TRANSPORT=binary` is the default managed n8n path: it works with private local or hosted storage because n8n sends file bytes to the provider. The worker must reach storage, n8n must reach the private worker, and n8n needs outbound provider access. `url` is a legacy mode requiring its matching URL-based workflow and a public signed HTTPS storage URL; the retained native adapters also keep their own URL requirements.

Known failed destinations can be explicitly retried after checking the same accounts. The additive retry migration resets only the failed managed request in the same queue-admission transaction. Successful receipts stay intact. A lost response after provider authorization is **uncertain**, never automatically resent. Check the provider/account manually before further action. Provider-confirmed success is not an independent public-visibility audit; known private YouTube results are not marked published.

## Workflows and secrets

- `ReelReadyProviderPublisherV1`: authenticated Webhook → consume approved job → read approved private video → provider HTTP upload → response.
- `ReelReadyProviderStatusV1`: authenticated Webhook → provider status GET → response.
- `ReelReadyProviderHealthV1`: authenticated health webhook → safe readiness response. It calls no social/provider API.
- The old `ReelReadyPublisherV1` schedule is unpublished in managed setup to avoid recursive execution/deadlock. The worker now dispatches/polls jobs through the webhooks; the old autonomous native upload path is not used for managed jobs.

The shared bridge secret and provider key live in n8n's encrypted credential store. Incoming webhooks authenticate with HS256 JWTs expiring after 60 seconds; only the short-lived token is present in request history. The outgoing private authorization call uses its encrypted Header Auth credential. The backend keeps its provider key for profile management. No social access/refresh tokens or Supabase service-role key are supplied to n8n. Neither key is embedded in source/workflow JSON, browser code, URL parameters or command arguments. Temporary credential imports are mode 600 and removed after import. Execution payload retention is disabled for successful, failed and manual runs. Filesystem binary mode uses the persistent n8n volume; protect that volume and its backups as private creator data. Keep the operator editor private and treat history/backups as sensitive. No customer workflow builder is exposed.

## Setup

Configure the provider API key securely in `.env.development.local`, then:

```sh
npm run n8n:setup -- --provider
npm run dev:all
```

Restart an already running ReelReady/worker rather than starting a second process. Setup securely imports the managed credential and three reserved workflows, publishes them in the local operator workspace and selects `PUBLISH_PROVIDER=uploadpost`, `PUBLISH_EXECUTOR=n8n`. It preserves the existing `DEMO_MODE` value and does not enqueue/publish a video. Re-running setup preserves the selected managed mode.

`N8N_PROVIDER_WEBHOOK_BASE` defaults locally to `http://127.0.0.1:5678/webhook`. Use your protected HTTPS n8n webhook base in production. `N8N_PUBLISHER_SECRET` must match both the encrypted JWT Auth credential for incoming webhooks and Header Auth credential for outgoing private authorization. The private `/authorize` listener defaults to port 3010 and must remain on a private network; update the n8n claim node's URL for your worker host. Use the existing Vercel + hosted Supabase + long-lived worker deployment topology. No public hosting or hosted schema change is performed here.

`npm run verify:n8n` validates the actual installed n8n nodes against a local mock authorization/provider server. It uses fake fixture credentials, never the live provider endpoint. Its reserved verification workflow is unpublished afterward; existing workflows/data remain. `npm run test:unit` includes real local Supabase ownership/queue tests with mocked provider/network calls.

## Current account limitation

The read-only provider check returned a two-profile plan with both slots occupied; one existing ReelReady profile has Instagram connected. With explicit user approval, the existing Instagram profile was reassigned in a local database transaction from the older browser workspace to the current reel workspace. Both workspaces and all reels remain; the older workspace no longer owns that provider profile. No remote profile was created or deleted. Only a verified, authorized owner mapping may reuse an existing profile. Other creators need available profile capacity; never map them to an occupied profile to bypass the limit.

## Primary references

- [Account-connection template](https://n8n.io/workflows/8596-generate-secure-social-media-connection-links-for-clients-with-upload-post/)
- [Connect API](https://docs.upload-post.com/api/connect-api)
- [User profiles, identifiers and disconnect](https://docs.upload-post.com/api/user-profiles)
- [Provider OpenAPI contract](https://docs.upload-post.com/openapi.json)

This path uses a third-party publishing provider and is subject to its current plan; self-hosted n8n does not make that access free or unlimited.

## Accurate generation

`ALLOW_SAMPLE_OUTPUT=false` is the default. Missing credentials, exhausted capacity and failed validation return a safe error; previous captions stay saved. Only isolated fixture tests opt into labelled samples. Existing placeholder kits are hidden in real mode and cannot pass publishing preflight. Video review uses the exact selected original or approved English render, binds its storage path, and replaces the summary and captions together only after both requests succeed. A new video version requires a new review. The current OpenArt reel was repaired using actual live Gemini video analysis and live caption generation.
