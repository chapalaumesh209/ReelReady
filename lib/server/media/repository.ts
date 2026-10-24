import { z } from "zod";
import { positiveEnv, workerPool } from "../hardening";
import { GenerationError } from "../../generation";
import { digest, sign } from "../../server";
import { storageAdmin, VIDEO_BUCKET } from "../../supabase";
import { ownedReel, repository, databaseError } from "../repository";
import {
  defaultSettings,
  editSchema,
  type AudioState,
} from "../../audio/schema";
export async function ownedMedia(req: Request, id: string, reelId?: string) {
  const { db, user } = await repository(req);
  const query = db
    .from("reelready_media")
    .select("*")
    .eq("id", z.string().uuid().parse(id));
  if (reelId) query.eq("reel_id", reelId);
  const r = await query.maybeSingle();
  if (r.error) databaseError(r.error);
  if (!r.data)
    throw new GenerationError(
      "This media was not found in your workspace.",
      404,
    );
  return { asset: r.data, user, db };
}
export async function audioState(
  req: Request,
  reelId: string,
  sourceId?: string,
): Promise<AudioState | null> {
  const { db } = await ownedReel(req, reelId);
  const r = await db
    .from("reelready_audio_edits")
    .select("*")
    .eq("reel_id", reelId)
    .maybeSingle();
  if (r.error) databaseError(r.error);
  if (!sourceId || r.data?.source_id === sourceId) return r.data;
  const { asset, user } = await ownedMedia(req, sourceId, reelId);
  if (asset.kind !== "original")
    throw new GenerationError("Choose your original uploaded recording.", 400);
  const created = await storageAdmin()
    .from("reelready_audio_edits")
    .upsert({
      reel_id: reelId,
      owner_id: user.id,
      source_id: sourceId,
      settings: defaultSettings(),
      transcript: "",
      script: "",
      classification: "unknown",
      segments: [],
      rendered_id: null,
      approved_hash: null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (created.error) databaseError(created.error);
  return created.data;
}
export async function editHash(state: unknown) {
  return digest(JSON.stringify(editSchema.parse(state)));
}
export async function enqueue(
  req: Request,
  reelId: string,
  sourceId: string,
  kind: string,
  payload: Record<string, unknown>,
  retry = false,
) {
  const { asset, user } = await ownedMedia(req, sourceId, reelId);
  if (!["transcribe", "analyze"].includes(kind) && asset.kind !== "original")
    throw new GenerationError("This operation needs the original video.", 400);
  const fingerprint = await digest(
    JSON.stringify({ kind, sourceId, payload, pool: workerPool() }),
  );
  const r = await storageAdmin().rpc("reelready_enqueue_media_job", {
    p_owner: user.id,
    p_reel: reelId,
    p_source: sourceId,
    p_kind: kind,
    p_fingerprint: fingerprint,
    p_payload: payload,
    p_retry: retry,
    p_user_cap: positiveEnv("MAX_ACTIVE_JOBS_PER_USER", 2),
    p_global_cap: positiveEnv("MAX_QUEUED_JOBS", 100),
    p_pool: workerPool(),
  });
  if (r.error) {
    if (/QUEUE_FULL/.test(r.error.message))
      throw new GenerationError(
        "The processing queue is busy. Continue with original audio, or cancel an older job and try again.",
        429,
      );
    databaseError(r.error);
  }
  return r.data[0];
}
export async function assetLink(req: Request, id: string) {
  const { asset, user } = await ownedMedia(req, id);
  const signed = await storageAdmin()
    .storage.from(VIDEO_BUCKET)
    .createSignedUrl(asset.path, 3600);
  if (signed.error) databaseError(signed.error);
  const token = await sign(
    {
      visitor: user.id,
      path: asset.path,
      size: Number(asset.bytes),
      mime: asset.mime,
      name: asset.metadata?.name || `reelready-${asset.kind}.mp4`,
      kind: asset.kind,
    },
    "stored-video",
    30 * 86400,
  );
  return {
    id: asset.id,
    kind: asset.kind,
    metadata: asset.metadata,
    url: signed.data.signedUrl,
    stored: {
      token,
      path: asset.path,
      size: Number(asset.bytes),
      mime: asset.mime,
      name: asset.metadata?.name || `reelready-${asset.kind}.mp4`,
    },
  };
}
