import { ttsConfiguration } from "@/lib/server/media/tts-config";
import { failure, json, session } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import { voices, audioLanguages, styles } from "@/lib/audio/schema";
export const GET = withSession(async (req: Request) => {
  try {
    await session(req);
    return json({
      provider: ttsConfiguration().provider,
      model: ttsConfiguration().model,
      configured: ttsConfiguration().configured,
      voices: ttsConfiguration().voiceDirectionsOnly ? [] : voices,
      languages: audioLanguages,
      styles,
      source: ttsConfiguration().voiceDirectionsOnly
        ? "Prompt-directed free speech; voice metadata unavailable"
        : "Documented Gemini prebuilt studio catalogue",
      sourceURL: ttsConfiguration().voiceDirectionsOnly
        ? "https://openrouter.ai/fish-audio/s2.1-pro-free:free"
        : "https://ai.google.dev/gemini-api/docs/speech-generation#voice_options",
      profiles: {
        genders: ["natural", "male", "female"],
        accents: ["en-US", "en-GB", "en-IN"],
      },
      voiceDirectionsOnly: ttsConfiguration().voiceDirectionsOnly,
      note: ttsConfiguration().voiceDirectionsOnly
        ? "Voice, accent and style are best-effort delivery directions. Preview before using; this free model has no verified gender or accent catalogue."
        : "New English voiceovers resolve a prebuilt regional voice using verified gender and locale metadata from the provider catalogue. Delivery style remains a performance instruction.",
    });
  } catch (e) {
    return failure(e);
  }
});
