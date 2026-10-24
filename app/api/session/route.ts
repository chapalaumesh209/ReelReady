import { session, failure, json } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import { demoMode } from "@/lib/server/config";
export const GET = withSession(async (req: Request) => {
  try {
    const user = await session(req, true);
    return json({ id: user.id, demo: demoMode() });
  } catch (e) {
    return failure(e);
  }
});
