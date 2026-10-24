> Historical hardening report. Current UI/native publishing architecture and verification: OVERHAUL-REPORT.md.

# ReelReady pre-submission hardening

Local implementation, 23 October 2026. The existing lavender UI, anonymous workspace and six steps remain. No visible login/signup was added.

## Changes

- Worker heartbeat endpoint with a configurable 60-second freshness window. Upload no longer waits for inspection. Selecting the unchanged original bypasses FFmpeg, preserves the source and approves that exact asset for publishing. Offline processing has calm feedback; the original choice and Continue stay usable. Queued jobs older than three minutes offer cancellation and original continuation. Cancellation is owner-checked, and leased result application is atomic against cancellation.
- Planning, caption kits and revisions use configured text credentials, including Gemini under the previous demo text setting. Schema validation retries once; each writing request has an 18-second timeout. Missing credentials, exhausted capacity or repeated provider/validation failure produce a visible **Sample output** badge. Publishing demo mode is independent of live writing. Existing factual review and manual-caption preservation remain; X links are rejected using the existing Twitter text parser.
- Browser and server upload checks, actual stored-byte verification, text caps, atomic database owner/IP rate limits, atomic queue admission and a global daily paid-call budget. The budget is charged before each paid generation/speech call, including worker segments. Exhausted text generation becomes a labelled sample; speech actions explain demo capacity.
- An original eight-second H.264/AAC portrait animation and quiet synthesized test tone are available on the home page and through **Use a sample video**. The sample follows the normal private upload path. Original audio is the default; advanced mixing/classification/fades/timing are collapsed. **English voiceover** orchestrates notes or transcription, English adaptation, narration and mixing in one durable job. First-use textareas support typing/Wispr dictation, autofocus, Enter/Shift+Enter and native scripts. Saved sample/new links become stable reel links after autosave.
- Publishing preflight reports publishing mode readiness, actual selected account connections, media requirements, caption/hashtag counts, public signed URL eligibility/lifetime and approximate per-creator usage. Real Instagram requires inspected MP4/H.264/AAC, 9:16, 5–90 seconds; YouTube and X receive media-spec warnings. Real sends require exact `DEMO_MODE=false`, explicit confirmation, owned connected destinations and passing preflight, including retries. The later user request removed the publishing PIN from the UI, API and configuration. Media URLs are signed afresh before sending. Per-destination receipts/links remain, with the requested YouTube privacy note.
- New additive migrations only, applied to local Supabase. Rate-limit/queue/usage infrastructure is inaccessible to browser roles. The retention scanner uses an invoker entry point and a narrowly scoped, service-only private auth lookup. Local security advisors reported no warnings/errors.

## New environment defaults

See `.env.example` for the full list. No credentials are included.

| Variable | Default |
| --- | --- |
| `MAX_UPLOAD_MB` | `200` |
| `MAX_VIDEO_SECONDS` | `90` |
| `WORKER_HEARTBEAT_SECONDS` | `60` |
| `WORKER_POOL` | `default` |
| `MAX_ACTIVE_JOBS_PER_USER` | `2` |
| `MAX_QUEUED_JOBS` | `100` active queued/running jobs globally |
| `DAILY_PROVIDER_CALL_LIMIT` | `500`, UTC day |
| `RETENTION_DAYS` | `7` |
| `PUBLISH_SIGNED_URL_TTL_SECONDS` | `172800` (48 hours), bounded to seven days |
| `INSTAGRAM_HASHTAG_LIMIT` | `5`, conservative configurable editorial cap |
| `RATE_IP_MULTIPLIER` | `4` times each owner limit |

`DEMO_MODE=true` remains the default. Per-owner fixed-hour defaults, configurable through the corresponding `RATE_*_PER_HOUR` variables:

- Generation: 20 shared across planning and kits; change requests: 20.
- Transcription, translation, voice preview/generation, suggestions and inspection: 10 per action.
- Render and English voiceover enqueue: 5 per action.
- Upload preparation and upload registration: 10 each; account connection start: 10.
- Publish sending/retry: 5; publication preparation: 10; preflight: 30; compatibility voice endpoint: 10.

Main generation, translation and voice text inputs are capped at 4,000 characters or a stricter field limit. Caption editors retain destination-specific limits. Registration validates reported duration; independent decoded stream measurements come from the worker when available. Uninspected media cannot pass real Instagram preflight. This keeps upload independent of stream inspection.

## Scripts and operation docs

- `npm run check:env`: validates hosted readiness and prints feature modes without credentials. Current local URLs correctly fail the hosted-URL checks. `npm run check:env -- --local` validates local configuration and succeeds.
- `npm run cleanup`: safe dry run, printing counts only. `-- --execute` is an explicit operator action; it was **not run**. Inactive anonymous reels/assets/jobs older than retention are candidates; active/future/uncertain work and non-anonymous users are excluded. No schedule was created. See `RETENTION.md`.
- `scripts/worker-health.ts`: Docker heartbeat health probe. `Dockerfile` uses Node 22 with FFmpeg/FFprobe. See `WORKER-DEPLOY.md` for secrets, health and restart policy.
- `scripts/offline-test-server.mjs`: isolated browser-test instances with provider keys cleared; one has no worker in its pool. Tests do not depend on the developer's live AI configuration or reset durable counters.
- `REAL-PUBLISH-CHECKLIST.md`: the separately authorized future account/visibility test, throwaway-post deletion and return to demo mode.

## Validation

- `npm run lint`, `npm run typecheck` and `npm run build` pass.
- Unit/backend suite: 33 tests, including live/fallback/invalid-JSON provider mocks, boundaries, atomic owner/IP/queue limits, provider circuit breaker, safe cancellation, retention selection, preflight/confirmation/ownership/public-URL/TTL/caption checks and quota warnings.
- Native media suite: 8 tests, including the new English voiceover preset with mocked providers and a real FFmpeg-rendered MP4.
- Browser suite: 10 tests. The judge path completes Plan → Publish using the sample video with no worker, provider keys, Wispr or connected accounts; measured around six seconds in the local run. Coverage includes 390px/desktop, accessibility, native rendering, queued cancellation, Enter/Shift+Enter and Telugu/Hindi persistence through editing/revision/reload.
- `/api/health` and local environment check return only feature readiness. Cleanup dry run found zero expired reels and deleted nothing. Local Supabase security advisors found no issues. Client bundle scan found no posting-vendor name or server credential names; authored source credential-pattern scan found no credentials.

Existing tests remain; fixture assertions were updated where the requested contract changed (permanent invalid AI now falls back to a labelled sample, explicit confirmation/public signed URL requirements, and collapsed advanced controls).

## Not performed in this local pass

No deployment, hosted migration/resource change, real OAuth approval, real social post, live publishing API request, cleanup execution or scheduler setup. Publishing adapter tests use mocks. Live generation/speech provider availability was not re-certified with paid calls in this pass; health describes configured capability and budget, not a remote service guarantee. The Docker image/long-lived host still needs an operator's deployment verification. Public HTTPS app/storage configuration and the manual real-publish checklist remain future operational work under the user's local-only constraint. Pre-existing local data was preserved; tests removed only their own new fixtures.
