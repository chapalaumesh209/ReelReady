import { ttsConfiguration } from "../lib/server/media/tts-config";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { speechCooldown, speechCooldownMessage, clearSpeechCooldown } =
  await import("../lib/server/media/speech-capacity");
const { regionalVoice, interactionBlocks } =
  await import("../lib/server/media/providers");
const { requestSpeech } = await import("../lib/server/media/speech-request");
const { MediaError } = await import("../lib/server/media/ffmpeg");
if (!ttsConfiguration().configured) {
  console.log("Speech is not configured. No provider request was made.");
  process.exitCode = 1;
} else if (!process.argv.includes("--probe")) {
  const cooldown = await speechCooldown();
  console.log(
    JSON.stringify({
      status: cooldown
        ? "provider-limited"
        : "configured; live check not requested",
      message: cooldown
        ? speechCooldownMessage(cooldown)
        : "Use --probe for one short live male Indian English voice check. This consumes provider allowance.",
      providerCalls: 0,
    }),
  );
} else {
  // Explicit operator probe can revalidate an upgraded plan before an old cooldown expires.
  // The paid-call budget, provider rate limits and bounded retry behavior still apply.
  try {
    if (ttsConfiguration().provider === "openrouter") {
      const { synthesize } = await import("../lib/server/media/providers");
      const { defaultSettings } = await import("../lib/audio/schema");
      const audio = await synthesize(
        "Your English voiceover service is ready.",
        {
          ...defaultSettings(),
          voiceProfile: { gender: "male", accent: "en-IN" },
          style: "Clear and professional",
        },
      );
      if (
        audio.length <= 44 ||
        audio.toString("ascii", 0, 4) !== "RIFF" ||
        audio.toString("ascii", 8, 12) !== "WAVE"
      )
        throw new MediaError("The free speech check returned no playable WAV.");
      await clearSpeechCooldown();
      console.log(
        JSON.stringify({
          status: "live",
          provider: "openrouter",
          model: ttsConfiguration().model,
          freeOnly: true,
          playableAudio: true,
          voiceDirectionsOnly: true,
          secretsPrinted: false,
        }),
      );
    } else {
      const voice = await regionalVoice({ gender: "male", accent: "en-IN" });
      const result = await requestSpeech(
        {
          model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text: "Your English voiceover service is ready.",
                  annotations: [
                    {
                      type: "speech_metadata",
                      style:
                        "Clear and professional. Indian English, natural pace. Read the text verbatim.",
                    },
                  ],
                },
              ],
            },
          ],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: voice.id }] },
        },
        {
          "x-goog-api-key": process.env.GEMINI_API_KEY!,
          "Content-Type": "application/json",
        },
        {},
        { cooldown: async () => null },
      );
      const output = interactionBlocks(result).findLast(
        (b) => b.type === "audio" && b.data,
      );
      const audio = output?.data
        ? Buffer.from(output.data, "base64")
        : Buffer.alloc(0);
      if (
        audio.length <= 44 ||
        audio.toString("ascii", 0, 4) !== "RIFF" ||
        audio.toString("ascii", 8, 12) !== "WAVE"
      )
        throw new MediaError(
          "The speech check returned no playable WAV audio. Availability was not changed.",
        );
      await clearSpeechCooldown();
      console.log(
        JSON.stringify({
          status: "live",
          voice: "Male · Indian English · Professional",
          playableAudio: true,
          availabilityUpdated: true,
          secretsPrinted: false,
        }),
      );
    }
  } catch (e) {
    console.log(
      JSON.stringify({
        status: "unavailable",
        message:
          e instanceof MediaError
            ? e.message
            : "The speech connection could not be verified. Check the provider plan and network.",
      }),
    );
    process.exitCode = 1;
  }
}
