import { failure, json, session } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import { voices, audioLanguages, styles } from "@/lib/audio/schema";
export const GET = withSession(async (req: Request) => {
  try {
    await session(req);
    return json({
      provider: "Gemini",
      model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
      configured:
        !!process.env.GEMINI_API_KEY && process.env.TTS_PROVIDER !== "disabled",
      voices,
      languages: audioLanguages,
      styles,
      source: "Documented Gemini prebuilt studio catalogue",
      sourceURL:
        "https://ai.google.dev/gemini-api/docs/speech-generation#voice_options",
      profiles: {
        genders: ["natural", "male", "female"],
        accents: ["en-US", "en-GB", "en-IN"],
      },
      note: "New English voiceovers resolve a prebuilt regional voice using verified gender and locale metadata from the provider catalogue. Delivery style remains a performance instruction.",
    });
  } catch (e) {
    return failure(e);
  }
});
