import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
const compose = ["compose", "-f", "automation/n8n/compose.yaml"];
const docker = (...args) =>
  execFileSync("docker", [...compose, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
const bootstrap = (name, content) =>
  execFileSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "n8n",
      "node",
      "-e",
      `require('fs').writeFileSync('/tmp/reelready-${name}.json',require('fs').readFileSync(0),{mode:0o600})`,
    ],
    { cwd: root, input: content, stdio: "pipe" },
  );
const envPath = ".env.development.local";
let appEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const setAppValue = (name, value) => {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  appEnv = pattern.test(appEnv)
    ? appEnv.replace(pattern, line)
    : `${appEnv.trimEnd()}\n${line}\n`;
};
const secret =
  process.env.N8N_PUBLISHER_SECRET || randomBytes(32).toString("base64url");
if (secret.length < 32)
  throw new Error(
    "Existing N8N_PUBLISHER_SECRET is too short; configure it securely.",
  );
const managed =
  !process.argv.includes("--native") &&
  (process.argv.includes("--provider") ||
    process.env.PUBLISH_PROVIDER === "uploadpost");
const publishingKey =
  process.env.UPLOAD_POST_API_KEY || process.env.UPLOADPOST_API_KEY || "";
if (managed && !publishingKey)
  throw new Error(
    "Configure the publishing service key securely before enabling this workflow.",
  );
const workflows = managed
  ? [
      "provider-publish-workflow.json",
      "provider-status-workflow.json",
      "provider-health-workflow.json",
      "provider-connect-workflow.json",
    ]
  : ["publish-workflow.json"];
setAppValue("N8N_PUBLISHER_SECRET", secret);
setAppValue("PUBLISH_EXECUTOR", "n8n");
if (managed) {
  setAppValue("PUBLISH_PROVIDER", "uploadpost");
  setAppValue(
    "N8N_PROVIDER_WEBHOOK_BASE",
    process.env.N8N_PROVIDER_WEBHOOK_BASE || "http://127.0.0.1:5678/webhook",
  );
} else setAppValue("PUBLISH_PROVIDER", "native");
// Mac Docker reaches the host listener through host.docker.internal. Do not expose this port publicly.
setAppValue("N8N_PUBLISHER_HOST", "0.0.0.0");
setAppValue("N8N_PUBLISHER_PORT", "3010");
mkdirSync(".n8n-local", { recursive: true, mode: 0o700 });
chmodSync(".n8n-local", 0o700);
if (!existsSync(".env.n8n.local"))
  writeFileSync(
    ".env.n8n.local",
    `N8N_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600 },
  );
chmodSync(".env.n8n.local", 0o600);
const credentialFile = ".n8n-local/publisher-credential.json";
writeFileSync(
  credentialFile,
  JSON.stringify([
    {
      id: "ReelReadyPublisherBridge",
      name: "ReelReady private publisher",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: `Bearer ${secret}` },
    },
    ...(managed
      ? [
          {
            id: "ReelReadyWorkflowJWT",
            name: "ReelReady workflow authentication",
            type: "jwtAuth",
            data: { keyType: "passphrase", secret, algorithm: "HS256" },
          },
          {
            id: "ReelReadyManagedPublisher",
            name: "ReelReady publishing service",
            type: "httpHeaderAuth",
            data: { name: "Authorization", value: `Apikey ${publishingKey}` },
          },
        ]
      : []),
  ]),
  { mode: 0o600 },
);
writeFileSync(
  ".n8n-local/publish-workflow.json",
  readFileSync("automation/n8n/publish-workflow.json"),
  { mode: 0o600 },
);

try {
  docker("up", "-d");
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      healthy = (await fetch("http://127.0.0.1:5678/healthz")).ok;
    } catch {
      /* still starting */
    }
    if (healthy) break;
  }
  if (!healthy) throw new Error("n8n did not become healthy.");
  bootstrap("credential", readFileSync(credentialFile));
  docker(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "import:credentials",
    "--input=/tmp/reelready-credential.json",
  );
  // Publish only our reserved workflows, never every workflow in the operator's account.
  if (managed)
    docker(
      "exec",
      "-T",
      "n8n",
      "n8n",
      "unpublish:workflow",
      "--id=ReelReadyPublisherV1",
    );
  for (const file of workflows) {
    const contents = readFileSync(`automation/n8n/${file}`);
    bootstrap("workflow", contents);
    docker(
      "exec",
      "-T",
      "n8n",
      "n8n",
      "import:workflow",
      "--input=/tmp/reelready-workflow.json",
    );
    docker(
      "exec",
      "-T",
      "n8n",
      "n8n",
      "publish:workflow",
      `--id=${JSON.parse(contents).id}`,
    );
  }
  docker("restart", "n8n");
  writeFileSync(envPath, appEnv, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  console.log(
    "Local n8n configured at http://127.0.0.1:5678. Restart ReelReady and its worker to activate the coordinator. No social posts were sent by setup.",
  );
} catch {
  console.error(
    "Local n8n setup could not finish. Application settings were not switched. Check Docker and the local n8n container, then retry. No secrets are printed.",
  );
  process.exitCode = 1;
} finally {
  if (existsSync(credentialFile)) unlinkSync(credentialFile);
  try {
    docker(
      "exec",
      "-T",
      "n8n",
      "node",
      "-e",
      "for(const name of ['credential','workflow']){try{require('fs').unlinkSync('/tmp/reelready-'+name+'.json')}catch{}}",
    );
  } catch {
    /* The container may not have started. No existing user data is removed. */
  }
}
