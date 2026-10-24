import { after } from "next/server";
import { automationCallback } from "@/lib/server/automation/callback";
import { coordinatorTick } from "@/lib/server/automation/coordinator";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  return automationCallback(req, (input) =>
    coordinatorTick(input, (callback) => after(callback)),
  );
}
