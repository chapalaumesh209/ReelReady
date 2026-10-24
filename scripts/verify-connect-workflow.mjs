import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import assert from "node:assert/strict";
const compose = ["compose", "-f", "automation/n8n/compose.yaml"];
const docker = (...args) =>
  execFileSync("docker", [...compose, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
const bootstrap = (name, value) =>
  execFileSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "n8n",
      "node",
      "-e",
      `require('fs').writeFileSync('/tmp/reelready-connect-verification-${name}.json',require('fs').readFileSync(0),{mode:0o600})`,
    ],
    { input: JSON.stringify(value), stdio: "pipe" },
  );
const secret = randomBytes(32).toString("base64url"),
  apiKey = "fixture-only-not-a-provider-key";
let creates = 0,
  starts = 0,
  lastToken = "";
const consumed = new Set();
const links = {
  youtube: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture",
  instagram: "https://www.instagram.com/oauth/authorize?state=fixture",
  x: "https://x.com/i/oauth2/authorize?state=fixture",
};
const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw || "{}");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/connect-authorize") {
      assert.equal(req.headers.authorization, `Bearer ${secret}`);
      if (consumed.has(data.connectionToken)) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: "Already used" }));
        return;
      }
      consumed.add(data.connectionToken);
      lastToken = data.connectionToken;
      res.end(
        JSON.stringify({
          profileUsername: "canonical-owner",
          redirectUrl: "http://127.0.0.1:3000/connect",
          platform:
            lastToken === "new"
              ? "instagram"
              : lastToken === "existing-x"
                ? "x"
                : "youtube",
          needsCreation: ["new", "capacity"].includes(lastToken),
        }),
      );
      return;
    }
    assert.equal(req.headers.authorization, `Apikey ${apiKey}`);
    if (req.url === "/users") {
      assert.equal(data.username, "canonical-owner");
      creates++;
      res.writeHead(lastToken === "capacity" ? 403 : 201);
      res.end(JSON.stringify({ success: lastToken !== "capacity" }));
      return;
    }
    const platform = req.url.split("/")[2];
    assert.ok(platform in links);
    assert.equal(data.profile, "canonical-owner");
    assert.equal(data.redirect_url, "http://127.0.0.1:3000/connect");
    starts++;
    res.end(JSON.stringify({ authorize_url: links[platform], success: true }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Local mock rejected request" }));
    console.error(e instanceof Error ? e.message : "Verification failed");
  }
});
server.listen(3021, "0.0.0.0");
await once(server, "listening");
const flow = JSON.parse(
  readFileSync("automation/n8n/provider-connect-workflow.json", "utf8"),
);
flow.id = "ReelReadyConnectVerificationV1";
flow.versionId = randomUUID();
flow.name = "Verification only — no real account connections";
flow.nodes[0].webhookId = randomUUID();
flow.nodes[0].parameters.path = "reelready-connect-verification-only";
for (const n of flow.nodes) {
  if (n.type.endsWith(".webhook"))
    n.credentials = {
      jwtAuth: {
        id: "ReelReadyConnectVerificationJWT",
        name: "Connect verification JWT",
      },
    };
  if (n.type.endsWith(".httpRequest")) {
    n.parameters.url = n.parameters.url
      .replace(
        "http://host.docker.internal:3010/connect-authorize",
        "http://host.docker.internal:3021/connect-authorize",
      )
      .replace(
        "https://api.upload-post.com/api/uploadposts/users",
        "http://host.docker.internal:3021/users",
      )
      .replace(
        "https://api.upload-post.com/api/uploadposts/oauth/",
        "http://host.docker.internal:3021/oauth/",
      );
    n.credentials.httpHeaderAuth =
      n.name === "Verify creator workspace"
        ? {
            id: "ReelReadyConnectVerificationBridge",
            name: "Connect verification bridge",
          }
        : {
            id: "ReelReadyConnectVerificationProvider",
            name: "Connect verification provider",
          };
  }
}
const creds = [
  {
    id: "ReelReadyConnectVerificationJWT",
    name: "Connect verification JWT",
    type: "jwtAuth",
    data: { keyType: "passphrase", secret, algorithm: "HS256" },
  },
  {
    id: "ReelReadyConnectVerificationBridge",
    name: "Connect verification bridge",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${secret}` },
  },
  {
    id: "ReelReadyConnectVerificationProvider",
    name: "Connect verification provider",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Apikey ${apiKey}` },
  },
];
function auth() {
  const head = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url"),
    payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString("base64url");
  return `Bearer ${head}.${payload}.${createHmac("sha256", secret).update(`${head}.${payload}`).digest("base64url")}`;
}
const url = "http://127.0.0.1:5678/webhook/reelready-connect-verification-only";
const call = (token) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth() },
    body: JSON.stringify({
      connectionToken: token,
      profileUsername: "untrusted-browser-profile",
    }),
  });
try {
  bootstrap("credentials", creds);
  bootstrap("workflow", flow);
  docker(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "import:credentials",
    "--input=/tmp/reelready-connect-verification-credentials.json",
  );
  docker(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "import:workflow",
    "--input=/tmp/reelready-connect-verification-workflow.json",
  );
  docker(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "publish:workflow",
    "--id=ReelReadyConnectVerificationV1",
  );
  docker("restart", "n8n");
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const status = r.status;
      await r.body?.cancel();
      if ([401, 403].includes(status)) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "Connection verification webhook did not register");
  let r = await call("existing");
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).authorize_url, links.youtube);
  assert.equal(creates, 0);
  assert.equal(starts, 1);
  r = await call("new");
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).authorize_url, links.instagram);
  assert.equal(creates, 1);
  assert.equal(starts, 2);
  r = await call("existing-x");
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).authorize_url, links.x);
  assert.equal(creates, 1);
  assert.equal(starts, 3);
  r = await call("capacity");
  assert.equal(r.status, 503);
  assert.equal(starts, 3);
  r = await call("existing");
  assert.ok(r.status >= 400);
  assert.equal(starts, 3);
  console.log(
    "Verified actual n8n account workflow: existing/new profiles, all three authorization links, canonical owner fields, capacity stop and replay rejection. Local mocks only; no real account changes.",
  );
} finally {
  try {
    docker(
      "exec",
      "-T",
      "n8n",
      "n8n",
      "unpublish:workflow",
      "--id=ReelReadyConnectVerificationV1",
    );
    docker(
      "exec",
      "-T",
      "n8n",
      "node",
      "-e",
      "for(const n of ['credentials','workflow'])try{require('fs').unlinkSync('/tmp/reelready-connect-verification-'+n+'.json')}catch{}",
    );
    docker("restart", "n8n");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
