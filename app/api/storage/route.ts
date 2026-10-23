import { z } from "zod";
import {
  body,
  digest,
  failure,
  json,
  limit,
  session,
  sign,
} from "@/lib/server";
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
  z.object({ action: z.literal("complete"), token: z.string().max(5000) }),
]);
export async function GET(req: Request) {
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
export async function POST(req: Request) {
  try {
    const visitor = await session(req),
      data = await body(req, actions);
    if (data.action === "complete") {
      const { cap } = await verifiedAsset(req, data.token);
      return json({
        token: data.token,
        path: cap.path,
        size: cap.size,
        mime: cap.mime,
        name: cap.name,
      });
    }
    limit(visitor.id, "storage-prepare", 30);
    const admin = await ensureVideoBucket(),
      fingerprint = await digest(
        JSON.stringify([data.name, data.size, data.lastModified, data.mime]),
      );
    const extension =
      data.mime === "video/webm"
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
export async function DELETE(req: Request) {
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
    return json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}
