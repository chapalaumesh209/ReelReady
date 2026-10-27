# ReelReady interaction contract

One reel moves through Plan → Record → Upload → Review → Publish. A ReelReady account is never required. Social authorization is an explicit action at Publish.

| Capability | Canonical owner | Behavior | Verification |
| --- | --- | --- | --- |
| Text input | components/studio/index.tsx AutoTextarea | Labelled native textareas, local persistence, native multiline and IME behavior | keyboard, editable scripts and captions |
| Choice | Native checkboxes, radio and select in app/studio/page.tsx | Multiple destinations/languages; one idea, script style, video variant and final caption language | mobile and keyboard |
| Form lifecycle | app/studio/page.tsx run | One operation at a time; honest busy label; cancel non-publishing work; preserve draft on error | browser error and cancellation states |
| Upload | browser-media.ts, storage-upload.ts, /api/storage | Visible native file input, drop or pasted file; MIME fallback; cancellable metadata check; private signed resumable Supabase uploads with progress; 200 MB and 90 seconds by default, checked before transfer and on registration; project limits remain | real MediaRecorder upload, provider size rejection and visitor isolation |
| Plan | /api/plan | Three model-generated ideas; estimates explicitly identified; schedule is chosen by user; stale plan cannot advance | schema validation and browser |
| Video review | /api/video, /api/review | Stream upload to Gemini Files; signed visitor-bound file capability; actual video/audio understanding; revisions become English | live provider verification |
| English export | /api/voiceover, browser-media.ts | Gemini standard synthetic voice; browser FFmpeg H264/AAC MP4 export; original audio replaced, visuals retained; overly long audio rejected | live WAV, actual WASM export |
| Results | components/studio/index.tsx OutputEditor | Editable, copy per output/all, Unicode and X weighted counts, warnings; native/Roman script | multilingual API tests and browser |
| Persistence | localStorage, /api/reels, Supabase Storage | Text cached locally and saved in private Postgres; original and English video in private Storage; cloud restoration uses the same anonymous cookie, without accounts; IndexedDB fallback only if storage is unconfigured | real database recovery after clearing local cache, signed preview and visitor isolation |
| Identity | lib/server.ts | Verified Supabase anonymous Auth with HttpOnly SSR cookies; RLS owner predicates; independent profile mapping; no owner-global accounts shown | capability isolation tests |
| Connection | /api/connections | Branded /connect and direct official-platform OAuth; return rechecks actual provider state; disconnect individual accounts | contract mocks; live requires key |
| Publishing | /api/publish | Confirmed durable prepare/send job; one atomic claim; signed private media URL sent to provider; stable provider correlation/idempotency key; ownership-checked database history | mocked provider and UI |
| Delivery | lib/server/social/publishing.ts + worker.ts | Processing/scheduled/published/failed/skipped remain distinct; no skipped or queued success; per-platform receipt | unit tests and reload |
| Feedback | app/studio/page.tsx messages | Inline error role=alert, success/status role=status, sticky busy status; no fabricated outcomes | axe and browser |
| Responsive | app/globals.css | Six-step passive progress, stacked mobile controls, visible focus, reduced motion, no horizontal overflow | 390px and desktop |

A completed or uncertain publishing request locks the send action for that reel. Check delivery before taking any new action. Starting a new reel does not cancel an accepted schedule or remove a published post. Video file URLs are not accepted as arbitrary server fetch targets; paste means a copied file.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | Native labelled select | DESIGN.md | native | keyboard, mobile and axe |
| Date | Native datetime-local input | DESIGN.md | local date/time with explicit timezone | future-time validation and UTC provider fields |
| Form | Shared AutoTextarea and workflow form in app/studio/page.tsx | This contract | plan, record, review, publish | validation, errors, IME and persistence |
| Scrollbar | app/globals.css | DESIGN.md tokens | native themed | responsive browser check |
| Toast | Inline message region in app/studio/page.tsx | This contract | error, status | axe and preserved input |

/ opens directly into the current reel. WorkspaceShell owns only the logo/save header. InlineAccounts owns real authorization/disconnection at Publish; /connect safely returns to the same reel and verifies server state. /settings redirects to /. There is no dashboard or preferences navigation. Shared ConfirmDialog owns modal publish/disconnect confirmation, with initial safe focus, Escape and focus restoration. Replacing an upload preserves the prior recording until the new private upload completes. Demo publication never invokes live publish/schedule/retry operations and has separate simulated receipts. Account authorization/status is independently real when configured.

## Audio & Voice
Source: user’s attached 23 October 2026 AI Video Editing implementation brief; maintained details in AUDIO-VOICE-IMPLEMENTATION.md.

