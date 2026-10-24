# ReelReady workspace and direct integrations — local implementation report

Source: the full UI/UX brief and the user's explicit choice to include the direct platform migration. The separate request removing the publishing PIN remains in force. No deployment, live OAuth consent or real social posts were performed.

## 1. UI changes

- Shared white navigation rail, breadcrumb bar, compact project heading and restrained lavender surfaces replace the oversized introductory studio layout.
- All reels, Accounts and Preferences use the same shell. The 390px menu is keyboard accessible, closes with Escape and restores focus.
- Dashboard cards include actual saved state, source previews when present, step completion, last update, search and clear-search, rename, duplicate idea, archive and restore.
- Empty/loading/error/saving states remain actionable. A failed cloud save preserves the browser draft and offers Retry saving.
- Six existing steps are retained. Completion follows saved plans, uploaded assets, audio approval, valid kits and actual receipts; visiting a later step does not complete earlier ones.
- Existing self-hosted typography, multilingual rendering, ordinary dictation-friendly textareas, focus styling, reduced-motion support and native confirmation dialogs remain.

## 2. End-to-end features

- Plan inputs, structured three-idea generation/fallbacks, recording checklists, actual private uploads and the project-owned sample video remain connected.
- Filming notes are now visible in Record and persist with the reel.
- Preferences persist in Supabase and seed new reels. An old reel autosave can no longer overwrite creator defaults.
- New/sample projects keep a stable reel ID during initial planning, avoiding orphaned initial records.
- Original-audio approval remains available without the worker or speech provider. Speech failures retain the script/source and expose an explicit original-audio continuation.
- Each publishing-kit output has a scoped rewrite action; unrelated manual outputs are copied back exactly. Character/link validation appears beside the editor.
- Rename/archive survive stale autosave snapshots. Concurrent management changes reject stale timestamps. Archive is reversible and keeps sources/accepted schedules. Duplication intentionally copies the creator idea/details into a fresh project without copying media capabilities or publishing jobs.

## 3. Issues found and fixed

- Initial generation could replace a new reel ID after its first save.
- Record lacked a visible filming-note field.
- Progress was inferred from the clicked step rather than completed work.
- Old project autosaves could overwrite shared creator preferences.
- Dashboard status could lag behind background publication; listing now reads current job/target receipts.
- Shared-shell skip links and two low-contrast labels failed accessibility checks; corrected without disabling rules.
- Repeated mocked AI tests consumed the live local daily budget. Test-only transport scoping now exercises the real atomic limiter under isolated keys and removes only its own fixture counters. Production budget keys, the 500-call default and existing data are unchanged.
- Native queue admission/retry could expose partial state to another worker. Target checkpoints and admission are now transactional, with combined media/publication caps, renewable leases and ownership checks.
- Refresh rotation is serialized and cannot overwrite a newly reconnected account. Confirmed publication binds server-verified destination account IDs; reconnecting a different account cannot redirect a saved job.
- Confirmed failed, unpublished Instagram/X uploads receive fresh media on explicit retry. Existing successful IDs/receipts and uncertain final commits are never resent.

## 4. Direct social integrations

The runtime publishing intermediary was removed. Its legacy database rows and local key are preserved but unused.

Implemented against official endpoints:

- Google OAuth, PKCE, channel discovery, refresh, resumable YouTube transfer, real processing/privacy checks and receipt URL.
- Instagram Login, long-lived token exchange/refresh, professional identity checks, REELS container creation/polling, explicit publication and permalink lookup.
- X OAuth 2.0 PKCE, refresh rotation, user discovery, initialized/chunked/finalized video upload, processing checks, post creation and receipt lookup.
- Owner-bound ten-minute single-use OAuth state, encrypted PKCE verifier and encrypted grants/checkpoints. Ordinary database roles cannot read credential/state tables or execute queue RPCs.
- Disconnect attempts remote revocation and removes the owned grant; if revocation cannot be confirmed, the UI explains the remaining platform-settings action.
- Serverless requests only confirm/enqueue. A persistent worker performs platform uploads/polling. Scheduling is in ReelReady and depends on that worker. Final non-idempotent Instagram/X responses that cannot be confirmed require manual reconciliation.

