import { storageAdmin, VIDEO_BUCKET } from "../../supabase";
import { publishInput, type Platform } from "../../workflow";
import { databaseError } from "../repository";
import { workerPool } from "../hardening";
import { demoMode } from "../config";
import { decryptSocial, encryptSocial } from "./crypto";
import { nativeAdapters, type NativeState } from "./publishing";
import { getAccount } from "./accounts";
import { SocialAPIError } from "./http";
import { publicMediaURL, signedURLTTL } from "../publishing/preflight";
import { advanceProviderDelivery } from "../provider/delivery";
export async function publicationWorkerOnce(
  worker = `publisher-${crypto.randomUUID()}`,
) {
  if (demoMode()) return false;
  const admin = storageAdmin();
  const claim = await admin.rpc("reelready_claim_publication", {
    p_pool: workerPool(),
    p_worker: worker,
  });
  if (claim.error) databaseError(claim.error);
  const job = claim.data?.[0];
  if (!job) return false;
  const leaseHeartbeat = setInterval(() => {
    void admin
      .from("reelready_jobs")
      .update({ lease_until: new Date(Date.now() + 300000).toISOString() })
      .eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .eq("worker_id", worker)
      .then(
        () => {},
        () => {},
      );
  }, 45000);
  leaseHeartbeat.unref();
  let next = 5;
  try {
    if (job.payload.publishingProvider === "uploadpost") {
      await advanceProviderDelivery(job, worker);
      return true;
    }
    const data = publishInput.parse(job.payload);
    const media = await admin
      .from("reelready_media")
      .select("path,bytes,mime")
      .eq("id", job.payload.mediaId)
      .eq("reel_id", job.reel_id)
      .eq("owner_id", job.owner_id)
      .single();
    if (media.error) databaseError(media.error);
    const targets = await admin
      .from("reelready_targets")
      .select("platform,status,native_state")
      .eq("job_id", job.id)
      .eq("owner_id", job.owner_id);
    if (targets.error) databaseError(targets.error);
    for (const row of targets.data) {
      if (demoMode()) break;
      if (["published", "failed", "skipped"].includes(row.status)) continue;
      const platform = row.platform as Platform,
        context = `${job.owner_id}:${platform}:job:${job.id}`;
      let state: NativeState = row.native_state
        ? decryptSocial(row.native_state, context)
        : { startedAt: Date.now() };
      const checkpoint = async (value: NativeState) => {
        // A stale worker must never apply state or start a second platform commit.
        const lease = await admin
          .from("reelready_jobs")
          .select("id")
          .eq("id", job.id)
          .eq("owner_id", job.owner_id)
          .eq("worker_id", worker)
          .gt("lease_until", new Date().toISOString())
          .maybeSingle();
        if (lease.error) databaseError(lease.error);
        if (!lease.data) throw new Error("Publishing lease no longer owned");
        const r = await admin
          .from("reelready_targets")
          .update({ native_state: encryptSocial(value, context) })
          .eq("job_id", job.id)
          .eq("owner_id", job.owner_id)
          .eq("platform", platform);
        if (r.error) databaseError(r.error);
        state = { ...value };
      };
      try {
        const account = await getAccount(job.owner_id, platform);
        if (!account) throw new SocialAPIError(401);
        if (job.payload.accountIds?.[platform] !== account.accountId)
          throw new SocialAPIError(403);
        const signed = await admin.storage
          .from(VIDEO_BUCKET)
          .createSignedUrl(media.data.path, signedURLTTL());
        if (signed.error || !signed.data) throw new Error("Media unavailable");
        if (platform === "instagram" && !publicMediaURL(signed.data.signedUrl))
          throw new SocialAPIError(400);
        const result = await nativeAdapters[platform].step({
          platform,
          data,
          account,
          state,
          bytes: Number(media.data.bytes),
          mime: media.data.mime,
          publicURL: signed.data.signedUrl,
          checkpoint,
          chunk: async (offset, size) => {
            const r = await fetch(signed.data.signedUrl, {
              headers: { Range: `bytes=${offset}-${offset + size - 1}` },
              signal: AbortSignal.timeout(90000),
              redirect: "error",
            });
            if (
              !(
                r.status === 206 ||
                (r.status === 200 &&
                  offset === 0 &&
                  Number(media.data.bytes) <= size)
              )
            ) {
              await r.body?.cancel();
              throw new Error("Storage range read unavailable");
            }
            const bytes = new Uint8Array(await r.arrayBuffer());
            if (bytes.byteLength !== size)
              throw new Error("Storage byte count changed");
            return bytes;
          },
        });
        await checkpoint(result.state);
        const saved = await admin
          .from("reelready_targets")
          .update({
            status: result.delivery.state,
            published_url: result.delivery.url || null,
            safe_message: result.delivery.message || null,
          })
          .eq("job_id", job.id)
          .eq("owner_id", job.owner_id)
          .eq("platform", platform);
        if (saved.error) databaseError(saved.error);
        next = Math.max(next, Math.min(result.delay || 5, 300));
        if (result.state.uncertain) next = 300;
      } catch (e) {
        const definite =
          e instanceof SocialAPIError &&
          [400, 401, 403, 404, 410, 422].includes(e.providerStatus);
        const uncertain =
          platform !== "youtube" && !!state.committing && !definite;
        const attempts = (state.attempts || 0) + 1;
        await checkpoint({
          ...state,
          attempts,
          committing: uncertain,
          uncertain,
        });
        const r = await admin
          .from("reelready_targets")
          .update({
            status: uncertain
              ? "processing"
              : definite || attempts >= 10
                ? "failed"
                : "processing",
            safe_message: uncertain
              ? "The platform response is unconfirmed. Check your account before retrying; automatic resend is paused."
              : e instanceof SocialAPIError
                ? e.message
                : "This destination could not finish. Your video and other destination receipts are safe.",
          })
          .eq("job_id", job.id)
          .eq("owner_id", job.owner_id)
          .eq("platform", platform);
        if (r.error) databaseError(r.error);
        next = Math.max(next, uncertain ? 300 : 60);
      }
    }
    const final = await admin
      .from("reelready_targets")
      .select("status,native_state,platform")
      .eq("job_id", job.id)
      .eq("owner_id", job.owner_id);
    if (final.error) databaseError(final.error);
    const uncertain = final.data.some(
      (t) =>
        t.native_state &&
        decryptSocial<NativeState>(
          t.native_state,
          `${job.owner_id}:${t.platform}:job:${job.id}`,
        ).uncertain,
    );
    const complete = final.data.every((t) =>
      ["published", "failed", "skipped"].includes(t.status),
    );
    const state = final.data.every((t) => t.status === "published")
      ? "published"
      : complete
        ? "failed"
        : uncertain &&
            final.data.every(
              (t) =>
                ["published", "failed", "skipped"].includes(t.status) ||
                (t.native_state &&
                  decryptSocial<NativeState>(
                    t.native_state,
                    `${job.owner_id}:${t.platform}:job:${job.id}`,
                  ).uncertain),
            )
          ? "uncertain"
          : "processing";
    const r = await admin
      .from("reelready_jobs")
      .update({
        status: state,
        next_attempt_at: new Date(Date.now() + next * 1000).toISOString(),
        worker_id: null,
        lease_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .eq("worker_id", worker);
    if (r.error) databaseError(r.error);
    if (final.data.some((t) => t.status === "published")) {
      const usage = await admin
        .from("reelready_publish_usage")
        .upsert(
          [
            { owner_id: job.owner_id, job_id: job.id, kind: "upload" },
            ...(final.data.some(
              (t) => t.platform === "x" && t.status === "published",
            )
              ? [{ owner_id: job.owner_id, job_id: job.id, kind: "x" }]
              : []),
          ],
          { onConflict: "job_id,kind", ignoreDuplicates: true },
        );
      if (usage.error) databaseError(usage.error);
    }
  } catch {
    // A lease is recoverable after a worker crash. Never clear a platform commit checkpoint.
    await admin
      .from("reelready_jobs")
      .update({
        next_attempt_at: new Date(Date.now() + 60000).toISOString(),
        worker_id: null,
        lease_until: null,
        status: "processing",
      })
      .eq("id", job.id)
      .eq("worker_id", worker);
  } finally {
    clearInterval(leaseHeartbeat);
  }
  return true;
}
