import { withSession } from "@/lib/supabase/server";
import { failure, json } from "@/lib/server";
import { repository, databaseError } from "@/lib/server/repository";
export { POST } from "../reels/route";
export const GET = withSession(async (req: Request) => {
  try {
    const { db } = await repository(req);
    const { data, error } = await db
      .from("reelready_reels")
      .select("state,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) databaseError(error);
    return json({
      state: data?.state || null,
      updatedAt: data?.updated_at || null,
    });
  } catch (e) {
    return failure(e);
  }
});
