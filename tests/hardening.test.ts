import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { storageAdmin, VIDEO_BUCKET, ensureVideoBucket } from "../lib/supabase";
import { sign } from "../lib/server";
import { probe } from "../lib/server/media/ffmpeg";
import { defaultSettings, editSchema } from "../lib/audio/schema";
import { workerStatus } from "../lib/server/media/status";
import { enqueue, editHash } from "../lib/server/media/repository";
import { processJob } from "../lib/server/media/worker";
import { uploadProblem } from "../lib/limits";
import { enforceUpload } from "../lib/server/hardening";
import { rateLimit } from "../lib/server/rate-limit";
import {
  providerCapacity,
  takeProviderCall,
} from "../lib/server/provider-budget";
import {
  publicMediaURL,
  mediaSpecIssues,
  captionIssues,
  signedURLTTL,
  publishPreflight,
  preflightInput,
} from "../lib/server/publishing/preflight";
import { POST as audio } from "../app/api/audio/route";
import { POST as cancel } from "../app/api/media/jobs/route";
import { POST as register } from "../app/api/storage/route";
import { POST as review } from "../app/api/review/route";
import { POST as plan } from "../app/api/plan/route";
import { POST as change } from "../app/api/ai/change-request/route";
import { POST as generate } from "../app/api/generate/route";
import { POST as voice } from "../app/api/voiceover/route";
import { POST as transcribe } from "../app/api/voiceover/transcribe/route";
import { POST as translate } from "../app/api/voiceover/translate/route";
import { POST as mediaVoice } from "../app/api/voiceover/generate/route";
import { GET as health } from "../app/api/health/route";
import { samplePlan } from "../lib/server/ai";
import { publishingKit } from "../lib/server/kits";
const admin = storageAdmin(),
  pool = `test-${crypto.randomUUID()}`;
let owner = "",
  token = "",
  reelId = "",
  sourceId = "",
  assetToken = "",
  path = "";
