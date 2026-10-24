import { automationCallback } from "@/lib/server/automation/callback";
import { authorizeProviderDelivery } from "@/lib/server/provider/delivery";
import { binaryMediaTransfer } from "@/lib/server/provider/config";
import { GenerationError } from "@/lib/generation";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  return automationCallback(req, async (input) => {
    if (binaryMediaTransfer())
      throw new GenerationError(
        "Hosted authorization requires PUBLISH_MEDIA_TRANSPORT=url. Large videos must be fetched directly from storage.",
        503,
      );
    return authorizeProviderDelivery(input);
  });
}
