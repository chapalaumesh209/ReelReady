import { z } from "zod";
import { storageAdmin } from "../../supabase";
import { GenerationError } from "../../generation";
import { workerPool } from "../hardening";
import { demoMode } from "../config";
import { databaseError } from "../repository";
import { publishExecutor } from "./config";
import { publisherCoordinatorPrefix } from "./status";
import { publishingProvider, binaryMediaTransfer } from "../provider/config";
import { publicationWorkerOnce } from "../social/worker";

export async function hostedBackendHealth(input: unknown) {
  z.object({}).strict().parse(input);
  if (
    publishExecutor() !== "n8n" ||
    publishingProvider() !== "uploadpost" ||
    binaryMediaTransfer()
  )
    throw new GenerationError(
      "Configure hosted n8n publishing with signed URL transport.",
      503,
    );
  const result = await storageAdmin()
    .from("reelready_jobs")
    .select("id")
    .limit(0);
  if (result.error) databaseError(result.error);
  return { ready: true };
}
export async function coordinatorTick(
  input: unknown,
  schedule: (callback: () => Promise<void>) => void,
  run: (id: string) => Promise<boolean> = publicationWorkerOnce,
) {
  await hostedBackendHealth(input);
  const id = `${publisherCoordinatorPrefix()}vercel-coordinator`;
  async function heartbeat() {
    const result = await storageAdmin()
      .from("reelready_workers")
      .upsert({ id, pool: workerPool(), heartbeat: new Date().toISOString() });
    if (result.error) databaseError(result.error);
  }
  await heartbeat();
  const demo = demoMode();
  if (!demo)
    schedule(async () => {
      try {
        await run(`vercel-${crypto.randomUUID()}`);
      } catch {
        // Leases/checkpoints remain durable. Later ticks recover safely; never log
        // provider bodies, tokens, signed URLs or silently start a duplicate upload.
        console.error(
          "Publishing coordinator paused; saved delivery will be checked on a later tick.",
        );
      } finally {
        await heartbeat();
      }
    });
  // Return before the background callback calls n8n again, so a single-slot n8n
  // instance can finish its coordinator execution and run the publishing webhook.
  return { accepted: !demo, demo };
}
