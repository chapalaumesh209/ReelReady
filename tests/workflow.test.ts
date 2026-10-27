import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storageAdmin, ensureVideoBucket, VIDEO_BUCKET } from "../lib/supabase";
import { sign, session } from "../lib/server";
import { POST as publish } from "../app/api/publish/route";
import { GET as list } from "../app/api/reels/route";
import { prepareInput, refreshJob } from "../lib/server/publishing/jobs";
import { startConnection, connectionStatus } from "../lib/server/connections";
import { saveAccount } from "../lib/server/social/accounts";
import { requiredScopes } from "../lib/server/social/config";
import { finishOAuth } from "../lib/server/social/oauth";
import { publicationWorkerOnce } from "../lib/server/social/worker";
import { decryptSocial } from "../lib/server/social/crypto";
import { rateLimit } from "../lib/server/rate-limit";
import { type PublishInput } from "../lib/workflow";
let alice: { id: string; token: string; db: SupabaseClient }, bob: typeof alice;
let assetToken = "",
  reelId = "",
  path = "";
const admin = storageAdmin();
process.env.RATE_PUBLISH_PER_HOUR = "50";
process.env.WORKER_POOL = `native-test-${crypto.randomUUID()}`;
// A separate trusted-proxy IP namespace keeps repeat runs isolated from durable production-style counters.
const testIP = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
const request = (token: string, route = "/api/publish", data?: unknown) =>
  new Request(`http://127.0.0.1:3000${route}`, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-forwarded-for": testIP,
      "Content-Type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
async function user() {
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await db.auth.signInAnonymously();
  assert.equal(error, null);
  return { id: data.user!.id, token: data.session!.access_token, db };
}
before(async () => {
  assert.match(
    process.env.SUPABASE_URL || "",
    /^http:\/\/(127\.0\.0\.1|localhost):/,
    "Integration tests are restricted to local Supabase.",
  );
  [alice, bob] = await Promise.all([user(), user()]);
  await ensureVideoBucket();
  reelId = crypto.randomUUID();
  path = `${alice.id}/${reelId}/original-test.mp4`;
  const reel = await admin.from("reelready_reels").insert({
    id: reelId,
    owner_id: alice.id,
    title: "Private integration reel",
    state: {
      version: 2,
      id: reelId,
      step: 4,
      input: "A private integration reel.",
    },
  });
  assert.equal(reel.error, null);
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  assert.equal(
    (
      await admin.storage
        .from(VIDEO_BUCKET)
        .upload(path, bytes, { contentType: "video/mp4" })
    ).error,
    null,
  );
  assert.equal(
    (
      await admin.from("reelready_media").insert({
        owner_id: alice.id,
        reel_id: reelId,
        kind: "original",
        path,
        mime: "video/mp4",
        bytes: 32,
        metadata: {
          duration: 15,
          width: 360,
          height: 640,
          decoded: true,
          videoCodec: "h264",
          audioCodec: "aac",
        },
        processing_state: "reviewed",
      })
    ).error,
    null,
  );
  assetToken = await sign(
    {
      visitor: alice.id,
      path,
      size: 32,
      mime: "video/mp4",
      name: "test.mp4",
      kind: "original",
    },
    "stored-video",
    3600,
  );
});
after(async () => {
  if (path) await admin.storage.from(VIDEO_BUCKET).remove([path]);
  for (const who of [alice, bob])
    if (who) {
      await admin.from("reelready_jobs").delete().eq("owner_id", who.id);
      await admin.auth.admin.deleteUser(who.id);
    }
});
const payload = (): PublishInput => ({
  draftId: reelId,
  platforms: ["instagram", "youtube"],
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  instagram: "A private test caption.",
  youtubeTitle: "A private test",
  youtubeDescription: "Test description.",
  x: "Test caption.",
  language: "English",
  dubbed: false,
  assetToken,
  size: 32,
  duration: 15,
  width: 360,
  height: 640,
});
async function prepare(extra: Partial<PublishInput> = {}) {
  const data = {
    ...payload(),
    ...extra,
    action: "prepare" as const,
    confirmed: true as const,
  };
  prepareInput.parse(data);
  const r = await publish(request(alice.token, "/api/publish", data));
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()) as { id: string; status: string; demo: boolean };
}
test("verified Supabase identities and RLS isolate reels, jobs, media, profile mappings and connection caches", async () => {
  assert.equal((await session(request(alice.token))).id, alice.id);
  const own = await alice.db
    .from("reelready_reels")
    .select("id")
    .eq("id", reelId);
  assert.equal(own.data?.length, 1);
  for (const table of [
    "reelready_reels",
    "reelready_media",
    "reelready_jobs",
    "reelready_profiles",
    "reelready_connections",
    "reelready_targets",
  ]) {
    const other = await bob.db.from(table).select("*").eq("owner_id", alice.id);
    assert.deepEqual(other.data, []);
  }
  assert.equal(
    (await list(new Request("http://127.0.0.1:3000/api/reels"))).status,
    401,
  );
  const stolen = await publish(
    request(bob.token, "/api/publish", {
      ...payload(),
      action: "prepare",
      confirmed: true,
    }),
  );
  assert.equal(stolen.status, 404);
  assert.ok(
    (
      await alice.db.rpc("reelready_take_limit", {
        p_key: "forged",
        p_limit: 999,
        p_seconds: 60,
      })
    ).error,
  );
  assert.ok(
    (await alice.db.rpc("reelready_prepare_job", { p_job: {}, p_targets: [] }))
      .error,
  );
  const forged = await bob.db
    .from("reelready_profiles")
    .insert({ owner_id: bob.id, external_profile: "administrator" });
  assert.ok(forged.error);
});
test("demo publication is labelled, durable, confirmed and idempotent without contacting the provider", async () => {
  process.env.DEMO_MODE = "true";
  process.env.UPLOADPOST_API_KEY = "unit-test-only";
  const original = fetch;
  let external = 0;
  globalThis.fetch = async (input, options) => {
    if (String(input).includes("api.upload-post.com")) {
      external++;
      throw Error("No external calls allowed");
    }
    return original(input, options);
  };
  try {
    const missing = await publish(
      request(alice.token, "/api/publish", { ...payload(), action: "prepare" }),
    );
    assert.equal(missing.status, 400);
    const [job, same] = await Promise.all([
      prepare({ scheduledAt: null }),
      prepare({ scheduledAt: null }),
    ]);
    assert.equal(job.id, same.id);
    const send = () =>
      publish(
        request(alice.token, "/api/publish", {
          action: "send",
          id: job.id,
          confirmed: true,
        }),
      );
    const sent = await Promise.all([send(), send()]);
    for (const result of sent)
      assert.equal(result.status, 200, await result.clone().text());
    const result = await refreshJob(request(alice.token), job.id);
    assert.equal(result.demo, true);
    assert.ok(
      result.deliveries.every(
        (d) => d.state === "demo" && /Nothing was posted/.test(d.message || ""),
      ),
    );
    assert.equal(external, 0);
    const attempts = await admin
      .from("reelready_attempts")
      .select("id")
      .eq("job_id", job.id);
    assert.equal(attempts.data?.length, 1);
    await assert.rejects(() => refreshJob(request(bob.token), job.id));
  } finally {
    globalThis.fetch = original;
    delete process.env.UPLOADPOST_API_KEY;
  }
});
function nativeConfig() {
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  for (const prefix of ["GOOGLE", "INSTAGRAM", "X"]) {
    process.env[`${prefix}_CLIENT_ID`] = `${prefix.toLowerCase()}-test-client`;
    process.env[`${prefix}_CLIENT_SECRET`] = "test-only-client-secret";
  }
}
async function seed(owner: string) {
  nativeConfig();
  for (const platform of ["youtube", "instagram", "x"] as const)
    await saveAccount(owner, platform, {
      accountId: `${platform}-id`,
      name: `Test ${platform}`,
      credential: {
        accessToken: "test-only-access",
        refreshToken: "test-only-refresh",
        expiresAt: Date.now() + 3600000,
        scopes: requiredScopes[platform],
      },
    });
}
function installNativeMock(
  extra?: (url: string, options?: RequestInit) => Response | undefined,
) {
  const old = fetch;
  let put = false;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (!url.startsWith("https://")) return old(input, options);
    const override = extra?.(url, options);
    if (override) return override;
    if (url.includes("/youtube/v3/channels"))
      return Response.json({
        items: [{ id: "youtube-id", snippet: { title: "Owned channel" } }],
      });
    if (url.includes("graph.instagram.com") && url.includes("/me?"))
      return Response.json({
        user_id: "instagram-id",
        username: "owned-creator",
        account_type: "BUSINESS",
      });
    if (url.endsWith("/2/users/me"))
      return Response.json({ data: { id: "x-id", username: "owned-writer" } });
    if (url.includes("uploadType=resumable"))
      return new Response(null, {
        status: 200,
        headers: {
          location: "https://www.googleapis.com/upload/session?upload_id=test",
        },
      });
    if (url.includes("/upload/session")) {
      if (
        new Headers(options?.headers)
          .get("Content-Range")
          ?.startsWith("bytes */")
      )
        return put
          ? Response.json({ id: "youtube-post" })
          : new Response(null, { status: 308 });
      put = true;
      return Response.json({ id: "youtube-post" });
    }
    if (url.includes("/youtube/v3/videos?"))
      return Response.json({
        items: [
          {
            id: "youtube-post",
            status: { uploadStatus: "processed", privacyStatus: "public" },
          },
        ],
      });
    if (url.endsWith("/instagram-id/media"))
      return Response.json({ id: "container-1" });
    if (url.includes("/container-1?"))
      return Response.json({ status_code: "FINISHED" });
    if (url.endsWith("/instagram-id/media_publish"))
      return Response.json({ id: "instagram-post" });
    if (url.includes("/instagram-post?"))
      return Response.json({
        id: "instagram-post",
        permalink: "https://www.instagram.com/reel/native-test/",
      });
    if (url.endsWith("/2/media/upload/initialize"))
      return Response.json({ data: { id: "12345" } });
    if (url.endsWith("/12345/append"))
      return Response.json({ data: { expires_at: 3600 } });
    if (url.endsWith("/12345/finalize"))
      return Response.json({
        data: { id: "12345", processing_info: { state: "succeeded" } },
      });
    if (url.endsWith("/2/tweets"))
      return Response.json({ data: { id: "x-post" } });
    if (url.includes("/2/tweets/x-post"))
      return Response.json({ data: { id: "x-post" } });
    throw new Error("Unexpected external request in isolated native test");
  };
  return () => {
    globalThis.fetch = old;
  };
}
async function tick(id: string) {
  await admin
    .from("reelready_jobs")
    .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", id);
  await publicationWorkerOnce("test-only-worker");
}
test("native credentials are encrypted, owner-bound and inaccessible through ordinary database reads", async () => {
  await seed(alice.id);
  const record = await admin
    .from("reelready_social_credentials")
    .select("encrypted_credentials")
    .eq("owner_id", alice.id)
    .eq("platform", "x")
    .single();
  assert.equal(record.error, null);
  assert.ok(!record.data!.encrypted_credentials.includes("test-only-access"));
  assert.throws(() =>
    decryptSocial(record.data!.encrypted_credentials, `${bob.id}:x`),
  );
  assert.equal(
    (await alice.db.from("reelready_social_credentials").select("*")).data,
    null,
  );
  assert.equal(
    (await bob.db.from("reelready_oauth_states").select("*")).data,
    null,
  );
  const restore = installNativeMock();
  try {
    assert.equal(
      (await connectionStatus(request(alice.token))).accounts.x?.connected,
      true,
    );
    assert.equal(
      (await connectionStatus(request(bob.token))).accounts.x?.connected,
      false,
    );
    assert.ok(
      !JSON.stringify(await connectionStatus(request(alice.token))).includes(
        "test-only-access",
      ),
    );
  } finally {
    restore();
  }
});
test("all direct OAuth links have fresh owner-bound state, official hosts and PKCE where supported", async () => {
  nativeConfig();
  process.env.DEMO_MODE = "true";
  const hosts = {
    youtube: "accounts.google.com",
    instagram: "www.instagram.com",
    x: "x.com",
  };
  const states = new Set();
  for (const platform of ["youtube", "instagram", "x"] as const) {
    const link = await startConnection(request(alice.token), platform),
      url = new URL(link.url);
    assert.equal(url.hostname, hosts[platform]);
    assert.equal(link.demo, false);
    assert.equal(
      url.searchParams.get("redirect_uri"),
      `http://127.0.0.1:3000/api/connect/callback/${platform}`,
    );
    assert.ok(!states.has(url.searchParams.get("state")));
    states.add(url.searchParams.get("state"));
    if (platform !== "instagram")
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    await assert.rejects(() =>
      finishOAuth(
        new Request(
          `http://127.0.0.1:3000/api/connect/callback/${platform}?state=${url.searchParams.get("state")}&code=forged`,
          { headers: { Authorization: `Bearer ${bob.token}` } },
        ),
        platform,
      ),
    );
    const callback = new Request(
      `http://127.0.0.1:3000/api/connect/callback/${platform}?state=${url.searchParams.get("state")}&error=access_denied`,
      { headers: { Authorization: `Bearer ${alice.token}` } },
    );
    assert.equal(await finishOAuth(callback, platform), "cancelled");
    await assert.rejects(() => finishOAuth(callback, platform), /expired|used/);
  }
});
test("real direct publishing without a PIN persists independent receipts, exact copy and safe failed-only retries", async () => {
  await seed(alice.id);
  process.env.DEMO_MODE = "false";
  let rejected = false,
    sends = 0,
    instagramPosts = 0;
  const restore = installNativeMock((url, options) => {
    if (url.includes("uploadType=resumable")) {
      const data = JSON.parse(String(options?.body));
      assert.equal(data.snippet.title, "A private test");
      assert.equal(data.snippet.description, "Test description.");
    }
    if (
      url.includes("/upload/session") &&
      !new Headers(options?.headers)
        .get("Content-Range")
        ?.startsWith("bytes */")
    ) {
      sends++;
      if (!rejected) {
        rejected = true;
        return Response.json(
          { error: "private-secret-must-not-leak" },
          { status: 400 },
        );
      }
    }
    if (url.endsWith("/instagram-id/media_publish")) instagramPosts++;
    return undefined;
  });
  const originalURL = process.env.SUPABASE_URL;
  // Instagram preflight requires public signed URLs. Only this fake public hostname is routed back to local test storage.
  process.env.SUPABASE_URL = "https://storage.reelready.example";
  const nativeFetch = fetch;
  globalThis.fetch = (input, options) =>
    String(input).startsWith("https://storage.reelready.example")
      ? nativeFetch(
          String(input).replace(
            "https://storage.reelready.example",
            originalURL!,
          ),
          options,
        )
      : nativeFetch(input, options);
  try {
    const job = await prepare({ scheduledAt: null });
    const send = () =>
      publish(
        request(alice.token, "/api/publish", {
          action: "send",
          id: job.id,
          confirmed: true,
        }),
      );
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 200);
    for (let n = 0; n < 5; n++) await tick(job.id);
    let result = await refreshJob(request(alice.token), job.id);
    assert.deepEqual(
      result.deliveries.map((d) => d.state),
      ["published", "failed"],
    );
    assert.equal(instagramPosts, 1);
    assert.equal(sends, 1);
    assert.ok(!JSON.stringify(result).includes("private-secret"));
    const responses = await Promise.all(
      [0, 1].map(() =>
        publish(
          request(alice.token, "/api/publish", {
            action: "retry",
            id: job.id,
            confirmed: true,
          }),
        ),
      ),
    );
    assert.ok(responses.every((r) => [200, 409].includes(r.status)));
    for (let n = 0; n < 4; n++) await tick(job.id);
    result = await refreshJob(request(alice.token), job.id);
    assert.deepEqual(
      result.deliveries.map((d) => d.state),
      ["published", "published"],
    );
    assert.equal(instagramPosts, 1);
    assert.equal(sends, 2);
    await assert.rejects(() => refreshJob(request(bob.token), job.id));
  } finally {
    globalThis.fetch = nativeFetch;
    restore();
    process.env.SUPABASE_URL = originalURL;
    process.env.DEMO_MODE = "true";
  }
});
test("reconnecting a different account cannot redirect an already-confirmed publishing job", async () => {
  await seed(alice.id);
  process.env.DEMO_MODE = "false";
  let uploads = 0;
  const restore = installNativeMock((url, options) => {
    if (options?.method === "POST" && url.includes("uploadType=resumable"))
      uploads++;
    return undefined;
  });
  try {
    const job = await prepare({
      platforms: ["youtube"],
      scheduledAt: null,
      youtubeTitle: "An account-bound request",
    });
    assert.equal(
      (
        await publish(
          request(alice.token, "/api/publish", {
            action: "send",
            confirmed: true,
            id: job.id,
          }),
        )
      ).status,
      200,
    );
    await saveAccount(alice.id, "youtube", {
      accountId: "another-channel",
      name: "Another channel",
      credential: {
        accessToken: "test-only-another-access",
        expiresAt: Date.now() + 3600000,
        scopes: requiredScopes.youtube,
      },
    });
    await tick(job.id);
    assert.equal(
      (await refreshJob(request(alice.token), job.id)).status,
      "failed",
    );
    assert.equal(uploads, 0);
  } finally {
    restore();
    process.env.DEMO_MODE = "true";
  }
});
test("retrying an expired unpublished X upload starts fresh media without repeating successful posts", async () => {
  await seed(alice.id);
  process.env.DEMO_MODE = "false";
  let initialized = 0,
    expires = true;
  const restore = installNativeMock((url) => {
    if (url.endsWith("/2/media/upload/initialize")) initialized++;
    if (url.endsWith("/12345/append") && expires)
      return Response.json({ error: "media expired" }, { status: 404 });
    return undefined;
  });
  try {
    const job = await prepare({
      platforms: ["x"],
      scheduledAt: null,
      x: "A safe media-expiration retry.",
    });
    await publish(
      request(alice.token, "/api/publish", {
        action: "send",
        confirmed: true,
        id: job.id,
      }),
    );
    for (let n = 0; n < 3; n++) await tick(job.id);
    assert.equal(
      (await refreshJob(request(alice.token), job.id)).status,
      "failed",
    );
    expires = false;
    assert.equal(
      (
        await publish(
          request(alice.token, "/api/publish", {
            action: "retry",
            confirmed: true,
            id: job.id,
          }),
        )
      ).status,
      200,
    );
    for (let n = 0; n < 5; n++) await tick(job.id);
    assert.equal(
      (await refreshJob(request(alice.token), job.id)).status,
      "published",
    );
    assert.equal(initialized, 2);
  } finally {
    restore();
    process.env.DEMO_MODE = "true";
  }
});
test("uncertain X post responses pause automatic resend and durable rate limits stay shared", async () => {
  await seed(alice.id);
  process.env.DEMO_MODE = "false";
  let posts = 0;
  const restore = installNativeMock((url) => {
    if (url.endsWith("/2/tweets")) {
      posts++;
      throw new DOMException("Uncertain response", "TimeoutError");
    }
    return undefined;
  });
  try {
    const job = await prepare({
      platforms: ["x"],
      scheduledAt: null,
      x: "A different private caption.",
    });
    assert.equal(
      (
        await publish(
          request(alice.token, "/api/publish", {
            action: "send",
            confirmed: true,
            id: job.id,
          }),
        )
      ).status,
      200,
    );
    for (let n = 0; n < 5; n++) await tick(job.id);
    const result = await refreshJob(request(alice.token), job.id);
    assert.equal(result.status, "uncertain");
    assert.equal(posts, 1);
    assert.equal(
      (
        await publish(
          request(alice.token, "/api/publish", {
            action: "retry",
            confirmed: true,
            id: job.id,
          }),
        )
      ).status,
      409,
    );
    for (let n = 0; n < 2; n++) await tick(job.id);
    assert.equal(posts, 1);
    const action = `native-limit-${crypto.randomUUID()}`;
    await rateLimit(request(alice.token), action, 2);
    await rateLimit(request(alice.token), action, 2);
    await assert.rejects(() => rateLimit(request(alice.token), action, 2));
  } finally {
    restore();
    process.env.DEMO_MODE = "true";
  }
});
test("legacy simulated connections and intermediary credentials never authorize native accounts", async () => {
  const env = { ...process.env };
  process.env.DEMO_MODE = "true";
  for (const key of ["GOOGLE_CLIENT_ID", "INSTAGRAM_CLIENT_ID", "X_CLIENT_ID"])
    delete process.env[key];
  process.env.UPLOAD_POST_API_KEY = "ignored-test-only-intermediary-key";
  await admin.from("reelready_connections").upsert({
    owner_id: bob.id,
    platform: "instagram",
    is_demo: true,
    connected: true,
    display_name: "Legacy simulated account",
  });
  try {
    const state = await connectionStatus(request(bob.token));
    assert.equal(state.configured, false);
    assert.ok(
      Object.values(state.accounts).every(
        (a) => !a.connected && a.configured === false,
      ),
    );
    await assert.rejects(
      () => startConnection(request(bob.token), "instagram"),
      /not configured/,
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
test("revoked grants and malformed identities are never displayed as connected; credentials never leak", async () => {
  await seed(alice.id);
  const restore = installNativeMock((url) =>
    url.endsWith("/2/users/me")
      ? Response.json({ error: "access=never-leak" }, { status: 401 })
      : url.includes("/youtube/v3/channels")
        ? Response.json({ items: [] })
        : undefined,
  );
  try {
    const state = await connectionStatus(request(alice.token));
    assert.equal(state.accounts.x?.connected, false);
    assert.equal(state.accounts.x?.reauth, true);
    assert.equal(state.accounts.youtube?.connected, false);
    assert.equal(state.accounts.youtube?.unavailable, true);
    assert.ok(!JSON.stringify(state).includes("never-leak"));
  } finally {
    restore();
  }
});

test("reel rename, archive, restoration and safe duplication persist without copying media or publishing jobs", async () => {
  const { PATCH: manage, POST: save } = await import("../app/api/reels/route");
  const current = async () =>
    (await admin.from("reelready_reels").select("*").eq("id", reelId).single())
      .data!;
  const act = async (action: string, extra = {}) =>
    manage(
      request(alice.token, "/api/reels", {
        action,
        id: reelId,
        updatedAt: (await current()).updated_at,
        ...extra,
      }),
    );
  const old = await current();
  assert.equal((await act("rename", { title: "My named reel" })).status, 200);
  assert.equal((await act("archive")).status, 200);
  const saved = await save(
    request(alice.token, "/api/reels", {
      state: {
        ...old.state,
        id: reelId,
        version: 2,
        step: 0,
        input: "A stale tab must preserve the rename and archive.",
      },
    }),
  );
  assert.equal(saved.status, 200);
  const now = await current();
  assert.equal(now.title, "My named reel");
  assert.ok(now.state.archivedAt);
  assert.equal((await act("restore")).status, 200);
  assert.equal((await current()).state.archivedAt, null);
  const stale = await manage(
    request(alice.token, "/api/reels", {
      action: "archive",
      id: reelId,
      updatedAt: old.updated_at,
    }),
  );
  assert.equal(stale.status, 409);
  assert.equal(
    (
      await manage(
        request(bob.token, "/api/reels", {
          action: "archive",
          id: reelId,
          updatedAt: now.updated_at,
        }),
      )
    ).status,
    404,
  );
  const duplicate = await act("duplicate");
  assert.equal(duplicate.status, 200);
  const { id } = (await duplicate.json()) as { id: string };
  const copied = (
    await admin.from("reelready_reels").select("state").eq("id", id).single()
  ).data!.state;
  assert.equal(copied.originalAsset, null);
  assert.equal(copied.job, null);
  assert.equal(copied.token, "");
  assert.equal(copied.step, 0);
  await admin.from("reelready_reels").delete().eq("id", id);
});
test("creator preferences persist explicitly and old reel autosaves never overwrite them", async () => {
  const { POST: write, GET: read } = await import(
    "../app/api/preferences/route"
  );
  const { POST: save } = await import("../app/api/reels/route");
  const details = {
    brand: "My creator brand",
    voice: "Friendly and specific.",
    link: "",
    disclosure: "",
  };
  assert.equal(
    (await write(request(alice.token, "/api/preferences", { details }))).status,
    200,
  );
  await save(
    request(alice.token, "/api/reels", {
      state: {
        id: reelId,
        version: 2,
        step: 0,
        input: "Old project notes stay with this reel only.",
        details: { ...details, brand: "Old project" },
      },
    }),
  );
  const data = (await (
    await read(request(alice.token, "/api/preferences"))
  ).json()) as { details: { brand: string } };
  assert.equal(data.details.brand, details.brand);
  const other = (await (
    await read(request(bob.token, "/api/preferences"))
  ).json()) as { details: { brand: string } };
  assert.notEqual(other.details.brand, details.brand);
});

test("concurrent first saves keep the owning workspace and reject foreign IDs", async () => {
  const { ensureReel } = await import("../lib/server/repository");
  const id = crypto.randomUUID();
  try {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => ensureReel(request(alice.token), id)),
    );
    assert.ok(results.every((x) => x.user.id === alice.id));
    await assert.rejects(
      () => ensureReel(request(bob.token), id),
      /could not be opened/,
    );
    const row = await admin
      .from("reelready_reels")
      .select("owner_id")
      .eq("id", id)
      .single();
    assert.equal(row.data!.owner_id, alice.id);
  } finally {
    await admin
      .from("reelready_reels")
      .delete()
      .eq("id", id)
      .eq("owner_id", alice.id);
  }
});
