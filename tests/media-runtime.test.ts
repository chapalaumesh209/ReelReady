import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMediaHealthServer,
  mediaWorkerRuntime,
} from "../lib/server/media/runtime";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
test("media-only hosting exposes only health and becomes unavailable when its heartbeat stops", async () => {
  let ready = false;
  const server = createMediaHealthServer(() => ready);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(url + "/health")).status, 503);
    ready = true;
    const good = await fetch(url + "/");
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { ready: true });
    assert.equal(
      (await fetch(url + "/health", { method: "POST", body: "{}" })).status,
      405,
    );
    assert.equal((await fetch(url + "/api/jobs")).status, 404);
    assert.equal((await fetch(url + "/health?secret=anything")).status, 404);
    ready = false;
    assert.equal((await fetch(url + "/health")).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("media-only mode is explicit, binds privately by default and rejects invalid health ports", () => {
  assert.deepEqual(mediaWorkerRuntime({}), {
    only: false,
    port: undefined,
    host: "127.0.0.1",
  });
  assert.deepEqual(
    mediaWorkerRuntime({
      MEDIA_WORKER_ONLY: "true",
      MEDIA_HEALTH_PORT: "7860",
      MEDIA_HEALTH_HOST: "0.0.0.0",
    }),
    { only: true, port: 7860, host: "0.0.0.0" },
  );
  for (const port of ["0", "65536", "bad", "123.5"])
    assert.throws(
      () => mediaWorkerRuntime({ MEDIA_HEALTH_PORT: port }),
      /valid port/,
    );
});

test("container health checks its own process rather than another worker's database heartbeat", async () => {
  let ready = false;
  const server = createMediaHealthServer(() => ready);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = String((server.address() as AddressInfo).port);
  const check = () =>
    new Promise<number>((resolve) => {
      execFile(
        process.execPath,
        ["--import", "tsx", "scripts/worker-health.ts"],
        {
          env: {
            ...process.env,
            MEDIA_HEALTH_PORT: port,
            SUPABASE_URL: "http://127.0.0.1:1",
          },
          timeout: 10000,
        },
        (error) => resolve(Number(error?.code || 0)),
      );
    });
  try {
    assert.equal(await check(), 1);
    ready = true;
    assert.equal(await check(), 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
