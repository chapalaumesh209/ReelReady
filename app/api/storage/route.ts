import { enforceUpload } from "@/lib/server/hardening";
import { enqueue } from "@/lib/server/media/repository";
import { defaultSettings } from "@/lib/audio/schema";
import { ensureReel, databaseError } from "@/lib/server/repository";
import { rateLimit } from "@/lib/server/rate-limit";
import { withSession } from "@/lib/supabase/server";
import { z } from "zod";
import { body, digest, failure, json, session, sign } from "@/lib/server";
import {
  assetInput,
  ensureVideoBucket,
  ownedAsset,
  storageAdmin,
  storageConfiguration,
  storageError,
  storedURL,
  VIDEO_BUCKET,
  verifiedAsset,
} from "@/lib/supabase";
const actions = z.discriminatedUnion("action", [
  assetInput.extend({ action: z.literal("prepare") }),
  z.object({
    action: z.literal("complete"),
    token: z.string().max(5000),
    metadata: z
      .object({
        duration: z.number().positive(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .optional(),
  }),
]);
async function handleGET(req: Request) {
  try {
    await session(req);
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return json({ configured: storageConfiguration().configured });
    const { url, cap } = await storedURL(req, token);
    return json({ url, size: cap.size, mime: cap.mime, name: cap.name });
  } catch (e) {
    return failure(e);
  }
}
async function handlePOST(req: Request) {
  try {
    const visitor = await session(req),
      data = await body(req, actions);
    if (data.action === "complete") {
      await rateLimit(req, "upload-registration", 10);
      const { cap } = await verifiedAsset(req, data.token);
      enforceUpload(Number(cap.size), data.metadata?.duration);
      if (cap.kind !== "source_audio" && !data.metadata)
        return json(
          {
            error:
              "We could not read the video length. Choose a playable video and retry.",
          },
          400,
        );
      const pieces = String(cap.path).split("/");
      const reelId = z.string().uuid().parse(pieces[1]);
      const { user } = await ensureReel(req, reelId);
      const saved = await storageAdmin()
        .from("reelready_media")
        .upsert(
          {
            owner_id: user.id,
            reel_id: reelId,
            kind: cap.kind,
            bucket: VIDEO_BUCKET,
            path: cap.path,
            mime: cap.mime,
            bytes: cap.size,
            metadata: data.metadata || {},
            processing_state: cap.kind === "english" ? "ready" : "uploaded",
          },
          { onConflict: "path", ignoreDuplicates: true },
        );
      if (saved.error) databaseError(saved.error);
      const stored = await storageAdmin()
        .from("reelready_media")
        .select("id")
        .eq("path", String(cap.path))
        .eq("owner_id", user.id)
        .single();
      if (stored.error) databaseError(stored.error);
      const analysisJob =
        cap.kind === "source_audio"
          ? await enqueue(req, reelId, stored.data!.id, "analyze", {
              settings: defaultSettings(),
            })
          : undefined;
      return json({
        id: stored.data!.id,
        analysisJob,
        token: data.token,
        path: cap.path,
        size: cap.size,
        mime: cap.mime,
        name: cap.name,
      });
    }
    enforceUpload(data.size, data.metadata?.duration);
    if (data.kind !== "source_audio" && !data.metadata)
      return json(
        {
          error:
            "We could not read the video length. Choose a playable video and retry.",
        },
        400,
      );
    await rateLimit(req, "upload-prepare", 10);
    await ensureReel(req, data.draftId);
    const admin = await ensureVideoBucket(),
      fingerprint = await digest(
        JSON.stringify([data.name, data.size, data.lastModified, data.mime]),
      );
    if ((data.kind === "source_audio") !== data.mime.startsWith("audio/"))
      return json(
        { error: "Choose a supported video or narration audio file." },
        400,
      );
    const extension =
      data.kind === "source_audio"
        ? (
            {
              "audio/wav": "wav",
              "audio/x-wav": "wav",
              "audio/mpeg": "mp3",
              "audio/mp4": "m4a",
              "audio/webm": "webm",
              "audio/ogg": "ogg",
              "audio/flac": "flac",
              "audio/aac": "aac",
            } as Record<string, string>
          )[data.mime] || "audio"
        : data.mime === "video/webm"
          ? "webm"
          : data.mime === "video/quicktime"
            ? "mov"
            : "mp4";
    const path = `${visitor.id}/${data.draftId}/${data.kind}-${fingerprint}.${extension}`;
    const token = await sign(
      {
        visitor: visitor.id,
        path,
        size: data.size,
        mime: data.mime,
        name: data.name,
        kind: data.kind,
      },
      "stored-video",
      30 * 86400,
    );
    const existing = await admin.storage.from(VIDEO_BUCKET).info(path);
    if (
      existing.data &&
      Number(existing.data.size ?? existing.data.metadata?.size) === data.size
    )
      return json({
        alreadyUploaded: true,
        token,
        path,
        size: data.size,
        mime: data.mime,
        name: data.name,
      });
    const { data: upload, error } = await admin.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !upload) storageError(error);
    const config = storageConfiguration(),
      host = new URL(config.url);
    host.hostname = host.hostname.replace(
      /\.supabase\.co$/,
      ".storage.supabase.co",
    );
    return json({
      alreadyUploaded: false,
      token,
      path,
      uploadToken: upload.token,
      endpoint: `${host.origin}/storage/v1/upload/resumable/sign`,
      publishableKey: config.publishableKey,
      bucket: VIDEO_BUCKET,
    });
  } catch (e) {
    return failure(e);
  }
}
async function handleDELETE(req: Request) {
  try {
    const { token } = await body(
        req,
        z.object({ token: z.string().max(5000) }),
      ),
      cap = await ownedAsset(req, token);
    const { error } = await storageAdmin()
      .storage.from(VIDEO_BUCKET)
      .remove([String(cap.path)]);
    if (error) storageError(error);
    const removed = await storageAdmin()
      .from("reelready_media")
      .delete()
      .eq("path", String(cap.path))
      .eq("owner_id", String(cap.visitor));
    if (removed.error) databaseError(removed.error);
    return json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}

export const GET = withSession(handleGET);

export const POST = withSession(handlePOST);

export const DELETE = withSession(handleDELETE);
