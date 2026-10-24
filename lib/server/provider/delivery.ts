import { sign, verify } from "../../server";
import { binaryMediaTransfer } from "./config";
import { editHash } from "../media/repository";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { GenerationError } from "../../generation";
import { storageAdmin, VIDEO_BUCKET } from "../../supabase";
import { databaseError } from "../repository";
import { publicMediaURL, signedURLTTL } from "../publishing/preflight";
import { ownerProfile, profileAccounts } from "./accounts";
import { callPublishingWorkflow } from "./webhook";
import { demoMode } from "../config";
import { publishInput, type Platform, type Delivery } from "../../workflow";
const proof = (id: string, marker: string) =>
  createHmac("sha256", process.env.N8N_PUBLISHER_SECRET || "")
    .update(`${id}:${marker}`)
    .digest("base64url");
export const providerClaimInput = z
  .object({
    postId: z.string().uuid(),
    dispatchToken: z.string().min(20).max(200),
  })
  .strict();

export async function deliveryEnvelope(job: {
  id: string;
  owner_id: string;
  reel_id: string;
  payload: Record<string, unknown>;
}) {
  const data = publishInput.parse(job.payload),
    admin = storageAdmin();
  const profile = await ownerProfile(job.owner_id);
  if (!profile || profile.username !== job.payload.providerProfile)
    throw new GenerationError(
      "The connected profile changed. Review this publication again.",
      409,
    );
  const targets = await admin
    .from("reelready_targets")
    .select("platform,status")
    .eq("job_id", job.id)
    .eq("owner_id", job.owner_id);
  if (targets.error) databaseError(targets.error);
  const selected = targets.data
    .filter((t) => ["processing", "scheduled", "pending"].includes(t.status))
    .map((t) => t.platform as Platform);
  if (!selected.length)
    throw new GenerationError(
      "No destinations are waiting for publication.",
      409,
    );
  const accounts = profileAccounts(profile),
    ids = job.payload.accountIds as Record<string, string>;
  for (const p of selected)
    if (!accounts[p]?.connected || accounts[p]?.accountId !== ids[p])
      throw new GenerationError(
        "A destination account changed or needs reconnecting. Review before publishing.",
        409,
      );
  const media = await admin
    .from("reelready_media")
    .select("id,path")
    .eq("id", String(job.payload.mediaId))
    .eq("reel_id", job.reel_id)
    .eq("owner_id", job.owner_id)
    .single();
  if (media.error) databaseError(media.error);
  let transport:
    | { mediaTicket: string; videoUrl?: undefined }
    | { videoUrl: string; mediaTicket?: undefined };
  if (binaryMediaTransfer())
    transport = {
      mediaTicket: await sign(
        { postId: job.id, ownerId: job.owner_id, mediaId: media.data.id },
        "publisher-media",
        600,
      ),
    };
  else {
    const signed = await admin.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(media.data.path, signedURLTTL());
    if (!signed.data || !publicMediaURL(signed.data.signedUrl))
      throw new GenerationError(
        "Publishing requires a provider-accessible signed HTTPS video URL. Local storage cannot be fetched by the publishing service.",
        409,
      );
    transport = { videoUrl: signed.data.signedUrl };
  }
  return {
    postId: job.id,
    profileUsername: profile.username,
    ...transport,
    platforms: selected,
    title: data.youtubeTitle,
    youtubeDescription: data.youtubeDescription,
    caption: data.instagram,
    instagramCaption: data.instagram,
    xCaption: data.x,
    synthetic: data.dubbed,
  };
}

