# Instagram asynchronous delivery correction

24 October 2026. Local application fix; no deployment, account changes, new social post, deletion or repost was performed by this debugging pass.

## Cause and recovery

The stored n8n response for the original request reported top-level `status: processing`, Instagram `{status: processing, success: false}`, and YouTube `{status: completed, success: true}`. ReelReady incorrectly treated `success: false` as a permanent Instagram failure and stopped polling. Instagram completed that request shortly afterward.

The earlier retry also completed, leaving two Instagram posts. Both were confirmed through read-only provider status queries; neither was deleted. The saved current request was reconciled through the status-only n8n endpoint, and both current destinations now show Published with links. Its request ID and existing YouTube receipt were preserved. No video was sent during recovery.

## Fix

- Platform lifecycle states take precedence over the provisional success flag. Pending, queued, processing, in-progress and retryable/retrying results stay Processing; they do not offer a resend.
- A queued success flag without a public receipt or completion evidence is not marked Published.
- Permanent per-platform failure or a final aggregate failure remains actionable. Diagnostics map to fixed connection/allowance/media/rights guidance; raw upstream messages, tokens and internal URLs are not exposed.
- Check delivery can reconcile a previously failed managed receipt read-only. This uses an owner-bound compare-and-swap lease and the existing provider request marker, preventing concurrent reconciliation and retry.
- Retry always checks the existing request first. A late success returns its saved receipt without uploading. A status-read failure keeps the request Processing and resumes read-only polling; it cannot authorize a duplicate resend.
- Existing successful destinations and their URLs are preserved. Missing final results remain unconfirmed rather than invented successes.

No new environment variables, database migrations, package dependencies, or n8n workflow changes are required. Restart the worker to load the corrected parser.

## Verification

Unit/backend suite: 84 tests, including four new regression tests covering interim statuses, delayed Instagram completion with one upload, owner-isolated concurrent recovery, and retry suppression after late success or a failed status read. Production build, lint, typecheck and browser checks are recorded in `artifacts/delivery-receipts-*.log`.

Provider status documentation: https://docs.upload-post.com/api/upload-status

The original and earlier retry receipts were checked read-only. Creator-specific links and local diagnostic artifacts are excluded from this public repository.
