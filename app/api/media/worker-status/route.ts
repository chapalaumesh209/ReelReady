import { json } from "@/lib/server";
import { workerStatus } from "@/lib/server/media/status";
export const dynamic = "force-dynamic";
export async function GET() {
  return json(await workerStatus());
}
