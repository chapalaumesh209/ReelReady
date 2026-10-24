# Managed publishing through n8n — implementation report

## What changed

Implemented the user's per-creator provider profile / Connect API / authenticated n8n webhook plan. New managed publications use the existing approval, ownership and durable queue, then dispatch to n8n and the provider rather than the three native upload adapters. Existing native grants, profiles, jobs, source assets and earlier workflow are retained. The previous scheduler-only workflow is unpublished locally; the new publish/status/health workflows are published in the signed-in local n8n personal workspace.

The existing Accounts screen now uses server-side profile lookup and the provider's Connect API. Profile names never come from the browser. Dashboard reads do not allocate profiles; only Connect creates a missing per-owner profile. Provider plan errors never fall back to a shared/default profile. OAuth return flags are only notices; actual profile account state is verified. Disconnect unlinks only the owned profile/network.

The publishing webhook calls a private authorization endpoint before the provider POST. This rechecks ownership, confirmed account IDs, selected media, lease and a five-minute HMAC proof, atomically consumes it and returns canonical fields with a fresh public signed URL. Duplicate clicks/webhooks cannot create another authorized provider POST. Async request IDs, per-destination receipts, failed-only retries and uncertain commits are saved in Supabase. The provider key is server-only and separately encrypted in n8n's credential store. No AI model is needed in n8n.

## Files and configuration

- `lib/server/provider`: provider configuration, owned profile connections, webhook client, one-use canonical authorization, delivery and receipt parsing.
- `lib/server/automation/bridge.ts`: bounded authenticated `/authorize` endpoint alongside the native control plane.
- Existing connection/preflight/job/worker services route by the stored provider snapshot. The queue's internal native marker is retained for compatibility; real async request IDs use the existing separate provider job field.
- `automation/n8n/provider-*-workflow.json`: publish, status and health workflows. The publishing HTTP Request node is pinned to supported version 4.1, whose plain-form adapter correctly expands the platform array. Actual n8n verification caught empty-field/byte serialization problems in the 4.2 form adapter; the final workflow avoids those paths.
- `scripts/setup-n8n.mjs --provider`: securely imports the reserved workflows/credentials, publishes them and selects managed mode. Repeat setup keeps managed mode. Operator-created workflows are not reset.
- `scripts/verify-provider-workflow.mjs` / `npm run verify:n8n`: real local n8n with fake credentials and local authorization/provider mocks. Verifies authentication, canonical data, individual caption fields, repeated platform fields, async response, replay rejection and a single-platform follow-up. The verification workflow is unpublished afterward.
- Additive migration `20261024064308_n8n_managed_publishing_retry.sql`, applied only locally: resets a confirmed failed managed request in the same retry/admission transaction while preserving successful receipts and native checkpoints. No existing migration was edited.

New variables: `PUBLISH_PROVIDER=uploadpost` (native retained as an explicit option), `UPLOAD_POST_API_KEY` (server-only), `N8N_PROVIDER_WEBHOOK_BASE` (local default `http://127.0.0.1:5678/webhook`). Existing `PUBLISH_EXECUTOR=n8n`, bridge secret/host/port, encryption, limits, storage and demo controls remain. Setup preserves the existing demo switch. All secrets remain ignored and excluded from workflow source.

## Verification

Final checks are recorded in `artifacts/provider-*.log` and `artifacts/provider-db-security.json`.

- Backend/unit: all 72 passed (ten new tests across the managed provider and private bridge suites).
- Native media: 8 passed.
- Browser: 14 passed, including the complete mobile no-worker/no-key demo and existing connected-flow guards.
- Actual n8n workflow against local mocks: passed, including all three destinations, a one-destination follow-up and duplicate rejection. No live publishing provider/social endpoint was called by this verification.
- Local database security advisors: no issues.
- Lint/typecheck/build: all passed. Total: 94 automated tests (72 backend + 8 media + 14 browser), plus actual n8n mock verification.

No real OAuth approvals, posts, profile creation/deletion/moves, hosted schema changes, Vercel deployment or public-site deployment were performed. Read-only account/profile checks confirmed the existing provider key and the documented specific-profile response shape.

## Remaining live-use requirements

Local Supabase media URLs cannot be fetched by the remote provider. Real publishing correctly blocks them; configure hosted private storage with public signed HTTPS URLs before a live test. The provider account currently permits two profiles, both occupied, and one existing ReelReady profile has Instagram connected. Only its mapped owner can reuse it; additional creators need available provider capacity. No profile was deleted to bypass this.

Publication state is provider-confirmed, with checked links where supplied, rather than an independent public-visibility audit. Known private YouTube receipts remain unconfirmed. Uncertain commits require manual reconciliation and are never automatically resent. Hosting, AI and provider allowances remain finite. The public hosted application is unchanged.

See [operator and architecture guide](MANAGED-N8N-PUBLISHING.md).

Final hardening: n8n saved an incoming static bridge authentication header in private execution history. The provider key was not present in plaintext. Incoming webhook authentication now uses 60-second HS256 tokens, and the internal bridge key was rotated so the preserved historical value is invalid. No history or creator data was deleted.

Final scans after key rotation: no current bridge/provider plaintext secrets in n8n SQLite/WAL or container logs; no server secrets or provider name in production client bundles; no remaining plaintext bootstrap credential file. Local health reports the n8n executor online and check:env -- --local passes with the managed backend.
