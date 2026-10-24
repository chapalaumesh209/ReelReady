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
export function providerWebhook(
  action: "publish" | "status" | "health" | "connect",
) {
  const raw = process.env.N8N_PROVIDER_WEBHOOK_BASE || "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GenerationError(
      "The publishing workflow is not configured yet.",
      503,
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      ))
  )
    throw new GenerationError(
      "The publishing workflow address needs attention.",
      503,
    );
  return `${url.href.replace(/\/$/, "")}/reelready-provider-${action}`;
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

export const binaryMediaTransfer = () =>
  publishingProvider() === "uploadpost" &&
  process.env.PUBLISH_EXECUTOR === "n8n" &&
  process.env.PUBLISH_MEDIA_TRANSPORT !== "url";
