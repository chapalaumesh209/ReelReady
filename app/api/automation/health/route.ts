import { automationCallback } from "@/lib/server/automation/callback";
import { hostedBackendHealth } from "@/lib/server/automation/coordinator";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: Request) {
  return automationCallback(req, hostedBackendHealth);
}
