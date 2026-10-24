import { createHash } from "node:crypto";
import { publishingProvider, providerWebhookBase } from "../provider/config";
import { storageAdmin } from "../../supabase";
import { positiveEnv, workerPool } from "../hardening";
import { workerStatus } from "../media/status";
import { publishExecutor } from "./config";

export function publisherCoordinatorPrefix() {
  if (publishingProvider() !== "uploadpost") return "n8n-";
  const fingerprint = createHash("sha256")
    .update(providerWebhookBase())
    .digest("hex")
    .slice(0, 12);
  return `n8n-${fingerprint}-`;
}

export async function publishingExecutorStatus() {
  const executor = publishExecutor();
  if (executor === "native")
    return { executor, status: (await workerStatus()).status };
  try {
    const r = await storageAdmin()
      .from("reelready_workers")
      .select("id")
      .eq("pool", workerPool())
      .like("id", `${publisherCoordinatorPrefix()}%`)
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
