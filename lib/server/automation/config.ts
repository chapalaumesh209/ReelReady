export type PublishExecutor = "native" | "n8n";

// Keep existing installations on their current executor until explicitly switched.
export function publishExecutor(): PublishExecutor {
  const value = process.env.PUBLISH_EXECUTOR || "native";
  if (value !== "native" && value !== "n8n")
    throw new Error("PUBLISH_EXECUTOR must be native or n8n.");
  return value;
}

export function publisherBridgeConfiguration() {
  const secret = process.env.N8N_PUBLISHER_SECRET || "";
  const port = Number(process.env.N8N_PUBLISHER_PORT || "3010");
  if (secret.length < 32)
    throw new Error("Set N8N_PUBLISHER_SECRET with at least 32 characters.");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("N8N_PUBLISHER_PORT must be a valid port.");
  return {
    secret,
    port,
    host: process.env.N8N_PUBLISHER_HOST || "127.0.0.1",
  };
}
