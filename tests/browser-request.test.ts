import { test } from "node:test";
import assert from "node:assert/strict";
import { browserRequest, BrowserRequestError } from "../lib/browser-request";

test("a dropped read is retried and resolves without exposing raw fetch errors", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new TypeError("Failed to fetch");
    return Response.json({ status: "completed" });
  };
  try {
    assert.deepEqual(await browserRequest("/api/media/jobs?id=fixture"), {
      status: "completed",
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
test("writes are never replayed without idempotency and an ambiguous keyed write keeps the same body", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const bodies: string[] = [];
  globalThis.fetch = async (_url, init) => {
    calls++;
    bodies.push(String(init?.body));
    throw new TypeError("Failed to fetch");
  };
  try {
    await assert.rejects(
      () => browserRequest("/api/audio", { action: "save" }),
      (e: unknown) =>
        e instanceof BrowserRequestError &&
        e.status === 0 &&
        /could not be reached/.test(e.message),
    );
    assert.equal(calls, 1);
    calls = 0;
    bodies.length = 0;
    await assert.rejects(
      () =>
        browserRequest(
          "/api/media/english",
          { requestId: "fixed" },
          undefined,
          { idempotent: true },
        ),
      /could not be reached/,
    );
    assert.equal(calls, 2);
    assert.equal(bodies[0], bodies[1]);
  } finally {
    globalThis.fetch = original;
  }
});
test("quota and permission errors preserve server recovery guidance and never get retried", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    for (const status of [401, 403, 429]) {
      globalThis.fetch = async () => {
        calls++;
        return Response.json(
          { error: "Check the speech plan.", code: "SPEECH_PROVIDER_LIMIT" },
          { status },
        );
      };
      calls = 0;
      await assert.rejects(
        () =>
          browserRequest("/api/media/english", {}, undefined, {
            idempotent: true,
          }),
        (e: unknown) =>
          e instanceof BrowserRequestError &&
          e.status === status &&
          e.code === "SPEECH_PROVIDER_LIMIT" &&
          e.message === "Check the speech plan.",
      );
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("non-JSON gateway responses retry safely, while caller cancellation stops immediately", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () =>
      ++calls === 1
        ? new Response("Gateway error", { status: 502 })
        : Response.json({ ready: true });
    assert.deepEqual(await browserRequest("/api/audio"), { ready: true });
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      () => browserRequest("/api/audio", undefined, cancelled.signal),
      { name: "AbortError" },
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
