import { automationCallback } from "@/lib/server/automation/callback";
import { authorizeProviderConnection } from "@/lib/server/provider/accounts";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  return automationCallback(req, async (input) => {
    return authorizeProviderConnection(input);
  });
}
