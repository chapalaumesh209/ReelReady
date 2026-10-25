import { json } from "@/lib/server";
import { publicLimits } from "@/lib/server/hardening";
import { demoMode } from "@/lib/server/config";
import { sampleOutputsAllowed } from "@/lib/server/ai";
export const dynamic = "force-dynamic";
export async function GET() {
  return json({
    ...publicLimits(),
    samplesAvailable: demoMode() && sampleOutputsAllowed(),
  });
}
