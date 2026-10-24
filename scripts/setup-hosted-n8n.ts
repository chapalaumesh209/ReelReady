import nextEnv from "@next/env";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  hostedActions,
  hostedWorkflows,
  hostedCoordinator,
  type HostedAction,
} from "../lib/server/automation/hosted-workflows";
import {
  providerWebhookBase,
  providerKey,
} from "../lib/server/provider/config";
import { workflowAuthorization } from "../lib/server/provider/webhook";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const apply = process.argv.includes("--apply");
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
if (only?.some((a) => !hostedActions.includes(a as HostedAction)))
  throw new Error("--only supports publish,status,health,connect.");
const actions = (only || hostedActions) as HostedAction[];
const base = providerWebhookBase();
if (
  !base.startsWith("https://") ||
  /\/(?:localhost|127\.0\.0\.1)[:/]/.test(base)
)
  throw new Error(
    "Hosted setup requires a public HTTPS N8N_PROVIDER_WEBHOOK_BASE.",
  );
const host = new URL(base).origin;
const app =
  process.argv.find((a) => a.startsWith("--app-url="))?.slice(10) ||
  process.env.APP_URL ||
  "";
const flows = hostedWorkflows(app, actions);
if (process.argv.includes("--with-coordinator"))
  flows.push(hostedCoordinator(app));
const directory = ".n8n-hosted";
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
for (const flow of flows)
  writeFileSync(
    `${directory}/${flow.id}.json`,
    JSON.stringify(flow, null, 2) + "\n",
    { mode: 0o600 },
  );
if (!apply) {
  console.log(
    `Prepared ${flows.length} hosted workflows in ${directory}. Review them, then use --apply to update only these workflows on ${host}. No remote changes made.`,
  );
  process.exit(0);
}
const key = process.env.N8N_API_KEY || "";
if (!key)
  throw new Error(
    "Configure N8N_API_KEY securely in your local server environment. Never pass it as a command argument.",
  );
const secret = process.env.N8N_PUBLISHER_SECRET || "";
if (secret.length < 32 || !providerKey())
  throw new Error(
    "Configure the shared N8N_PUBLISHER_SECRET and publishing service API key securely before setup.",
  );
async function api(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${host}/api/v1${path}`, {
      method,
      headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    if (r.ok) return (await r.json()) as Record<string, unknown>;
    let diagnostic = await r.text();
    for (const value of [key, secret, providerKey()])
      if (value) diagnostic = diagnostic.replaceAll(value, "[redacted]");
    writeFileSync(
      `${directory}/last-api-error.json`,
      JSON.stringify({ method, path, status: r.status, diagnostic }, null, 2),
      { mode: 0o600 },
    );
    if (
      method === "GET" &&
      [429, 500, 502, 503, 504].includes(r.status) &&
      attempt < 2
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    const reason = [401, 403].includes(r.status)
      ? "Verify the management API key and its permissions."
      : r.status === 400
        ? "n8n rejected the workflow data. See the private sanitized .n8n-hosted/last-api-error.json diagnostic."
        : "The hosted n8n service is unavailable; inspect its health before retrying. No automatic mutation retry was performed.";
    throw new Error(
      `Hosted n8n management request failed (HTTP ${r.status}). ${reason}`,
    );
  }
  throw new Error("Hosted n8n management request could not finish.");
}
type RemoteWorkflow = {
  id: string;
  name: string;
  nodes: Array<{ parameters: Record<string, unknown> }>;
  [key: string]: unknown;
};
const remote: RemoteWorkflow[] = [];
let cursor: string | undefined;
do {
  const page = await api(
    `/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  if (!Array.isArray(page.data))
    throw new Error("Hosted n8n returned an unexpected workflow list.");
  remote.push(...(page.data as RemoteWorkflow[]));
  cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
} while (cursor);
const statePath = `${directory}/state.json`;
const previous = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {};
const state: {
  host: string;
  fingerprint: string;
  credentials: Record<string, string>;
  workflows: Record<string, string>;
} =
  previous.host === host
    ? previous
    : { host, fingerprint: "", credentials: {}, workflows: {} };