// Called only by the authenticated private bridge. Neither storage credentials nor
// a public storage URL leave the backend; n8n receives only this approved file stream.
export async function providerMediaStream(
  input: unknown,
  signal?: AbortSignal,
) {
  if (demoMode() || !binaryMediaTransfer())
    throw new GenerationError("Private media transfer is disabled.", 409);
  const { mediaTicket } = z
    .object({ mediaTicket: z.string().min(20).max(3000) })
    .strict()
    .parse(input);
  const cap = await verify(mediaTicket, "publisher-media");
  const ids = z
    .object({
      postId: z.string().uuid(),
      ownerId: z.string().uuid(),
      mediaId: z.string().uuid(),
    })
    .parse(cap);
  const admin = storageAdmin();
  const job = await admin
    .from("reelready_jobs")
    .select("payload,provider_job_id")
    .eq("id", ids.postId)
    .eq("owner_id", ids.ownerId)
    .eq("is_demo", false)
    .eq("status", "submitting")
    .gt("lease_until", new Date().toISOString())
    .maybeSingle();
  if (job.error) databaseError(job.error);
  if (
    !job.data ||
    !String(job.data.provider_job_id).startsWith("committing:") ||
    job.data.payload.mediaId !== ids.mediaId
  )
    throw new GenerationError("This media transfer is not authorized.", 409);
  const media = await admin
    .from("reelready_media")
    .select("path,bytes,mime,reel_id")
    .eq("id", ids.mediaId)
    .eq("owner_id", ids.ownerId)
    .single();
  if (media.error) databaseError(media.error);
  const edit = await admin
    .from("reelready_audio_edits")
    .select("*")
    .eq("reel_id", media.data.reel_id)
    .eq("owner_id", ids.ownerId)
    .maybeSingle();
  if (edit.error) databaseError(edit.error);
  if (
    edit.data &&
    (edit.data.rendered_id !== ids.mediaId ||
      !edit.data.approved_hash ||
      (await editHash(edit.data)) !== edit.data.approved_hash)
  )
    throw new GenerationError(
      "Your selected video changed. Review it again before publishing.",
      409,
    );
  const signed = await admin.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(media.data.path, 600);
  if (signed.error) databaseError(signed.error);
  const source = await fetch(signed.data!.signedUrl, {
    signal: signal || AbortSignal.timeout(300000),
  });
  if (!source.ok || !source.body)
    throw new GenerationError(
      "Your saved video could not be read for transfer.",
      502,
    );
  return {
    stream: source.body,
    size: Number(media.data.bytes),
    mime: media.data.mime,
  };
}

