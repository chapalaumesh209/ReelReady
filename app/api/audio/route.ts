import { ttsConfiguration } from "@/lib/server/media/tts-config";
import { z } from "zod";
import { workerStatus } from "@/lib/server/media/status";
import { body, failure, json } from "@/lib/server";
import { withSession } from "@/lib/supabase/server";
import { verifiedAsset, storageAdmin } from "@/lib/supabase";
import { ownedReel, databaseError } from "@/lib/server/repository";
import {
  audioState,
  editHash,
  ownedMedia,
} from "@/lib/server/media/repository";
import {
  defaultSettings,
  editSchema,
  type AudioState,
} from "@/lib/audio/schema";
import { rateLimit } from "@/lib/server/rate-limit";
import { GenerationError } from "@/lib/generation";
import {
  speechCooldown,
  speechCooldownMessage,
} from "@/lib/server/media/speech-capacity";
export const GET = withSession(async (req: Request) => {
  try {
    const reelId = z
      .string()
      .uuid()
      .parse(new URL(req.url).searchParams.get("reelId"));
    const { db } = await ownedReel(req, reelId);
    const state = await audioState(req, reelId);
    const media = await db
      .from("reelready_media")
      .select("id,kind,mime,bytes,metadata")
      .eq("reel_id", reelId)
      .order("created_at", { ascending: false });
    if (media.error) databaseError(media.error);
    const worker = await workerStatus();
    const cooldown = ttsConfiguration().configured
      ? await speechCooldown()
      : null;
    return json({
      state,
      assets: media.data,
      workerReady: worker.status === "online",
      speechReady: ttsConfiguration().configured && !cooldown,
      speechUnavailableReason: cooldown
        ? speechCooldownMessage(cooldown)
        : undefined,
      transcriptionReady:
        !!process.env.GEMINI_API_KEY &&
        process.env.SPEECH_TO_TEXT_PROVIDER !== "disabled",
      speechModel: ttsConfiguration().model,
      voiceDirectionsOnly: ttsConfiguration().voiceDirectionsOnly,
      settings: defaultSettings(),
    });
  } catch (e) {
    return failure(e);
  }
});
export const POST = withSession(async (req: Request) => {
  try {
    await rateLimit(req, "audio-save", 600);
    const data = await body(
      req,
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("original"),
          reelId: z.string().uuid(),
          sourceId: z.string().uuid(),
        }),
        z.object({
          action: z.literal("init"),
          reelId: z.string().uuid(),
          token: z.string().max(5000),
        }),
        z.object({
          action: z.literal("save"),
          reelId: z.string().uuid(),
          sourceId: z.string().uuid(),
          edit: editSchema,
        }),
      ]),
    );
    const { db, user } = await ownedReel(req, data.reelId);
    if (data.action === "init") {
      const { cap } = await verifiedAsset(req, data.token);
      const source = await db
        .from("reelready_media")
        .select("id")
        .eq("path", String(cap.path))
        .eq("reel_id", data.reelId)
        .eq("kind", "original")
        .single();
      if (source.error) databaseError(source.error);
      return json(await audioState(req, data.reelId, source.data.id));
    }
    const old = await audioState(req, data.reelId);
    if (!old || old.source_id !== data.sourceId)
      throw new GenerationError(
        "The recording changed. Reopen Audio & Voice.",
        409,
      );
    if (data.action === "original") {
      // No render or inspection is required to select an unchanged source.
      await ownedMedia(req, data.sourceId, data.reelId);
      await storageAdmin()
        .from("reelready_media_jobs")
        .update({
          status: "cancelled",
          stage: "Cancelled; original preserved",
          updated_at: new Date().toISOString(),
        })
        .eq("owner_id", user.id)
        .eq("reel_id", data.reelId)
        .in("status", ["queued", "running"]);
      const edit = editSchema.parse({
        ...old,
        settings: {
          ...defaultSettings(),
          ...(old.settings.creatorInstructions !== undefined
            ? { creatorInstructions: old.settings.creatorInstructions }
            : {}),
          ...(old.settings.voiceProfile
            ? {
                voiceProfile: old.settings.voiceProfile,
                style: old.settings.style,
              }
            : {}),
        },
      });
      const r = await storageAdmin()
        .from("reelready_audio_edits")
        .update({
          ...edit,
          rendered_id: data.sourceId,
          approved_hash: await editHash(edit),
          updated_at: new Date().toISOString(),
        })
        .eq("owner_id", user.id)
        .eq("reel_id", data.reelId)
        .eq("source_id", data.sourceId)
        .select()
        .single();
      if (r.error) databaseError(r.error);
      return json(r.data);
    }
    for (const s of data.edit.segments)
      if (s.assetId) {
        const { asset } = await ownedMedia(req, s.assetId, data.reelId);
        if (!["voiceover", "source_audio"].includes(asset.kind))
          throw new GenerationError("Use a narration audio asset.", 400);
        s.duration = asset.metadata.duration;
        if (
          asset.kind === "voiceover" &&
          asset.metadata.fingerprint !== s.fingerprint
        )
          throw new GenerationError(
            "Regenerate this segment after changing its words or voice.",
            409,
          );
      }
    const unchanged = (await editHash(old)) === (await editHash(data.edit));
    const saved = await storageAdmin()
      .from("reelready_audio_edits")
      .update({
        ...data.edit,
        rendered_id: unchanged ? old.rendered_id : null,
        approved_hash: unchanged ? old.approved_hash : null,
        updated_at: new Date().toISOString(),
      })
      .eq("reel_id", data.reelId)
      .eq("owner_id", user.id)
      .select()
      .single();
    if (saved.error) databaseError(saved.error);
    return json(saved.data as AudioState);
  } catch (e) {
    return failure(e);
  }
});
