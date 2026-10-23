# ReelReady interaction contract

One reel moves through Plan → Record → Review → Publish. A ReelReady account is never required. Social authorization is an explicit action at Publish.

| Capability | Canonical owner | Behavior | Verification |
| --- | --- | --- | --- |
| Text input | components/studio/index.tsx AutoTextarea | Labelled native textareas, local persistence, native multiline and IME behavior | keyboard, editable scripts and captions |
| Choice | Native checkboxes, radio and select in app/page.tsx | Multiple destinations/languages; one idea, script style, video variant and final caption language | mobile and keyboard |
| Form lifecycle | app/page.tsx run | One operation at a time; honest busy label; cancel non-publishing work; preserve draft on error | browser error and cancellation states |
| Upload | browser-media.ts, storage-upload.ts, /api/storage | Visible native file input, drop or pasted file; MIME fallback; cancellable metadata check; private signed resumable Supabase uploads with progress; no app size/duration cap; project and destination restrictions remain | real MediaRecorder upload, provider size rejection and visitor isolation |
| Plan | /api/plan | Three model-generated ideas; estimates explicitly identified; schedule is chosen by user; stale plan cannot advance | schema validation and browser |
| Video review | /api/video, /api/review | Stream upload to Gemini Files; signed visitor-bound file capability; actual video/audio understanding; revisions become English | live provider verification |
| English export | /api/voiceover, browser-media.ts | Gemini standard synthetic voice; browser FFmpeg H264/AAC MP4 export; original audio replaced, visuals retained; overly long audio rejected | live WAV, actual WASM export |
| Results | components/studio/index.tsx OutputEditor | Editable, copy per output/all, Unicode and X weighted counts, warnings; native/Roman script | multilingual API tests and browser |
| Persistence | localStorage, /api/draft, Supabase Storage | Text cached locally and saved in private Postgres; original and English video in private Storage; cloud restoration uses the same anonymous cookie, without accounts; IndexedDB fallback only if storage is unconfigured | real database recovery after clearing local cache, signed preview and visitor isolation |
| Identity | lib/server.ts | HttpOnly, SameSite signed anonymous cookie; independent Upload-Post profile per visitor; no owner-global accounts shown | capability isolation tests |
| Connection | /api/connections | Explicit hosted social OAuth; return rechecks actual provider state; disconnect individual accounts | contract mocks; live requires key |
| Publishing | /api/publish | Immutable signed prepare request; signed private video URL sent to provider, legacy multipart fallback; stable upstream idempotency key; saved recovery handle before upload | mocked provider and UI |
| Delivery | upload-post.ts deliveries | Processing/scheduled/published/failed/skipped remain distinct; no skipped or queued success; per-platform receipt | unit tests and reload |
| Feedback | app/page.tsx messages | Inline error role=alert, success/status role=status, sticky busy status; no fabricated outcomes | axe and browser |
| Responsive | app/globals.css | Four-step navigation, stacked mobile controls, visible focus, reduced motion, no horizontal overflow | 390px and desktop |

A completed or uncertain publishing request locks the send action for that reel. Check delivery before taking any new action. Starting a new reel does not cancel an accepted schedule or remove a published post. Video file URLs are not accepted as arbitrary server fetch targets; paste means a copied file.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | Native labelled select | DESIGN.md | native | keyboard, mobile and axe |
| Date | Native datetime-local input | DESIGN.md | local date/time with explicit timezone | future-time validation and UTC provider fields |
| Form | Shared AutoTextarea and workflow form in app/page.tsx | This contract | plan, record, review, publish | validation, errors, IME and persistence |
| Scrollbar | app/globals.css | DESIGN.md tokens | native themed | responsive browser check |
| Toast | Inline message region in app/page.tsx | This contract | error, status | axe and preserved input |
