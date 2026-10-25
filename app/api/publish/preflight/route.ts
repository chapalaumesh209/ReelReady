import { body, failure, json } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import {
  preflightInput,
  publishPreflight,
} from "@/lib/server/publishing/preflight";
import { rateLimit } from "@/lib/server/rate-limit";
export const maxDuration = 60;
export const POST = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "publish-preflight", 30);
    return json(await publishPreflight(req, await body(req, preflightInput)));
  } catch (e) {
    return failure(e);
  }
});