let meta: Awaited<ReturnType<typeof probe>>;
const savedEnv = { ...process.env };
const ip = `2001:db8:${crypto.randomUUID().slice(0, 4)}::2`;
function req(data?: unknown, route = "/api/audio", address = ip) {
  return new Request(`http://127.0.0.1:3000${route}`, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-forwarded-for": address,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
const planned = () => ({
  input: "An original purple waveform animation with a quiet test tone.",
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  timezone: "Asia/Kolkata",
  platforms: ["instagram", "youtube", "x"] as const,
  languages: ["English"] as const,
  script: "native" as const,
});
const kitInput = () => ({
  input: planned().input,
  language: "English" as const,
  script: "native" as const,
});
before(async () => {
  assert.match(
    process.env.SUPABASE_URL || "",
    /^http:\/\/(127\.0\.0\.1|localhost):/,
  );
  process.env.WORKER_POOL = pool;
  process.env.DEMO_MODE = "true";
  process.env.LLM_PROVIDER = "demo";
  delete process.env.LLM_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const r = await db.auth.signInAnonymously();
  assert.equal(r.error, null);
  owner = r.data.user!.id;
  token = r.data.session!.access_token;
  reelId = crypto.randomUUID();
  assert.equal(
    (
      await admin.from("reelready_reels").insert({
        id: reelId,
        owner_id: owner,
        title: "Hardening fixture",
        state: { id: reelId, version: 2 },
      })
    ).error,
    null,
  );
  await ensureVideoBucket();
  const bytes = await readFile("public/samples/reelready-demo.mp4");
  meta = await probe("public/samples/reelready-demo.mp4", true);
  path = `${owner}/${reelId}/fixture.mp4`;
  assert.equal(
    (
      await admin.storage
        .from(VIDEO_BUCKET)
        .upload(path, bytes, { contentType: "video/mp4" })
    ).error,
    null,
  );
  const asset = await admin
    .from("reelready_media")
    .insert({
      owner_id: owner,
      reel_id: reelId,
      path,
      kind: "original",
      mime: "video/mp4",
      bytes: bytes.length,
      metadata: meta,
    })
    .select("id")
    .single();
  assert.equal(asset.error, null);
  sourceId = asset.data!.id;
  assetToken = await sign(
    {
      visitor: owner,
      path,
      size: bytes.length,
      mime: "video/mp4",
      name: "fixture.mp4",
      kind: "original",
    },
    "stored-video",
    3600,
  );
  assert.equal(
    (await audio(req({ action: "init", reelId, token: assetToken }))).status,
    200,
  );
});
after(async () => {
  // Remove only this suite's new fixtures; never touch pre-existing local data.
  await admin.from("reelready_workers").delete().eq("id", pool);
  const files = await admin
    .from("reelready_media")
    .select("path")
    .eq("reel_id", reelId);
  if (files.data?.length)
    await admin.storage
      .from(VIDEO_BUCKET)
      .remove(files.data.map((f) => f.path));
  await admin.from("reelready_jobs").delete().eq("reel_id", reelId);
  await admin.from("reelready_reels").delete().eq("id", reelId);
  await admin.auth.admin.deleteUser(owner);
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
test("worker status honours fresh, stale and configured heartbeat windows", async () => {
  assert.equal((await workerStatus()).status, "offline");
  await admin.from("reelready_workers").insert({
    id: pool,
    pool,
    heartbeat: new Date(Date.now() - 59000).toISOString(),
  });
  assert.equal((await workerStatus()).status, "online");
  await admin
    .from("reelready_workers")
    .update({ heartbeat: new Date(Date.now() - 61000).toISOString() })
    .eq("id", pool);
  assert.equal((await workerStatus()).status, "offline");
  process.env.WORKER_HEARTBEAT_SECONDS = "120";
  assert.equal((await workerStatus()).status, "online");
  delete process.env.WORKER_HEARTBEAT_SECONDS;
  await admin.from("reelready_workers").delete().eq("id", pool);
});
test("offline original approval cancels pending work, preserves sources, and needs no decoded inspection", async () => {
  await admin
    .from("reelready_media")
    .update({ metadata: { duration: 8, width: 360, height: 640 } })
    .eq("id", sourceId);
  const job = await enqueue(req(), reelId, sourceId, "analyze", {
    settings: defaultSettings(),
  });
  const approved = await audio(req({ action: "original", reelId, sourceId }));
  assert.equal(approved.status, 200, await approved.clone().text());
  const edit =
    (await approved.json()) as import("../lib/audio/schema").AudioState;
  assert.equal(edit.rendered_id, sourceId);
  assert.equal(edit.approved_hash, await editHash(edit));
  assert.equal(
    (
      await admin
        .from("reelready_media_jobs")
        .select("status")
        .eq("id", job.id)
        .single()
    ).data!.status,
    "cancelled",
  );
  assert.equal((await admin.storage.from(VIDEO_BUCKET).info(path)).error, null);
  const again = await cancel(req({ id: job.id }, "/api/media/jobs"));
  assert.equal(again.status, 200);
  await assert.rejects(
    () =>
      processJob({
        id: job.id,
        owner_id: owner,
        reel_id: reelId,
        source_id: sourceId,
        lease_token: crypto.randomUUID(),
        kind: "analyze",
        payload: { settings: defaultSettings() },
      }),
    /cancelled/,
  );
  await admin
    .from("reelready_media")
    .update({ metadata: meta })
    .eq("id", sourceId);
});
test("sample video is an original eight-second H264/AAC portrait fixture", () => {
  assert.equal(meta.videoCodec, "h264");
  assert.equal(meta.audioCodec, "aac");
  assert.equal(meta.width / meta.height, 9 / 16);
  assert.ok(meta.duration >= 6 && meta.duration <= 10);
});
test("upload limits reject in the shared browser check, prepare and registration; exact boundaries pass", async () => {
  assert.equal(
    uploadProblem(200 * 1024 * 1024, 90, {
      maxUploadMB: 200,
      maxVideoSeconds: 90,
    }),
    null,
  );
  assert.match(
    uploadProblem(200 * 1024 * 1024 + 1, 8, {
      maxUploadMB: 200,
      maxVideoSeconds: 90,
    })!,
    /200 MB/,
  );
  assert.match(
    uploadProblem(1, 91, { maxUploadMB: 200, maxVideoSeconds: 90 })!,
    /90 seconds/,
  );
  process.env.MAX_UPLOAD_MB = "1";
  assert.throws(() => enforceUpload(1024 * 1024 + 1, 8), /1 MB/);
  delete process.env.MAX_UPLOAD_MB;
  for (const extra of [
    { size: 201 * 1024 * 1024 },
    { metadata: { duration: 91, width: 360, height: 640 } },
  ]) {
    const r = await register(
      req(
        {
          action: "prepare",
          draftId: reelId,
          kind: "original",
          name: "test.mp4",
          mime: "video/mp4",
          size: 1,
          metadata: { duration: 8, width: 360, height: 640 },
          ...extra,
        },
        "/api/storage",
      ),
    );
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /Choose/);
  }
  const r = await register(
    req(
      {
        action: "complete",
        token: assetToken,
        metadata: { duration: 91, width: 360, height: 640 },
      },
      "/api/storage",
    ),
  );
  assert.equal(r.status, 400);
});
test("atomic queue admission allows at most two concurrent active jobs per owner, deduplicates, and cancellation frees a slot", async () => {
  const payload = { settings: defaultSettings() };
  const outcomes = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      enqueue(req(), reelId, sourceId, "render", { ...payload, test: i }),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 2);
  assert.ok(
    outcomes
      .filter((r) => r.status === "rejected")
      .every((r) => r.status === "rejected" && r.reason.status === 429),
  );
  const good = outcomes.find(
    (r) => r.status === "fulfilled",
  ) as PromiseFulfilledResult<{ id: string }>;
  assert.ok(good.value.id);
  await cancel(req({ id: good.value.id }));
  assert.ok(
    (
      await enqueue(req(), reelId, sourceId, "render", {
        ...payload,
        test: "after-cancel",
      })
    ).id,
  );
  await admin
    .from("reelready_media_jobs")
    .update({ status: "cancelled" })
    .eq("owner_id", owner)
    .in("status", ["queued", "running"]);
  process.env.MAX_QUEUED_JOBS = "1";
  await enqueue(req(), reelId, sourceId, "render", {
    ...payload,
    test: "global1",
  });
  await assert.rejects(
    () =>
      enqueue(req(), reelId, sourceId, "render", {
        ...payload,
        test: "global2",
      }),
    /queue is busy/,
  );
  delete process.env.MAX_QUEUED_JOBS;
  await admin
    .from("reelready_media_jobs")
    .update({ status: "cancelled" })
    .eq("owner_id", owner)
    .in("status", ["queued", "running"]);
});
test("atomic fixed-window RPC and per-user/IP limits cannot be bypassed concurrently; RLS blocks browser RPC", async () => {
  const key = `test-rate-${crypto.randomUUID()}`;
  const r = await Promise.all(
    Array.from({ length: 8 }, () =>
      admin.rpc("reelready_take_limit", {
        p_key: key,
        p_limit: 3,
        p_seconds: 60,
      }),
    ),
  );
  assert.equal(r.filter((v) => v.data === true).length, 3);
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  assert.ok(
    (
      await client.rpc("reelready_take_limit", {
        p_key: key,
        p_limit: 999,
        p_seconds: 60,
      })
    ).error,
  );
  assert.deepEqual(
    (await client.from("reelready_rate_limits").select("*")).data,
    null,
  );
  const action = `test-${crypto.randomUUID()}`;
  await rateLimit(req(), action, 1);
  await assert.rejects(
    () => rateLimit(req(), action, 1),
    /try again in an hour/,
  );
  process.env.RATE_IP_MULTIPLIER = "1";
  const actionIP = `test-ip-${crypto.randomUUID()}`;
  await rateLimit(req(), actionIP, 1);
  const other = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const who = await other.auth.signInAnonymously();
  const request = new Request("http://127.0.0.1:3000", {
    headers: {
      Authorization: `Bearer ${who.data.session!.access_token}`,
      "x-forwarded-for": ip,
    },
  });
  await assert.rejects(() => rateLimit(request, actionIP, 1), /try again/);
  await admin.auth.admin.deleteUser(who.data.user!.id);
  delete process.env.RATE_IP_MULTIPLIER;
  await admin.from("reelready_rate_limits").delete().eq("key", key);
});
test("text and voice inputs enforce caps before paid calls", async () => {
  assert.equal(
    editSchema.safeParse({ script: "x".repeat(4001) }).success,
    false,
  );
  const cases = [
    () => plan(req({ ...planned(), input: "x".repeat(4001) }, "/api/plan")),
    () =>
      generate(
        req({ ...kitInput(), input: "x".repeat(4001) }, "/api/generate"),
      ),
    () => voice(req({ script: "x".repeat(4001) }, "/api/voiceover")),
  ];
  for (const invoke of cases) assert.equal((await invoke()).status, 400);
});
test("live Gemini planning retries malformed JSON once; persistent provider failure returns labelled samples", async () => {
  const old = fetch;
  process.env.GEMINI_API_KEY = "mock-only";
  let calls = 0,
    fail = false;
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith("https://generativelanguage.googleapis.com/"))
      return old(input, init);
    calls++;
    if (fail) return new Response(null, { status: 503 });
    const value = calls === 1 ? { invalid: true } : samplePlan(planned());
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(value) }] },
        },
      ],
    });
  };
  try {
    let r = await plan(req(planned(), "/api/plan"));
    assert.equal(r.status, 200);
    let value = (await r.json()) as { sample?: boolean };
    assert.equal(calls, 2);
    // A provider is not allowed to choose its own sample/live badge.
    assert.equal(value.sample, undefined);
    fail = true;
    calls = 0;
    r = await plan(req(planned(), "/api/plan"));
    value = (await r.json()) as { sample?: boolean };
    assert.equal(value.sample, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = old;
    delete process.env.GEMINI_API_KEY;
  }
});
test("daily paid-call circuit breaker returns labelled text and friendly voice, transcription and translation capacity errors", async () => {
  await takeProviderCall();
  process.env.DAILY_PROVIDER_CALL_LIMIT = "1";
  process.env.GEMINI_API_KEY = "mock-only";
  const old = fetch;
  let paid = 0;
  globalThis.fetch = async (input, init) => {
    if (
      String(input).startsWith("https://generativelanguage.googleapis.com/")
    ) {
      paid++;
      throw new Error("No paid network calls expected");
    }
    return old(input, init);
  };
  try {
    assert.equal(await providerCapacity(), false);
    assert.equal(
      (await publishingKit(kitInput(), AbortSignal.timeout(2000))).sample,
      true,
    );
    const current = [
      "instagram",
      "youtubeTitle",
      "youtubeDescription",
      "x",
    ].map((id) => ({ id, text: "My supplied caption" }));
    const r = await change(
      req(
        { ...kitInput(), current, instruction: "Make it shorter" },
        "/api/ai/change-request",
      ),
    );
    assert.equal(((await r.json()) as { sample?: boolean }).sample, true);
    for (const endpoint of [transcribe, translate, mediaVoice]) {
      const r = await endpoint(req({ reelId, sourceId, confirmed: true }));
      assert.equal(r.status, 429, await r.clone().text());
      assert.match(
        ((await r.json()) as { error: string }).error,
        /Demo capacity reached/,
      );
    }
    const voiceResult = await voice(req({ script: "Read my own words" }));
    assert.equal(voiceResult.status, 429);
    assert.equal(paid, 0);
    const states = (await (await health()).json()) as Record<string, string>;
    assert.equal(states.generation, "sample");
    assert.equal(states.worker, "offline");
    assert.equal(states.publish, "demo");
    assert.ok(!JSON.stringify(states).includes("mock-only"));
  } finally {
    globalThis.fetch = old;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DAILY_PROVIDER_CALL_LIMIT;
  }
});
test("public media URL, codecs, captions and TTL preflight checks fail safely", async () => {
  for (const url of [
    "http://localhost:3000/a",
    "https://127.0.0.1/a",
    "https://10.0.0.2/a",
    "https://host.docker.internal/a",
    "https://supabase.local/a",
    "https://[::1]/a",
    "https://192.168.1.2/a",
    "https://172.16.0.2/a",
    "https://2130706433/a",
  ])
    assert.equal(publicMediaURL(url), false, url);
  assert.equal(
    publicMediaURL("https://example.supabase.co/storage/v1/object/sign/a"),
    true,
  );
  assert.deepEqual(
    mediaSpecIssues(meta as unknown as Record<string, unknown>, "video/mp4"),
    [],
  );
  assert.equal(
    mediaSpecIssues(
      { ...meta, videoCodec: "vp9", duration: 2, width: 640, height: 360 },
      "video/webm",
    ).length,
    3,
  );
  assert.ok(
    captionIssues({
      platforms: ["instagram"],
      instagram: "#a #b #c #d #e #f",
      youtubeTitle: "",
      x: "",
    }).blockers.some((v) => /5-hashtag/.test(v)),
  );
  const cap = captionIssues({
    platforms: ["instagram", "youtube", "x"],
    instagram: "#a ".repeat(31),
    youtubeTitle: "x".repeat(101),
    x: "https://example.com",
  });
  assert.equal(cap.blockers.length, 3);
  assert.equal(signedURLTTL(), 172800);
  process.env.PUBLISH_SIGNED_URL_TTL_SECONDS = "3600";
  assert.equal(signedURLTTL(), 3600);
  process.env.DEMO_MODE = "true";
  const input = preflightInput.parse({
    draftId: reelId,
    assetToken,
    platforms: ["instagram", "youtube", "x"],
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    instagram: "My test video",
    youtubeTitle: "Purple waveform",
    youtubeDescription: "An original test animation",
    x: "My original animation",
    language: "English",
    dubbed: false,
    size: 1000,
    duration: 8,
    width: 360,
    height: 640,
  });
  const report = await publishPreflight(req(), input);
  assert.equal(report.demo, true);
  assert.deepEqual(report.blockers, []);
  assert.ok(report.warnings.some((w) => /expire/.test(w)));
  assert.ok(report.warnings.some((w) => /public/.test(w)));
  assert.equal("pinRequired" in report, false);
  delete process.env.PUBLISH_SIGNED_URL_TTL_SECONDS;
});
test("retention only selects expired anonymous reels and excludes active work and future publications", async () => {
  const permanent = await admin.auth.admin.createUser({
    email: `retention-${crypto.randomUUID()}@example.invalid`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  assert.equal(permanent.error, null);
  const permanentReel = crypto.randomUUID();
  try {
    assert.equal(
      (
        await admin.from("reelready_reels").insert({
          id: permanentReel,
          owner_id: permanent.data.user!.id,
          state: {},
          updated_at: new Date(Date.now() - 8 * 86400000).toISOString(),
        })
      ).error,
      null,
    );
    const scan = await admin.rpc("reelready_retention_candidates", {
      p_before: new Date(Date.now() - 7 * 86400000).toISOString(),
    });
    assert.equal(scan.error, null);
    assert.ok(
      !scan.data.some((v: { reel_id: string }) => v.reel_id === permanentReel),
    );
  } finally {
    await admin.from("reelready_reels").delete().eq("id", permanentReel);
    await admin.auth.admin.deleteUser(permanent.data.user!.id);
  }
  const before = new Date(Date.now() - 7 * 86400000).toISOString();
  await admin
    .from("reelready_reels")
    .update({ updated_at: new Date(Date.now() - 8 * 86400000).toISOString() })
    .eq("id", reelId);
  let rows = await admin.rpc("reelready_retention_candidates", {
    p_before: before,
  });
  assert.equal(rows.error, null);
  assert.ok(rows.data.some((v: { reel_id: string }) => v.reel_id === reelId));
  await enqueue(req(), reelId, sourceId, "analyze", {
    test: "retention-active",
    settings: defaultSettings(),
  });
  rows = await admin.rpc("reelready_retention_candidates", {
    p_before: before,
  });
  assert.ok(!rows.data.some((v: { reel_id: string }) => v.reel_id === reelId));
  await admin
    .from("reelready_media_jobs")
    .update({ status: "cancelled" })
    .eq("owner_id", owner)
    .in("status", ["queued", "running"]);
  const id = crypto.randomUUID();
  assert.equal(
    (
      await admin.from("reelready_jobs").insert({
        id,
        owner_id: owner,
        reel_id: reelId,
        idempotency_key: id,
        is_demo: true,
        status: "scheduled",
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        payload: {},
      })
    ).error,
    null,
  );
  rows = await admin.rpc("reelready_retention_candidates", {
    p_before: before,
  });
  assert.ok(!rows.data.some((v: { reel_id: string }) => v.reel_id === reelId));
});

test("each public action's configured fixed-window cap returns a friendly 429", async () => {
  const limits: { [name: string]: number } = {
    generation: 20,
    "change-request": 20,
    "media-transcribe": 10,
    "media-translate": 10,
    "media-generate": 10,
    "media-render": 5,
    "upload-registration": 10,
    connect: 10,
    publish: 5,
  };
  for (const [name, limit] of Object.entries(limits)) {
    const action = `test-${name}-${crypto.randomUUID()}`;
    for (let i = 0; i < limit; i++) await rateLimit(req(), action, limit);
    await assert.rejects(
      () => rateLimit(req(), action, limit),
      (e: unknown) =>
        e instanceof Error &&
        "status" in e &&
        e.status === 429 &&
        /try again/.test(e.message),
    );
  }
});

test("real preflight blocks disconnected destinations and invalid Instagram specs, while real activity counters remain accurate in demo", async () => {
  const input = preflightInput.parse({
    draftId: reelId,
    assetToken,
    platforms: ["instagram", "youtube", "x"],
    scheduledAt: null,
    instagram: "Original animation",
    youtubeTitle: "My original animation",
    youtubeDescription: "A purple waveform",
    x: "An original animation",
    language: "English",
    dubbed: false,
    size: 1000,
    duration: 8,
    width: 360,
    height: 640,
  });
  process.env.DEMO_MODE = "false";
  await admin
    .from("reelready_media")
    .update({
      metadata: {
        ...meta,
        videoCodec: "vp9",
        duration: 2,
        width: 640,
        height: 360,
      },
    })
    .eq("id", sourceId);
  const report = await publishPreflight(req(), input);
  assert.ok(report.blockers.some((v) => /instagram:.*H.264/.test(v)));
  assert.ok(report.blockers.some((v) => /instagram:.*5 to 90/.test(v)));
  assert.ok(report.warnings.some((v) => /youtube:/.test(v)));
  assert.ok(report.warnings.some((v) => /x:/.test(v)));
  assert.ok(report.blockers.some((v) => /no connected account/.test(v)));
  assert.ok(report.blockers.every((v) => !/PIN/.test(v)));
  process.env.DEMO_MODE = "true";
  await admin
    .from("reelready_media")
    .update({ metadata: meta })
    .eq("id", sourceId);
  for (let i = 0; i < 9; i++) {
    const id = crypto.randomUUID();
    assert.equal(
      (
        await admin.from("reelready_jobs").insert({
          id,
          owner_id: owner,
          reel_id: reelId,
          idempotency_key: id,
          is_demo: false,
          status: "published",
          payload: {},
        })
      ).error,
      null,
    );
    assert.equal(
      (
        await admin.from("reelready_publish_usage").insert([
          { job_id: id, owner_id: owner, kind: "upload" },
          { job_id: id, owner_id: owner, kind: "x" },
        ])
      ).error,
      null,
    );
  }
  const warning = await publishPreflight(req(), input);
  assert.equal(warning.usage.uploadsThisMonth, 9);
  assert.equal(warning.usage.xPostsToday, 9);
  assert.ok(warning.warnings.every((v) => !/free plan/.test(v)));
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  assert.ok((await db.from("reelready_publish_usage").select("*")).error);
});

test("a cancelled lease cannot atomically apply a late render result", async () => {
  await admin
    .from("reelready_media_jobs")
    .update({ status: "cancelled" })
    .eq("owner_id", owner)
    .in("status", ["queued", "running"]);
  const edit = await admin
    .from("reelready_audio_edits")
    .select("*")
    .eq("reel_id", reelId)
    .single();
  assert.equal(edit.error, null);
  const job = await enqueue(req(), reelId, sourceId, "render", {
    settings: defaultSettings(),
    test: "atomic-cancel",
  });
  const lease = crypto.randomUUID(),
    claimed = await admin.rpc("reelready_claim_media_job", {
      p_lease: lease,
      p_pool: pool,
    });
  assert.equal(claimed.error, null);
  assert.equal(claimed.data[0].id, job.id);
  assert.equal((await cancel(req({ id: job.id }))).status, 200);
  const applied = await admin.rpc("reelready_apply_audio_job", {
    p_job: job.id,
    p_lease: lease,
    p_updated: edit.data.updated_at,
    p_changes: { script: "A late result that must not replace my work" },
  });
  assert.equal(applied.error, null);
  assert.equal(applied.data, false);
  assert.equal(
    (
      await admin
        .from("reelready_audio_edits")
        .select("script")
        .eq("reel_id", reelId)
        .single()
    ).data!.script,
    edit.data.script,
  );
});

test("reviewing creator notes without a provider marks the original reviewed and labels the sample", async () => {
  const { POST: review } = await import("../app/api/review/route");
  const videoToken = await sign(
    { visitor: owner, name: "demo", path },
    "video",
    3600,
  );
  const response = await review(
    req(
      {
        token: videoToken,
        idea: planned().input,
        filmingNote: "An original waveform animation",
        duration: 8,
      },
      "/api/review",
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { sample: boolean }).sample, true);
  assert.equal(
    (
      await admin
        .from("reelready_media")
        .select("processing_state")
        .eq("id", sourceId)
        .single()
    ).data!.processing_state,
    "reviewed",
  );
});

test("real publishing needs explicit confirmation and ownership, without a PIN or provider calls", async () => {
  const { POST: publish } = await import("../app/api/publish/route");
  const old = fetch;
  process.env.DEMO_MODE = "false";
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("api.upload-post.com")) {
      calls++;
      throw new Error("No live social requests allowed");
    }
    return old(input, init);
  };
  try {
    for (const action of ["send", "retry"]) {
      for (const confirmed of [undefined, false]) {
        const response = await publish(
          req({ action, id: crypto.randomUUID(), confirmed }, "/api/publish"),
        );
        assert.equal(response.status, 400);
      }
      const response = await publish(
        req(
          { action, id: crypto.randomUUID(), confirmed: true },
          "/api/publish",
        ),
      );
      assert.equal(response.status, 404);
      assert.doesNotMatch(
        ((await response.json()) as { error: string }).error,
        /PIN/,
      );
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
    process.env.DEMO_MODE = "true";
  }
});

test("production review rejects no-key and old notes capabilities rather than generating misleading analysis", async () => {
  const allow = process.env.ALLOW_SAMPLE_OUTPUT,
    key = process.env.GEMINI_API_KEY;
  process.env.ALLOW_SAMPLE_OUTPUT = "false";
  const videoToken = await sign(
    { visitor: owner, name: "notes", path },
    "video",
    3600,
  );
  const data = { token: videoToken, idea: planned().input, duration: 8 };
  try {
    delete process.env.GEMINI_API_KEY;
    let response = await review(req(data, "/api/review"));
    assert.equal(response.status, 503);
    assert.match(
      ((await response.json()) as { error: string }).error,
      /no sample analysis/,
    );
    process.env.GEMINI_API_KEY = "test-key";
    response = await review(req(data, "/api/review"));
    assert.equal(response.status, 409);
    assert.match(
      ((await response.json()) as { error: string }).error,
      /not been analyzed/,
    );
  } finally {
    if (allow === undefined) delete process.env.ALLOW_SAMPLE_OUTPUT;
    else process.env.ALLOW_SAMPLE_OUTPUT = allow;
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
  }
});

test("real preflight rejects captions bound to another selected video", async () => {
  const previous = (
    await admin
      .from("reelready_reels")
      .select("state")
      .eq("id", reelId)
      .single()
  ).data!.state;
  process.env.DEMO_MODE = "false";
  try {
    await admin
      .from("reelready_reels")
      .update({
        state: {
          ...previous,
          analysis: { origin: "recording", assetPath: "different-video.mp4" },
        },
      })
      .eq("id", reelId);
    const report = await publishPreflight(
      req(),
      preflightInput.parse({
        draftId: reelId,
        assetToken,
        platforms: ["youtube"],
        scheduledAt: null,
        language: "English",
        dubbed: false,
        size: 1000,
        duration: 8,
        width: 360,
        height: 640,
        instagram: "",
        youtubeTitle: "Original animation",
        youtubeDescription: "Original test animation",
        x: "",
      }),
    );
    assert.ok(report.blockers.some((b) => /different video version/.test(b)));
  } finally {
    await admin
      .from("reelready_reels")
      .update({ state: previous })
      .eq("id", reelId);
    process.env.DEMO_MODE = "true";
  }
});

test("production never exposes sample shortcuts, even if sample output is accidentally allowed", async () => {
  const { GET: limits } = await import("../app/api/limits/route");
  const before = {
    demo: process.env.DEMO_MODE,
    sample: process.env.ALLOW_SAMPLE_OUTPUT,
  };
  try {
    process.env.DEMO_MODE = "false";
    process.env.ALLOW_SAMPLE_OUTPUT = "true";
    assert.equal(
      ((await (await limits()).json()) as { samplesAvailable: boolean })
        .samplesAvailable,
      false,
    );
    process.env.DEMO_MODE = "true";
    process.env.ALLOW_SAMPLE_OUTPUT = "false";
    assert.equal(
      ((await (await limits()).json()) as { samplesAvailable: boolean })
        .samplesAvailable,
      false,
    );
    process.env.ALLOW_SAMPLE_OUTPUT = "true";
    assert.equal(
      ((await (await limits()).json()) as { samplesAvailable: boolean })
        .samplesAvailable,
      true,
    );
  } finally {
    for (const [key, value] of Object.entries({
      DEMO_MODE: before.demo,
      ALLOW_SAMPLE_OUTPUT: before.sample,
    }))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("real Instagram preflight inspects stored MP4 metadata without a worker and caches the result", async () => {
  const oldMode = process.env.DEMO_MODE;
  const oldFetch = globalThis.fetch;
  let rangedReads = 0;
  try {
    process.env.DEMO_MODE = "false";
    // Browser metadata is deliberately wrong. Only the stored bytes can verify it.
    await admin
      .from("reelready_media")
      .update({ metadata: { duration: 80, width: 1920, height: 1080 } })
      .eq("id", sourceId);
    globalThis.fetch = async (url, init) => {
      if (new Headers(init?.headers).has("range")) rangedReads++;
      return oldFetch(url, init);
    };
    const input = preflightInput.parse({
      draftId: reelId,
      assetToken,
      platforms: ["instagram"],
      scheduledAt: null,
      instagram: "An original animation",
      youtubeTitle: "Animation",
      youtubeDescription: "An original animation",
      x: "An original animation",
      language: "English",
      dubbed: false,
      size: 1000,
      duration: 80,
      width: 1920,
      height: 1080,
    });
    const report = await publishPreflight(req(), input);
    assert.ok(
      report.blockers.every(
        (x) => !/codecs|H.264|AAC|portrait|5 to 90/.test(x),
      ),
      JSON.stringify(report.blockers),
    );
    assert.ok(rangedReads > 0, "Must read actual stored bytes");
    const stored = (
      await admin
        .from("reelready_media")
        .select("metadata")
        .eq("id", sourceId)
        .single()
    ).data!.metadata;
    assert.equal(stored.streamInspected, true);
    assert.equal(stored.videoCodec, "h264");
    assert.equal(stored.audioCodec, "aac");
    assert.equal(stored.duration, 8);
    assert.equal(stored.width, 360);
    assert.equal(stored.height, 640);
    assert.notEqual(
      stored.decoded,
      true,
      "Container inspection must not claim full decoding",
    );
    const count = rangedReads;
    await publishPreflight(req(), input);
    assert.equal(
      rangedReads,
      count,
      "Verified metadata should be cached for this asset",
    );
    assert.equal(
      (
        await admin
          .from("reelready_media")
          .select("path")
          .eq("id", sourceId)
          .single()
      ).data!.path,
      path,
    );
  } finally {
    globalThis.fetch = oldFetch;
    process.env.DEMO_MODE = oldMode;
    await admin
      .from("reelready_media")
      .update({ metadata: meta })
      .eq("id", sourceId);
  }
});

test("free narration readiness does not need Gemini TTS and Vercel compatibility streams compressed audio", async () => {
  const previous = {
    provider: process.env.TTS_PROVIDER,
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_TTS_MODEL,
  };
  const oldFetch = fetch;
  process.env.TTS_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "private-unit-fixture";
  delete process.env.OPENROUTER_TTS_MODEL;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://openrouter.ai/"))
      return oldFetch(url, init);
    if (String(url).endsWith("/audio/speech")) {
      calls++;
      assert.equal(
        JSON.parse(String(init?.body)).model,
        "fish-audio/s2.1-pro-free:free",
      );
      return new Response(new Uint8Array(150), {
        headers: { "content-type": "audio/mpeg" },
      });
    }
    if (String(url).endsWith("/endpoints"))
      return Response.json({
        data: { endpoints: [{ pricing: { prompt: "0", completion: "0" } }] },
      });
    return Response.json({
      data: [
        {
          id: "fish-audio/s2.1-pro-free:free",
          pricing: { prompt: "0", completion: "0" },
          architecture: { output_modalities: ["speech"] },
        },
      ],
    });
  };
  try {
    const status = await health();
    assert.equal(((await status.json()) as { voice: string }).voice, "live");
    assert.equal(calls, 0);
    const result = await voice(
      req({ script: "A real creator narration." }, "/api/voiceover"),
    );
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), "audio/mpeg");
    assert.equal((await result.arrayBuffer()).byteLength, 150);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries({
      TTS_PROVIDER: previous.provider,
      OPENROUTER_API_KEY: previous.key,
      OPENROUTER_TTS_MODEL: previous.model,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
