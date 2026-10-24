import { z } from "zod";
import { withSession } from "@/lib/supabase/server";
import { body, failure, json, session } from "@/lib/server";
import { repository, databaseError } from "@/lib/server/repository";
import { detailsSchema } from "@/lib/server/kits";
import { rateLimit } from "@/lib/server/rate-limit";
export const GET = withSession(async (req: Request) => {
  try {
    await session(req, true);
    const { db, user } = await repository(req);
    const r = await db
      .from("reelready_preferences")
      .select("details")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (r.error) databaseError(r.error);
    return json({
      details: r.data?.details || {
        voice: "",
        brand: "",
        link: "",
        disclosure: "",
      },
    });
  } catch (e) {
    return failure(e);
  }
});
export const POST = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "preferences", 120);
    const data = await body(req, z.object({ details: detailsSchema })),
      { db, user } = await repository(req);
    const r = await db
      .from("reelready_preferences")
      .upsert({ owner_id: user.id, details: data.details });
    if (r.error) databaseError(r.error);
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
});
