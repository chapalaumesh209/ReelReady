import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
const { storageAdmin, VIDEO_BUCKET } = await import("../lib/supabase");
const { positiveEnv } = await import("../lib/server/hardening");
const admin = storageAdmin(),
  execute = process.argv.includes("--execute");
const before = new Date(
  Date.now() - positiveEnv("RETENTION_DAYS", 7) * 86400000,
).toISOString();
const candidates = await admin.rpc("reelready_retention_candidates", {
  p_before: before,
});
if (candidates.error)
  throw new Error(
    "Retention scan failed. Check local migrations and server permissions.",
  );
let count = 0;
for (const item of candidates.data || []) {
  const media = await admin
    .from("reelready_media")
    .select("path")
    .eq("reel_id", item.reel_id)
    .eq("owner_id", item.owner_id);
  if (media.error)
    throw new Error("Retention scan failed; no further work was attempted.");
  count += media.data.length;
  if (!execute) continue;
  // Re-check immediately before removal; never target active or scheduled work.
  const still = await admin.rpc("reelready_retention_candidates", {
    p_before: before,
  });
  if (
    still.error ||
    !still.data?.some((r: { reel_id: string }) => r.reel_id === item.reel_id)
  )
    continue;
  if (media.data.length) {
    const r = await admin.storage
      .from(VIDEO_BUCKET)
      .remove(media.data.map((m) => m.path));
    if (r.error)
      throw new Error(
        "Retention storage deletion failed; database records were preserved.",
      );
  }
  for (const table of ["reelready_jobs", "reelready_reels"]) {
    const r = await admin
      .from(table)
      .delete()
      .eq(table === "reelready_reels" ? "id" : "reel_id", item.reel_id)
      .eq("owner_id", item.owner_id);
    if (r.error)
      throw new Error(
        "Retention database deletion failed. Retry cleanup after resolving references.",
      );
  }
}
console.log(
  JSON.stringify({
    mode: execute ? "executed" : "dry-run",
    expiredReels: candidates.data?.length || 0,
    assets: count,
    retentionDays: positiveEnv("RETENTION_DAYS", 7),
  }),
);
