import { z } from "zod";
import { withSession } from "@/lib/supabase/server";
import { failure, json } from "@/lib/server";
import { refreshJob } from "@/lib/server/publishing/jobs";
import { repository, databaseError } from "@/lib/server/repository";
import { rateLimit } from "@/lib/server/rate-limit";
export const GET = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "publish-status", 400);
    const q = new URL(req.url).searchParams;
    let id = q.get("id") || q.get("token");
    if (!id && q.get("reelId")) {
      const { db } = await repository(req);
      const result = await db
        .from("reelready_jobs")
        .select("id")
        .eq("reel_id", z.string().uuid().parse(q.get("reelId")))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error) databaseError(result.error);
      id = result.data?.id;
      if (!id) return json({ job: null });
    }
    return json(await refreshJob(req, z.string().uuid().parse(id)));
  } catch (e) {
    return failure(e);
  }
});
