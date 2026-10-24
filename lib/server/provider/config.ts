import { GenerationError } from "../../generation";
import { nativeConfigured } from "../social/config";
export function publishingProvider(): "native" | "uploadpost" {
  const value = process.env.PUBLISH_PROVIDER || "native";
  if (value !== "native" && value !== "uploadpost")
    throw new GenerationError("Publishing configuration needs attention.", 503);
  return value;
}
export const providerKey = () =>
  process.env.UPLOAD_POST_API_KEY || process.env.UPLOADPOST_API_KEY || "";
export const connectionConfigured = () =>
  publishingProvider() === "uploadpost" ? !!providerKey() : nativeConfigured();
export function providerWebhookBase(
  raw = process.env.N8N_PROVIDER_WEBHOOK_BASE || "",
) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new GenerationError(
      "Set the production n8n webhook base URL in the server environment.",
      503,
    );
  }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    (process.env.VERCEL && local) ||
    url.pathname.split("/").includes("webhook-test")
  )
    throw new GenerationError(
      "Use a production n8n /webhook/ URL over HTTPS. Test webhooks and local URLs cannot be used on Vercel.",
      503,
    );
  // Accept either the base or a pasted production endpoint, never a test endpoint.
  url.pathname = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/reelready-provider-(?:publish|status|health|connect)$/, "");
  if (!url.pathname || url.pathname === "/") url.pathname = "/webhook";
  if (!url.pathname.endsWith("/webhook"))
    throw new GenerationError(
      "The n8n webhook base must end in /webhook, not an editor or API URL.",
      503,
    );
  return url.href.replace(/\/$/, "");
}
export function providerWebhook(
  action: "publish" | "status" | "health" | "connect",
) {
  return `${providerWebhookBase()}/reelready-provider-${action}`;
}

export function realPublishingConfigured() {
  if (publishingProvider() === "native") return nativeConfigured();
  try {
    providerWebhook("publish");
    return (
      !!providerKey() && (process.env.N8N_PUBLISHER_SECRET || "").length >= 32
    );
  } catch {
    return false;
  }
}

export function binaryMediaTransfer() {
  if (
    publishingProvider() !== "uploadpost" ||
    process.env.PUBLISH_EXECUTOR !== "n8n"
  )
    return false;
  const local = /^(?:https?:\/\/)?(?:127\.0\.0\.1|localhost)(?=[:/]|$)/.test(
    process.env.N8N_PROVIDER_WEBHOOK_BASE || "",
  );
  const transport =
    process.env.PUBLISH_MEDIA_TRANSPORT ||
    (local || !process.env.N8N_PROVIDER_WEBHOOK_BASE ? "binary" : "url");
  if (!["binary", "url"].includes(transport))
    throw new GenerationError(
      "PUBLISH_MEDIA_TRANSPORT must be binary or url.",
      503,
    );
  return transport === "binary";
}
