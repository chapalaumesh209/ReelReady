/** Server only. Every storage operation is authorized with our visitor-bound
 * capability before the service client can bypass Supabase RLS. */
import { createAdminClient } from "@supabase/server/core";
import { z } from "zod";
import { GenerationError } from "./generation";
import { capability } from "./server";
export const VIDEO_BUCKET = "reelready-videos";
export const assetInput = z.object({
  draftId: z.string().uuid(),
  kind: z.enum(["original", "english", "source_audio"]),
  name: z.string().min(1).max(250),
  mime: z.enum([
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/webm",
    "audio/ogg",
    "audio/flac",
    "audio/aac",
  ]),
  size: z.number().int().positive().refine(Number.isSafeInteger),
  metadata: z
    .object({
      duration: z.number().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  lastModified: z.number().finite().nonnegative().default(0),
});
export type AssetInput = z.infer<typeof assetInput>;
export type StoredVideo = {
  token: string;
  name: string;
  mime: string;
  size: number;
  path: string;
};
export function storageConfiguration() {
  const url =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    publishableKey =
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      "",
    secret =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";
  return {
    url,
    publishableKey,
    secret,
    configured:
      !!url &&
      !!publishableKey &&
      (secret.startsWith("sb_secret_") || secret.startsWith("eyJ")) &&
      !/[•…\s]/.test(secret),
  };
}
export function storageAdmin() {
  const c = storageConfiguration();
  if (!c.configured)
    throw new GenerationError(
      "Cloud storage is not connected yet. Your recording remains available in this browser.",
      503,
    );
  return createAdminClient({
    env: {
      url: c.url,
      publishableKeys: { default: c.publishableKey },
      secretKeys: { default: c.secret },
    },
    supabaseOptions: {
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.timeout(30000),
          }),
      },
    },
  });
}
export function storageError(error: unknown): never {
  const e = error as { status?: number; statusCode?: string; message?: string };
  if (
    Number(e.statusCode || e.status) === 413 ||
    /maximum allowed size|size limit|exceeded.*size/i.test(e.message || "")
  )
    throw new GenerationError(
      "Supabase rejected the file under this project’s storage limit. Increase the limit in Supabase Storage settings and retry. ReelReady adds no file-size cap.",
      413,
    );
  if ([401, 403].includes(Number(e.statusCode || e.status)))
    throw new GenerationError(
      "Cloud storage needs its server connection updated. Your local recording is safe.",
      503,
    );
  throw new GenerationError(
    "Cloud storage could not finish this step. Your local recording is safe. Please retry.",
    502,
  );
}
export async function ensureVideoBucket() {
  const admin = storageAdmin(),
    result = await admin.storage.getBucket(VIDEO_BUCKET);
  if (result.data) {
    if (result.data.public)
      throw new GenerationError(
        "The ReelReady video bucket must be private before uploads can be enabled.",
        503,
      );
    return admin;
  }
  if (
    !["404", "400"].includes(String(result.error?.statusCode)) &&
    !/not found/i.test(result.error?.message || "")
  )
    storageError(result.error);
  const created = await admin.storage.createBucket(VIDEO_BUCKET, {
    public: false,
    allowedMimeTypes: [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp4",
      "audio/webm",
      "audio/ogg",
      "audio/flac",
      "audio/aac",
    ],
  });
  if (created.error && !/already exists/i.test(created.error.message))
    storageError(created.error);
  return admin;
}
export async function ownedAsset(req: Request, token: string) {
  const cap = await capability(req, token, "stored-video");
  if (
    typeof cap.path !== "string" ||
    !cap.path.startsWith(`${cap.visitor}/`) ||
    cap.path.includes("..") ||
    !Number.isSafeInteger(cap.size) ||
    Number(cap.size) <= 0
  )
    throw new GenerationError(
      "This video reference is invalid. Upload it again.",
      400,
    );
  return cap;
}
export async function verifiedAsset(req: Request, token: string) {
  const cap = await ownedAsset(req, token),
    admin = storageAdmin();
  const { data, error } = await admin.storage
    .from(VIDEO_BUCKET)
    .info(String(cap.path));
  if (error) storageError(error);
  if (!data || Number(data.size ?? data.metadata?.size) !== cap.size)
    throw new GenerationError(
      "The cloud upload is incomplete. Please resume the upload before continuing.",
      409,
    );
  return { cap, admin };
}
export async function storedURL(req: Request, token: string, expiresIn = 3600) {
  const { cap, admin } = await verifiedAsset(req, token);
  const { data, error } = await admin.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(String(cap.path), expiresIn);
  if (error || !data) storageError(error);
  return { cap, url: data.signedUrl };
}
