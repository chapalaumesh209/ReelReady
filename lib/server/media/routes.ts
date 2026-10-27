import { ttsConfiguration } from "./tts-config";
import { z } from "zod";
import { providerCapacity } from "../provider-budget";
import { body, failure, json } from "../../server";
import { GenerationError } from "../../generation";
import { withSession } from "../../supabase/server";
import { rateLimit } from "../rate-limit";
import { storageAdmin } from "../../supabase";
import { ownedReel, databaseError } from "../repository";
import {
  audioState,
  editHash,
  enqueue,
  ownedMedia,
  mediaRequestFingerprint,
} from "./repository";
import { editSchema, needsNarration, untouched } from "../../audio/schema";
import { speechCooldown, speechCooldownMessage } from "./speech-capacity";
const input = z.object({
  reelId: z.string().uuid(),
  sourceId: z.string().uuid(),
  retry: z.boolean().default(false),
  confirmed: z.boolean().default(false),
  recordingId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
});
export function mediaAction(kind: string) {
  return withSession(async (req: Request) => {
    try {
      const data = await body(req, input);
      const { db, user } = await ownedReel(req, data.reelId);
      if (data.requestId) {
        const prior = await db
          .from("reelready_media_jobs")
          .select(jobSelect)
          .eq("reel_id", data.reelId)
          .eq("source_id", data.sourceId)
          .eq("kind", kind)
          .eq(
            "fingerprint",
            await mediaRequestFingerprint(
              user.id,
              data.reelId,
              data.sourceId,
              kind,
              data.requestId,
            ),
          )
          .maybeSingle();
        if (prior.error) databaseError(prior.error);
        // Replaying a lost response must not enqueue, restart or charge a second job.
        if (prior.data) return json(prior.data, 202);
      }
      const state = await audioState(req, data.reelId);
      if (!state || state.source_id !== data.sourceId)
        throw new GenerationError(
          "Open Audio & Voice for this recording first.",
          409,
        );
      const { asset } = await ownedMedia(req, data.sourceId, data.reelId);
      if (kind !== "analyze" && !asset.metadata?.decoded)
        throw new GenerationError(
          "Wait for the recording inspection to finish first.",
          409,
        );
      if (!["render", "analyze"].includes(kind) && !(await providerCapacity()))
        throw new GenerationError(
          "Demo capacity reached for today. Keep original audio or try again tomorrow.",
          429,
        );
      const payload: Record<string, unknown> = {
        ...editSchema.parse(state),
        stateHash: await editHash(state),
      };
      if (["generate", "render", "english"].includes(kind) && !data.confirmed)
        throw new GenerationError(
          "Review and approve these settings first.",
          400,
        );
      if (
        ["preview", "generate", "english"].includes(kind) &&
        !ttsConfiguration().configured
      )
        throw new GenerationError(
          "Voice generation needs a configured voice service. You can keep, mute, or mix an uploaded recording instead.",
          503,
        );
      if (
        ["transcribe", "suggest", "english"].includes(kind) &&
        (!process.env.GEMINI_API_KEY ||
          (kind === "transcribe"
            ? process.env.SPEECH_TO_TEXT_PROVIDER === "disabled"
            : process.env.VIDEO_ANALYSIS_PROVIDER === "disabled"))
      )
        throw new GenerationError(
          "This action needs a configured Gemini media service. Your script can still be typed or dictated.",
          503,
        );
      if (
        kind === "generate" &&
        (!state.script.trim() || !state.segments.length)
      )
        throw new GenerationError(
          "Write and approve your narration script first.",
          400,
        );
      if (kind === "transcribe") {
        if (data.recordingId) {
          const recording = await ownedMedia(
            req,
            data.recordingId,
            data.reelId,
          );
          if (recording.asset.kind !== "source_audio")
            throw new GenerationError(
              "Choose an uploaded voice recording.",
              400,
            );
          payload.recordingId = data.recordingId;
        } else if (!asset.metadata.hasAudio)
          throw new GenerationError(
            "This video has no audio track. Type a script or upload a voice recording.",
            400,
          );
      }
      if (
        kind === "render" &&
        !untouched(state.settings) &&
        needsNarration(state.settings) &&
        state.segments.some((s) => !s.assetId)
      )
        throw new GenerationError(
          "Generate narration or use an uploaded recording before rendering.",
          409,
        );
      if (["preview", "generate", "english"].includes(kind)) {
        const cooldown = await speechCooldown();
        if (cooldown)
          throw new GenerationError(
            speechCooldownMessage(cooldown),
            429,
            "SPEECH_PROVIDER_LIMIT",
          );
      }
      // Invalid input, provider cooldowns and duplicate delivery are not new jobs.
      await rateLimit(
        req,
        `media-${kind}`,
        ["render", "english"].includes(kind) ? 5 : 10,
      );
      const job = await enqueue(
        req,
        data.reelId,
        data.sourceId,
        kind,
        payload,
        data.retry,
        data.requestId,
      );
      if (
        kind === "render" &&
        job.status === "completed" &&
        job.result?.assetId
      ) {
        const output = await ownedMedia(
          req,
          String(job.result.assetId),
          data.reelId,
        );
        if (
          output.asset.id !== data.sourceId &&
          output.asset.metadata.settingsHash !== payload.stateHash
        )
          throw new GenerationError(
            "This saved rendering belongs to different settings.",
            409,
          );
        const restored = await storageAdmin()
          .from("reelready_audio_edits")
          .update({
            rendered_id: output.asset.id,
            approved_hash: payload.stateHash,
            updated_at: new Date().toISOString(),
          })
          .eq("reel_id", data.reelId)
          .eq("source_id", data.sourceId)
          .eq("updated_at", state.updated_at)
          .select("reel_id");
        if (restored.error) databaseError(restored.error);
        job.result.applied = !!restored.data?.length;
      }
      return json(job, 202);
    } catch (e) {
      return failure(e);
    }
  });
}
export const jobSelect =
  "id,source_id,kind,status,stage,result,safe_error,created_at,updated_at";
export async function jobList(req: Request, reelId: string) {
  const { db } = await ownedReel(req, reelId);
  const r = await db
    .from("reelready_media_jobs")
    .select(jobSelect)
    .eq("reel_id", reelId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (r.error) databaseError(r.error);
  return r.data;
}
