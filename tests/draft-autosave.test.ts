import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDraftAutosave,
  DraftSaveError,
  sendDraft,
} from "../lib/draft-autosave";
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean) => {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await wait(5);
  }
  assert.ok(check(), "Expected autosave state");
};
test("autosave retries a network failure and transient conflict without user intervention", async () => {
  const states: string[] = [];
  let calls = 0;
  const saver = createDraftAutosave({
    send: async () => {
      calls++;
      if (calls === 1) throw new TypeError("network");
      if (calls === 2) throw new DraftSaveError(409);
    },
    onStatus: (s) => states.push(s),
    debounceMs: 1,
    retryDelays: [1, 1],
  });
  try {
    saver.submit({ text: "నా కొత్త రీల్ — मेरी कहानी" });
    await until(() => states.includes("saved"));
    assert.equal(calls, 3);
    assert.ok(!states.includes("local"));
  } finally {
    saver.dispose();
  }
});
test("new edits never abort an in-flight commit or mark an outdated snapshot saved", async () => {
  let release!: () => void;
  const sent: string[] = [];
  const saved: string[] = [];
  let firstSignal: AbortSignal | undefined;
  const saver = createDraftAutosave({
    send: async (value: string, signal) => {
      sent.push(value);
      if (sent.length === 1) {
        firstSignal = signal;
        await new Promise<void>((r) => (release = r));
      }
    },
    onStatus: () => {},
    onSaved: (v) => saved.push(v),
    debounceMs: 1,
  });
  try {
    saver.submit("first");
    await until(() => sent.length === 1);
    saver.submit("second");
    saver.submit("latest");
    await wait();
    assert.deepEqual(sent, ["first"]);
    assert.equal(firstSignal?.aborted, false);
    release();
    await until(() => saved.length === 1);
    assert.deepEqual(sent, ["first", "latest"]);
    assert.deepEqual(saved, ["latest"]);
  } finally {
    saver.dispose();
  }
});
test("failed saves stay queued and recover on retry; permanent validation failures do not loop", async () => {
  let fail = true,
    calls = 0;
  const states: string[] = [];
  const saver = createDraftAutosave({
    send: async () => {
      calls++;
      if (fail) throw new DraftSaveError(400);
    },
    onStatus: (s) => states.push(s),
    debounceMs: 1,
    retryDelays: [1],
  });
  try {
    saver.submit("preserved");
    await until(() => states.includes("local"));
    await wait();
    assert.equal(calls, 1);
    fail = false;
    saver.retry();
    await until(() => states.at(-1) === "saved");
    assert.equal(calls, 2);
  } finally {
    saver.dispose();
  }
});
test("timeouts are retried and disposing never sends a queued stale draft", async () => {
  let calls = 0;
  const states: string[] = [];
  const saver = createDraftAutosave({
    send: async (_value: string, signal) => {
      calls++;
      if (calls === 1)
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
    },
    onStatus: (s) => states.push(s),
    debounceMs: 1,
    timeoutMs: 5,
    retryDelays: [1],
  });
  saver.submit("latest");
  await until(() => states.includes("saved"));
  assert.equal(calls, 2);
  saver.submit("must not send");
  saver.dispose();
  await wait();
  assert.equal(calls, 2);
});
test("the save transport requires server acknowledgement and preserves retry status", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ saved: true });
    await sendDraft({ id: "fixture" }, new AbortController().signal);
    globalThis.fetch = async () =>
      Response.json({ error: "conflict" }, { status: 409 });
    await assert.rejects(
      () => sendDraft({}, new AbortController().signal),
      (e: unknown) => e instanceof DraftSaveError && e.status === 409,
    );
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(
      () => sendDraft({}, new AbortController().signal),
      DraftSaveError,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("workspace changes are permanent conflicts with a recovery code, not transient retries", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const saver = createDraftAutosave({
    send: async () => {
      calls++;
      throw new DraftSaveError(409, "REEL_WORKSPACE_CHANGED");
    },
    onStatus: () => {},
    onFailure: (e) => errors.push(e),
    debounceMs: 1,
    retryDelays: [1, 1],
  });
  try {
    saver.submit("browser-owned text");
    await until(() => errors.length === 1);
    await wait();
    assert.equal(calls, 1);
    assert.equal((errors[0] as DraftSaveError).code, "REEL_WORKSPACE_CHANGED");
  } finally {
    saver.dispose();
  }
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        { error: "Workspace changed", code: "REEL_WORKSPACE_CHANGED" },
        { status: 409 },
      );
    await assert.rejects(
      () => sendDraft({}, new AbortController().signal),
      (e: unknown) =>
        e instanceof DraftSaveError && e.code === "REEL_WORKSPACE_CHANGED",
    );
  } finally {
    globalThis.fetch = old;
  }
});

test("workspace recovery preserves local planning text without adopting private media or publish approvals", async () => {
  const { fresh, recoveredDraft } = await import("../lib/reel");
  const original = {
    ...fresh(),
    id: crypto.randomUUID(),
    input: "నా ఆలోచన — मेरी कहानी",
    step: 5,
    token: "old-private-capability",
    dubScript: "My edited narration",
    audioReady: true,
    originalAsset: {
      token: "private-video",
      path: "other-owner/private.mp4",
      mime: "video/mp4",
      name: "video.mp4",
      size: 100,
    },
    job: { id: "private-job" },
  };
  const recovered = recoveredDraft(
    original as unknown as import("../lib/reel").Draft,
    crypto.randomUUID(),
  );
  assert.equal(recovered.input, original.input);
  assert.equal(recovered.dubScript, original.dubScript);
  assert.notEqual(recovered.id, original.id);
  assert.equal(recovered.originalAsset, null);
  assert.equal(recovered.englishAsset, null);
  assert.equal(recovered.token, "");
  assert.equal(recovered.job, null);
  assert.equal(recovered.audioReady, false);
  assert.equal(recovered.step, 0);
  assert.equal(original.token, "old-private-capability");
  assert.equal(original.originalAsset.path, "other-owner/private.mp4");
});
