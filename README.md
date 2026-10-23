# ReelReady

A public creator workflow: plan a reel, record/upload it, review and revise an English voiceover, generate multilingual platform captions, then publish or schedule through Upload-Post. No ReelReady login.

## Local setup

Use Node 22.13+. `npm install`, copy `.env.example` to ignored `.env.local`, and configure server secrets without putting them in chat or public variables. Launch with `node --env-file=.env.local scripts/run-framework.mjs dev --port 3000` and open http://127.0.0.1:3000.

- `GEMINI_API_KEY`: structured planning, video understanding and English speech.
- `GEMINI_MODEL`: defaults to `gemini-3.1-flash-lite`.
- English speech uses `gemini-2.5-flash-preview-tts`.
- `UPLOAD_POST_API_KEY`: social account linking, publishing, scheduling and delivery status. The chat plugin’s credentials are separate from the website’s server environment.
- `SESSION_SECRET`: optional independent HMAC secret; otherwise domain-separated signing uses the Gemini server key. Rotating this key invalidates anonymous session/file/delivery capabilities.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`: private video storage and Postgres draft persistence through `@supabase/server`. The secret stays on the server. Apply `supabase/migrations/20261023_reelready_drafts.sql`; uploads use the private `reelready-videos` bucket. `SUPABASE_JWKS_URL` is retained for future Supabase identity verification; this app uses its signed anonymous cookie and requires no Supabase login.

Production secrets must also be configured through Sites. No credentials enter browser code or Git. When a service is unconfigured the UI says so; it never pretends a generation or publication happened.

## Creator flow

1. Dictate a topic with the installed Wispr Flow, choose a future local publishing time, destinations, caption languages and native/Roman script. Optional caption examples, brand, link and CTA/disclosure help match the creator’s voice.
2. Choose one of three ideas. Review its hook, outline, shots and estimated timing. Film the reel, then upload, drop or paste the actual video file.
3. The recording is streamed to Gemini Files for understanding. Review its transcript, observed facts and English voiceover. Dictate revisions in any language. Create the English video using generated speech and browser-side FFmpeg. The standard English voice replaces all audio, including music; no voice cloning or lip-sync. Visual edits need a video editor.
4. Review and edit the platform kit. English is always available; Telugu/Hindi captions can be generated in native or Roman script. One selected caption language is used for each publishing operation. Captions have individual/all copy and character counts.
5. Connect the creator’s own social accounts through Upload-Post’s hosted authorization. Review original versus English video, exact text and schedule. One button sends to all checked connected destinations. Real receipts distinguish scheduled, processing, published, failed and skipped. Delivery can be checked again after a reload.

No promises about virality or best posting times. The chosen schedule, planned duration and preparation effort are displayed; effort is an estimate. Video duration, size and dimensions are measured from the actual file. YouTube uploads are public, square/vertical and ≤3 minutes; X in this version is ≤140 seconds and 280 weighted text characters. Platform/provider account policies can impose additional restrictions.

## Storage and privacy

Text/profile preferences are cached in localStorage and saved to the private `reelready_drafts` Postgres table. Original and generated English videos use private Supabase Storage objects. Videos upload directly from the browser with signed, resumable TUS uploads in 6 MB chunks; the server does not buffer the entire video. Re-select the same file after an interrupted transfer to resume it. The app and bucket impose no video file-size cap; Supabase project/plan limits, Gemini processing limits, browser memory and destination platform rules still apply. A live 81 MB upload declaration was accepted by ReelReady but rejected by this project's current Supabase limit; raise that limit in Supabase Storage settings for larger files.

Draft recovery belongs to the same signed anonymous browser session. Clearing localStorage while keeping cookies restores the cloud draft and signed video previews; clearing cookies loses access. This is not cross-device account history. Local IndexedDB is used only as a fallback when cloud storage is unconfigured. Important exports should still be downloaded. Service-role access is restricted to server-verified visitor IDs and video capabilities. The database has RLS enabled with no anonymous/authenticated direct access grants; the bucket is private.

The server streams uploads without buffering full video files in the Worker. Original analysis copies live in Gemini Files, expire within 48 hours, and are deleted on replacement/reset when possible. Uploaded content and creator details are processed by Google; publishing sends the approved video/text to Upload-Post and the selected platforms. Browser FFmpeg downloads ~31 MB of self-hosted tools only when English export is requested. WASM is split into two static assets to stay under per-asset hosting limits.

Social connections belong to a signed, HttpOnly anonymous browser session. The server derives a separate Upload-Post profile for that session. It never lists all owner profiles to visitors. Clearing cookies loses access to the connection from this browser; revoke/manage permissions through the platform or Upload-Post if needed. No app session can use another visitor’s file or delivery handle. Connect actions are rate limited; upstream subscription profile limits still apply.

Publishing uses a signed immutable preparation token and a stable provider idempotency key. A recovery handle is saved before upload starts; uncertain delivery must be checked before retrying. Stored videos are sent to Upload-Post using a signed read URL valid through the chosen schedule plus two days, avoiding a second large browser upload. New reels do not cancel already accepted schedules; their storage objects are retained. This version does not implement cancellation of provider schedules inside the app; use Upload-Post to manage them.

## Verification

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:e2e` (installed Chrome on macOS in playwright.config.ts)
- `RUN_LIVE_TESTS=1 npx playwright test tests/live.spec.ts` exercises real planning, streamed video upload/analysis, multilingual kit and WAV speech; deletes the test analysis file.
- `RUN_LIVE_TESTS=1 node --env-file=.env.local node_modules/@playwright/test/cli.js test tests/storage-live.spec.ts` verifies real signed resumable Supabase upload, private visitor isolation, Postgres draft recovery and Google analysis from the stored recording; cleans up its objects and draft.
- `npm run build`

Browser tests use real local video files and actual FFmpeg WASM export; social posting is mocked so verification never publishes test content to a real account. Real publishing/account authorization remains unverified until the owner configures Upload-Post and connects a test destination. The public API uses per-instance request limits; sustained public traffic requires durable edge limits and provider budgets.

Self-hosted FFmpeg sources are vendored from @ffmpeg/ffmpeg 0.12.15 and @ffmpeg/core 0.12.10, including upstream license notices under public/ffmpeg. The core is an upstream GPL build; consult its source/license links before redistributing modified binaries.