// Called by n8n immediately before its provider POST. Derive every field again from
// owned database records and consume the dispatch proof atomically. Replays stop here.
export async function authorizeProviderDelivery(input: unknown) {
  if (demoMode())
    throw new GenerationError("Real publication is disabled.", 409);
  const data = providerClaimInput.parse(input),
    admin = storageAdmin();
  const r = await admin
    .from("reelready_jobs")
    .select("*")
    .eq("id", data.postId)
    .eq("is_demo", false)
    .eq("status", "submitting")
    .gt("lease_until", new Date().toISOString())
    .single();
  if (r.error || !r.data || r.data.payload.publishingProvider !== "uploadpost")
    throw new GenerationError("This publication is not authorized.", 409);
  const job = r.data,
    marker = String(job.provider_job_id || "");
  const issued = Number(marker.split(":")[1]);
  const supplied = Buffer.from(data.dispatchToken),
    expected = Buffer.from(proof(job.id, marker));
  if (
    !marker.startsWith("dispatch:") ||
    !Number.isFinite(issued) ||
    issued > Date.now() ||
    issued < Date.now() - 300000 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new GenerationError(
      "This publication authorization expired or was already used.",
      409,
    );
  const envelope = await deliveryEnvelope(job);
  const claim = await admin
    .from("reelready_jobs")
    .update({ provider_job_id: marker.replace(/^dispatch:/, "committing:") })
    .eq("id", job.id)
    .eq("owner_id", job.owner_id)
    .eq("worker_id", job.worker_id)
    .eq("provider_job_id", marker)
    .gt("lease_until", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (claim.error) databaseError(claim.error);
  if (!claim.data)
    throw new GenerationError(
      "This publication authorization was already used.",
      409,
    );
  return envelope;
}

function receiptURL(raw: unknown, platform: Platform) {
  if (typeof raw !== "string") return undefined;
  try {
    const u = new URL(raw);
    const allowed =
      platform === "youtube"
        ? ["youtube.com", "www.youtube.com", "youtu.be"]
        : platform === "instagram"
          ? ["instagram.com", "www.instagram.com"]
          : ["x.com", "www.x.com", "twitter.com", "www.twitter.com"];
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      allowed.includes(u.hostname)
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
// Classify provider diagnostics into fixed creator-facing guidance. Raw provider
// errors can contain tokens, internal URLs or personal data and never reach UI.
function destinationFailure(result: Record<string, unknown>) {
  const reason = [
    result.error_code,
    result.error_signature,
    result.error_message,
    result.message,
  ]
    .filter((v) => typeof v === "string")
    .join(" ")
    .slice(0, 3000)
    .toLowerCase();
  if (
    /reauth|token.{0,20}expir|account.{0,20}connect|permission|oauth|unauthoriz/.test(
      reason,
    )
  )
    return "This account needs attention. Reconnect it, then check delivery before retrying.";
  if (
    /quota|rate.?limit|plan.?limit|capacity|allowance|payment|credit/.test(
      reason,
    )
  )
    return "The publishing allowance or platform rate limit was reached. Check the service plan or wait for the limit to reset before retrying.";
  if (
    /codec|format|aspect.?ratio|duration|resolution|file.?size|video.{0,20}invalid/.test(
      reason,
    )
  )
    return "The platform rejected this video's format or length. Check the video requirements before retrying.";
  if (/copyright|music.?rights|rights.?holder/.test(reason))
    return "The platform rejected this video's music or rights. Review the soundtrack before retrying.";
  return "The platform confirmed this destination failed. Check delivery for the latest result before retrying.";
}

export function providerDeliveries(
  raw: Record<string, unknown>,
  selected: Platform[],
): Delivery[] {
  const results = raw.results;
  return selected.map((platform) => {
    const value = Array.isArray(results)
      ? results.find((v) => v?.platform === platform)
      : results && typeof results === "object"
        ? (results as Record<string, unknown>)[platform]
        : undefined;
    const outer =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const r = {
      ...(outer.result && typeof outer.result === "object"
        ? (outer.result as Record<string, unknown>)
        : {}),
      ...outer,
    };
    const privateVideo =
      platform === "youtube" &&
      (r.privacyStatus === "private" ||
        /\bprivate\b/i.test(String(r.message || "")));
    const platformStatus = String(r.status || r.state || "").toLowerCase();
    const aggregateStatus = String(raw.status || "").toLowerCase();
    const waiting = [
      "pending",
      "queued",
      "processing",
      "in_progress",
      "retryable",
      "retrying",
      "uploading",
    ].includes(platformStatus);
    const aggregateDone = ["completed", "failed"].includes(aggregateStatus);
    const url = receiptURL(
      r.url ||
        r.post_url ||
        r.video_url ||
        r.permalink ||
        String(r.message || "").match(/https:\/\/[^\s<>"']+/)?.[0],
      platform,
    );
    // Providers use success:false for an unfinished platform. Its lifecycle state
    // takes precedence; only a permanent failure or final aggregate is terminal.
    const state: Delivery["state"] =
      r.skipped === true || platformStatus === "skipped"
        ? "skipped"
        : waiting || privateVideo
          ? "processing"
          : platformStatus === "failed" ||
              (r.success === false && aggregateDone)
            ? "failed"
            : r.success === true &&
                (url ||
                  platformStatus === "completed" ||
                  aggregateStatus === "completed" ||
                  /^published\b/i.test(String(r.message || "")))
              ? "published"
              : "processing";
    return {
      platform,
      state,
      url: state === "published" || privateVideo ? url : undefined,
      message: privateVideo
        ? "Uploaded privately. Check your channel's upload settings."
        : state === "published"
          ? "Publication confirmed by the connected service."
          : state === "skipped"
            ? "This destination was not sent. Check the connected account before creating a new request."
            : state === "failed"
              ? destinationFailure(r)
              : ["retryable", "retrying"].includes(platformStatus)
                ? "The platform is retrying delivery. Wait for the final result before sending another copy."
                : "Your reel is still processing. Delivery will refresh automatically; avoid resending while it finishes.",
    };
  });
}

export async function advanceProviderDelivery(
  job: {
    id: string;
    owner_id: string;
    reel_id: string;
    payload: Record<string, unknown>;
    provider_job_id?: string | null;
  },
  worker: string,
) {
  const admin = storageAdmin();
  const update = async (data: Record<string, unknown>) => {
    const r = await admin
      .from("reelready_jobs")
      .update(data)
      .eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .eq("worker_id", worker)
      .gt("lease_until", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (r.error) databaseError(r.error);
    if (!r.data)
      throw new GenerationError("Publishing lease no longer owned.", 409);
  };
  try {
    let raw: Record<string, unknown>;
    const marker = job.provider_job_id || "";
    if (marker.startsWith("committing:")) {
      await update({ status: "uncertain", worker_id: null, lease_until: null });
      return;
    }
    if (marker.startsWith("request:")) {
      raw = await callPublishingWorkflow("status", {
        postId: job.id,
        requestId: marker.slice(8),
      });
    } else {
      // Known-unclaimed dispatches can be replaced: their old proof is invalidated
      // before another webhook is sent. Claimed/ambiguous commits are never resent.
      const envelope = await deliveryEnvelope(job);
      const next = `dispatch:${Date.now()}:${crypto.randomUUID()}`;
      await update({ provider_job_id: next });
      raw = await callPublishingWorkflow("publish", {
        ...envelope,
        dispatchToken: proof(job.id, next),
      });
    }
    const requestId =
      typeof raw.request_id === "string" &&
      /^[\w-]{1,200}$/.test(raw.request_id)
        ? raw.request_id
        : undefined;
    if (
      marker.startsWith("request:") &&
      requestId &&
      marker.slice(8) !== requestId
    )
      throw new Error("Unexpected publication receipt");
    if (requestId) await update({ provider_job_id: `request:${requestId}` });
    await update({ updated_at: new Date().toISOString() });
    const targets = await admin
      .from("reelready_targets")
      .select("platform,status")
      .eq("job_id", job.id)
      .eq("owner_id", job.owner_id);
    if (targets.error) databaseError(targets.error);
    const deliveries = providerDeliveries(
      raw,
      targets.data
        .filter((t) => !["published", "skipped"].includes(t.status))
        .map((t) => t.platform as Platform),
    );
    for (const d of deliveries) {
      const r = await admin
        .from("reelready_targets")
        .update({
          status: d.state,
          safe_message: d.message,
          published_url: d.url || null,
        })
        .eq("job_id", job.id)
        .eq("owner_id", job.owner_id)
        .eq("platform", d.platform)
        .neq("status", "published");
      if (r.error) databaseError(r.error);
    }
    const latest = await admin
      .from("reelready_targets")
      .select("status,platform")
      .eq("job_id", job.id)
      .eq("owner_id", job.owner_id);
    if (latest.error) databaseError(latest.error);
    const allDone = latest.data.every((t) =>
      ["published", "failed", "skipped"].includes(t.status),
    );
    const status = latest.data.every((t) => t.status === "published")
      ? "published"
      : allDone
        ? "failed"
        : "processing";
    if (
      (!requestId && !marker.startsWith("request:") && !allDone) ||
      (["completed", "failed"].includes(String(raw.status)) && !allDone)
    ) {
      await update({ status: "uncertain", worker_id: null, lease_until: null });
      return;
    }
    if (latest.data.some((t) => t.status === "published")) {
      const r = await admin
        .from("reelready_publish_usage")
        .upsert(
          [
            { owner_id: job.owner_id, job_id: job.id, kind: "upload" },
            ...(latest.data.some(
              (t) => t.platform === "x" && t.status === "published",
            )
              ? [{ owner_id: job.owner_id, job_id: job.id, kind: "x" }]
              : []),
          ],
          { onConflict: "job_id,kind", ignoreDuplicates: true },
        );
      if (r.error) databaseError(r.error);
    }
    await update({
      status,
      next_attempt_at: new Date(Date.now() + 15000).toISOString(),
      worker_id: null,
      lease_until: null,
      updated_at: new Date().toISOString(),
    });
  } catch {
    const current = await admin
      .from("reelready_jobs")
      .select("provider_job_id")
      .eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .single();
    if (current.error) databaseError(current.error);
    const marker = current.data.provider_job_id || "";
    const uncertain = marker.startsWith("committing:"),
      polling = marker.startsWith("request:");
    await update({
      status: uncertain ? "uncertain" : polling ? "processing" : "failed",
      next_attempt_at: new Date(Date.now() + 60000).toISOString(),
      worker_id: null,
      lease_until: null,
    });
    if (!polling)
      await admin
        .from("reelready_targets")
        .update({
          status: uncertain ? "processing" : "failed",
          safe_message: uncertain
            ? "The publishing response is unconfirmed. Check your account before retrying; automatic resend is paused."
            : "Publishing could not start. Check your connection, workflow and service allowance. Your video is saved.",
        })
        .eq("job_id", job.id)
        .eq("owner_id", job.owner_id)
        .neq("status", "published");
  }
}

/** Read-only recovery of a saved failed receipt. Never starts an upload. */
export async function reconcileFailedProviderDelivery(
  id: string,
  owner: string,
  force = false,
) {
  if (demoMode()) return false;
  const admin = storageAdmin();
  const found = await admin
    .from("reelready_jobs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", owner)
    .eq("is_demo", false)
    .eq("status", "failed")
    .maybeSingle();
  if (found.error) databaseError(found.error);
  const job = found.data;
  if (
    !job ||
    job.payload.publishingProvider !== "uploadpost" ||
    !/^request:[\w-]{1,200}$/.test(job.provider_job_id || "") ||
    (!force && Date.now() - Date.parse(job.updated_at) < 15000)
  )
    return false;
  const worker = `receipt-${crypto.randomUUID()}`;
  // Moving out of failed atomically excludes the retry RPC, and the lease keeps
  // the normal worker from polling the same request concurrently.
  const claim = await admin
    .from("reelready_jobs")
    .update({
      status: "processing",
      worker_id: worker,
      lease_until: new Date(Date.now() + 300000).toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", owner)
    .eq("status", "failed")
    .eq("provider_job_id", job.provider_job_id)
    .eq("updated_at", job.updated_at)
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .select("id")
    .maybeSingle();
  if (claim.error) databaseError(claim.error);
  if (!claim.data) return false;
  const checking = await admin
    .from("reelready_targets")
    .update({
      status: "processing",
      safe_message:
        "Checking the existing delivery. No new copy has been sent.",
    })
    .eq("job_id", id)
    .eq("owner_id", owner)
    .eq("status", "failed");
  if (checking.error) databaseError(checking.error);
  // The validated request marker forces the status-only branch. Do not invoke
  // this helper for pending/dispatch/committing markers or native/demo jobs.
  await advanceProviderDelivery(job, worker);
  return true;
}
