import { z } from "zod";
import type { Platform, PublishInput, Delivery } from "../../workflow";
import type { SocialAccount } from "./accounts";
import { instagramGraph } from "./config";
import { socialFetch, socialJSON, bearer, SocialAPIError } from "./http";
import { GenerationError } from "../../generation";
export type NativeState = {
  phase?: string;
  uploadURL?: string;
  offset?: number;
  mediaId?: string;
  postId?: string;
  committing?: boolean;
  uncertain?: boolean;
  attempts?: number;
  startedAt?: number;
};
export type PublishContext = {
  platform: Platform;
  data: PublishInput;
  account: SocialAccount;
  state: NativeState;
  bytes: number;
  mime?: string;
  publicURL: string;
  chunk: (offset: number, size: number) => Promise<Uint8Array>;
  checkpoint: (next: NativeState) => Promise<void>;
};
export type StepResult = {
  state: NativeState;
  delivery: Delivery;
  delay?: number;
};
function result(
  c: PublishContext,
  state: NativeState,
  status: Delivery["state"],
  message: string,
  url?: string,
  delay = 5,
): StepResult {
  return {
    state,
    delivery: { platform: c.platform, state: status, message, url },
    delay,
  };
}
export function youtubeMetadata(data: PublishInput) {
  return {
    snippet: {
      title: data.youtubeTitle,
      description: data.youtubeDescription,
      defaultLanguage: {
        English: "en",
        Telugu: "te",
        Hindi: "hi",
        Tamil: "ta",
      }[data.language],
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: data.dubbed,
    },
  };
}
export function youtubeDelivery(raw: unknown): Delivery {
  const data = z
    .object({
      id: z.string().min(1),
      status: z.object({ uploadStatus: z.string(), privacyStatus: z.string() }),
    })
    .parse(raw);
  const failed = ["failed", "rejected", "deleted"].includes(
    data.status.uploadStatus,
  );
  return {
    platform: "youtube",
    state: failed
      ? "failed"
      : data.status.uploadStatus === "processed" &&
          data.status.privacyStatus === "public"
        ? "published"
        : "processing",
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(data.id)}`,
    message: failed
      ? "YouTube rejected this upload. Check its format and channel status."
      : data.status.privacyStatus === "private"
        ? "Uploaded privately. Check your channel’s upload settings; this is not confirmed public."
        : "YouTube is processing this upload.",
  };
}
async function youtubeStep(c: PublishContext): Promise<StepResult> {
  let s = { ...c.state };
  const h = bearer(c.account.credential.accessToken);
  if (s.postId) {
    const raw = await socialJSON<{ items: unknown[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(s.postId)}`,
      { headers: h },
    );
    if (!raw.items?.[0])
      return result(
        c,
        s,
        "failed",
        "This upload is no longer available on YouTube.",
      );
    return { state: s, delivery: youtubeDelivery(raw.items[0]), delay: 60 };
  }
  if (!s.uploadURL) {
    const r = await socialFetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          ...h,
          "Content-Type": "application/json",
          "X-Upload-Content-Length": String(c.bytes),
          "X-Upload-Content-Type": c.mime || "video/mp4",
        },
        body: JSON.stringify(youtubeMetadata(c.data)),
      },
    );
    if (!r.ok) throw new SocialAPIError(r.status);
    const loc = r.headers.get("location");
    if (!loc)
      throw new GenerationError(
        "YouTube did not provide an upload session. Please retry.",
        502,
      );
    const u = new URL(loc);
    if (
      u.protocol !== "https:" ||
      !["www.googleapis.com", "youtube.googleapis.com"].includes(u.hostname) ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443")
    )
      throw new GenerationError(
        "YouTube returned an unsupported upload session.",
        502,
      );
    s = { ...s, uploadURL: loc, offset: 0, phase: "upload" };
    await c.checkpoint(s);
    return result(
      c,
      s,
      "processing",
      "Starting your resumable YouTube upload.",
      undefined,
      1,
    );
  }
  // Always query the authoritative offset, including after a worker restart or lost PUT response.
  const probe = await socialFetch(s.uploadURL, {
    method: "PUT",
    redirect: "manual",
    headers: {
      ...h,
      "Content-Length": "0",
      "Content-Range": `bytes */${c.bytes}`,
    },
  });
  if (probe.ok) {
    const data = z.object({ id: z.string().min(1) }).parse(await probe.json());
    s = {
      ...s,
      postId: data.id,
      committing: false,
      uncertain: false,
      phase: "visibility",
    };
    await c.checkpoint(s);
    return result(
      c,
      s,
      "processing",
      "Upload received. Checking YouTube processing and visibility.",
      undefined,
      10,
    );
  }
  if (probe.status !== 308) throw new SocialAPIError(probe.status);
  const range = probe.headers.get("range"),
    offset = range ? Number(range.match(/-(\d+)$/)?.[1]) + 1 : 0;
  if (!Number.isFinite(offset) || offset < 0 || offset >= c.bytes)
    throw new GenerationError(
      "YouTube returned an invalid upload position.",
      502,
    );
  const chunk = await c.chunk(
    offset,
    Math.min(8 * 1024 * 1024, c.bytes - offset),
  );
  s = {
    ...s,
    offset,
    committing: offset + chunk.byteLength >= c.bytes,
    uncertain: false,
  };
  await c.checkpoint(s);
  const r = await socialFetch(s.uploadURL!, {
    method: "PUT",
    redirect: "manual",
    headers: {
      ...h,
      "Content-Type": c.mime || "video/mp4",
      "Content-Length": String(chunk.byteLength),
      "Content-Range": `bytes ${offset}-${offset + chunk.byteLength - 1}/${c.bytes}`,
    },
    body: new Uint8Array(chunk),
  });
  if (r.status === 308) {
    s = { ...s, offset: offset + chunk.byteLength, committing: false };
    await c.checkpoint(s);
    return result(
      c,
      s,
      "processing",
      `Uploading to YouTube: ${Math.round(((s.offset || 0) / c.bytes) * 100)}% of video bytes sent.`,
      undefined,
      1,
    );
  }
  if (!r.ok) throw new SocialAPIError(r.status);
  const data = z.object({ id: z.string().min(1) }).parse(await r.json());
  s = { ...s, postId: data.id, committing: false, phase: "visibility" };
  await c.checkpoint(s);
  return result(
    c,
    s,
    "processing",
    "YouTube received the video. Verifying processing and public visibility.",
    undefined,
    10,
  );
}
async function instagramStep(c: PublishContext): Promise<StepResult> {
  let s = { ...c.state };
  const root = instagramGraph(),
    h = bearer(c.account.credential.accessToken),
    id = encodeURIComponent(c.account.accountId);
  if (s.postId) {
    const data = z
      .object({ id: z.string(), permalink: z.string().url().optional() })
      .parse(
        await socialJSON(
          `${root}/${encodeURIComponent(s.postId)}?fields=id,permalink`,
          { headers: h },
        ),
      );
    const url = data.permalink ? new URL(data.permalink) : undefined;
    return result(
      c,
      s,
      "published",
      "Published to Instagram.",
      url?.protocol === "https:" &&
        ["www.instagram.com", "instagram.com"].includes(url.hostname)
        ? url.href
        : undefined,
    );
  }
  if (!s.mediaId) {
    const data = z.object({ id: z.string().min(1) }).parse(
      await socialJSON(`${root}/${id}/media`, {
        method: "POST",
        headers: {
          ...h,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          media_type: "REELS",
          video_url: c.publicURL,
          caption: c.data.instagram,
          share_to_feed: "true",
        }),
      }),
    );
    s = { ...s, mediaId: data.id, phase: "container" };
    await c.checkpoint(s);
    return result(
      c,
      s,
      "processing",
      "Instagram is processing your reel.",
      undefined,
      15,
    );
  }
  const container = z
    .object({ status_code: z.string() })
    .parse(
      await socialJSON(
        `${root}/${encodeURIComponent(s.mediaId)}?fields=status_code`,
        { headers: h },
      ),
    );
  if (["ERROR", "EXPIRED"].includes(container.status_code))
    return result(
      c,
      { ...s, committing: false },
      "failed",
      "Instagram could not process this video. Check the format before retrying.",
    );
  if (s.committing || s.uncertain || container.status_code === "PUBLISHED")
    return result(
      c,
      { ...s, uncertain: true },
      "processing",
      "Instagram may have published this reel. Check your profile before taking another action; automatic resend is paused.",
      undefined,
      300,
    );
  if (container.status_code !== "FINISHED")
    return result(
      c,
      s,
      "processing",
      "Instagram is still processing the video.",
      undefined,
      15,
    );
  s = { ...s, committing: true };
  await c.checkpoint(s);
  const data = z.object({ id: z.string().min(1) }).parse(
    await socialJSON(`${root}/${id}/media_publish`, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: s.mediaId! }),
    }),
  );
  s = { ...s, postId: data.id, committing: false };
  await c.checkpoint(s);
  return result(
    c,
    s,
    "processing",
    "Instagram accepted publication. Fetching your post link.",
    undefined,
    2,
  );
}
const processing = z.object({
  state: z.string(),
  check_after_secs: z.number().optional(),
});
async function xStep(c: PublishContext): Promise<StepResult> {
  let s = { ...c.state };
  const h = {
    ...bearer(c.account.credential.accessToken),
    "Content-Type": "application/json",
  };
  if (s.postId) {
    const data = z
      .object({ data: z.object({ id: z.string() }) })
      .parse(
        await socialJSON(
          `https://api.x.com/2/tweets/${encodeURIComponent(s.postId)}`,
          { headers: h },
        ),
      );
    return result(
      c,
      s,
      "published",
      "Published to X.",
      `https://x.com/i/status/${encodeURIComponent(data.data.id)}`,
    );
  }
  if (s.committing || s.uncertain)
    return result(
      c,
      { ...s, uncertain: true },
      "processing",
      "The X post response is unconfirmed. Check your profile; automatic resend is paused.",
      undefined,
      300,
    );
  if (!s.mediaId) {
    const raw = await socialJSON(
      "https://api.x.com/2/media/upload/initialize",
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          total_bytes: c.bytes,
          media_type: c.mime || "video/mp4",
          media_category: "tweet_video",
        }),
      },
    );
    const { data } = z
      .object({ data: z.object({ id: z.string().min(1) }) })
      .parse(raw);
    s = { ...s, mediaId: data.id, offset: 0, phase: "append" };
    await c.checkpoint(s);
    return result(
      c,
      s,
      "processing",
      "Starting your X video upload.",
      undefined,
      1,
    );
  }
  if (s.phase === "append" && (s.offset || 0) < c.bytes) {
    const offset = s.offset || 0,
      chunkSize = 1024 * 1024,
      chunk = await c.chunk(offset, Math.min(chunkSize, c.bytes - offset));
    await socialJSON(
      `https://api.x.com/2/media/upload/${encodeURIComponent(s.mediaId)}/append`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          media: Buffer.from(chunk).toString("base64"),
          segment_index: Math.floor(offset / chunkSize),
        }),
      },
    );
    s = { ...s, offset: offset + chunk.byteLength };
    await c.checkpoint(s);
    return result(
      c,
      s,
      "processing",
      `Uploading to X: ${Math.round(((s.offset || 0) / c.bytes) * 100)}% of video bytes sent.`,
      undefined,
      1,
    );
  }
  let ready = s.phase === "ready";
  if (!ready) {
    const raw = await socialJSON(
      s.phase === "append"
        ? `https://api.x.com/2/media/upload/${encodeURIComponent(s.mediaId)}/finalize`
        : `https://api.x.com/2/media/upload?media_id=${encodeURIComponent(s.mediaId)}&command=STATUS`,
      { method: s.phase === "append" ? "POST" : "GET", headers: h },
    );
    const { data } = z
      .object({ data: z.object({ processing_info: processing.optional() }) })
      .parse(raw);
    if (data.processing_info?.state === "failed")
      return result(
        c,
        s,
        "failed",
        "X could not process this video. Check its format and your developer access.",
      );
    ready = !data.processing_info || data.processing_info.state === "succeeded";
    s = { ...s, phase: ready ? "ready" : "processing" };
    await c.checkpoint(s);
    if (!ready)
      return result(
        c,
        s,
        "processing",
        "X is processing your video.",
        undefined,
        Math.max(5, data.processing_info?.check_after_secs || 5),
      );
  }
  s = { ...s, committing: true };
  await c.checkpoint(s);
  const raw = await socialJSON("https://api.x.com/2/tweets", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ text: c.data.x, media: { media_ids: [s.mediaId] } }),
  });
  const { data } = z
    .object({ data: z.object({ id: z.string().min(1) }) })
    .parse(raw);
  s = { ...s, postId: data.id, committing: false };
  await c.checkpoint(s);
  return result(
    c,
    s,
    "processing",
    "X accepted the post. Verifying its receipt.",
    undefined,
    2,
  );
}
export interface NativePublishingAdapter {
  step(context: PublishContext): Promise<StepResult>;
}
export const nativeAdapters: Record<Platform, NativePublishingAdapter> = {
  youtube: { step: youtubeStep },
  instagram: { step: instagramStep },
  x: { step: xStep },
};