Verified with isolated protocol mocks plus real local Supabase persistence, queue admission, ownership and encryption. Live consent, actual platform posting, app reviews, quota access and public visibility are **not verified**. Meta's documentation server rate-limited automated access; official Meta-owned collection/reference links are documented, and the live contract must be validated with eligible developer credentials.

## 5. Database and environment

Four additive migrations were applied **only to local Supabase**:

- `20261023185548_native_social_and_workspace.sql`: private grants/OAuth state; native queue/checkpoints.
- `20261023190447_native_queue_race_guards.sql`: transactional target visibility; token-refresh lease.
- `20261023192217_unified_worker_queue_admission.sql`: shared lock and combined media/publication limits.
- `20261023194950_atomic_native_failed_retry.sql`: transactional failed-only retry/checkpoint update.

Existing tables, assets, profiles and credentials were not reset or deleted. Security advisors found no warning/error findings.

New configuration: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `SOCIAL_TOKEN_ENCRYPTION_KEY`, and optional `INSTAGRAM_API_VERSION=v24.0`. A stable local encryption key was generated securely; no secret was displayed or committed. Official app credentials are currently absent. Existing Supabase, upload/text limits, budgets, retention, worker and demo controls are preserved. No PIN is required. See `.env.example` and `DIRECT-SOCIAL-SETUP.md`.

## 6. Verification

- Lint: passed.
- Typecheck: passed.
- Unit/backend: **55 passed**, including OAuth callbacks, tamper/replay/owner isolation, refresh rotation/races, revocation, direct media adapters, uncertainty, expired-media retry, account binding, quota/queue guards, reel actions, preferences and selective caption preservation.
- Native media suite: **8 passed**; actual FFmpeg/FFprobe fixtures, source safety, uploaded narration, timing and rendered streams.
- Browser suite: **14 passed**. Includes the complete worker-offline 390px Plan → Publish demo, real private uploads/native renders, multilingual editing, menu focus, missing setup/callback forgery, reel management, persistent preferences, and PIN-free final confirmation with mocked live delivery. Desktop/mobile accessibility checks pass.
- Production build: passed with the final implementation.
- Strict premium UI audit: no findings. Local database security advisors: no warnings/errors.
- `check:env -- --local` works without secrets and correctly reports all three official app configurations missing. This is an expected setup failure, not a fabricated live connection.

## 7. Remaining configuration and limits

- Add the official Google, Instagram and X application credentials and complete required platform consent/review manually. The former intermediary API key does not configure native APIs.
- Use public HTTPS callbacks/media where the platform requires them. The current deployment was not changed; local URLs cannot serve Instagram's remote media fetch.
- A separate long-lived worker is required for production processing and scheduled publishing; Vercel alone does not run that process. No host was provisioned.
- The live local daily AI counter was exhausted by earlier shared-budget tests. It has not been reset and the spending limit was not raised; it resets automatically at UTC midnight. Future tests are isolated. Google speech quota/billing may separately refuse requests. Scripts/originals remain available; no synthetic placeholder is substituted. See the speech guidance in DIRECT-SOCIAL-SETUP.md.
- Optional burned-in subtitle controls, automated visual editing, voice cloning and lip sync are not added. Long narration retains the existing explicit timing/shortening controls rather than silently truncating audio.
- Private/uncertain upstream results require the visible recovery/manual visibility checks; they are not labelled Published.

## 8. Local use

The local app is at `http://127.0.0.1:3000/`. Use Node 22 with local Supabase running. Start `npm run dev:all`, or run `npm run dev` and `npm run worker` in separate terminals. Avoid starting a second process on an occupied port.

Start a reel or choose the sample, plan it, record externally, upload, approve the original soundtrack or process narration, edit the publishing kit, then review accounts and confirmation. Native connection setup is documented in DIRECT-SOCIAL-SETUP.md. No visible ReelReady account or PIN is required. The public hosted website is unchanged. All **77 tests** passed (55 backend + 8 media + 14 browser).
