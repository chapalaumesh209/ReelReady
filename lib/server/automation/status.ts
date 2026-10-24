import { storageAdmin } from "../../supabase";
import { positiveEnv, workerPool } from "../hardening";
import { workerStatus } from "../media/status";
import { publishExecutor } from "./config";

export async function publishingExecutorStatus() {
  const executor = publishExecutor();
  if (executor === "native")
    return { executor, status: (await workerStatus()).status };
  try {
    const r = await storageAdmin()
      .from("reelready_workers")
      .select("id")
      .eq("pool", workerPool())
      .like("id", "n8n-%")
      .gt(
        "heartbeat",
        new Date(
          Date.now() - positiveEnv("WORKER_HEARTBEAT_SECONDS", 60) * 1000,
        ).toISOString(),
      )
      .limit(1);
    return {
      executor,
      status:
        !r.error && r.data?.length ? ("online" as const) : ("offline" as const),
    };
  } catch {
    return { executor, status: "offline" as const };
  }
}
