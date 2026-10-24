import { reconcileFailedProviderDelivery } from "../provider/delivery";
import { publishPreflight } from "./preflight";
import { editHash } from "../media/repository";
import { z } from "zod";
import { repository, ownedReel, databaseError } from "../repository";
import { storageAdmin, verifiedAsset } from "../../supabase";
import { GenerationError } from "../../generation";
import { demoMode } from "../config";
import { connectionStatus } from "../connections";
import { digest } from "../../server";
import { publishInput, type PublishJob, type Delivery } from "../../workflow";
import { validatePublish } from "./validation";
import {
  publishingProvider,
  realPublishingConfigured,
} from "../provider/config";
import { ownerProfile } from "../provider/accounts";
import { encryptSocial, decryptSocial } from "../social/crypto";
import type { NativeState } from "../social/publishing";
import { positiveEnv, workerPool } from "../hardening";
export const prepareInput = publishInput.extend({
  action: z.literal("prepare"),
  confirmed: z.literal(true),
  assetToken: z.string().min(1).max(5000),
});
export async function getJob(
  req: Request,
  id: string,
): Promise<PublishJob & { status: string }> {
  const { db } = await repository(req);
  const job = await db
    .from("reelready_jobs")
    .select("id,status,is_demo,scheduled_at,provider_request_id")
    .eq("id", id)
    .maybeSingle();
  if (job.error) databaseError(job.error);
  if (!job.data)
    throw new GenerationError(
      "This publishing job was not found in your workspace.",
      404,
    );
  const targets = await db
    .from("reelready_targets")
    .select("platform,status,published_url,safe_message")
    .eq("job_id", id);
  if (targets.error) databaseError(targets.error);
  return {
    id,
    token: id,
    status: job.data.status,
    demo: job.data.is_demo,
    legacy:
      !!job.data.provider_request_id &&
      job.data.provider_request_id !== "native" &&
      !job.data.is_demo,
    scheduledAt: job.data.scheduled_at,
    done: ["demo", "published", "failed"].includes(job.data.status),
    deliveries: (targets.data || [])
      .sort(
        (a, b) =>
          ["instagram", "youtube", "x"].indexOf(a.platform) -
          ["instagram", "youtube", "x"].indexOf(b.platform),
      )
      .map((t) => ({
        platform: t.platform,
        state: t.status as Delivery["state"],
        url: t.published_url || undefined,
        message: t.safe_message || undefined,
      })),
  };
}
export async function prepareJob(
  req: Request,
  incoming: z.infer<typeof prepareInput>,
) {
  const report = await publishPreflight(req, incoming);
  if (report.blockers.length)
    throw new GenerationError(report.blockers.join(" "), 409);
  const { user, db } = await ownedReel(req, incoming.draftId);
  const { cap } = await verifiedAsset(req, incoming.assetToken);
  const media = await db
    .from("reelready_media")
    .select("*")
    .eq("path", String(cap.path))
    .eq("reel_id", incoming.draftId)
    .maybeSingle();
  if (media.error) databaseError(media.error);
  if (!media.data)
    throw new GenerationError(
      "This video is not attached to your reel. Upload it again.",
      409,
    );
  const audioEdit = await db
    .from("reelready_audio_edits")
    .select("*")
    .eq("reel_id", incoming.draftId)
    .maybeSingle();
  if (audioEdit.error) databaseError(audioEdit.error);
  if (
    audioEdit.data &&
    (!audioEdit.data.approved_hash ||
      audioEdit.data.rendered_id !== media.data.id ||
      (await editHash(audioEdit.data)) !== audioEdit.data.approved_hash)
  )
    throw new GenerationError(
      "Approve the exact selected soundtrack in Audio & Voice before publishing. Failed renders never fall back to the original.",
      409,
    );
  const meta = media.data.metadata as {
    duration: number;
    width: number;
    height: number;
  };
  const data = publishInput.parse({
    ...incoming,
    size: Number(media.data.bytes),
    dubbed:
      media.data.kind === "english" ||
      (media.data.kind === "rendered" && !!media.data.metadata?.synthetic),
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
  });
  validatePublish(data);
  let accountIds: Record<string, string> = {};
  if (!demoMode()) {
    if (!realPublishingConfigured())
      throw new GenerationError(
        "Real publishing is not configured. Your video and captions are saved.",
        503,
      );
    if (!["reviewed", "ready"].includes(media.data.processing_state))
      throw new GenerationError(
        "Review the uploaded recording before publishing.",
        409,
      );
    const connected = await connectionStatus(req);
    accountIds = Object.fromEntries(
      data.platforms.map((p) => [p, connected.accounts[p]?.accountId || ""]),
    );
    for (const platform of data.platforms)
      if (!connected.accounts[platform]?.connected)
        throw new GenerationError(
          `Connect your ${platform} account before publishing.`,
          409,
        );
  }
  const payload = {
    ...data,
    assetToken: undefined,
    mediaPath: cap.path,
    mediaId: media.data.id,
    accountIds,
    publishingProvider: publishingProvider(),
    providerProfile:
      !demoMode() && publishingProvider() === "uploadpost"
        ? (await ownerProfile(user.id))?.username
        : undefined,
  };
  const hash = await digest(JSON.stringify({ payload, demo: demoMode() }));
  const admin = storageAdmin();
  const existing = await db
    .from("reelready_jobs")
    .select("id")
    .eq("owner_id", user.id)
    .eq("idempotency_key", hash)
    .maybeSingle();
  if (existing.error) databaseError(existing.error);
  if (existing.data) return getJob(req, existing.data.id);
  const active = await db
    .from("reelready_jobs")
    .select("id,idempotency_key")
    .eq("reel_id", data.draftId)
    .eq("is_demo", demoMode())
    .in("status", [
      "pending",
      "submitting",
      "uncertain",
      "processing",
      "scheduled",
    ])
    .limit(1)
    .maybeSingle();
  if (active.error) databaseError(active.error);
  if (active.data?.idempotency_key === hash) return getJob(req, active.data.id);
  if (active.data)
    throw new GenerationError(
      "This reel already has an unresolved publication. Check delivery before starting another request.",
      409,
    );
  const id = crypto.randomUUID();
  const created = await admin.rpc("reelready_prepare_job", {
    p_job: {
      id,
      owner_id: user.id,
      reel_id: data.draftId,
      idempotency_key: hash,
      is_demo: demoMode(),
      scheduled_at: data.scheduledAt,
      payload,
    },
    p_targets: data.platforms.map((p) => ({
      platform: p,
      caption:
        p === "instagram"
          ? data.instagram
          : p === "youtube"
            ? `${data.youtubeTitle}\n${data.youtubeDescription}`
            : data.x,
    })),
  });
  if (created.error) {
    if (created.error.code === "23505") {
      // A concurrent identical request can hit the active-job index before
      // PostgreSQL resolves the idempotency conflict. Reuse only its exact hash.
      const duplicate = await db
        .from("reelready_jobs")
        .select("id")
        .eq("owner_id", user.id)
        .eq("idempotency_key", hash)
        .maybeSingle();
      if (duplicate.error) databaseError(duplicate.error);
      if (duplicate.data) return getJob(req, duplicate.data.id);
      throw new GenerationError(
        "A publication is already being prepared for this reel. Check delivery before retrying.",
        409,
      );
    }
    databaseError(created.error);
  }
  return getJob(req, String(created.data));
}

