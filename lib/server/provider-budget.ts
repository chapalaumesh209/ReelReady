import { storageAdmin } from "../supabase";
import { GenerationError } from "../generation";
import { positiveEnv } from "./hardening";
export const providerBudgetKey = () =>
  `provider-day:${new Date().toISOString().slice(0, 10)}`;
export async function providerCapacity() {
  const r = await storageAdmin()
    .from("reelready_rate_limits")
    .select("count,expires_at")
    .eq("key", providerBudgetKey())
    .maybeSingle();
  if (r.error) return false;
  return (
    !r.data ||
    Date.parse(r.data.expires_at) <= Date.now() ||
    r.data.count < positiveEnv("DAILY_PROVIDER_CALL_LIMIT", 500)
  );
}
export async function takeProviderCall() {
  const now = new Date();
  const seconds = Math.max(
    1,
    Math.ceil(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) -
        Date.now()) /
        1000,
    ),
  );
  const r = await storageAdmin().rpc("reelready_take_limit", {
    p_key: providerBudgetKey(),
    p_limit: positiveEnv("DAILY_PROVIDER_CALL_LIMIT", 500),
    p_seconds: seconds,
  });
  if (r.error || r.data !== true)
    throw new GenerationError(
      "Demo capacity reached for today. Your work is saved. Keep original audio or try again tomorrow.",
      429,
    );
}
