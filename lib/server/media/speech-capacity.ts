import { storageAdmin } from "../../supabase";
import { digest } from "../../server";
import { MediaError } from "./ffmpeg";
import { workerPool } from "../hardening";

export type SpeechCooldown = { until: string; daily: boolean };
async function capacityKey(
  model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
) {
  // The worker makes speech calls. Web credentials may differ, so availability
  // follows their shared execution pool rather than the web server's key.
  return `speech-cooldown:${await digest(
    JSON.stringify([workerPool(), model]),
  )}`;
}
export function speechCooldownMessage(cooldown: SpeechCooldown) {
  const next = new Date(cooldown.until).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  return `${
    cooldown.daily
      ? "The speech provider’s daily allowance is used up."
      : "The speech provider is temporarily limiting voice requests."
  } Next availability check: ${next} IST. The site owner can check the speech plan. Your script and completed voice segments are saved.`;
}
export async function speechCooldown(
  model?: string,
): Promise<SpeechCooldown | null> {
  const r = await storageAdmin()
    .from("reelready_rate_limits")
    .select("count,expires_at")
    .eq("key", await capacityKey(model))
    .maybeSingle();
  if (r.error)
    throw new MediaError(
      "Speech availability could not be checked. Your script is safe; please retry.",
    );
  if (!r.data || Date.parse(r.data.expires_at) <= Date.now()) return null;
  return { until: r.data.expires_at, daily: r.data.count === 1 };
}
export async function recordSpeechCooldown(
  cooldown: SpeechCooldown,
  model?: string,
) {
  const r = await storageAdmin()
    .from("reelready_rate_limits")
    .upsert({
      key: await capacityKey(model),
      count: cooldown.daily ? 1 : 2,
      expires_at: cooldown.until,
    });
  if (r.error)
    throw new MediaError(
      "The speech provider is unavailable. Your script is safe; check the speech plan before retrying.",
    );
}
/** Operator-only use after a successful live check of this same provider/model. */
export async function clearSpeechCooldown() {
  const r = await storageAdmin()
    .from("reelready_rate_limits")
    .delete()
    .eq("key", await capacityKey());
  if (r.error)
    throw new MediaError(
      "The speech check passed but its availability state could not be updated.",
    );
}
