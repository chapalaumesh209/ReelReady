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
const bootstrap = (name, input) =>
  execFileSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "n8n",
      "node",
      "-e",
      `require('fs').writeFileSync('/tmp/reelready-verification-${name}.json',require('fs').readFileSync(0),{mode:0o600})`,
    ],
    { input: JSON.stringify(input), stdio: "pipe" },
  );
const bridgeSecret = randomBytes(32).toString("base64url"),
  providerSecret = "fixture-only-not-an-api-key";
let consumed = false,
  uploads = 0;
const hosted = process.argv.includes("--hosted");
const videoBytes = readFileSync("public/samples/reelready-demo.mp4");
const envelope = {
  postId: randomUUID(),
  profileUsername: "verification-profile",
  ...(hosted
    ? {
        videoUrl:
          "https://media.example.com/signed-owned-video.mp4?fixture=yes",
      }
    : { mediaTicket: "fixture-private-media-ticket" }),
  platforms: ["youtube", "instagram", "x"],
  title: "Fixture title",
  youtubeDescription: "YouTube only description",
  instagramCaption: "Instagram only caption",
  xCaption: "X only caption",
  synthetic: false,
};
const server = createServer(async (req, res) => {
  let body = "";
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    body = raw.toString("utf8");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/authorize") {
      assert.equal(req.headers.authorization, `Bearer ${bridgeSecret}`);
      if (consumed) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: "Already consumed" }));
        return;
      }
      consumed = true;
      res.end(JSON.stringify(envelope));
      return;
    }
    if (req.url === "/media-download") {
      assert.equal(req.headers.authorization, `Bearer ${bridgeSecret}`);
      assert.equal(JSON.parse(body).mediaTicket, envelope.mediaTicket);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="reelready.mp4"',
      );
      res.end(videoBytes);
      return;
    }
    assert.equal(req.url, "/upload");
    if (!hosted) {
      assert.ok(
        raw.includes(videoBytes),
        "Publisher must receive the actual video bytes",
      );
      assert.match(body, /name="video"; filename="[^"]+"/);
    }
    assert.equal(req.headers.authorization, `Apikey ${providerSecret}`);
    assert.match(String(req.headers["content-type"]), /^multipart\/form-data;/);
    const field = (name) =>
      body.match(
        new RegExp(
          `name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\r\\n\\r\\n([^\\r]*)`,
        ),
      )?.[1];
    if (hosted) assert.equal(field("video"), envelope.videoUrl);
    assert.equal(field("user"), envelope.profileUsername);
    assert.equal(field("youtube_description"), envelope.youtubeDescription);
    assert.equal(field("instagram_title"), envelope.instagramCaption);
    assert.equal(field("x_title"), envelope.xCaption);
    assert.equal(field("async_upload"), "true");
    const selectedPlatforms = [
      ...body.matchAll(/name="platform\[\]"\r\n\r\n([^\r]*)/g),
    ].map((match) => match[1]);
    assert.deepEqual(selectedPlatforms, envelope.platforms);
    uploads++;
    res.end(
      JSON.stringify({
        success: true,
        request_id: "verification-request-no-post",
      }),
    );
  } catch (error) {
    // This listener receives only synthetic fixtures, never a real API key/video.
    console.error(
      error instanceof Error ? error.message : "Mock rejected request",
    );
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Local verification failed" }));
  }
});
server.listen(3020, "0.0.0.0");
await once(server, "listening");
const flow = JSON.parse(
  readFileSync(
    hosted
      ? ".n8n-hosted/ReelReadyProviderPublisherV1.json"
      : "automation/n8n/provider-publish-workflow.json",
    "utf8",
  ),
);
flow.id = "ReelReadyVerificationV1";
flow.versionId = randomUUID();
flow.name = "Verification only — no social posts";
flow.nodes[0].webhookId = randomUUID();
flow.nodes[0].parameters.path = "reelready-verification-only";
flow.nodes[0].credentials = {
  jwtAuth: { id: "ReelReadyVerificationJWT", name: "Verification JWT" },
};
flow.nodes[1].parameters.url = "http://host.docker.internal:3020/authorize";
flow.nodes[1].credentials.httpHeaderAuth = {
  id: "ReelReadyVerificationAuth",
  name: "Verification auth",
};
const download = flow.nodes.find(
  (node) => node.id === "download-private-video",
);
if (download) {
  download.parameters.url = "http://host.docker.internal:3020/media-download";
  download.credentials.httpHeaderAuth = {
    id: "ReelReadyVerificationAuth",
    name: "Verification auth",
  };
}
flow.nodes.find(
  (node) => node.name === "Publish video to selected destinations",
).parameters.url = "http://host.docker.internal:3020/upload";
flow.nodes.find(
  (node) => node.name === "Publish video to selected destinations",
).credentials.httpHeaderAuth = {
  id: "ReelReadyVerificationProvider",
  name: "Verification provider",
};
const credentials = [
  {
    id: "ReelReadyVerificationJWT",
    name: "Verification JWT",
    type: "jwtAuth",
    data: { keyType: "passphrase", secret: bridgeSecret, algorithm: "HS256" },
  },
  {
    id: "ReelReadyVerificationAuth",
    name: "Verification auth",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${bridgeSecret}` },
  },
  {
    id: "ReelReadyVerificationProvider",
    name: "Verification provider",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Apikey ${providerSecret}` },
  },
];
async function healthy() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5678/healthz")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Local n8n did not start");
}
try {
  bootstrap("credentials", credentials);
  bootstrap("workflow", flow);
  docker(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "import:credentials",
    "--input=/tmp/reelready-verification-credentials.json",
  );
  docker(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "import:workflow",
    "--input=/tmp/reelready-verification-workflow.json",
  );
  docker(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "publish:workflow",
    "--id=ReelReadyVerificationV1",
  );
  docker("restart", "n8n");
  await healthy();
  const url = "http://127.0.0.1:5678/webhook/reelready-verification-only";
  // n8n's process health can be ready before published webhooks are registered.
  // Probe without credentials, so this readiness check can never execute a post.
  let guardStatus = 404;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    guardStatus = probe.status;
    await probe.body?.cancel();
    if (guardStatus === 401 || guardStatus === 403) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(
    guardStatus === 401 || guardStatus === 403,
    "The protected verification webhook did not register.",
  );
  assert.equal(uploads, 0);
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: (() => {
        const head = Buffer.from(
          JSON.stringify({ alg: "HS256", typ: "JWT" }),
        ).toString("base64url");
        const payload = Buffer.from(
          JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 }),
        ).toString("base64url");
        return `Bearer ${head}.${payload}.${createHmac("sha256", bridgeSecret).update(`${head}.${payload}`).digest("base64url")}`;
      })(),
    },
    body: JSON.stringify({
      postId: envelope.postId,
      dispatchToken: "fixture-proof-only",
      profileUsername: "forged-browser-value",
    }),
  };
  const response = await fetch(url, init);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(
    (await response.json()).request_id,
    "verification-request-no-post",
  );
  assert.ok((await fetch(url, init)).status >= 400);
  assert.equal(uploads, 1);
  consumed = false;
  envelope.platforms = ["instagram"];
  assert.equal((await fetch(url, init)).status, 200);
  assert.equal(uploads, 2);
  console.log(
    "Verified actual n8n webhook authentication, canonical authorization, multipart mapping, async response and duplicate rejection against local mocks. No real provider or social calls.",
  );
} finally {
  try {
    docker(
      "exec",
      "-T",
      "n8n",
      "n8n",
      "unpublish:workflow",
      "--id=ReelReadyVerificationV1",
    );
    docker(
      "exec",
      "-T",
      "n8n",
      "node",
      "-e",
      "for(const name of ['credentials','workflow'])try{require('fs').unlinkSync('/tmp/reelready-verification-'+name+'.json')}catch{}",
    );
    docker("restart", "n8n");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
