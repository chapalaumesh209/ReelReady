import { json } from "@/lib/server";
import { publicLimits } from "@/lib/server/hardening";
export const dynamic = "force-dynamic";
export async function GET() {
  return json(publicLimits());
}
