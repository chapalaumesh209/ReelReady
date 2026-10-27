/** Compatibility endpoint. Normal studio synthesis uses durable segment jobs. */
import { z } from "zod";
import { rateLimit } from "@/lib/server/rate-limit";
import { withSession } from "@/lib/supabase/server";
import { body, failure, session } from "@/lib/server";
import { ttsConfiguration } from "@/lib/server/media/tts-config";
import { requestFreeSpeech } from "@/lib/server/media/openrouter-speech";
import { synthesize } from "@/lib/server/media/providers";
import { defaultSettings } from "@/lib/audio/schema";
export const POST = withSession(async (req: Request) => {
  try {
    await session(req);
    await rateLimit(req, "voiceover", 10);
    const { script } = await body(
      req,
      z.object({ script: z.string().min(5).max(3000) }),
    );
    // This compatibility route runs on Vercel without FFmpeg. Return the real
    // compressed format; normal studio narration is decoded by the media worker.
    const free = ttsConfiguration().provider === "openrouter";
    const audio = free
      ? await requestFreeSpeech(script, defaultSettings())
      : await synthesize(script, defaultSettings());
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": free ? "audio/mpeg" : "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
});
export const maxDuration = 60;
