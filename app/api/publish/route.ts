import { z } from "zod";
import { withSession } from "@/lib/supabase/server";
import { body, failure, json } from "@/lib/server";
import {
  prepareInput,
  prepareJob,
  sendJob,
  retryJob,
} from "@/lib/server/publishing/jobs";
import { rateLimit } from "@/lib/server/rate-limit";
export const POST = withSession(async (req: Request) => {
  try {
    const data = await body(
      req,
      z.union([
        prepareInput,
        z.object({
          action: z.enum(["send", "retry"]),
          id: z.string().uuid(),
          confirmed: z.literal(true),
        }),
      ]),
    );
    await rateLimit(
      req,
      data.action === "prepare" ? "publish-prepare" : "publish",
      data.action === "prepare" ? 10 : 5,
    );
    return json(
      data.action === "prepare"
        ? await prepareJob(req, data)
        : data.action === "retry"
          ? await retryJob(req, data.id)
          : await sendJob(req, data.id),
    );
  } catch (e) {
    return failure(e);
  }
});
export { GET } from "./status/route";

export const maxDuration = 60;
