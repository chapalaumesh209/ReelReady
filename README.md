# ReelReady

**Current publishing path:** ReelReady → authenticated n8n webhooks → managed publishing provider. See [managed n8n setup](docs/MANAGED-N8N-PUBLISHING.md). The direct-platform implementation described below is retained for explicit native mode and historical jobs.

Two main n8n workflows are connected to the app: **connect creator accounts** and **publish the approved video/captions**. See [the two-flow guide](docs/N8N-TWO-FLOWS.md). Test the actual account workflow safely with `npm run verify:n8n:connect`.

**Speak in your language. Reach the world.**

A no-signup creator workspace: **Plan → Record → Upload → Audio & Voice → Review → Publish**. This iteration is local only. The existing hosted Site and its Supabase configuration have not been deployed or changed.

## Start locally

Prerequisites: Node **22.13+**, npm, Docker Desktop running, native FFmpeg/FFprobe on PATH, and Chrome for the browser tests. The checked-in Supabase configuration is for a separate local Docker stack, not the hosted project.

```sh
npm install
npm run setup:local
npm run n8n:setup
npm run dev:all
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). `setup:local` starts local Supabase, applies additive local migrations and securely writes ignored `.env.development.local` and `.env.test.local` overrides. The existing `.env.local` is preserved. The override uses `DEMO_MODE=true`, local Supabase, and `LLM_PROVIDER=demo`. Real planning, video analysis and captions require server-side AI credentials. `ALLOW_SAMPLE_OUTPUT=false` is the default: unavailable services return clear errors while preserving drafts. Automated offline fixtures explicitly opt into labelled samples; demo publishing remains a separate sending safeguard. Anonymous Auth must be available; there is no insecure identity fallback or login screen.

`npm run dev` uses native Next.js App Router. Optional `dev:sites`, `build:sites` and `start:sites` retain the previous Vinext/Cloudflare tooling separately. Do not deploy those commands as a substitute for the requested Vercel runtime.

## Try the workflow

1. Open a food or garden sample, or start a new reel. Dictate/type an idea. English captions stay enabled; add Telugu, Hindi or Tamil, choose native/Roman script, and select platforms. The default publishing time is tomorrow **7 PM Asia/Kolkata**, stored as an explicit UTC instant.
2. Generate three ideas. Choose one, review the suggested timing and language plan, then tick recording beats/shots. Suggestions are general guidance, never your analytics.
3. Select **I’ve recorded it**. Choose, drop or paste a video file. Actual browser metadata drives dimension/duration warnings. Uploads go directly to private Supabase Storage with signed, resumable TUS transfers. Replacing a video commits only after its upload succeeds, preserving the previous recording on failure.
4. Open **Audio & Voice**. Inspect actual streams, then keep the original or choose mute, replace, mix or narration for silent video. Type/dictate/paste a script, transcribe, upload/record narration or request a video-grounded suggestion. Review language, voice, measured segments and timing, then explicitly approve/render the selected version.
5. Review the selected video and platform kit. Dictate caption changes in any language; current manual edits remain the starting point. Switch caption language/script and copy outputs.
6. Review the exact approved media, platform captions, account choices and timing. Click Publish/Schedule, then explicitly confirm the listed destinations. Demo receipts say **“Demo mode: nothing was posted.”**

Wispr Flow is an external installed dictation app. It is not embedded and has no invented SDK integration. All editable copy uses ordinary textareas, with voice hints. The idea field supports Enter to generate, Shift+Enter for a newline and IME-safe composition. Voice Tips cover language selection, dictionary words, snippets and supported command rewriting. Noto Sans fonts are self-hosted for Telugu, Devanagari and Tamil.

## AI and media

Text generation uses the common server-only helper in `lib/generation.ts`. `LLM_PROVIDER`, `LLM_API_KEY` and `LLM_MODEL` support `gemini`, `openai` and `anthropic`; compatible provider-specific key names are accepted. The existing Gemini adapter remains for video understanding; Gemini Interactions provides multilingual transcription and speech. Explicit narration translation can use the configured Gemini key even while planning/caption templates remain in demo mode. Structured responses use JSON schemas plus Zod validation and one bounded repair attempt. Missing text credentials in demo mode produce visibly labelled deterministic templates. Templates do not pretend to analyze or transcribe the uploaded video.

Without a video-analysis key, a configured text provider can draft from creator-supplied plans/filming notes, explicitly labelled as untranscribed notes. Speech synthesis requires `GEMINI_API_KEY`. The native media worker measures generated audio and renders the explicitly selected original-audio treatment to a separate verified MP4. Keep, mute and uploaded-narration workflows work without synthesis. Source separation, voice cloning, lip sync and visual editing are not claimed. The former browser FFmpeg helper remains as compatibility code; the normal studio no longer downloads/renders through WASM.

Public-link defaults are 200 MB and 90 seconds, configurable through MAX_UPLOAD_MB and MAX_VIDEO_SECONDS and enforced before upload and on registration. Storage infrastructure and destination constraints also apply. This local pass changes no hosted storage configuration. Real Instagram requires verified MP4/H.264/AAC 9:16 video lasting 5–90 seconds. YouTube visibility is checked after upload, and X text is limited to 280 weighted characters with no links.

## Auth, storage and durable data

Supabase anonymous sign-in creates a real Auth user, verified on the server with `getUser`. SSR cookies are HttpOnly, SameSite=Lax and Secure over HTTPS, with refresh cookies returned from API handlers. No submitted user/profile ID is used as authorization. Anonymous workspaces belong to the current browser; clearing cookies loses access. A future permanent identity can be linked to the same Supabase user.

The database is the source of truth for reels, creator preferences, media metadata, publishing profiles, connection caches, jobs, targets and attempt history. Browser storage is only a temporary text cache. Reopening a saved reel reads its owned database record and private signed media URLs. Legacy `reelready_drafts` and its original data remain untouched; they are not reassigned to a new Auth identity. Legacy text can be re-entered, and old recordings may need re-uploading under the new session.

Version-controlled additive migrations:

- `supabase/migrations/20261023_reelready_drafts.sql`: previous private draft table, retained.
- `supabase/migrations/20261023114830_complete_creator_workflow.sql`: new Auth-owned entities, indexes, constraints, RLS and durable limits.
- `supabase/migrations/20261023115709_workflow_guards.sql`: compatible guard completion for an initialized local stack.
- `supabase/migrations/20261023122357_atomic_publication_prepare.sql`: atomic job/target preparation and one unresolved job per reel/mode.

Every user-owned table has RLS. Reels/preferences permit ownership-checked writes. Profiles, connections, media, jobs, targets and attempts are read-only to their owner through the Data API; writes use narrowly scoped server services after session/ownership checks. This prevents a client from replacing a provider job ID or profile mapping. Rate counters have no public access; their atomic `SECURITY INVOKER` RPC is executable only by `service_role`.

The `reelready-videos` bucket is private. The server issues path-scoped upload signatures only for a verified owner/reel and validates the completed byte count. Completed files retain bucket/path/size/type/metadata. Read capabilities are owner-bound; the service key stays on the server. Incomplete transfers can resume by re-selecting the same file. Accepted schedules retain their video objects; this app does not cancel provider schedules when opening a new reel.

## Direct account connections and publishing

The runtime talks directly to Google/YouTube, Instagram and X. No publishing intermediary or legacy profile mapping is used. Each platform shows Not configured until its official developer app credentials and the encryption key are present. OAuth uses owner-bound, ten-minute single-use state, plus PKCE S256 for Google and X. AES-256-GCM encrypted tokens are bound to owner/platform; ordinary database clients cannot read credential or OAuth-state tables. Connected means the platform's real identity endpoint has verified the owned account.

After preflight and final confirmation, publication is enqueued durably. The long-lived worker owns resumable YouTube uploads, Instagram container processing/publication and X chunked media upload/post creation. Encrypted checkpoints survive restarts. Scheduled jobs wait for the exact UTC instant in ReelReady and require the worker to be online. Returned IDs and platform verification are required before Published; private YouTube uploads are not reported public. Failed-only retry preserves successful receipts. Ambiguous final Instagram/X responses stop automatic resend and require manual reconciliation. A page load never sends or retries a publication.

Self-hosted n8n now controls publication execution when `PUBLISH_EXECUTOR=n8n`. Its fixed five-second schedule calls a secret-authenticated private worker bridge, which claims only approved due jobs. n8n never receives social tokens, video files or Supabase service credentials. The autonomous publishing loop is disabled in this mode. See [n8n setup and architecture](docs/N8N-PUBLISHING.md). This removes a hosted publishing intermediary, not the platforms' authorization, quotas or costs. Existing installations without an executor setting retain native execution for compatibility.

See [direct integration setup](docs/DIRECT-SOCIAL-SETUP.md) and [manual visibility checklist](docs/REAL-PUBLISH-CHECKLIST.md). No real social consent or posts were performed during implementation.

## Environment configuration

See `.env.example` for names and aliases; it contains no secrets.

- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: project access. Only publishable values may be public.
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`: server-only private storage signatures, protected metadata/mappings/jobs and the limiter RPC.
- `SESSION_SECRET`: server-only HMAC key for media capabilities. Local setup generates one and preserves it on repeat runs. Rotation invalidates previous media handles.
- `APP_URL`: canonical application origin, including local port. Used for CSRF checks and OAuth redirects.
- `DEMO_MODE`: defaults to `true`. **Only the exact value `false` enables the real-publishing path.** This is the server-side kill switch.
- `PUBLISH_EXECUTOR`: `n8n` for the self-hosted coordinator; `native` for an explicit rollback. `N8N_PUBLISHER_SECRET` secures the private worker control plane; `N8N_PUBLISHER_HOST/PORT` default to `127.0.0.1:3010`.
- `SOCIAL_TOKEN_ENCRYPTION_KEY`: stable base64 encoding of 32 random bytes shared by server and worker.
- `GOOGLE_CLIENT_ID/SECRET`, `INSTAGRAM_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET`: official app credentials. `INSTAGRAM_API_VERSION` defaults to `v24.0`.
- `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`: optional text generation. `demo` forces deterministic templates. `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` aliases are supported as appropriate.
- `GEMINI_API_KEY`, `GEMINI_MODEL`: optional actual media analysis and multilingual speech. Worker analysis copies are deleted after each task; Google file expiry is a fallback.
- `SUPABASE_JWKS_URL`: optional project reference; session verification uses Auth `getUser` rather than trusting a client JWT decode.

