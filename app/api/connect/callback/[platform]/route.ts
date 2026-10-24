import { z } from "zod";
import { withSession } from "@/lib/supabase/server";
import { finishOAuth } from "@/lib/server/social/oauth";
import { rateLimit } from "@/lib/server/rate-limit";
import { appOrigin } from "@/lib/server/config";
export const GET = withSession(async (req: Request) => {
  let status = "error";
  const platform = z
    .enum(["youtube", "instagram", "x"])
    .safeParse(new URL(req.url).pathname.split("/").pop());
  try {
    await rateLimit(req, "oauth-callback", 30);
    if (platform.success) status = await finishOAuth(req, platform.data);
  } catch {
    /* Provider details, tokens and authorization codes never leave the server. */
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${appOrigin(req)}/connect?connect_status=${status}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});
