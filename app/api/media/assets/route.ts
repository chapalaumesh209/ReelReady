import { z } from "zod";
import { failure, json } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import { assetLink } from "@/lib/server/media/repository";
export const GET = withSession(async (req: Request) => {
  try {
    return json(
      await assetLink(
        req,
        z.string().uuid().parse(new URL(req.url).searchParams.get("id")),
      ),
    );
  } catch (e) {
    return failure(e);
  }
});
