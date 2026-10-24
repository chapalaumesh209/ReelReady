import { sampleOutputsAllowed } from "@/lib/server/ai";
import { json } from "@/lib/server";
import { generationConfiguration } from "@/lib/generation";
import { workerStatus } from "@/lib/server/media/status";
import { providerCapacity } from "@/lib/server/provider-budget";
import { demoMode } from "@/lib/server/config";
import { publishingExecutorStatus } from "@/lib/server/automation/status";
export const dynamic = "force-dynamic";
export async function GET() {
  const [worker, capacity, publishingExecutor] = await Promise.all([
    workerStatus(),
    providerCapacity().catch(() => false),
    publishingExecutorStatus(),
  ]);
  const unavailable = sampleOutputsAllowed() ? "sample" : "offline";
  return json({
    generation:
      generationConfiguration().key && capacity ? "live" : unavailable,
    transcription:
      process.env.GEMINI_API_KEY &&
      process.env.SPEECH_TO_TEXT_PROVIDER !== "disabled" &&
      capacity
        ? "live"
        : unavailable,
    voice:
      process.env.GEMINI_API_KEY &&
      process.env.TTS_PROVIDER !== "disabled" &&
      capacity
        ? "live"
        : unavailable,
    worker: worker.status,
    publish: demoMode() ? "demo" : "real",
    publishingExecutor,
  });
}