- Workflow: Plan → Record → Upload → Audio & Voice → Review → Publish. Existing saved indices migrate once.
- Controls: native select/range/number inputs; shared AutoTextarea for scripts and shared ConfirmDialog before speech generation/render. Keep original and Continue work without AI.
- Persistence: verified Supabase owner; server-only edit/job writes; original media preserved. Editing audio invalidates approval until the exact configuration is rendered/approved again.
- Async behavior: durable job identifier, named worker stages, bounded polling requests, explicit retry; worker restart never publishes. Reopening recovers active work and approved media.
- Errors: source and editable script remain available; no fake audio or fallback to a different publish asset. Long narration requests a duration decision.
- Privacy: external dictation remains external; only requested media AI calls send needed content, server keys stay private; separate publishing confirmation.
- Verification: tests/media.test.ts covers native codecs/duration/mixing, ownership and mocked speech; tests/studio.spec.ts covers six-step render/caption/publish, narrow layout, keyboard and accessibility.

## Professional publishing copy

Source: current user request for an agency-style digital marketing editor. Optional creator brief fields use shared CreatorDetails and ordinary dictation-friendly textareas. Generation adapts to platform, language, featured location, audience and desired action; relevant keywords and focused hashtags are validated without fabricated trend metrics. Separate AI factual review may request one rewrite. Existing captions stay intact on generation errors. Search notes are descriptive, not live trend evidence, and clear after manual caption changes. Real publishing consent and the publishing kill switch are unchanged. Verification: tests/captions.test.ts and the extended review browser flow.

## Public judging hardening

Default original audio approval is worker-independent and cancels pending processing safely. Three-minute queued jobs expose original continuation and cancellation. A missing worker disables only processing actions; sources remain private and intact. Sample output badges identify fallback writing; the provider budget and owner/IP/queue limits fail with recovery guidance. The complete sample reel works without Wispr, a provider key, a worker or connected social accounts in demo mode. Native disclosures keep advanced audio and preflight warnings secondary. Real sends require explicit final confirmation, verified owned connections and a fresh public signed URL. No publishing PIN is required (current user request). Sample/new URLs become stable saved-reel links after autosave. Offline browser coverage includes 390px, Enter/Shift+Enter, Telugu/Hindi round-trip, queued cancellation and demo publishing.

## Production connections

Current user request removes simulated social connections. /connect uses real OAuth regardless of DEMO_MODE. Server account status ignores all legacy simulated cache rows, verifies identity and token state from the publishing service, and isolates each visitor’s profile. Missing credentials fail explicitly; no local fallback creates connected accounts. DEMO_MODE remains an independent publishing safeguard. Local development explicitly selects real publishing with preflight and final confirmation required; test instances explicitly retain demo sends. Callback query parameters are informational only and never update account authorization.

## Native integration and workspace overhaul

Source: 24 October full-overhaul brief and explicit user answer selecting direct integrations. WorkspaceShell owns sidebar, breadcrumb and narrow-screen navigation; existing AutoTextarea, ConfirmDialog and inline feedback remain canonical. Dashboard management routes persist rename and reversible archive with concurrent-update protection; safe duplication copies creator input but never source-media capabilities or publication jobs. Preferences save explicitly; old autosaves cannot overwrite them. WorkflowProgress checks actual data, rather than visited step numbers. Publishing-kit output rewrites target one field and preserve other manual edits.

Only official Google/YouTube, Instagram Login and X adapters are in the runtime. OAuth callbacks use expiring single-use owner-bound state, S256 PKCE where supported and encrypted credential storage. The queue atomically enforces combined media/publication admission caps, and a persistent worker owns uploads/status checks. Real publication retains final confirmation and preflight; no PIN is used. Legacy receipts remain readable but cannot be blindly resent. Missing official app credentials are shown as Not configured, never simulated Connected. See docs/DIRECT-SOCIAL-SETUP.md for exact configuration and manual-only live verification.

## Canonical single-flow experience (latest request, 24 October)

This decision supersedes older workspace navigation sections. One active task at a time, one primary action and Back controls preserve the six saved stage indices. Optional choices use native details; only visible fields receive autofocus. The saved browser draft resumes on /, its server-owned ID stays in the URL, and cloud state is authoritative after hydration. New reels do not delete existing media or cancel scheduled posts.

