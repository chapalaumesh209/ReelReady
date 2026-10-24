import { storageAdmin } from "../../supabase";
import { positiveEnv, workerPool } from "../hardening";
export async function workerStatus() {
  const maxAgeSeconds = positiveEnv("WORKER_HEARTBEAT_SECONDS", 60);
  try {
    const result = await storageAdmin()
      .from("reelready_workers")
      .select("heartbeat")
      .eq("pool", workerPool())
      .not("id", "like", "n8n-%")
      .gt(
        "heartbeat",
        new Date(Date.now() - maxAgeSeconds * 1000).toISOString(),
      )
      .limit(1);
    return {
      status:
        !result.error && !!result.data?.length
          ? ("online" as const)
          : ("offline" as const),
      maxAgeSeconds,
    };
  } catch {
    return { status: "offline" as const, maxAgeSeconds };
  }
}
