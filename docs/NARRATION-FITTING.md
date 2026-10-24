# Full-video narration and voice choices

The English path now combines the real reel, its original speech and creator changes. It no longer treats a short creator note as the whole narration.

## Creator workflow

Choose English voiceover. Enter optional changes/details in any language. Select Voice (natural automatic, male or female), Accent (US, British or Indian English) and Delivery (natural, casual, friendly or professional). Create the English version, preview it, and use Change voice or words to revise any of these choices. A narration disclosure shows the saved English text and measured video duration. Keep original remains the default and works without processing.

## Duration fitting

- The worker measures the source and uses its actual audio and video. Original transcription is cached privately on that source asset. Creator instructions remain separate from transcription and generated narration.
- Video-aware planning returns grounded sections for server-assigned windows covering the full measured duration; 90 seconds uses six 15-second windows. Short notes can be expanded using visible/source/creator-provided facts; excess detail is condensed. The model is instructed to preserve important meaning and never invent filler.
- Speech is generated and measured. Overlong sections trigger one automatic tighter rewrite, with word budgets calculated from the measured overrun, then regeneration.
- Rendering uses only small tempo corrections (0.85–1.15x) and natural gaps; short speech is distributed through the video, including its ending, rather than slowed threefold or finished in the first 30 seconds. The output and audio stream keep the measured video duration. No original frames are frozen or appended, and words are not truncated to force a fit.
- If a second measured attempt still cannot fit naturally, it returns an actionable error and retains the original and notes. Arbitrarily long text cannot be retained verbatim in a shorter video: the operation adapts/condenses it.
- The new English path replaces the original soundtrack, avoiding two languages speaking over each other. Original media remains private and intact.

## Voice identity

The server queries Gemini's Extended Voice Library by exact locale and requested gender presentation, validates returned metadata and caches the selected prebuilt entry for one hour. It does not infer gender from who appears on camera or attempt gender/accent changes through performance prompts. Natural automatic selects a catalog voice; delivery style is a speech metadata instruction. Voice fingerprints include presentation and accent, preventing cached audio from the wrong voice being reused. Changing only the voice retains the prepared content and cached transcription, subject to measured fitting if a new voice runs longer.

Primary API reference verified 24 October 2026: https://ai.google.dev/gemini-api/docs/speech-generation#extended-voice-library-and-filtering

## Compatibility and privacy

Optional `durationMode`, `creatorInstructions` and `voiceProfile` fields live inside existing owned JSONB settings. No migration or new environment variables. Legacy settings retain their hashes and old jobs retain their supported rendering path. New plans use existing Gemini credentials, private Files analysis copies with cleanup, model-call budget, queue/cancellation/lease guards and owned storage. No arbitrary URLs or client-selected catalog voice IDs are accepted. Returning to original audio preserves creator instructions and voice preferences. Existing exports and source files remain intact.

## Verification

- 74 unit/backend tests passed.
- 12 media tests passed: actual 90-second FFmpeg output and late-video audio; source speech plus notes; actual lease-guarded fitting; measured tightening; male Indian to female British voice changes; context reuse; catalog filtering; profile fingerprint invalidation; schema retry and original-file preservation.
- 15 browser tests passed, covering profile persistence, before/after voice changes, multilingual instructions, preview, service-limit recovery, offline continuation and full demo publication. A focused recovery check additionally covers preferences after reverting to original audio.
- Lint, typecheck, production build and strict UI audit passed. Desktop/390px inspection completed.
- Read-only live catalog checks returned voices for en-US, en-GB and en-IN. A short live male Indian-English speech check produced a valid 2.08-second WAV. Full fitting tests inject speech/model fixtures while rendering real MP4s; no live full-length video/model run or social post was performed.
- Local app and worker restarted. No hosted changes or deployment.

Ignored evidence: `artifacts/narration-*` logs/audio, plus the Audio & Voice desktop/mobile screenshots in `artifacts/audio-simple-*`.
