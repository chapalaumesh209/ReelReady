# Focused Audio & Voice

This update replaces the audio console with a guided part of the same reel flow. No new pages or global steps.

## Creator flow

1. **Choose the sound.** Keep original is selected. Continue immediately, or optionally preview the original recording. Choosing English moves directly into its words box.
2. **Give it words.** Dictate or type in any language. Leave the box empty to use the video’s speech when transcription is available. One Create English voiceover action starts the existing durable worker pipeline: transcribe if needed, translate, narrate and export with quieter original audio.
3. **Listen and continue.** Processing gives way to the finished video. Play it, optionally change the words and regenerate, then Continue to captions. An existing approved export reopens here without a paid operation.

## Kept

- Original-audio continuation without an online worker or a paid provider.
- Multilingual words, plain textarea/Wispr input and script persistence.
- One automatic English voiceover preset using the existing voice service.
- Playable finished video, download, revised words and regeneration.
- Saved render recovery, explicit failures, safe job cancellation and original continuation for jobs queued over three minutes.
- Approval invalidation after edits, exact asset checks, source retention, backend authorization and publishing safeguards.

## Removed from the creator interface

Manual audio classification, source/target language dropdowns, voice catalogue, style and pace selection, mixing/muting modes, volume/ducking/fade sliders, narration timelines and segment timing, microphone/voice-file tools, source-separation explanations, and separate transcribe/translate/generate/render buttons and dialogs. Those controls distracted from the core task. Existing backend APIs, stored recordings, scripts and renders remain intact for compatibility.

## Implementation

`components/studio/audio-editor.tsx` owns the progressive UI and serializes script saves. It uses existing `/api/audio`, `/api/media/english`, `/api/media/jobs`, `/api/media/assets` and worker-status endpoints. No database migration, credentials, provider change, deployment or new environment variables.

## Validation

See ignored `artifacts/audio-simple-*` logs/screenshots. Browser coverage includes original and English paths, multilingual words, save/reload, automatic processing and word changes (speech mocked), finished-export recovery without another paid call, provider quota recovery, offline continuation, stale cancellation, mobile accessibility and the full publishing demo. Backend media tests exercise the real FFmpeg pipeline with injected speech/translation fixtures; automated tests do not make real social posts or paid speech calls.

Verified results: lint, typecheck and isolated production build passed; 74 unit/backend tests, 8 media tests and 15 browser tests passed (97 total). The strict UI audit has zero findings. Desktop/390px inspection and one confirmation pass completed. Current development server remains available at http://127.0.0.1:3000/; no deployment was performed.
