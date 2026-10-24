import { z } from "zod";
import { body, failure, json } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import {
  repository,
  databaseError,
  ensureReel,
  ownedReel,
} from "@/lib/server/repository";
import { rateLimit } from "@/lib/server/rate-limit";
export const GET = withSession(async (req: Request) => {
  try {
    const { db, user } = await repository(req);
    const id = new URL(req.url).searchParams.get("id");
    if (id)
      return json((await ownedReel(req, z.string().uuid().parse(id))).reel);
    const { data, error } = await db
      .from("reelready_reels")
      .select("id,title,step,updated_at,state")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(60);
    if (error) databaseError(error);
    const jobs = data.length
      ? await db
          .from("reelready_jobs")
          .select("id,reel_id,status,is_demo,scheduled_at,created_at")
          .eq("owner_id", user.id)
          .in(
            "reel_id",
            data.map((r) => r.id),
          )
          .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (jobs.error) databaseError(jobs.error);
    const latest = new Map<string, NonNullable<typeof jobs.data>[number]>();
    for (const job of jobs.data || [])
      if (!latest.has(job.reel_id)) latest.set(job.reel_id, job);
    const targets = latest.size
      ? await db
          .from("reelready_targets")
          .select("job_id,platform,status,published_url,safe_message")
          .eq("owner_id", user.id)
          .in(
            "job_id",
            Array.from(latest.values()).map((j) => j.id),
          )
      : { data: [], error: null };
    if (targets.error) databaseError(targets.error);
    return json({
      reels: data.map((reel) => {
        const job = latest.get(reel.id);
        return {
          ...reel,
          state: {
            ...reel.state,
            ...(job
              ? {
                  job: {
                    id: job.id,
                    token: job.id,
                    status: job.status,
                    demo: job.is_demo,
                    scheduledAt: job.scheduled_at,
                    done: ["published", "failed", "demo"].includes(job.status),
                    deliveries: (targets.data || [])
                      .filter((t) => t.job_id === job.id)
                      .map((t) => ({
                        platform: t.platform,
                        state: t.status,
                        url: t.published_url || undefined,
                        message: t.safe_message || undefined,
                      })),
                  },
                }
              : {}),
          },
        };
      }),
    });
  } catch (e) {
    return failure(e);
  }
});
export const POST = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "save-reel", 1200);
    const { state } = await body(
      req,
      z.object({
        state: z
          .object({
            id: z.string().uuid(),
            version: z.literal(2),
            step: z.number().int().min(0).max(5),
            input: z.string().max(4000).default(""),
          })
          .passthrough(),
      }),
    );
    const { db, user } = await ensureReel(req, state.id);
    const { reel } = await ownedReel(req, state.id);
    // Management metadata belongs to the saved reel, not to stale autosave snapshots.
    state.title = reel.state.title || state.title;
    state.archivedAt = reel.state.archivedAt || null;
    const { error, data: savedRows } = await db
      .from("reelready_reels")
      .update({
        state,
        title:
          typeof state.title === "string" && state.title.trim()
            ? state.title.slice(0, 100)
            : state.input.slice(0, 100) || "Untitled reel",
        step: state.step,
        updated_at: new Date().toISOString(),
      })
      .eq("id", state.id)
      .eq("owner_id", user.id)
      .eq("updated_at", reel.updated_at)
      .select("id");
    if (error) databaseError(error);
    if (!savedRows?.length)
      return json(
        {
          error:
            "This reel changed while saving. Your local draft is safe; retry saving.",
        },
        409,
      );
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
});

export const PATCH = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "manage-reel", 120);
    const data = await body(
      req,
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("rename"),
          id: z.string().uuid(),
          title: z.string().trim().min(1).max(100),
          updatedAt: z.string(),
        }),
        z.object({
          action: z.enum(["archive", "restore", "duplicate"]),
          id: z.string().uuid(),
          updatedAt: z.string(),
        }),
      ]),
    );
    const { db, user, reel } = await ownedReel(req, data.id);
    if (reel.updated_at !== data.updatedAt)
      return json(
        {
          error:
            "This reel changed in another tab. Refresh your reels and try again.",
        },
        409,
      );
    const state = reel.state as Record<string, unknown>;
    if (data.action === "duplicate") {
      const { fresh } = await import("@/lib/reel");
      const copy = {
        ...fresh(),
        id: crypto.randomUUID(),
        title: `Copy of ${reel.title}`.slice(0, 100),
        input: String(state.input || ""),
        details: state.details || fresh().details,
        languages: state.languages || ["English"],
        script: state.script || "native",
      };
      const result = await db.from("reelready_reels").insert({
        id: copy.id,
        owner_id: user.id,
        title: copy.title,
        state: copy,
        step: 0,
      });
      if (result.error) databaseError(result.error);
      return json({ id: copy.id });
    }
    const next = {
      ...state,
      ...(data.action === "rename"
        ? { title: data.title }
        : {
            archivedAt:
              data.action === "archive" ? new Date().toISOString() : null,
          }),
    };
    const result = await db
      .from("reelready_reels")
      .update({
        state: next,
        ...(data.action === "rename" ? { title: data.title } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("owner_id", user.id)
      .eq("updated_at", data.updatedAt)
      .select("id");
    if (result.error) databaseError(result.error);
    if (!result.data?.length)
      return json(
        {
          error:
            "This reel changed while saving. Refresh your reels and try again.",
        },
        409,
      );
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
});
