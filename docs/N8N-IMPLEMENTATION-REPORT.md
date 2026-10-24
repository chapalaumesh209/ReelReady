# Self-hosted n8n publishing — local implementation

## Result

ReelReady's local publishing executor is now self-hosted n8n. The actual Docker container and published schedule have been started and verified through authenticated-trigger heartbeats. The application remains at `http://127.0.0.1:3000`; the private operator editor is at `http://127.0.0.1:5678`. There is no ReelReady login/signup/PIN and no UI redesign in this change.

The replacement is **orchestration**: n8n drives approved due jobs rather than the autonomous publishing loop. Existing official OAuth connections, encrypted credentials, resumable/chunked upload adapters and per-platform receipts remain in the private Node worker/backend. This is intentional: n8n receives no social tokens, videos or Supabase service keys. Upload-Post is not used. This is not a migration to n8n's built-in social nodes or a replacement for official platform APIs.

## Files and behavior

- `lib/server/automation`: executor configuration, empty-request authenticated bridge, serialized execution and n8n-specific heartbeat status.
- `scripts/media-worker.ts`: starts the private bridge for n8n mode and disables its autonomous publication loop. Media processing remains available; shutdown waits for active delivery before removing its own heartbeats.
- `automation/n8n`: pinned 2.44.6 container/digest, persistent volume and fixed five-second Schedule → HTTP Request workflow. Only successful operational metadata is retained for up to 24 hours; error/manual payload saving is disabled. This avoids the observed stuck-running records with successful execution saving disabled on the pinned n8n version.
- `scripts/setup-n8n.mjs`: securely generates/stores local secrets, imports the fixed credential/workflow, publishes it and selects n8n without altering existing demo mode. Repeat setup was verified. Temporary credential files are removed. Existing database/media data was not reset or deleted.
- `/api/health` and `check:env` now report executor identity and observed liveness. A recent authenticated n8n trigger is required for online status. n8n heartbeats do not count as FFmpeg workers. Preflight warns when the selected publishing executor is offline.
- Browser verification explicitly uses n8n offline in the no-worker demo, independent of local operator settings.

No schema migration was required. Existing queue leases/admission, owner/account binding, final confirmation, demo kill switch, failed-only retries and uncertainty protection remain in force.

## Configuration and scripts

- `PUBLISH_EXECUTOR=n8n` selects the new executor. `native` is the explicit compatibility/rollback option; existing installs with no setting retain it.
- `N8N_PUBLISHER_SECRET`: generated server-only 32+ character secret, matching n8n's encrypted Header Auth credential.
- `N8N_PUBLISHER_HOST=127.0.0.1`, `N8N_PUBLISHER_PORT=3010`: private bridge defaults. Local Docker setup selects `0.0.0.0` to reach the host; do not expose this listener publicly.
- n8n's own `N8N_ENCRYPTION_KEY` lives in ignored `.env.n8n.local`; it is separate from the application's encryption key.
- New commands: `npm run n8n:setup`, `npm run n8n:start`, `npm run n8n:stop`. Stop preserves persistent volumes.

Production requires Vercel for Next.js, hosted Supabase, and long-lived n8n/worker hosting with a private bridge and protected HTTPS operator access. The included Compose settings are local-only. No production deployment was made.

## Verification

- Backend/unit: 62 passed, including seven new n8n tests for authentication/payload rejection, demo safety, overlap protection, sanitized recovery, configuration, fresh/stale liveness separation and workflow contract.
- Media: 8 passed with native FFmpeg fixtures.
- Browser: 14 passed, including the full worker/n8n-offline mobile demo flow.
- Lint/typecheck/production build: all passed. Total: 84 tests (62 backend + 8 media + 14 browser).
- Actual pinned n8n import/publication/restart succeeded twice. Runtime health reports n8n online.
- Local credentials/bootstrap files are git-ignored; a scan found no bridge secret in container logs.

## Remaining live requirements and costs

The configuration check still correctly reports YouTube, Instagram and X app credentials **not configured**. No creator grants or active real publishing jobs existed before activating the local coordinator. No real social consent or posts were performed. An online n8n scheduler does not establish live platform connectivity.

Self-hosted n8n does not make platform API access, hosting/storage/egress, or AI services free or unlimited. Existing protective limits remain. The current n8n FAQ permits operator-built backend automations that users trigger/connect accounts to, with no customer workflow-building access. Keep the editor internal and review licensing if that boundary changes.

See [architecture and operator guide](N8N-PUBLISHING.md) and [official account setup](DIRECT-SOCIAL-SETUP.md).

## Signed-in workspace verification

Verified that ReelReadyPublisherV1 belongs to the local n8n personal workspace and is published. The current no-save execution setting left historical rows marked running despite worker responses. Success history now retains only the safe operational acknowledgement; prior rows are preserved. This change is local self-hosting, not an n8n Cloud deployment.

After re-publication, a new scheduled execution was verified as success/finished and the ReelReady health endpoint reported n8n online. All 62 backend tests passed again. A raw database/WAL scan found no plaintext bridge secret. Historical execution records were preserved.
