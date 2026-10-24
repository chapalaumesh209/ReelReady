import { z } from "zod";
import { GenerationError } from "../../generation";
import { storageAdmin, verifiedAsset, VIDEO_BUCKET } from "../../supabase";
import { ownedReel, databaseError } from "../repository";
import { connectionStatus } from "../connections";
import { demoMode } from "../config";
import {
  publishingProvider,
  binaryMediaTransfer,
  realPublishingConfigured,
} from "../provider/config";
import { publishingExecutorStatus } from "../automation/status";
import { positiveEnv } from "../hardening";
import { publishInput, type PublishInput } from "../../workflow";
import {
  isPlaceholderKit,
  characterCount,
  hashtagCount,
  xCount,
  hasLinks,
} from "../../content";
import type { PublishPreflight } from "../../publish-preflight";
export function publicMediaURL(value: string) {
  try {
    const u = new URL(value),
      h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      !h.includes(".") ||
      /(^|\.)(localhost|local|internal|docker|test|invalid)$/.test(h) ||
      h.includes("supabase_kong") ||
      h === "host.docker.internal"
    )
      return false;
    if (h.includes(":")) return false; // conservative: signed publisher URLs must use public DNS or IPv4
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const [a, b] = h.split(".").map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && [0, 168].includes(b)) ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 198 && [18, 19, 51].includes(b)) ||
        (a === 203 && b === 0)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export const signedURLTTL = () =>
  Math.min(604800, positiveEnv("PUBLISH_SIGNED_URL_TTL_SECONDS", 172800));
