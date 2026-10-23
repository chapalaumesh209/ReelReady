import { z } from "zod";
import { body, failure, json, limit, session } from "@/lib/server";
import { storageAdmin, storageError } from "@/lib/supabase";
export async function GET(req: Request) {
  try {
    const visitor = await session(req);
    const { data, error } = await storageAdmin()
      .from("reelready_drafts")
      .select("state,updated_at")
      .eq("visitor_id", visitor.id)
      .maybeSingle();
    if (error) storageError(error);
    return json({
      state: data?.state || null,
      updatedAt: data?.updated_at || null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const visitor = await session(req);
    limit(visitor.id, "draft-save", 1200);
    const { state } = await body(
      req,
      z.object({
        state: z
          .object({ id: z.string().uuid(), version: z.literal(2) })
          .passthrough(),
      }),
    );
    const { error } = await storageAdmin()
      .from("reelready_drafts")
      .upsert(
        {
          visitor_id: visitor.id,
          draft_id: state.id,
          state,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "visitor_id" },
      );
    if (error) storageError(error);
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
