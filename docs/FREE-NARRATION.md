# Free English narration

Set these on both the Next.js server and the long-lived media worker (never in NEXT_PUBLIC variables):

```dotenv
TTS_PROVIDER=openrouter
OPENROUTER_API_KEY=<secure server secret>
OPENROUTER_TTS_MODEL=fish-audio/s2.1-pro-free:free
```

Gemini credentials remain required for recording understanding, transcription and planning. No n8n AI changes are required. Restart the media worker and redeploy Next.js after environment changes.

The exact free model is pinned. The worker verifies zero model and endpoint prices before synthesis (cached five minutes); an unverified or charging route stops generation. There is no paid model fallback. Each attempt consumes the existing global provider budget. Free service has rate limits and no production availability guarantee. The app saves the script and completed segments on errors. Readiness is configuration plus known cooldown, not a promise of provider capacity.

Voice, locale and delivery preferences are best-effort instructions. This endpoint does not publish verified gender/accent voice metadata; listen to the finished preview. It may differ from the prior Gemini voice. No voice cloning is used.

Run `npm run check:speech` for a read-only status check. `npm run check:speech -- --probe` consumes a real free request and needs FFmpeg on that host to verify MP3-to-WAV conversion. For narration, the media worker converts the real MP3 to WAV and validates it before the normal H.264/AAC rendering path. Existing timed segments, source media, cancellation, approval and duration fitting remain in force.

To use Gemini again, explicitly set `TTS_PROVIDER=gemini` on server and worker. This never happens automatically.

Official references: [OpenRouter TTS](https://openrouter.ai/docs/guides/overview/multimodal/tts), [free model and limits](https://openrouter.ai/fish-audio/s2.1-pro-free:free).

Selection (27 October 2026): the public catalogue also lists HeyGen Voice Turbo free, but that variant is marked for retirement on 30 November 2026. Fish was selected for this integration after successful real audio verification; this is a practical choice, not a claim of a universal quality ranking.

Delivery uses short Fish-native inline tags (for example `[excited] [confident]`) ahead of the unchanged script. Do not send long prose in the top-level instructions field: a live transcription check found that endpoint reading those directions aloud. Voice-cache fingerprints include the adapter version, so old incorrect clips cannot be reused. Energetic rendering normalizes perceived loudness to -14 LUFS with peak headroom; unchanged original audio bypasses this treatment.
