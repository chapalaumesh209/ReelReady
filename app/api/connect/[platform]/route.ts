import { z } from "zod";
import { withSession } from "@/lib/supabase/server";
import { failure, json } from "@/lib/server";
import { startConnection } from "@/lib/server/connections";
import { rateLimit } from "@/lib/server/rate-limit";
export const POST = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "connect", 10);
    const p = z
      .enum(["instagram", "youtube", "x"])
      .parse(new URL(req.url).pathname.split("/").pop());
    return json(await startConnection(req, p));
  } catch (e) {
    return failure(e);
  }
});