const fingerprint = createHash("sha256")
  .update(`${secret}\0${providerKey()}`)
  .digest("hex");
if (state.fingerprint !== fingerprint) state.credentials = {};
const save = () =>
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
const credentialSpecs = {
  ReelReadyWorkflowJWT: {
    name: "ReelReady hosted workflow authentication",
    type: "jwtAuth",
    data: { keyType: "passphrase", secret, algorithm: "HS256" },
  },
  ReelReadyPublisherBridge: {
    name: "ReelReady hosted callback authentication",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${secret}` },
  },
  ReelReadyManagedPublisher: {
    name: "ReelReady hosted publishing service",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Apikey ${providerKey()}` },
  },
};
const neededCredentials = new Set(
  flows.flatMap((flow) =>
    flow.nodes.flatMap((node) =>
      Object.values(node.credentials || {}).map((credential) => credential.id),
    ),
  ),
);
for (const [id, spec] of Object.entries(credentialSpecs)) {
  if (!neededCredentials.has(id)) continue;
  if (!state.credentials[id]) {
    const created = await api("/credentials", "POST", spec);
    if (typeof created.id !== "string")
      throw new Error("n8n did not return a credential identifier.");
    state.credentials[id] = created.id;
    state.fingerprint = fingerprint;
    save();
  }
}
for (const flow of flows) {
  const path = flow.nodes.find((n) => n.type === "n8n-nodes-base.webhook")
    ?.parameters.path;
  const matches = remote.filter((candidate) =>
    path
      ? candidate.nodes.some((n) => n.parameters.path === path)
      : candidate.id === state.workflows[flow.id] ||
        candidate.name === flow.name,
  );
  if (matches.length > 1)
    throw new Error(
      `More than one workflow uses ${String(path)}. Resolve the duplicate before applying changes.`,
    );
  const existing = matches[0];
  if (existing) {
    const snapshot = await api(`/workflows/${encodeURIComponent(existing.id)}`);
    writeFileSync(
      `${directory}/backup-${existing.id}-${Date.now()}.json`,
      JSON.stringify(snapshot, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  for (const node of flow.nodes)
    for (const credential of Object.values(node.credentials || {})) {
      if (!state.credentials[credential.id])
        throw new Error("A workflow references an unknown credential.");
      credential.id = state.credentials[credential.id];
    }
  const payload = {
    name: flow.name,
    nodes: flow.nodes,
    connections: flow.connections,
    settings: flow.settings,
  };
  const result = existing
    ? await api(`/workflows/${encodeURIComponent(existing.id)}`, "PUT", payload)
    : await api("/workflows", "POST", payload);
  const id = typeof result.id === "string" ? result.id : existing?.id;
  if (!id) throw new Error("n8n did not return a workflow identifier.");
  state.workflows[flow.id] = id;
  save();
  if (flow.id === "ReelReadyHostedCoordinatorV1") {
    const check = await fetch(`${new URL(app).origin}/api/automation/health`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const ready =
      check.ok && ((await check.json()) as { ready?: boolean }).ready === true;
    await check.body?.cancel().catch(() => {});
    if (!ready) {
      console.log(
        "Hosted coordinator prepared but left inactive: deploy the callbacks and configure Vercel/hosted Supabase first, then rerun --apply --with-coordinator.",
      );
      continue;
    }
  }
  await api(`/workflows/${encodeURIComponent(id)}/activate`, "POST");
  console.log(`Published hosted workflow: ${flow.name}`);
}
if (actions.includes("health")) {
  const r = await fetch(`${base}/reelready-provider-health`, {
    method: "POST",
    headers: {
      Authorization: workflowAuthorization(),
      "Content-Type": "application/json",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const data = r.ok ? ((await r.json()) as { ready?: boolean }) : null;
  if (!r.ok || data?.ready !== true)
    throw new Error(
      "Hosted health webhook did not authenticate successfully. Check n8n credential bindings and activation.",
    );
  console.log(
    "Hosted authenticated health webhook verified. No account authorization or social post was triggered.",
  );
}
