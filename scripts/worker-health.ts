import { storageAdmin } from "../lib/supabase";
import { workerPool, positiveEnv } from "../lib/server/hardening";
const r = await storageAdmin()
  .from("reelready_workers")
  .select("id")
  .eq("pool", workerPool())
  .gt(
    "heartbeat",
    new Date(
      Date.now() - positiveEnv("WORKER_HEARTBEAT_SECONDS", 60) * 1000,
    ).toISOString(),
  )
  .limit(1);
process.exitCode = !r.error && r.data?.length ? 0 : 1;
