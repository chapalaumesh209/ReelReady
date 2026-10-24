import { withSession } from "@/lib/supabase/server";
import { body, failure, json, session } from "@/lib/server";
import { generationConfiguration } from "@/lib/generation";
import { kitInput, publishingKit } from "@/lib/server/kits";
import { rateLimit } from "@/lib/server/rate-limit";
export const GET = withSession(async () =>
  json({
    configured: !!generationConfiguration().key || !!process.env.GEMINI_API_KEY,
  }),
);
export const POST = withSession(async (req: Request) => {
  try {
    await session(req);
    await rateLimit(req, "generation", 20);
    const data = await body(req, kitInput);
    return json(
      await publishingKit(
        data,
        AbortSignal.any([req.signal, AbortSignal.timeout(180000)]),
      ),
    );
  } catch (e) {
    return failure(e);
  }
});

export const maxDuration = 240;
