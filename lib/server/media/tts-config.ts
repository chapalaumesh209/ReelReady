/** Server-only speech configuration. Never include provider credentials in snapshots. */
export const FREE_SPEECH_MODEL = "fish-audio/s2.1-pro-free:free";
export function ttsConfiguration() {
  const provider = process.env.TTS_PROVIDER || "gemini";
  const model =
    provider === "openrouter"
      ? process.env.OPENROUTER_TTS_MODEL || FREE_SPEECH_MODEL
      : process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  return {
    provider,
    model,
    configured:
      provider === "openrouter"
        ? !!process.env.OPENROUTER_API_KEY && model === FREE_SPEECH_MODEL
        : provider === "gemini" && !!process.env.GEMINI_API_KEY,
    voiceDirectionsOnly: provider === "openrouter",
  };
}