async function saveResult(
  req: Request,
  id: string,
  deliveries: Delivery[],
  state?: string,
) {
  const { user } = await repository(req),
    admin = storageAdmin();
  const status =
    state ||
    (deliveries.every((d) => d.state === "published")
      ? "published"
      : deliveries.every((d) =>
            ["published", "failed", "skipped"].includes(d.state),
          )
        ? "failed"
        : deliveries.some((d) => d.state === "scheduled")
          ? "scheduled"
          : "processing");
  const updates = await Promise.all(
    deliveries.map((d) =>
      admin
        .from("reelready_targets")
        .update({
          status: d.state,
          published_url: d.url || null,
          safe_message: d.message || null,
        })
        .eq("job_id", id)
        .eq("owner_id", user.id)
        .eq("platform", d.platform),
    ),
  );
  for (const update of updates) if (update.error) databaseError(update.error);
  const saved = await admin
    .from("reelready_jobs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (saved.error) databaseError(saved.error);
  return getJob(req, id);
}
export async function sendJob(req: Request, id: string) {
  const { user, db } = await repository(req),
    admin = storageAdmin();
  const stored = await db
    .from("reelready_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (stored.error) databaseError(stored.error);
  const job = stored.data;
  if (!job)
    throw new GenerationError("This publishing job was not found.", 404);
  if (job.is_demo !== demoMode())
    throw new GenerationError(
      "Publishing mode changed. Review a new request before sending.",
      409,
    );
  if (
    !job.is_demo &&
    (job.payload.publishingProvider || "native") !== publishingProvider()
  )
    throw new GenerationError(
      "The publishing connection changed. Review a new request before sending.",
      409,
    );
  if (job.status === "pending") {
    const audio = await db
      .from("reelready_audio_edits")
      .select("*")
      .eq("reel_id", job.reel_id)
      .maybeSingle();
    if (audio.error) databaseError(audio.error);
    if (
      audio.data &&
      (!audio.data.approved_hash ||
        audio.data.rendered_id !== job.payload.mediaId ||
        (await editHash(audio.data)) !== audio.data.approved_hash)
    )
      throw new GenerationError(
        "The soundtrack changed after preparation. Review and approve the selected asset again before sending.",
        409,
      );
  }
  const data = publishInput.parse(job.payload);
  validatePublish(data);
  if (!job.is_demo) {
    const selected = await db
      .from("reelready_media")
      .select("*")
      .eq("id", job.payload.mediaId)
      .eq("reel_id", data.draftId)
      .single();
    if (selected.error) databaseError(selected.error);
    const { sign } = await import("../../server");
    const assetToken = await sign(
      {
        visitor: user.id,
        path: selected.data.path,
        size: Number(selected.data.bytes),
        mime: selected.data.mime,
        name: "selected.mp4",
        kind: selected.data.kind,
      },
      "stored-video",
      600,
    );
    const report = await publishPreflight(req, { ...data, assetToken });
    if (report.blockers.length)
      throw new GenerationError(report.blockers.join(" "), 409);
    const state = await connectionStatus(req);
    for (const p of data.platforms)
      if (!state.accounts[p]?.connected)
        throw new GenerationError(
          `Connect your ${p} account before publishing.`,
          409,
        );
  }
  if (!job.is_demo) {
    if (job.status !== "pending") return getJob(req, id);
    const queued = await admin.rpc("reelready_queue_publication", {
      p_job: id,
      p_owner: user.id,
      p_pool: workerPool(),
      p_user_limit: positiveEnv("MAX_ACTIVE_JOBS_PER_USER", 2),
      p_global_limit: positiveEnv("MAX_QUEUED_JOBS", 100),
    });
    if (queued.error)
      throw new GenerationError(
        "The publishing queue is full right now. Your reel is saved; retry later.",
        429,
      );
    if (queued.data) {
      const attempt = await admin
        .from("reelready_attempts")
        .insert({ owner_id: user.id, job_id: id, kind: "send" });
      if (attempt.error) databaseError(attempt.error);
    }
    return getJob(req, id);
  }
  const claimed = await admin
    .from("reelready_jobs")
    .update({ status: "submitting", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("status", "pending")
    .select("id");
  if (claimed.error) databaseError(claimed.error);
  if (!claimed.data?.length) return getJob(req, id);
  const attempt = await admin.from("reelready_attempts").insert({
    job_id: id,
    owner_id: user.id,
    kind: job.is_demo ? "demo" : "send",
  });
  if (attempt.error) databaseError(attempt.error);
  if (job.is_demo)
    return saveResult(
      req,
      id,
      data.platforms.map((platform) => ({
        platform,
        state: "demo",
        message: data.scheduledAt
          ? "Simulated schedule. Nothing was posted."
          : "Simulated post. Nothing was posted.",
      })),
      "demo",
    );
  return getJob(req, id);
}
export async function refreshJob(req: Request, id: string) {
  // Uploads stay in the worker. A failed managed receipt may be checked again
  // read-only, because an unfinished provider result was previously marked failed.
  const existing = await getJob(req, id);
  if (existing.status === "failed" && !existing.demo && !existing.legacy) {
    const { user } = await repository(req);
    await reconcileFailedProviderDelivery(id, user.id);
    return getJob(req, id);
  }
  return existing;
}
export async function retryJob(req: Request, id: string) {
  const { db, user } = await repository(req),
    admin = storageAdmin();
  const record = await db
    .from("reelready_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (record.error) databaseError(record.error);
  let job = record.data;
  if (!job)
    throw new GenerationError(
      "This publication was not found in your workspace.",
      404,
    );
  if (
    !job.is_demo &&
    (job.payload.publishingProvider || "native") !== publishingProvider()
  )
    throw new GenerationError(
      "The publishing connection changed. Check existing delivery before retrying.",
      409,
    );
  if (demoMode() || job.is_demo || job.provider_request_id !== "native")
    throw new GenerationError(
      "Only direct platform publications can be retried. Legacy requests must be checked in the original account.",
      409,
    );
  if (
    job.payload.publishingProvider === "uploadpost" &&
    job.status === "failed" &&
    String(job.provider_job_id || "").startsWith("request:")
  ) {
    // Refresh the same provider request before allowing any resend. A late success
    // or an unresolved read must never create a duplicate publication.
    await reconcileFailedProviderDelivery(id, user.id, true);
    const fresh = await db
      .from("reelready_jobs")
      .select("*")
      .eq("id", id)
      .single();
    if (fresh.error) databaseError(fresh.error);
    job = fresh.data;
    if (job.status !== "failed") return getJob(req, id);
  }
  if (job.status !== "failed")
    throw new GenerationError(
      "Check delivery first. Only confirmed failed destinations can be retried safely.",
      409,
    );
  const failed = await db
    .from("reelready_targets")
    .select("platform,native_state")
    .eq("job_id", id)
    .eq("status", "failed");
  if (failed.error) databaseError(failed.error);
  if (!failed.data.length)
    throw new GenerationError(
      "There are no confirmed failed destinations to retry.",
      409,
    );
  const accounts = await connectionStatus(req);
  for (const target of failed.data) {
    if (
      accounts.accounts[target.platform as "youtube" | "instagram" | "x"]
        ?.accountId !== job.payload.accountIds?.[target.platform]
    )
      throw new GenerationError(
        "This destination account changed after confirmation. Review a new publishing request.",
        409,
      );
  }
  for (const target of failed.data)
    if (
      !accounts.accounts[target.platform as "youtube" | "instagram" | "x"]
        ?.connected
    )
      throw new GenerationError(
        `Reconnect your ${target.platform} account before retrying.`,
        409,
      );
  const checkpoints: Record<string, string> = {};
  for (const target of job.payload.publishingProvider === "uploadpost"
    ? []
    : failed.data) {
    const context = `${user.id}:${target.platform}:job:${id}`;
    const old = target.native_state
      ? decryptSocial<NativeState>(target.native_state, context)
      : {};
    const freshMedia =
      target.platform !== "youtube" &&
      !old.postId &&
      !old.committing &&
      !old.uncertain;
    checkpoints[target.platform] = encryptSocial(
      freshMedia
        ? { startedAt: Date.now(), attempts: 0 }
        : { ...old, startedAt: Date.now(), attempts: 0 },
      context,
    );
  }
  const queued = await admin.rpc("reelready_retry_publication", {
    p_job: id,
    p_owner: user.id,
    p_pool: workerPool(),
    p_user_limit: positiveEnv("MAX_ACTIVE_JOBS_PER_USER", 2),
    p_global_limit: positiveEnv("MAX_QUEUED_JOBS", 100),
    p_states: checkpoints,
  });
  if (queued.error)
    throw new GenerationError(
      /CAP/.test(queued.error.message)
        ? "The publishing queue is full. Your receipts are saved; retry later."
        : "The retry could not be confirmed. Check delivery before trying again.",
      /CAP/.test(queued.error.message) ? 429 : 502,
    );
  if (!queued.data) return getJob(req, id);
  await admin
    .from("reelready_attempts")
    .insert({ owner_id: user.id, job_id: id, kind: "retry-failed" });
  return getJob(req, id);
}
