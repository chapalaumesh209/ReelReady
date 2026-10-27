import { ttsConfiguration } from "@/lib/server/media/tts-config";
import { sampleOutputsAllowed } from "@/lib/server/ai";
import { json } from "@/lib/server";
import { generationConfiguration } from "@/lib/generation";
import { workerStatus } from "@/lib/server/media/status";
import { providerCapacity } from "@/lib/server/provider-budget";
import { demoMode } from "@/lib/server/config";
import { publishingExecutorStatus } from "@/lib/server/automation/status";
import { speechCooldown } from "@/lib/server/media/speech-capacity";
export const dynamic = "force-dynamic";
export async function GET() {
  const [worker, capacity, publishingExecutor, speechAvailable] =
    await Promise.all([
      workerStatus(),
      providerCapacity().catch(() => false),
      publishingExecutorStatus(),
      ttsConfiguration().configured
        ? speechCooldown()
            .then((x) => !x)
            .catch(() => false)
        : false,
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
      ttsConfiguration().configured && capacity && speechAvailable
        ? "live"
        : unavailable,
    worker: worker.status,
    publish: demoMode() ? "demo" : "real",
    publishingExecutor,
  });
}
