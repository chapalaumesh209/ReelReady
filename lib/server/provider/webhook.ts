import { GenerationError } from "../../generation";
import { providerWebhook } from "./config";
import { createHmac } from "node:crypto";
export function workflowAuthorization(now = Date.now()) {
  const key = process.env.N8N_PUBLISHER_SECRET || "";
  if (key.length < 32)
    throw new GenerationError(
      "The publishing workflow needs configuration.",
      503,
    );
  const head = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "reelready",
      aud: "publishing-workflow",
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 60,
      jti: crypto.randomUUID(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(`${head}.${payload}`)
    .digest("base64url");
  return `Bearer ${head}.${payload}.${signature}`;
}
export async function callPublishingWorkflow(
  action: "publish" | "status" | "health" | "connect",
  data: unknown,
) {
  const key = process.env.N8N_PUBLISHER_SECRET || "";
  if (key.length < 32)
    throw new GenerationError(
      "The publishing workflow needs configuration.",
      503,
    );
  const response = await fetch(providerWebhook(action), {
    method: "POST",
    headers: {
      Authorization: workflowAuthorization(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    redirect: "error",
    signal: AbortSignal.timeout(
      action === "health" ? 5000 : action === "publish" ? 300000 : 45000,
    ),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GenerationError(
      action === "connect" && response.status === 503
        ? "Account connection or service capacity needs attention. Your reel is saved; the site owner needs to check the service plan."
        : action === "connect"
          ? "The account connection workflow could not finish. Your reel is saved; try again later."
          : "The publishing workflow could not confirm this step. Your video and receipts are safe.",
      response.status === 429 ? 429 : 502,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}
