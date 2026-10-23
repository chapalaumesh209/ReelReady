import { GenerationError } from "./generation";
import {
  platforms,
  type Connections,
  type Delivery,
  type Platform,
  type PublishInput,
} from "./workflow";
import { xCount } from "./content";
export const profileName = (visitor: string) =>
  `rr_${visitor.replaceAll("-", "")}`;
export async function uploadPost(path: string, options: RequestInit = {}) {
  const key = process.env.UPLOAD_POST_API_KEY;
  if (!key)
    throw new GenerationError(
      "Social publishing is not connected yet. The site owner needs to configure Upload-Post. Your reel can still be planned, dubbed and downloaded.",
      503,
    );
  return fetch(`https://api.upload-post.com${path}`, {
    ...options,
    headers: { Authorization: `Apikey ${key}`, ...options.headers },
    signal: options.signal || AbortSignal.timeout(30000),
  });
}
export async function providerFailure(response: Response): Promise<never> {
  if (response.status === 401 || response.status === 403)
    throw new GenerationError(
      "The publishing connection needs attention or has reached its plan limit. Your video is safe.",
      503,
    );
  if (response.status === 429)
    throw new GenerationError(
      "The publishing service is busy. Wait before trying again.",
      429,
    );
  throw new GenerationError(
    "The publishing service could not complete this step. Check your connection and try again.",
    502,
  );
}
export async function connections(visitor: string): Promise<Connections> {
  if (!process.env.UPLOAD_POST_API_KEY)
    return { configured: false, accounts: {} };
  const response = await uploadPost(
    `/api/uploadposts/users/${profileName(visitor)}`,
  );
  if (response.status === 404) return { configured: true, accounts: {} };
  if (!response.ok) return providerFailure(response);
  const data = (await response.json()) as {
    profile?: { social_accounts?: Record<string, unknown> };
  };
  const accounts: Connections["accounts"] = {};
  for (const p of platforms) {
    const a = data.profile?.social_accounts?.[p];
    if (a && typeof a === "object" && Object.keys(a).length) {
      const acc = a as Record<string, unknown>;
      accounts[p] = {
        connected: !acc.reauth_required,
        reauth: !!acc.reauth_required,
        name: String(
          acc.handle || acc.display_name || "Connected account",
        ).slice(0, 120),
      };
    }
  }
  return { configured: true, accounts };
}
export function validatePublish(data: PublishInput) {
  if (new Set(data.platforms).size !== data.platforms.length)
    throw new GenerationError("Select each platform only once.", 400);
  if (data.platforms.includes("youtube") && !data.youtubeTitle.trim())
    throw new GenerationError("Add a YouTube title before publishing.", 400);
  if (
    (data.platforms.includes("instagram") && !data.instagram.trim()) ||
    (data.platforms.includes("x") && !data.x.trim())
  )
    throw new GenerationError(
      "Add the caption for each selected platform.",
      400,
    );
  if (
    data.platforms.includes("x") &&
    (xCount(data.x) > 280 || data.duration > 140)
  )
    throw new GenerationError(
      "For X, keep text within 280 weighted characters and the video within 140 seconds.",
      400,
    );
  if (data.scheduledAt) {
    const delta = Date.parse(data.scheduledAt) - Date.now();
    if (delta < 5 * 60000 || delta > 365 * 86400000)
      throw new GenerationError(
        "Choose a scheduled time at least 5 minutes ahead and within a year, or publish now.",
        400,
      );
  }
  if (data.platforms.includes("youtube") && data.duration > 180)
    throw new GenerationError(
      "YouTube Shorts accepts videos up to 3 minutes. Choose another destination or export a shorter version.",
      400,
    );
  if (data.platforms.includes("youtube") && data.width > data.height)
    throw new GenerationError(
      "YouTube Shorts needs a square or vertical video. Upload a suitable export or deselect YouTube.",
      400,
    );
}
export function publishingFields(
  data: PublishInput,
  visitor: string,
  requestId: string,
) {
  const fields: Array<[string, string]> = [
    ["user", profileName(visitor)],
    ["title", data.youtubeTitle || data.instagram || data.x],
    ["instagram_title", data.instagram],
    ["youtube_title", data.youtubeTitle],
    ["youtube_description", data.youtubeDescription],
    ["x_title", data.x],
    ["media_type", "REELS"],
    ["privacyStatus", "public"],
    ["async_upload", "true"],
    ["request_id", requestId],
    ["external_id", data.draftId],
    [
      "defaultLanguage",
      { English: "en", Telugu: "te", Hindi: "hi" }[data.language],
    ],
    ["is_ai_generated", String(data.dubbed)],
    ["containsSyntheticMedia", String(data.dubbed)],
  ];
  for (const p of data.platforms) fields.push(["platform[]", p]);
  if (data.dubbed) fields.push(["defaultAudioLanguage", "en"]);
  if (data.scheduledAt) fields.push(["scheduled_date", data.scheduledAt]);
  return fields;
}
/** Results may be an array (status endpoint) or a platform map (upload endpoint). */
export function deliveries(
  raw: Record<string, unknown>,
  selected: readonly Platform[],
  scheduledAt: string | null,
): Delivery[] {
  const rows = Array.isArray(raw.results)
    ? raw.results
    : raw.results && typeof raw.results === "object"
      ? Object.entries(raw.results).map(([platform, r]) => ({
          platform,
          ...(r && typeof r === "object" ? r : {}),
        }))
      : [];
  return selected.map((platform) => {
    const row = rows.find((r) => r?.platform === platform) as
      | Record<string, unknown>
      | undefined;
    let state: Delivery["state"] = "processing";
    if (row?.skipped || row?.status === "skipped") state = "skipped";
    else if (
      ["queued", "processing", "retryable", "pending"].includes(
        String(row?.status || ""),
      )
    )
      state = "processing";
    else if (
      row?.status === "failed" ||
      row?.success === false ||
      (raw.status === "failed" && !row)
    )
      state = "failed";
    else if (
      row?.status === "completed" ||
      (row?.success === true &&
        !["queued", "processing", "retryable", "pending"].includes(
          String(row?.status || ""),
        ) &&
        !/queued|processing|retry/i.test(String(row?.message || "")))
    )
      state = "published";
    else if (
      scheduledAt &&
      Date.parse(scheduledAt) > Date.now() &&
      !["completed", "failed"].includes(String(raw.status))
    )
      state = "scheduled";
    const candidate = String(row?.post_url || row?.url || "");
    let url: string | undefined;
    try {
      const u = new URL(candidate);
      if (u.protocol === "https:") url = u.href;
    } catch {}
    return {
      platform,
      state,
      message:
        row?.error || row?.message
          ? String(row.error || row.message).slice(0, 500)
          : state === "failed"
            ? String(raw.message || "Publishing failed.").slice(0, 500)
            : undefined,
      url,
    };
  });
}
