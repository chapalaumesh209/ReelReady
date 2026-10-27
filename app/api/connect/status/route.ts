import { ttsConfiguration } from "@/lib/server/media/tts-config";
import { withSession } from "@/lib/supabase/server";
import { session, failure, json } from "@/lib/server";
import { connectionStatus } from "@/lib/server/connections";
import { generationConfiguration } from "@/lib/generation";
import { demoMode } from "@/lib/server/config";
export const GET = withSession(async (req: Request) => {
  try {
    await session(req, true);
    return json({
      ...(await connectionStatus(req)),
      aiConfigured: demoMode() || !!generationConfiguration().key,
      speechConfigured: ttsConfiguration().configured,
    });
  } catch (e) {
    return failure(e);
  }
});