export function mediaSpecIssues(
  metadata: Record<string, unknown>,
  mime: string,
): string[] {
  const issues: string[] = [];
  if (
    mime !== "video/mp4" ||
    metadata.decoded !== true ||
    metadata.videoCodec !== "h264" ||
    metadata.audioCodec !== "aac"
  )
    issues.push(
      "Use a verified MP4 with H.264 video and AAC audio. Stream inspection is required to verify codecs.",
    );
  const duration = Number(metadata.duration),
    ratio = Number(metadata.width) / Number(metadata.height);
  if (!Number.isFinite(duration) || duration < 5 || duration > 90)
    issues.push("Video should be 5 to 90 seconds long.");
  if (!Number.isFinite(ratio) || Math.abs(ratio - 9 / 16) > 0.01)
    issues.push("Use a portrait 9:16 video.");
  return issues;
}
export function captionIssues(
  data: Pick<PublishInput, "platforms" | "instagram" | "youtubeTitle" | "x">,
) {
  const blockers: string[] = [],
    warnings: string[] = [];
  if (
    data.platforms.includes("youtube") &&
    (!data.youtubeTitle.trim() || characterCount(data.youtubeTitle) > 100)
  )
    blockers.push("YouTube title must contain 1 to 100 characters.");
  if (
    data.platforms.includes("x") &&
    (!data.x.trim() || xCount(data.x) > 280 || hasLinks(data.x))
  )
    blockers.push(
      "X text must contain 1 to 280 weighted characters and no links.",
    );
  if (data.platforms.includes("instagram")) {
    const tags = hashtagCount(data.instagram);
    if (!data.instagram.trim() || characterCount(data.instagram) > 2200)
      blockers.push("Instagram caption must contain 1 to 2,200 characters.");
    const limit = positiveEnv("INSTAGRAM_HASHTAG_LIMIT", 5);
    if (tags > limit)
      blockers.push(
        `Keep Instagram within the configured ${limit}-hashtag limit.`,
      );
    else if (tags > 5)
      warnings.push(
        `Instagram has ${tags} hashtags. Consider 3 to 5 specific tags.`,
      );
  }
  return { blockers, warnings };
}
export const preflightInput = publishInput.extend({
  assetToken: z.string().min(1).max(5000),
  instagram: z.string().max(6000),
  youtubeTitle: z.string().max(6000),
  x: z.string().max(6000),
});
export async function publishingUsage(owner: string) {
  const now = new Date(),
    day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString(),
    month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
  const r = await storageAdmin()
    .from("reelready_publish_usage")
    .select("kind,created_at")
    .eq("owner_id", owner)
    .gte("created_at", month);
  if (r.error) databaseError(r.error);
  return {
    uploadsThisMonth: r.data.filter((v) => v.kind === "upload").length,
    xPostsToday: r.data.filter((v) => v.kind === "x" && v.created_at >= day)
      .length,
  };
}
export async function publishPreflight(
  req: Request,
  data: z.infer<typeof preflightInput>,
): Promise<PublishPreflight> {
  const { db, user, reel } = await ownedReel(req, data.draftId);
  const { cap } = await verifiedAsset(req, data.assetToken);
  const r = await db
    .from("reelready_media")
    .select("*")
    .eq("path", String(cap.path))
    .eq("reel_id", data.draftId)
    .maybeSingle();
  if (r.error) databaseError(r.error);
  if (!r.data)
    throw new GenerationError(
      "Attach this video to your reel before publishing.",
      409,
    );
  const demo = demoMode(),
    report = captionIssues(data),
    connected: Record<string, boolean> = {};
  const currentKit = reel.state?.kits?.[reel.state?.kitLanguage || "English"];
  if (!demo && (reel.state?.analysis?.sample || isPlaceholderKit(currentKit)))
    report.blockers.push(
      "Replace sample captions by analyzing your actual recording before publishing.",
    );
  if (
    !demo &&
    reel.state?.analysis?.origin === "recording" &&
    reel.state.analysis.assetPath &&
    reel.state.analysis.assetPath !== r.data.path
  )
    report.blockers.push(
      "The captions describe a different video version. Analyze your selected video again before publishing.",
    );
  let accounts;
  try {
    accounts = await connectionStatus(req);
  } catch {
    report.blockers.push(
      "Account connections could not be verified. Please refresh them.",
    );
  }
  for (const platform of data.platforms) {
    connected[platform] = !!accounts?.accounts[platform]?.connected;
    if (!connected[platform])
      (demo ? report.warnings : report.blockers).push(
        `${platform}: no connected account${demo ? "; demo is still available" : ""}.`,
      );
  }
  const spec = mediaSpecIssues(r.data.metadata, r.data.mime);
  for (const platform of data.platforms)
    for (const issue of spec)
      (platform === "instagram" && !demo
        ? report.blockers
        : report.warnings
      ).push(`${platform}: ${issue}`);
  const ttl = signedURLTTL(),
    expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const signed = await storageAdmin()
    .storage.from(VIDEO_BUCKET)
    .createSignedUrl(r.data.path, ttl);
  const publicURL = !!signed.data && publicMediaURL(signed.data.signedUrl);
  if (!publicURL && !binaryMediaTransfer())
    (demo ||
    (publishingProvider() !== "uploadpost" &&
      !data.platforms.includes("instagram"))
      ? report.warnings
      : report.blockers
    ).push(
      "The publisher needs a public signed HTTPS media URL. Local storage addresses cannot be fetched by social platforms.",
    );
  if (
    !binaryMediaTransfer() &&
    data.scheduledAt &&
    Date.parse(data.scheduledAt) + 300000 >= Date.parse(expiresAt)
  )
    (demo ? report.warnings : report.blockers).push(
      "The signed media URL would expire before the scheduled publish time. Choose an earlier time or increase the configured URL lifetime.",
    );
  if (!demo && !realPublishingConfigured())
    report.blockers.push(
      "Real publishing is not configured by the site owner.",
    );
  const usage = await publishingUsage(user.id);
  const worker = await publishingExecutorStatus();
  if (!demo && worker.status === "offline")
    report.warnings.push(
      "Publishing will wait until processing is available. Your confirmed request stays saved in the queue.",
    );
  return {
    demo,
    connected,
    captions: {
      instagramHashtags: hashtagCount(data.instagram),
      instagramHashtagLimit: positiveEnv("INSTAGRAM_HASHTAG_LIMIT", 5),
      youtubeTitleCharacters: characterCount(data.youtubeTitle),
      xCharacters: xCount(data.x),
    },
    ...report,
    media: { public: publicURL, expiresAt },
    usage,
  };
}
