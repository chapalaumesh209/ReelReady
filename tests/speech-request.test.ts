import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requestSpeech,
  speechRateLimit,
} from "../lib/server/media/speech-request";
const quota = (id: string, value = "3") => ({
  error: {
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          { quotaMetric: "speech_requests", quotaId: id, quotaValue: value },
        ],
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "12.5s",
      },
    ],
  },
});
test("speech waits for RetryInfo and retries per-minute throttling while counting each provider attempt", async () => {
  let calls = 0,
    budgets = 0,
    checks = 0;
  const waits: number[] = [];
  const notices: number[] = [];
  const result = await requestSpeech(
    { model: "fixture" },
    { "x-goog-api-key": "fixture" },
    {
      beforeAttempt: async () => {
        checks++;
      },
      onRetry: async (x) => {
        notices.push(x.delayMs);
      },
    },
    {
      budget: async () => {
        budgets++;
      },
      pause: async (ms) => {
        waits.push(ms);
      },
      fetch: async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).store, false);
        calls++;
        return calls === 1
          ? Response.json(quota("RequestsPerMinutePerProject"), { status: 429 })
          : Response.json({ audio: "real-response-fixture" });
      },
    },
  );
  assert.deepEqual(result, { audio: "real-response-fixture" });
  assert.equal(calls, 2);
  assert.equal(budgets, 2);
  assert.equal(checks, 2);
  assert.deepEqual(waits, [12750]);
  assert.deepEqual(notices, waits);
});
test("daily and zero-allowance limits stop immediately without retrying or pretending to raise quota", async () => {
  for (const [id, value] of [
    ["RequestsPerDay", "10"],
    ["RequestsPerMinute", "0"],
  ]) {
    let calls = 0,
      waits = 0;
    await assert.rejects(
      () =>
        requestSpeech(
          {},
          {},
          {},
          {
            budget: async () => {},
            pause: async () => {
              waits++;
            },
            fetch: async () => {
              calls++;
              return Response.json(quota(id, value), { status: 429 });
            },
          },
        ),
      /daily or plan quota/,
    );
    assert.equal(calls, 1);
    assert.equal(waits, 0);
  }
});
test("Retry-After is respected and permanent authentication errors are never retried", async () => {
  let calls = 0;
  const waits: number[] = [];
  await requestSpeech(
    {},
    {},
    {},
    {
      budget: async () => {},
      pause: async (n) => {
        waits.push(n);
      },
      fetch: async () =>
        ++calls === 1
          ? Response.json({}, { status: 503, headers: { "retry-after": "20" } })
          : Response.json({ ok: true }),
    },
  );
  assert.deepEqual(waits, [20250]);
  calls = 0;
  await assert.rejects(
    () =>
      requestSpeech(
        {},
        {},
        {},
        {
          budget: async () => {},
          fetch: async () => {
            calls++;
            return Response.json({}, { status: 403 });
          },
        },
      ),
    /model access/,
  );
  assert.equal(calls, 1);
});
test("retry count and total waiting are bounded; prolonged cooldowns do not get shortened", async () => {
  let calls = 0;
  const waits: number[] = [];
  await assert.rejects(
    () =>
      requestSpeech(
        {},
        {},
        {},
        {
          budget: async () => {},
          pause: async (n) => {
            waits.push(n);
          },
          fetch: async () => {
            calls++;
            return Response.json({}, { status: 429 });
          },
        },
      ),
    /still busy/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [20250, 40250]);
});
test("cancellation and our own daily safety budget stop further provider calls", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      requestSpeech(
        {},
        {},
        {
          beforeAttempt: async () => {
            throw new Error("Cancelled");
          },
        },
        {
          budget: async () => {},
          fetch: async () => {
            calls++;
            return Response.json({});
          },
        },
      ),
    /Cancelled/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      requestSpeech(
        {},
        {},
        {},
        {
          budget: async () => {
            throw new Error("Daily safety budget");
          },
          fetch: async () => {
            calls++;
            return Response.json({});
          },
        },
      ),
    /Daily safety budget/,
  );
  assert.equal(calls, 0);
  assert.equal(
    speechRateLimit(new Response(null, { status: 429 }), {
      error: { details: "invalid" },
    }).hardQuota,
    false,
  );
});

test("long provider cooldowns are reported rather than shortened, and RetryInfo retries remain bounded", async () => {
  let calls = 0,
    waits = 0;
  await assert.rejects(
    () =>
      requestSpeech(
        {},
        {},
        {},
        {
          budget: async () => {},
          pause: async () => {
            waits++;
          },
          fetch: async () => {
            calls++;
            return Response.json(
              {},
              { status: 429, headers: { "retry-after": "120" } },
            );
          },
        },
      ),
    /still busy/,
  );
  assert.equal(calls, 1);
  assert.equal(waits, 0);
  calls = 0;
  waits = 0;
  await assert.rejects(
    () =>
      requestSpeech(
        {},
        {},
        {},
        {
          budget: async () => {},
          pause: async () => {
            waits++;
          },
          fetch: async () => {
            calls++;
            return Response.json(quota("RequestsPerMinutePerProject"), {
              status: 429,
            });
          },
        },
      ),
    /still busy/,
  );
  assert.equal(calls, 4);
  assert.equal(waits, 3);
});
