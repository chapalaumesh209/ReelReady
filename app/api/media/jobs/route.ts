import { z } from "zod";
import { body, failure, json } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import { repository, databaseError } from "@/lib/server/repository";
import { jobList, jobSelect } from "@/lib/server/media/routes";
import { GenerationError } from "@/lib/generation";
export const GET = withSession(async (req: Request) => {
  try {
    const params = new URL(req.url).searchParams;
    if (params.has("reelId"))
      return json({
        jobs: await jobList(req, z.string().uuid().parse(params.get("reelId"))),
      });
    const id = z.string().uuid().parse(params.get("id"));
    const { db } = await repository(req);
    const r = await db
      .from("reelready_media_jobs")
      .select(jobSelect)
      .eq("id", id)
      .maybeSingle();
    if (r.error) databaseError(r.error);
    if (!r.data)
      throw new GenerationError(
        "This processing job was not found in your workspace.",
        404,
      );
    return json(r.data);
  } catch (e) {
    return failure(e);
  }
});

export const POST = withSession(async (req: Request) => {
  try {
    const { id } = await body(req, z.object({ id: z.string().uuid() }));
    const { db, user } = await repository(req);
    const job = await db
      .from("reelready_media_jobs")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (job.error) databaseError(job.error);
    if (!job.data)
      throw new GenerationError(
        "This processing job was not found in your workspace.",
        404,
      );
    const { storageAdmin } = await import("@/lib/supabase");
    const result = await storageAdmin()
      .from("reelready_media_jobs")
      .update({
        status: "cancelled",
        stage: "Cancelled; sources preserved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_id", user.id)
      .in("status", ["queued", "running"]);
    if (result.error) databaseError(result.error);
    return json({ cancelled: true });
  } catch (e) {
    return failure(e);
  }
});