- Navigation: WorkspaceShell, no links to dashboard/settings/account pages. Old deep links remain compatible.
- Accounts: components/studio/inline-accounts.tsx consumes server-verified Connections, flushes current draft before OAuth and saves a same-origin return reference. Query status is informational, never authorization. Safe disconnect uses ConfirmDialog.
- Plan: one idea box plus destinations. Schedule/language and creator brief closed by default; once ideas exist the source brief collapses. Recording keeps the selected outline/shot checklist without duplicating them on the idea picker.
- Review: one caption-language select, editable outputs, optional change request and factual strategy. Each requested platform remains reviewable before final consent.
- Feedback and recovery: existing inline live regions, worker-offline original path, upload recovery, durable job receipts and final publish consent are preserved.
- Verification: updated studio/offline browser suites cover root entry, route compatibility, inline OAuth return, safe cancellation, browser resume, multilingual editing, full publish and mobile accessibility.

## Focused Audio & Voice (supersedes advanced-console UI)

AudioEditor owns two initial choices: original (default, worker independent) and English voiceover. English requests use the existing durable `/api/media/english` orchestration after an explicit Create action. One optional words field accepts any language; blank input uses video speech when transcription is available. The worker translates, narrates and mixes using safe existing preset defaults. Preview the completed video, optionally revise the words, then Continue. Provider failures preserve words and original continuation. A queued job can be cancelled and a job older than three minutes offers original continuation. No new routes, global stages, database schema or hosted changes.

Autosaves are serialized; edited words invalidate approval. Sources and existing renders are retained. Existing approved custom renders remain selectable without restoring their mixing console. The UI removes recording/uploaded-narration tools, manual classification, source/voice/style/pace selectors, mix/duck/fade sliders, timing segments and separate generate/render/confirmation controls. Backend audio APIs and media tests remain for compatibility and data recovery. Ordinary textareas, live regions, labelled sound-choice buttons, preview controls and the existing primary/Back pattern stay canonical.

The voiceover path replaces the choice list with its words box, then replaces the box with the finished preview. It does not stack all three tasks. Original-video preview is optional; normal background inspection does not interrupt original continuation. Restoring an existing approved render opens its finished preview directly, with no new paid operation.

Sound choices are native buttons because English opens the next part of the task immediately. Keep original carries the selected state; ordinary keyboard activation applies, with no disappearing radio input.

## Full-video English narration and voice preferences

The latest request supersedes the fixed-voice/short-note translation behavior. Settings use optional additions inside the existing owned JSONB settings field, retaining legacy edit hashes. Creator changes are separate from original transcription and generated English narration. First generation transcribes actual original audio where intelligible, analyzes the real video, then combines those sources with creator changes into timed English sections over the measured duration. Excess detail is condensed; unsupported facts are never requested as filler. Voice-only changes retain the prepared script and cached original transcript.

Three native selects persist voice presentation, verified regional accent and delivery. A server-side catalog lookup selects prebuilt voices from provider metadata; no gender inference from the person on screen, cloned voice or prompt-only accent claims. Delivery is a speech-style instruction. Changes invalidate approval and regenerate only after explicit Create. The finished preview can reopen the same editor. Original continuation preserves creator notes/voice preferences, cancels work safely and keeps all sources.

Fitting preserves video duration and frame sequence. Narration windows span the video; measured clips use bounded natural tempo correction and appropriate gaps. Overlong measured speech requests one automatic tighter rewrite before render; no mid-word trimming, extreme slowdown or silent extension of the video. Failed fitting/provider capacity leaves the original usable. Tests cover real 90-second output, late-video narration, source+creator context, measured rewrite, profile fingerprint invalidation, cached-context reuse, ownership and browser persistence.

## Voice connection recovery

AudioEditor uses the shared `lib/browser-request.ts` transport: bounded reads, safe cancellation, friendly connectivity errors and replay only for idempotent submissions. Each English creation has an owner/source-scoped request ID; replay returns the same job, including a failed receipt, without charging another hourly admission or restarting work. Unchanged retries retain saved segments. Background polling reconnects without discarding progress or claiming failure when completion is unknown.

Provider daily limits and long Retry-After windows are saved server-side in the existing service-only rate-limit table, scoped to the configured worker pool and model. A known cooldown blocks new speech requests before queue/hourly admission and is explained inline. Original continuation, words and voice preferences remain usable. The provider's actual allowance remains authoritative; no fake audio, credential switching or quota bypass. `/api/health` and `check:env` distinguish configured speech from currently available speech. The operator-only `check:speech --probe` explicitly consumes allowance to recheck an upgraded plan and clears only this provider's cooldown after real playable audio succeeds.

## Free narration

Source: docs/FREE-NARRATION.md and lib/server/media/tts-config.ts. Free narration uses an exact zero-priced model with no paid fallback; Gemini remains responsible for understanding the recording. AudioEditor preserves the same native voice controls and shows a concise direction-only hint when the provider has no verified gender/accent catalogue. Readiness and persisted cooldowns follow the selected speech model across web and worker. Cached narration fingerprints include that model; previous provider audio is never mistaken for the newly chosen voice.
