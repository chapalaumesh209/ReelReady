import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createPublisherBridge } from "../lib/server/automation/bridge";
import {
  publishExecutor,
  publisherBridgeConfiguration,
} from "../lib/server/automation/config";
import { publishingExecutorStatus } from "../lib/server/automation/status";
import { workerStatus } from "../lib/server/media/status";
import { storageAdmin } from "../lib/supabase";
const secret = "n8n-test-only-not-a-real-secret-0000000000";
const headers = { Authorization: `Bearer ${secret}` };
async function fixture(
  deps: Partial<Parameters<typeof createPublisherBridge>[0]> = {},
) {
  let calls = 0,
    beats = 0;
  const server = createPublisherBridge({
    secret,
    run: async () => {
      calls++;
      return true;
    },
    heartbeat: async () => {
      beats++;
    },
    demo: () => false,
    ...deps,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls: () => calls,
    beats: () => beats,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
test("n8n control plane rejects untrusted calls and cannot receive job IDs or media URLs", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await fetch(`${f.url}/tick`, { method: "POST" })).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${f.url}/tick`, {
          method: "POST",
          headers: { Authorization: "Bearer incorrect" },
        })
      ).status,
      401,
    );
    assert.equal((await fetch(`${f.url}/tick`, { headers })).status, 405);
    assert.equal(
      (
        await fetch(`${f.url}/tick?jobId=someone-else`, {
          method: "POST",
          headers,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${f.url}/tick`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            owner: "another-creator",
            url: "http://127.0.0.1/private",
          }),
        })
      ).status,
      400,
    );
    assert.equal(f.calls(), 0);
    assert.equal(f.beats(), 0);
    const response = await fetch(`${f.url}/tick`, { method: "POST", headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { claimed: true, demo: false });
    assert.equal(f.calls(), 1);
    assert.equal(f.beats(), 1);
  } finally {
    await f.close();
  }
});
test("demo ticks heartbeat but never call the real publication worker", async () => {
  const f = await fixture({ demo: () => true });
  try {
    const r = await fetch(`${f.url}/tick`, { method: "POST", headers });
    assert.deepEqual(await r.json(), { claimed: false, demo: true });
    assert.equal(f.calls(), 0);
    assert.equal(f.beats(), 1);
  } finally {
    await f.close();
  }
});
test("private authorization requires authentication, bounded JSON and a valid canonical claim", async () => {
  let calls = 0;
  const f = await fixture({
    authorize: async (input) => {
      calls++;
      assert.deepEqual(input, { postId: "fixture", dispatchToken: "proof" });
      return { approved: true };
    },
  });
  try {
    assert.equal(
      (await fetch(`${f.url}/authorize`, { method: "POST", body: "{}" }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(`${f.url}/authorize`, {
          method: "POST",
          headers,
          body: "x".repeat(4097),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(`${f.url}/authorize`, {
          method: "POST",
          headers,
          body: "invalid-json",
        })
      ).status,
      400,
    );
    const r = await fetch(`${f.url}/authorize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ postId: "fixture", dispatchToken: "proof" }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { approved: true });
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
test("overlapping n8n ticks never start a second local executor", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const f = await fixture({
    run: async () => {
      calls++;
      started();
      await gate;
      return true;
    },
  });
  try {
    const first = fetch(`${f.url}/tick`, { method: "POST", headers });
    await start;
    const second = await fetch(`${f.url}/tick`, { method: "POST", headers });
    assert.equal(second.status, 202);
    assert.equal(calls, 1);
    release();
    assert.equal((await first).status, 200);
  } finally {
    release();
    await f.close();
  }
});
test("upstream bridge errors never echo tokens, source URLs or raw provider bodies and allow safe later ticks", async () => {
  let fail = true;
  const f = await fixture({
    run: async () => {
      if (fail)
        throw new Error(
          `sensitive ${secret} https://storage.example/private?token=secret`,
        );
      return false;
    },
  });
  try {
    const r = await fetch(`${f.url}/tick`, { method: "POST", headers });
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.ok(!body.includes(secret) && !body.includes("token="));
    fail = false;
    assert.deepEqual(
      await (await fetch(`${f.url}/tick`, { method: "POST", headers })).json(),
      { claimed: false, demo: false },
    );
    const health = await fetch(`${f.url}/healthz`);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), { status: "online" });
  } finally {
    await f.close();
  }
});
test("executor selection and bridge configuration reject invalid or weak settings", () => {
  const saved = { ...process.env };
  try {
    delete process.env.PUBLISH_EXECUTOR;
    assert.equal(publishExecutor(), "native");
    process.env.PUBLISH_EXECUTOR = "n8n";
    assert.equal(publishExecutor(), "n8n");
    process.env.PUBLISH_EXECUTOR = "unknown";
    assert.throws(publishExecutor);
    process.env.N8N_PUBLISHER_SECRET = "short";
    assert.throws(publisherBridgeConfiguration);
    process.env.N8N_PUBLISHER_SECRET = secret;
    process.env.N8N_PUBLISHER_PORT = "0";
    assert.throws(publisherBridgeConfiguration);
    process.env.N8N_PUBLISHER_PORT = "3010";
    delete process.env.N8N_PUBLISHER_HOST;
    assert.equal(publisherBridgeConfiguration().host, "127.0.0.1");
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
test("n8n status requires fresh authenticated-trigger heartbeats and never counts them as FFmpeg workers", async () => {
  assert.match(
    process.env.SUPABASE_URL || "",
    /^http:\/\/(127\.0\.0\.1|localhost):/,
  );
  const savedPool = process.env.WORKER_POOL,
    savedExecutor = process.env.PUBLISH_EXECUTOR;
  const pool = `n8n-test-${crypto.randomUUID()}`,
    id = `n8n-${crypto.randomUUID()}`,
    workerId = `worker-${crypto.randomUUID()}`;
  const admin = storageAdmin();
  process.env.WORKER_POOL = pool;
  process.env.PUBLISH_EXECUTOR = "n8n";
  try {
    assert.equal((await publishingExecutorStatus()).status, "offline");
    let r = await admin
      .from("reelready_workers")
      .insert({ id, pool, heartbeat: new Date().toISOString() });
    assert.equal(r.error, null);
    assert.deepEqual(await publishingExecutorStatus(), {
      executor: "n8n",
      status: "online",
    });
    assert.equal((await workerStatus()).status, "offline");
    r = await admin
      .from("reelready_workers")
      .update({ heartbeat: new Date(Date.now() - 3600000).toISOString() })
      .eq("id", id);
    assert.equal(r.error, null);
    assert.equal((await publishingExecutorStatus()).status, "offline");
    await admin
      .from("reelready_workers")
      .insert({ id: workerId, pool, heartbeat: new Date().toISOString() });
    assert.equal((await workerStatus()).status, "online");
    assert.equal((await publishingExecutorStatus()).status, "offline");
  } finally {
    await admin.from("reelready_workers").delete().eq("pool", pool);
    if (savedPool === undefined) delete process.env.WORKER_POOL;
    else process.env.WORKER_POOL = savedPool;
    if (savedExecutor === undefined) delete process.env.PUBLISH_EXECUTOR;
    else process.env.PUBLISH_EXECUTOR = savedExecutor;
  }
});
test("importable n8n workflow contains a fixed private trigger, encrypted credential reference and operational success history", () => {
  const flow = JSON.parse(
    readFileSync("automation/n8n/publish-workflow.json", "utf8"),
  );
  assert.equal(flow.active, false);
  assert.equal(flow.nodes.length, 2);
  const request = flow.nodes.find((n: { type: string }) =>
    n.type.endsWith(".httpRequest"),
  );
  assert.equal(request.parameters.url, "http://host.docker.internal:3010/tick");
  assert.equal(request.retryOnFail, false);
  assert.equal(request.parameters.sendBody, undefined);
  assert.equal(flow.settings.saveDataErrorExecution, "none");
  assert.equal(flow.settings.saveDataSuccessExecution, "all");
  assert.ok(!JSON.stringify(flow).includes("access_token"));
});

test("private media bridge authenticates bounded tickets and streams exact file bytes", async () => {
  let calls = 0;
  const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
  const f = await fixture({
    media: async (input) => {
      calls++;
      assert.deepEqual(input, { mediaTicket: "approved" });
      return {
        stream: new Response(bytes).body!,
        size: bytes.length,
        mime: "video/mp4",
      };
    },
  });
  try {
    assert.equal(
      (await fetch(`${f.url}/media-download`, { method: "POST", body: "{}" }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(`${f.url}/media-download`, {
          method: "POST",
          headers,
          body: "x".repeat(4097),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(`${f.url}/media-download`, {
          method: "POST",
          headers,
          body: "invalid",
        })
      ).status,
      400,
    );
    assert.equal(calls, 0);
    const r = await fetch(`${f.url}/media-download`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaTicket: "approved" }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "video/mp4");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test("private media bridge never leaks upstream storage addresses or tickets", async () => {
  const f = await fixture({
    media: async () => {
      throw new Error("https://private-storage?token=secret-ticket");
    },
  });
  try {
    const r = await fetch(`${f.url}/media-download`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(r.status, 400);
    assert.doesNotMatch(await r.text(), /private-storage|secret-ticket/);
  } finally {
    await f.close();
  }
});
