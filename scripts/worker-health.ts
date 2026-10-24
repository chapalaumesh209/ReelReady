import { storageAdmin } from "../lib/supabase";
import { workerPool, positiveEnv } from "../lib/server/hardening";
if (process.env.MEDIA_HEALTH_PORT) {
  const { mediaWorkerRuntime } = await import("../lib/server/media/runtime");
  const { port } = mediaWorkerRuntime();
  try {
    const result = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = result.ok ? ((await result.json()) as { ready?: unknown }) : null;
    process.exitCode = data?.ready === true ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
} else {
  const r = await storageAdmin()
    .from("reelready_workers")
    .select("id")
    .eq("pool", workerPool())
    .not("id", "like", "n8n-%")
    .gt(
      "heartbeat",
      new Date(
        Date.now() - positiveEnv("WORKER_HEARTBEAT_SECONDS", 60) * 1000,
      ).toISOString(),
    )
    .limit(1);
  process.exitCode = !r.error && r.data?.length ? 0 : 1;
}
