# Accurate captions and recovered connections

Local implementation and verification, 24 October 2026. No deployment, hosted database changes, real social posts or OAuth approvals.

## Changes

- Removed silent sample fallback from production planning, recording review, publishing kits and caption revisions. Missing credentials or provider/validation failure now returns a useful error without replacing saved captions. Labelled fixtures require explicit opt-in.
- Regenerated the existing OpenArt reel's summary and English kit with real Gemini video analysis and text generation. Saved with a compare-and-swap check so concurrent edits were not overwritten.
- Video analysis follows the exact selected original or approved English render. The analysis records its source path, stale tokens are not reused, old placeholder output is quarantined, and captions for a different selected file cannot pass real preflight. Suggested narration is not presented to the caption writer as approved recorded speech. A new source does not inherit older caption facts.
- Summary and kit are applied together after both requests succeed. Failed regeneration keeps the previous kit. “Analyze my recording again” is available in Review.
- With explicit user approval, transferred the existing Instagram-connected provider profile to the current reel workspace in a locked local transaction. The old workspace and every reel were preserved; the old workspace lost access to this profile. No remote profile was created or deleted.
- Verified the real Instagram account identity and official Google/X authorization starts. YouTube and X are not connected until the user approves their official screens. Other new workspaces remain subject to the two-profile account capacity.
- n8n now obtains a short-lived approved-media ticket and privately streams the owned file through the worker. The workflow posts multipart video bytes plus separate captions and descriptions. Local storage no longer needs a publicly accessible URL in this managed path. Native/legacy URL integrations retain their existing URL checks.
- Private streaming rechecks ticket scope/expiry, owner, job/media IDs, active commit lease and unchanged audio approval. Existing dispatch replay protection and uncertain-commit handling are preserved. No automatic resend after an uncertain upload.
- Fixed original-audio continuation after a speech quota error: it explicitly chooses the original file rather than depending on React update timing.

## Configuration

- `ALLOW_SAMPLE_OUTPUT=false` by default. Only isolated tests explicitly enable fixture output; it is separate from the `DEMO_MODE` sending safeguard.
- `PUBLISH_MEDIA_TRANSPORT=binary` by default for managed n8n publishing. `url` is retained for legacy matching workflows requiring public signed HTTPS storage.
- n8n Docker uses filesystem binary mode on its existing persistent volume. The worker and n8n must be able to reach each other privately. Credentials remain server-only/encrypted.
- Existing default example `DEMO_MODE=true` is unchanged. The user's explicit local real-mode setting remains in place. No PIN or visible login was added.

## Verification

- Unit/backend: 80 passed. Media/FFmpeg: 12 passed. Browser: 15 passed, including real-mode mocked publishing, generation failure preserving captions, original-audio quota recovery, multilingual editing and the offline six-step flow. 107 automated tests total.
- Actual local n8n publishing workflow passed authentication, one-use authorization, exact multipart video bytes, platform-specific copy, async response and duplicate rejection against local mocks.
- Actual local n8n account workflow passed existing/new profile, all three official-link mappings, canonical ownership, capacity rejection and replay tests against local mocks.
- Live current-reel analysis and caption generation succeeded. Real connection inspection confirmed Instagram; YouTube/X official authorization starts succeeded without approving them.
- Lint, typecheck and production build passed. Environment check and health report live generation/speech, online worker/n8n and configured real publishing without printing credentials.
- Desktop/390px inspection: corrected reel captions, explicit connection states, no horizontal overflow. Strict UI audit: no findings. Production client and check-log scan: no server secrets or publishing vendor name in client chunks.

## Remaining user action

Refresh the local app and approve **Connect YouTube** and **Connect X** in Publish. The app cannot authorize those accounts on the creator's behalf. No end-to-end real post was made; actual provider acceptance and public visibility remain unverified until a separately authorized post. New creators require available provider profile capacity. The hosted site is unchanged.
