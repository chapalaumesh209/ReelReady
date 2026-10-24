> Current creator interface: [Focused Audio & Voice](docs/AUDIO-SIMPLE-UI.md). The console described below is retained as backend/history documentation; its advanced controls are no longer in the creator flow.

# Audio & Voice implementation — local only

Source: the user’s 23 October 2026 “AI Video Editing, Multilingual Voiceover, Audio Control, Voice Selection and Social Publishing” brief.

## Existing foundations retained

Native Next.js App Router, Supabase anonymous Auth (no visible login), RLS-owned reels, private resumable TUS storage, multilingual planning and captions, branded Upload-Post account connections, durable confirmed publishing and per-destination retry remain. The public website and hosted Supabase project have not been modified.

## New workflow and audio treatments

Plan → Record → Upload → Audio & Voice → Review → Publish. Every uploaded recording enters the new step. Keep original is the safe default; narration is optional. Keep unchanged selects the actual original asset. Mute, translated/replacement voice, voiceover only, adding narration to a silent video and mixing original sound with narration produce separate verified MP4 assets. Volume, ducking and fades remain editable. No speech removal/source-separation service is connected; the interface states that replacing a mixed soundtrack removes its background sounds too. No lip sync, voice cloning or visual edits are claimed.

FFprobe reports actual container, streams, duration, dimensions, rotation, frame rate, codecs, sample rate and channels. FFmpeg decoding and volume detection distinguish no audio, effectively silent audio and sound that has not been classified as speech/music. Manual correction is available. Actual transcription occurs only on request.

Scripts may be typed, dictated with installed Wispr Flow, pasted, transcribed from the original or a separate uploaded/recorded voice note, or suggested from the actual video. Uploaded narration can also be used directly without synthesis. Original and target languages are independent. Voice changes do not rerun transcription. Persisted segment text and start/end slots are editable.

## Provider capability boundaries

Gemini transcription uses the documented Interactions API and `gemini-3.5-transcribe` (overridable). Gemini speech uses `gemini-3.8-flash-tts` (overridable), documented speech metadata for delivery and the actual WAV response. This replaces the old hard-coded English-only preview TTS call in the normal workflow. Translation uses the existing server-side structured LLM adapter, with an explicit-action Gemini fallback when caption generation is in demo mode; video-grounded suggestions use Gemini Files and video understanding. A Gemini media key is independent of LLM_PROVIDER=demo.

The selector uses a labelled documented curated subset of Gemini’s studio voices: Kore, Puck, Charon, Aoede, Iapetus, Sulafat, Achird and Zephyr. Characteristics are their documented delivery descriptors. Gender/accent classifications are not invented; the UI says these are unavailable in this catalogue. English, Telugu, Hindi, Tamil and Hinglish are exposed as narration instructions, subject to the configured model’s capabilities. Style and pace are natural-language instructions; actual output duration is measured. A short preview requires an explicit click and never triggers a video render. Missing credentials leave keep/mute/uploaded-narration editing available; the app never fabricates speech output.

Automated provider tests use explicitly mocked transcription and WAV tone fixtures; tone fixtures verify media processing, not pronunciation. Separate live checks succeeded for English/Kore and Telugu/Puck synthesis, English transcription (after one transient failure and retry), and Hindi-to-English text translation. Actual English speech was rendered into a six-second H.264/AAC MP4 with its duration preserved. No human pronunciation/accent quality assessment is claimed. Tamil/Hinglish live speech and actual video-understanding requests were not tested in this run.

## Worker architecture and duration behavior

Next.js authenticates, checks ownership, saves settings, creates/retrieves a deduplicated job and returns immediately. A separate Node worker atomically claims queued Supabase jobs using FOR UPDATE SKIP LOCKED. One render runs per worker process. Heartbeats renew leases; interrupted work becomes failed for explicit retry. Status survives page refresh. Progress is named stages, not fabricated percentages.

Media downloads and final uploads stream to/from private storage; native FFmpeg work runs outside serverless requests in private temporary directories. Commands use argument arrays, never a shell or client-provided path. Originals are never overwritten by a render. Temporary processing files are removed in finally blocks; completed versions persist.

Narration audio is probed after synthesis and again before rendering. Short narration is padded without shortening the video. A segment up to 12% too long may use a modest atempo adjustment. Longer narration fails with a deliberate choice to shorten, adjust timing or extend the last video frame. Extension requires the user’s selected timing mode. No final words are silently cut. Output H.264/AAC streams, original dimensions and duration are checked before a successful result is saved. Compatible H.264 visuals can be copied; incompatible input/extension uses H.264 encoding.

The approved settings fingerprint and final media ID are saved together. Publishing must reference that exact verified asset; modifying audio settings invalidates approval. A failed render never selects the original as a fallback. Publication still requires its own explicit confirmation and DEMO_MODE remains enabled locally.

## Persistence and privacy

Migration `supabase/migrations/20261023153146_audio_voice_worker.sql` is additive and applied only to local Docker Supabase. It adds `reelready_audio_edits`, `reelready_media_jobs`, `reelready_workers`, generic source-audio/voiceover/rendered asset roles, the six-step range and a private worker claim RPC. Existing five-step draft indices are migrated once. Existing data is not reset. Owner-read RLS protects new content; server/worker writes and claim functions are service-role only. Worker heartbeats are private. Source, separate recordings, generated segments, rendered media, scripts, settings and processing receipts persist in Supabase.

Requested AI actions send the necessary recording or script to the configured provider. Gemini processing copies are deleted after the task (provider expiry is a fallback). Raw videos are not sent for ordinary volume/mute/render operations. Real social publishing gives Upload-Post an expiring signed URL for the selected video and exact caption fields. Credentials remain server/worker only. Browser media links are owner-authorized, short-lived signed links.

## Local startup

Requires Node 22.13+, Docker Desktop and native FFmpeg/FFprobe on PATH. On this Mac, FFmpeg 9.0.2 was installed using Homebrew.

```sh
npm run setup:local
npm run dev:all
```

Or run the existing frontend and worker in separate terminals:

```sh
npm run dev
npm run worker
```

Keep the local Supabase stack running. Existing original `.env.local` is preserved. `.env.development.local` keeps demo text/publishing isolated from production; do not paste keys into chat or commit env files.

New optional env settings are documented in `.env.example`. The default worker processing limit is 1,800 seconds, separate from upload acceptance. There is no application upload-size cap; storage/project limits, provider limits and available disk still apply. Worker commands have bounded timeouts and require at least 512 MiB free temporary disk before starting. Limits are configurable server-side, not client-trusted.

## Before Vercel

Do not deploy this worker inside a Vercel Route Handler. Deploy the web/API to Vercel and run the worker in an FFmpeg-capable long-lived container/VM with suitable RAM/disk and the same private Supabase project. Apply reviewed migrations to the chosen development/production project only with authorization. Configure canonical APP_URL, Supabase credentials, provider models/keys and SESSION_SECRET securely. Verify anonymous Auth, private bucket access, retention policy, processing quotas and social accounts. Use publicly reachable signed media URLs for Upload-Post; a remote service cannot fetch this machine’s 127.0.0.1 Docker URLs. Keep DEMO_MODE=true until a separately confirmed real-account test. A durable storage queue is in place; operate a single worker initially, then set resource-appropriate process concurrency.

## Verification

Updated final check results are recorded in IMPLEMENTATION-REPORT.md. Do not infer live provider success from mocked tests. No production resource or public site was changed.
