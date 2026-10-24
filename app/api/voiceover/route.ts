/** Compatibility endpoint. Normal studio synthesis uses durable segment jobs. */
import { z } from "zod";
import { rateLimit } from "@/lib/server/rate-limit";
import { withSession } from "@/lib/supabase/server";
import { body, failure, session } from "@/lib/server";
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
    const wav = await synthesize(script, defaultSettings());
    return new Response(new Uint8Array(wav), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
});
export const maxDuration = 60;
