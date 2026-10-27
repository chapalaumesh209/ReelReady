import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
const { sampleOutputsAllowed } = await import("../lib/server/ai");
const { generationConfiguration } = await import("../lib/generation");
const { storageConfiguration } = await import("../lib/supabase");
const { workerStatus } = await import("../lib/server/media/status");
const { publicLimits, positiveEnv } = await import("../lib/server/hardening");
const { demoMode } = await import("../lib/server/config");
const { providerCapacity } = await import("../lib/server/provider-budget");
const { speechCooldown } = await import("../lib/server/media/speech-capacity");
const { publicMediaURL } = await import("../lib/server/publishing/preflight");
const { socialConfiguration } = await import("../lib/server/social/config");
const {
  publishingProvider,
  providerKey,
  realPublishingConfigured,
  providerWebhookBase,
  binaryMediaTransfer,
} = await import("../lib/server/provider/config");
const { publishExecutor, publisherBridgeConfiguration } =
  await import("../lib/server/automation/config");
const { publishingExecutorStatus } =
  await import("../lib/server/automation/status");
const socialEncryptionConfigured =
  Buffer.from(process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || "", "base64")
    .length === 32;
const storage = storageConfiguration(),
  demo = demoMode();
const issues: string[] = [],
  local = process.argv.includes("--local");
try {
  if (publishExecutor() === "n8n") publisherBridgeConfiguration();
} catch (e) {
  issues.push(
    e instanceof Error
      ? e.message
      : "Publishing executor configuration is invalid.",
  );
}
for (const name of [
  "MAX_UPLOAD_MB",
  "MAX_VIDEO_SECONDS",
  "WORKER_HEARTBEAT_SECONDS",
  "MAX_ACTIVE_JOBS_PER_USER",
  "MAX_QUEUED_JOBS",
  "DAILY_PROVIDER_CALL_LIMIT",
  "RETENTION_DAYS",
  "PUBLISH_SIGNED_URL_TTL_SECONDS",
]) {
  if (
    process.env[name] &&
    (!Number.isSafeInteger(Number(process.env[name])) ||
      Number(process.env[name]) <= 0)
  )
    issues.push(`${name} must be a positive whole number.`);
}
if (!storage.configured)
  issues.push(
    "Configure the server Supabase URL, publishable key and secret key.",
  );
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  issues.push("Set a stable SESSION_SECRET with at least 32 characters.");
if (!local && (!process.env.APP_URL || !publicMediaURL(process.env.APP_URL)))
  issues.push("Hosted configuration requires a public HTTPS APP_URL.");
if (!local && !publicMediaURL(storage.url))
  issues.push("Hosted storage requires a public HTTPS Supabase URL.");
if (publishingProvider() === "uploadpost") {
  try {
    const base = providerWebhookBase();
    if (!local && !publicMediaURL(base))
      issues.push(
        "Hosted publishing requires the public HTTPS n8n production webhook base.",
      );
    if (!local && binaryMediaTransfer())
      issues.push(
        "Vercel callbacks require PUBLISH_MEDIA_TRANSPORT=url and hosted Supabase Storage. Do not send large videos through Vercel functions.",
      );
  } catch (e) {
    issues.push(
      e instanceof Error
        ? e.message
        : "Hosted webhook configuration is invalid.",
    );
  }
}
if (!demo) {
  if (!realPublishingConfigured())
    issues.push(
      publishingProvider() === "uploadpost"
        ? "Configure the publishing service key, authenticated n8n webhooks and shared bridge secret."
        : socialEncryptionConfigured
          ? "Configure official platform application credentials before real posting."
          : "Configure official platform application credentials and SOCIAL_TOKEN_ENCRYPTION_KEY before real posting.",
    );
}
const [worker, capacity, publishingExecutor, speechAvailable] =
  await Promise.all([
    workerStatus(),
    providerCapacity().catch(() => false),
    publishingExecutorStatus().catch(() => ({
      executor: "invalid",
      status: "offline",
    })),
    process.env.GEMINI_API_KEY
      ? speechCooldown()
          .then((x) => !x)
          .catch(() => false)
      : false,
  ]);
console.log(
  JSON.stringify(
    {
      generation:
        generationConfiguration().key && capacity
          ? "live"
          : sampleOutputsAllowed()
            ? "sample"
            : "offline",
      transcription:
        process.env.GEMINI_API_KEY &&
        process.env.SPEECH_TO_TEXT_PROVIDER !== "disabled" &&
        capacity
          ? "live (requires worker)"
          : sampleOutputsAllowed()
            ? "sample / keep original"
            : "offline / keep original",
      voice:
        process.env.GEMINI_API_KEY &&
        process.env.TTS_PROVIDER !== "disabled" &&
        capacity &&
        speechAvailable
          ? "live (requires worker)"
          : sampleOutputsAllowed()
            ? "sample / keep original"
            : "offline / keep original",
      worker: worker.status,
      publish: demo ? "demo" : "real",
      connectionBackend:
        publishingProvider() === "uploadpost" ? "managed" : "direct",
      publishingExecutor,
      socialEncryption: socialEncryptionConfigured
        ? "configured"
        : "not configured",
      connections: Object.fromEntries(
        (["youtube", "instagram", "x"] as const).map((p) => [
          p,
          (
            publishingProvider() === "uploadpost"
              ? !!providerKey()
              : socialConfiguration(p).configured
          )
            ? "configured"
            : "not configured",
        ]),
      ),
      limits: {
        ...publicLimits(),
        dailyProviderCalls: positiveEnv("DAILY_PROVIDER_CALL_LIMIT", 500),
      },
      issues,
    },
    null,
    2,
  ),
);
process.exitCode = issues.length ? 1 : 0;