No shared publishing PIN is used as authentication.

## Verification

With the dev server and local Supabase running:

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:media
npm run test:e2e
npm run build
```

Backend tests verify the real local Supabase Auth/RLS/storage/repository plus mocked external AI/publishing calls. Browser tests exercise actual private uploads, native metadata, refresh recovery, manual-caption preservation, real FFmpeg export with a fixture WAV, responsive/accessibility checks, account callbacks, failed replacements and confirmation-gated demo publication. No test posts to a real social account. The local tests refuse a non-local Supabase target.

## Retained native publication prerequisites

Register official developer apps and configure their exact callbacks, scopes, test users and required production access/reviews. The old intermediary key does not configure these integrations. Use public HTTPS application/storage URLs for production OAuth and Instagram fetches, and a long-lived worker with the same Supabase project and encryption key. Real publishing requires exact `DEMO_MODE=false`, owned verified accounts, passing preflight and final confirmation. No publishing PIN is used. Missing credentials remain a visible not-configured state. No automatic deployment occurs.

## Vercel readiness — not deployed

1. Create/select a Vercel project pointing to this directory, framework **Next.js**, Node 22+, install `npm ci`, build `npm run build`.
2. Configure a separate hosted Supabase project (anonymous sign-ins enabled) and apply the versioned migrations without resetting any existing project. The existing legacy table is retained. Configure its private storage bucket and the required server-only environment variables in Vercel.
3. Set `APP_URL` to the exact Vercel/custom-domain origin and leave `DEMO_MODE=true` initially. Public browser keys are build-time variables; service/provider keys remain server-only.
4. Run `npm run worker` in a separate FFmpeg-capable container/VM with private Supabase access, RAM and temporary disk suitable for media. Vercel request handlers only enqueue/query jobs. Configure AI keys for desired live features; retain the no-visible-signup experience.
5. Connect a test social account and verify real delivery only after deliberately disabling demo mode and manually confirming a test post.

No Vercel deployment, Sites deployment, hosted schema migration or production environment update was performed for this brief.

## Audio & Voice worker (23 October extension)

The local workflow now includes **Audio & Voice** between Upload and Review. Native FFprobe inspects actual media, and a durable Supabase worker renders keep/mute/replace/mix/add-narration treatments. The original remains separate. Typed/dictated scripts, uploaded or recorded voice notes, optional transcription/translation/video-grounded suggestions, a documented voice catalogue, explicit previews and measured segment timelines lead to a verified final video. Publishing requires that exact approved asset.

Install native FFmpeg and FFprobe (`brew install ffmpeg` on macOS), then run `npm run dev:all` with Node 22.13+ and local Supabase running. If Next.js is already running, use `npm run worker` in a second terminal. The worker processes one job at a time outside Next.js requests. `npm run test:media` exercises real native media plus mocked speech providers against local Supabase.

See [AUDIO-VOICE-IMPLEMENTATION.md](./AUDIO-VOICE-IMPLEMENTATION.md) for the additive migration, private storage/security design, duration decisions, provider limitations, startup and separate-worker deployment requirements. Do not deploy automatically. Existing public hosting is unchanged.

## Professional caption writing

In Review, **Add my details** now accepts an optional audience, exact featured place, desired viewer action and relevant search terms. Generate or regenerate captions to write platform-specific hooks, useful video-grounded copy, natural search phrases, focused hashtags and a goal-led CTA. The configured text AI is used; when planning remains in demo mode but Gemini is configured, an explicit professional caption-generation action can use that Gemini connection. Publishing remains simulated unless its separate kill switch is disabled.

Generated copy gets a separate AI grounding review against the supplied video description, creator facts and current manual edits. Unsupported additions trigger one editorial rewrite; persistent issues return a recoverable error. This is an extra review aid, not a factual accuracy guarantee. Search-phrase notes explain the proposed keyword and local context; editing a caption clears those notes until regeneration so they cannot imply stale keyword placement. No live trend feed, search-volume figures, ranking scores or guaranteed virality are fabricated.

The editorial hashtag budgets are product choices: at most five Instagram tags, three YouTube-description tags and two X tags, including supplied disclosures. Titles remain hashtag-free. These are not claims about universal platform limits. Official [YouTube search guidance](https://support.google.com/youtube/answer/141805?hl=en) favors relevant titles/descriptions matching the actual video, and [YouTube hashtag guidance](https://support.google.com/youtube/answer/6390658?hl=en) cautions against unrelated tags and over-tagging.

## Workspace UI

Shared responsive navigation links All reels, Accounts and Preferences. Dashboard cards show real saved progress and receipts; actions include search, rename, safe idea duplication and reversible archive. Duplication starts fresh and never copies media capabilities or publishing jobs. Archive keeps assets and existing schedules. Creator preferences are saved explicitly and inherited by new reels; old autosaves cannot overwrite them. Completion follows saved data, not the clicked step. Individual caption rewrites preserve unrelated manual fields.

See `docs/OVERHAUL-REPORT.md` for implementation and verification details. Start locally with `npm run dev:all` after local Supabase is running, or use `npm run dev` and `npm run worker` in separate terminals. Unit files run sequentially because global quota/queue boundary tests share the local database; assertions remain intact.
