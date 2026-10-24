import { z } from "zod";
import { withSession } from "@/lib/supabase/server";
import { body, failure, json } from "@/lib/server";
import { disconnect } from "@/lib/server/connections";
import { rateLimit } from "@/lib/server/rate-limit";
export const POST = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "disconnect", 10);
    const { platform } = await body(
      req,
      z.object({ platform: z.enum(["instagram", "youtube", "x"]) }),
    );
    const result = await disconnect(req, platform);
    return json({ disconnected: true, ...result });
  } catch (e) {
    return failure(e);
  }
});
