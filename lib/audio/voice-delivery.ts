/** Shared performance instructions and mastering for the energetic delivery preset. */
export const ENERGETIC_STYLE = "Energetic creator style";
export const ENERGETIC_VOICE_VERSION = "energetic-delivery-v2";
export function deliveryInstruction(style: string) {
  return style === ENERGETIC_STYLE
    ? "Confident, high-energy creator delivery. Open with conviction. Use a bright, full-bodied, projected voice, crisp articulation, expressive pitch variation and strong emphasis on key words. Sound enthusiastic and authoritative, while staying professional and natural. Keep pauses brief and intentional. Do not whisper, sound sleepy or shout."
    : style;
}
// Normalize perceived loudness rather than simply increasing gain. Retain peak
// headroom for AAC encoding; disable the limiter's automatic make-up gain.
export const ENERGETIC_AUDIO_FILTER =
  "loudnorm=I=-14:TP=-1.5:LRA=7,aresample=48000,alimiter=limit=0.89:level=0:latency=1";
