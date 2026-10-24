import { positiveEnv } from "./hardening";
import { storageAdmin } from "../supabase";
import { digest, session } from "../server";
import { GenerationError } from "../generation";
import { databaseError } from "./repository";
export async function rateLimit(
  req: Request,
  action: string,
  max: number,
  seconds = 3600,
) {
  max = positiveEnv(
    `RATE_${action.toUpperCase().replaceAll("-", "_")}_PER_HOUR`,
    max,
  );
  const user = await session(req);
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "local";
  for (const subject of [`user:${user.id}`, `ip:${ip}`]) {
    const key = await digest(
      `${process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY}:${action}:${subject}`,
    );
    const { data, error } = await storageAdmin().rpc("reelready_take_limit", {
      p_key: key,
      p_limit: subject.startsWith("ip:")
        ? max * positiveEnv("RATE_IP_MULTIPLIER", 4)
        : max,
      p_seconds: seconds,
    });
    if (error) databaseError(error);
    if (data !== true)
      throw new GenerationError(
        "You have reached this step’s temporary usage limit. Please try again in an hour.",
        429,
      );
  }
}
