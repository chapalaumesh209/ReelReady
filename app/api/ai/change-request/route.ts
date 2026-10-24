import { withSession } from "@/lib/supabase/server";
import { body, failure, json } from "@/lib/server";
import { kitInput, publishingKit } from "@/lib/server/kits";
import { rateLimit } from "@/lib/server/rate-limit";
export const POST = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "change-request", 20);
    const data = await body(
      req,
      kitInput.refine((d) => !!d.current && !!d.instruction.trim()),
    );
    return json(
      await publishingKit(
        data,
        AbortSignal.any([req.signal, AbortSignal.timeout(55000)]),
      ),
    );
  } catch (e) {
    return failure(e);
  }
});
export const maxDuration = 60;
