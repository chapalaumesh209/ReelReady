import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storageAdmin, ensureVideoBucket, VIDEO_BUCKET } from "../lib/supabase";
import { sign } from "../lib/server";
import { POST as publish } from "../app/api/publish/route";
import {
  connectionStatus,
  startConnection,
  disconnect,
} from "../lib/server/connections";
import {
  ownerProfile,
  authorizeProviderConnection,
} from "../lib/server/provider/accounts";
import { stateHash } from "../lib/server/social/crypto";
import {
  authorizeProviderDelivery,
  providerDeliveries,
  providerMediaStream,
} from "../lib/server/provider/delivery";
import { publicationWorkerOnce } from "../lib/server/social/worker";
import { getJob, refreshJob } from "../lib/server/publishing/jobs";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { workflowAuthorization } from "../lib/server/provider/webhook";
const saved = { ...process.env },
  baseFetch = fetch,
  admin = storageAdmin();
const storagePrototype = Object.getPrototypeOf(
  admin.storage.from(VIDEO_BUCKET),
);
const originalSignedURL = storagePrototype.createSignedUrl;
let alice: { id: string; token: string; db: SupabaseClient }, bob: typeof alice;
const profiles = new Map<
  string,
  { username: string; social_accounts: Record<string, unknown> }
>();
const paths: string[] = [];
let profileCap = false,
  publications = 0,
  loseResponse = false;
let lastEnvelope: Record<string, unknown> = {},
  lastProof: Record<string, unknown> = {};
const requests = new Map<string, { platforms: string[]; round: number }>();
const statusOverrides = new Map<string, Record<string, unknown>>();
const statusReads: string[] = [];
const failedStatusReads = new Set<string>();
const request = (user = alice, data?: unknown) =>
  new Request("http://127.0.0.1:3000/api/publish", {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
      "x-forwarded-for": `2001:db8:${user.id.slice(0, 4)}::1`,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
async function identity() {
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const r = await db.auth.signInAnonymously();
  assert.equal(r.error, null);
  return { id: r.data.user!.id, token: r.data.session!.access_token, db };
}
function connected(name: string) {
  return {
    username: name,
    social_accounts: {
      instagram: { username: `ig-${name}`, handle: "creator-ig" },
      youtube: { username: `yt-${name}`, handle: "creator-yt" },
      x: { username: `x-${name}`, handle: "creator-x" },
    },
  };
}
before(async () => {
  assert.match(
    process.env.SUPABASE_URL || "",
    /^http:\/\/(127\.0\.0\.1|localhost):/,
  );
  process.env.WORKER_POOL = `managed-test-${crypto.randomUUID()}`;
  process.env.PUBLISH_PROVIDER = "uploadpost";
  process.env.PUBLISH_EXECUTOR = "n8n";
  process.env.PUBLISH_MEDIA_TRANSPORT = "binary";
  process.env.UPLOAD_POST_API_KEY = "test-provider-key-not-real";
  process.env.N8N_PUBLISHER_SECRET =
    "test-bridge-secret-not-real-000000000000000";
  process.env.N8N_PROVIDER_WEBHOOK_BASE =
    "https://workflow.example.com/webhook";
  process.env.DEMO_MODE = "false";
  process.env.RATE_PUBLISH_PER_HOUR = "100";
  process.env.RATE_PUBLISH_PREPARE_PER_HOUR = "100";
  [alice, bob] = await Promise.all([identity(), identity()]);
  await ensureVideoBucket();
  for (const user of [alice, bob]) {
    const name = `rr_${user.id.replaceAll("-", "")}`;
    assert.equal(
      (
        await admin
          .from("reelready_profiles")
          .insert({ owner_id: user.id, external_profile: name })
      ).error,
      null,
    );
    profiles.set(name, connected(name));
  }
  storagePrototype.createSignedUrl = async () => ({
    data: {
      signedUrl: "https://media.example.com/owned-test.mp4?token=fixture",
    },
    error: null,
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (["127.0.0.1", "localhost"].includes(url.hostname))
      return baseFetch(input, init);
    if (url.hostname === "media.example.com")
      return new Response(new Uint8Array(32));
    if (url.hostname === "api.upload-post.com") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (
        url.pathname === "/api/uploadposts/users" &&
        init?.method === "POST"
      ) {
        if (profileCap)
          return Response.json(
            { error_code: "PROFILE_LIMIT_REACHED" },
            { status: 403 },
          );
        if (profiles.has(body.username))
          return Response.json({}, { status: 409 });
        profiles.set(body.username, {
          username: body.username,
          social_accounts: {},
        });
        return Response.json({ success: true }, { status: 201 });
      }
      if (
        url.pathname === "/api/uploadposts/users/social" &&
        init?.method === "DELETE"
      ) {
        delete profiles.get(body.profile_username)!.social_accounts[
          body.social_platform
        ];
        return Response.json({ success: true });
      }
      if (url.pathname.includes("/oauth/")) {
        assert.equal(body.profile, `rr_${alice.id.replaceAll("-", "")}`);
        return Response.json({
          authorize_url:
            "https://accounts.google.com/o/oauth2/v2/auth?state=provider-state",
        });
      }
      const name = decodeURIComponent(url.pathname.split("/").pop()!);
      return profiles.has(name)
        ? Response.json({ profile: profiles.get(name) })
        : Response.json({}, { status: 404 });
    }
    if (url.hostname === "workflow.example.com") {
      const body = JSON.parse(String(init?.body));
      if (url.pathname.endsWith("-connect")) {
        const canonical = await authorizeProviderConnection(body);
        assert.equal(
          canonical.profileUsername,
          `rr_${alice.id.replaceAll("-", "")}`,
        );
        assert.equal(canonical.platform, "youtube");
        await assert.rejects(
          () => authorizeProviderConnection(body),
          /already used/,
        );
        return Response.json({
          authorize_url:
            "https://accounts.google.com/o/oauth2/v2/auth?state=provider-state",
        });
      }
      if (url.pathname.endsWith("-publish")) {
        // The workflow ignores every untrusted envelope field until the private
        // backend consumes the proof and returns fresh canonical values.
        lastProof = { postId: body.postId, dispatchToken: body.dispatchToken };
        await assert.rejects(
          () =>
            authorizeProviderDelivery({
              ...lastProof,
              dispatchToken: `${body.dispatchToken}tampered`,
            }),
          /expired|already used/,
        );
        lastEnvelope = await authorizeProviderDelivery(lastProof);
        assert.ok(lastEnvelope.mediaTicket);
        assert.equal(lastEnvelope.videoUrl, undefined);
        await assert.rejects(() =>
          providerMediaStream({
            mediaTicket: String(lastEnvelope.mediaTicket) + "tampered",
          }),
        );
        const file = await providerMediaStream({
          mediaTicket: lastEnvelope.mediaTicket,
        });
        assert.equal(file.size, 32);
        assert.deepEqual(
          new Uint8Array(await new Response(file.stream).arrayBuffer()),
          new Uint8Array(32),
        );
        const foreignTicket = await sign(
          {
            postId: body.postId,
            ownerId: bob.id,
            mediaId: crypto.randomUUID(),
          },
          "publisher-media",
          60,
        );
        await assert.rejects(
          () => providerMediaStream({ mediaTicket: foreignTicket }),
          /not authorized/,
        );
        publications++;
        if (loseResponse)
          throw new Error("Lost response after provider commit");
        const id = `request-${publications}`;
        requests.set(id, {
          platforms: lastEnvelope.platforms as string[],
          round: publications,
        });
        return Response.json({ success: true, request_id: id });
      }
      if (url.pathname.endsWith("-status")) {
        statusReads.push(body.requestId);
        if (failedStatusReads.has(body.requestId))
          return Response.json({}, { status: 503 });
        if (statusOverrides.has(body.requestId))
          return Response.json(statusOverrides.get(body.requestId));
        const rec = requests.get(body.requestId)!;
        return Response.json({
          request_id: body.requestId,
          status: "completed",
          results: rec.platforms.map((platform) => ({
            platform,
            success: !(platform === "instagram" && rec.round === 1),
            url:
              platform === "youtube"
                ? "https://www.youtube.com/watch?v=fixture"
                : platform === "instagram"
                  ? "https://www.instagram.com/reel/fixture/"
                  : "https://x.com/i/status/fixture",
          })),
        });
      }
      return Response.json({ ready: true });
    }
    throw new Error("Unmocked external network forbidden");
  };
});
after(async () => {
  globalThis.fetch = baseFetch;
  storagePrototype.createSignedUrl = originalSignedURL;
  if (paths.length) await admin.storage.from(VIDEO_BUCKET).remove(paths);
  for (const user of [alice, bob])
    if (user) await admin.auth.admin.deleteUser(user.id);
  for (const key of Object.keys(process.env))
    if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
async function freshJob(extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID(),
    path = `${alice.id}/${id}/source.mp4`;
  paths.push(path);
  assert.equal(
    (
      await admin.from("reelready_reels").insert({
        id,
        owner_id: alice.id,
        title: "Managed fixture",
        state: { id, version: 2, step: 5 },
      })
    ).error,
    null,
  );
  assert.equal(
    (
      await admin.storage
        .from(VIDEO_BUCKET)
        .upload(path, new Uint8Array(32), { contentType: "video/mp4" })
    ).error,
    null,
  );
  assert.equal(
    (
      await admin.from("reelready_media").insert({
        owner_id: alice.id,
        reel_id: id,
        kind: "original",
        path,
        bytes: 32,
        mime: "video/mp4",
        processing_state: "reviewed",
        metadata: {
          decoded: true,
          duration: 15,
          width: 360,
          height: 640,
          videoCodec: "h264",
          audioCodec: "aac",
        },
      })
    ).error,
    null,
  );
  const assetToken = await sign(
    {
      visitor: alice.id,
      path,
      size: 32,
      mime: "video/mp4",
      name: "source.mp4",
      kind: "original",
    },
    "stored-video",
    600,
  );
  const body = {
    draftId: id,
    platforms: ["youtube", "instagram"],
    scheduledAt: null,
    instagram: "Instagram caption",
    youtubeTitle: "YouTube title",
    youtubeDescription: "Full description",
    x: "X caption",
    language: "English",
    dubbed: false,
    size: 32,
    duration: 15,
    width: 360,
    height: 640,
    assetToken,
    profileUsername: "another-person",
    action: "prepare",
    confirmed: true,
    ...extra,
  };
  const r = await publish(request(alice, body));
  assert.equal(r.status, 200, await r.clone().text());
  return { job: (await r.json()) as { id: string }, body };
}
async function send(id: string) {
  const r = await publish(
    request(alice, { action: "send", id, confirmed: true }),
  );
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}
async function advance() {
  assert.equal(await publicationWorkerOnce("managed-fixture-worker"), true);
}
async function ready(id: string) {
  await admin
    .from("reelready_jobs")
    .update({ next_attempt_at: new Date(0).toISOString() })
    .eq("id", id)
    .eq("owner_id", alice.id);
}

test("managed connections use only the session's mapped profile; callbacks and browser profile names cannot create connections", async () => {
  const a = await connectionStatus(request());
  assert.equal(a.accounts.instagram?.connected, true);
  assert.equal(
    a.accounts.instagram?.accountId,
    `ig-rr_${alice.id.replaceAll("-", "")}`,
  );
  assert.deepEqual(
    (
      await bob.db
        .from("reelready_profiles")
        .select("*")
        .eq("owner_id", alice.id)
    ).data,
    [],
  );
  const url = await startConnection(request(), "youtube");
  assert.match(url.url, /^https:\/\/accounts.google.com\//);
  const name = `rr_${bob.id.replaceAll("-", "")}`,
    old = profiles.get(name)!;
  profiles.set(name, { username: name, social_accounts: { instagram: "" } });
  assert.equal(
    (await connectionStatus(request(bob))).accounts.instagram?.connected,
    false,
  );
  profiles.set(name, old);
});
test("per-user profile creation is deterministic and profile capacity never falls back to a shared account", async () => {
  const user = await identity();
  try {
    profileCap = true;
    await assert.rejects(() => ownerProfile(user.id, true), /capacity/);
    const map = await admin
      .from("reelready_profiles")
      .select("external_profile")
      .eq("owner_id", user.id)
      .single();
    assert.equal(
      map.data!.external_profile,
      `rr_${user.id.replaceAll("-", "")}`,
    );
    profileCap = false;
    const [a, b] = await Promise.all([
      ownerProfile(user.id, true),
      ownerProfile(user.id, true),
    ]);
    assert.equal(a!.username, b!.username);
    assert.notEqual(a!.username, "default");
  } finally {
    profileCap = false;
    await admin.auth.admin.deleteUser(user.id);
  }
});
test("approved jobs, duplicate clicks and webhook replay produce one provider request; partial retry touches only failed destinations", async () => {
  const { job, body } = await freshJob();
  const duplicate = await publish(request(alice, body));
  assert.equal(((await duplicate.json()) as { id: string }).id, job.id);
  await Promise.all([send(job.id), send(job.id)]);
  await advance();
  assert.equal(publications, 1);
  assert.equal(
    lastEnvelope.profileUsername,
    `rr_${alice.id.replaceAll("-", "")}`,
  );
  assert.equal(lastEnvelope.youtubeDescription, "Full description");
  // Tickets cannot read media after dispatch leaves its active leased commit.
  await assert.rejects(
    () => providerMediaStream({ mediaTicket: lastEnvelope.mediaTicket }),
    /not authorized/,
  );
  await assert.rejects(
    () => authorizeProviderDelivery(lastProof),
    /already used|authorized/,
  );
  assert.equal(publications, 1);
  await assert.rejects(() => getJob(request(bob), job.id), /not found/);
  await ready(job.id);
  await advance();
  const partial = await getJob(request(), job.id);
  assert.equal(partial.status, "failed");
  assert.equal(
    partial.deliveries.find((d) => d.platform === "youtube")?.state,
    "published",
  );
  const retry = await publish(
    request(alice, { action: "retry", id: job.id, confirmed: true }),
  );
  assert.equal(retry.status, 200, await retry.clone().text());
  await advance();
  assert.equal(publications, 2);
  assert.deepEqual(lastEnvelope.platforms, ["instagram"]);
  await ready(job.id);
  await advance();
  const done = await getJob(request(), job.id);
  assert.equal(done.status, "published");
  assert.ok(done.deliveries.every((d) => d.state === "published" && !!d.url));
});
test("an ambiguous provider commit is parked for manual reconciliation and never automatically resent", async () => {
  const { job } = await freshJob();
  await send(job.id);
  loseResponse = true;
  try {
    await advance();
  } finally {
    loseResponse = false;
  }
  const count = publications;
  assert.equal((await getJob(request(), job.id)).status, "uncertain");
  assert.equal(await publicationWorkerOnce("managed-fixture-worker"), false);
  const retry = await publish(
    request(alice, { action: "retry", id: job.id, confirmed: true }),
  );
  assert.equal(retry.status, 409);
  assert.equal(publications, count);
});
test("changing the destination after confirmation blocks delivery; demo mode never invokes a publishing webhook", async () => {
  const { job } = await freshJob();
  await send(job.id);
  const name = `rr_${alice.id.replaceAll("-", "")}`,
    old = profiles.get(name)!;
  profiles.set(name, {
    ...old,
    social_accounts: {
      ...old.social_accounts,
      instagram: { username: "somebody-else", handle: "other" },
    },
  });
  const count = publications;
  await advance();
  assert.equal(publications, count);
  assert.equal((await getJob(request(), job.id)).status, "failed");
  profiles.set(name, old);
  process.env.DEMO_MODE = "true";
  try {
    const demo = await freshJob();
    await send(demo.job.id);
    assert.equal((await getJob(request(), demo.job.id)).status, "demo");
    assert.equal(publications, count);
  } finally {
    process.env.DEMO_MODE = "false";
  }
});
test("disconnect removes only the authenticated owner's selected network", async () => {
  await disconnect(request(), "x");
  const a = await connectionStatus(request()),
    b = await connectionStatus(request(bob));
  assert.equal(a.accounts.x?.connected, false);
  assert.equal(a.accounts.instagram?.connected, true);
  assert.equal(b.accounts.x?.connected, true);
});
test("provider receipt parsing never invents success or accepts untrusted post links", () => {
  assert.equal(
    providerDeliveries(
      {
        results: [
          {
            platform: "instagram",
            success: true,
            result: { url: "https://www.instagram.com/reel/verified/" },
          },
        ],
      },
      ["instagram"],
    )[0].url,
    "https://www.instagram.com/reel/verified/",
  );
  assert.equal(
    providerDeliveries({ status: "completed", results: [] }, ["youtube"])[0]
      .state,
    "processing",
  );
  assert.equal(
    providerDeliveries(
      {
        results: [
          {
            platform: "youtube",
            success: true,
            privacyStatus: "private",
            url: "https://www.youtube.com/watch?v=id",
          },
        ],
      },
      ["youtube"],
    )[0].state,
    "processing",
  );
  assert.equal(
    providerDeliveries(
      { results: { x: { success: true, url: "https://evil.example/post" } } },
      ["x"],
    )[0].url,
    undefined,
  );
});
test("workflow requests use expiring signed tokens instead of exposing the permanent shared secret in webhook history", () => {
  const now = Date.now(),
    value = workflowAuthorization(now);
  const [head, payload, signature] = value.slice(7).split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(data.exp, Math.floor(now / 1000) + 60);
  assert.equal(
    signature,
    createHmac("sha256", process.env.N8N_PUBLISHER_SECRET!)
      .update(`${head}.${payload}`)
      .digest("base64url"),
  );
  assert.ok(!value.includes(process.env.N8N_PUBLISHER_SECRET!));
  assert.notEqual(workflowAuthorization(now), value);
});
test("publishing workflow authenticates its webhook, consumes a server authorization and uses distinct destination copy without AI", () => {
  const flow = JSON.parse(
    readFileSync("automation/n8n/provider-publish-workflow.json", "utf8"),
  );
  assert.equal(flow.nodes[0].parameters.authentication, "jwtAuth");
  assert.match(flow.nodes[1].parameters.url, /\/authorize$/);
  assert.equal(
    flow.nodes.find(
      (n: { name: string }) =>
        n.name === "Publish video to selected destinations",
    ).retryOnFail,
    false,
  );
  const params = JSON.stringify(
    flow.nodes.find(
      (n: { name: string }) =>
        n.name === "Publish video to selected destinations",
    ).parameters.bodyParameters,
  );
  for (const field of [
    "youtube_description",
    "instagram_title",
    "x_title",
    "platform[]",
    "async_upload",
  ])
    assert.ok(params.includes(field));
  assert.ok(
    !flow.nodes.some((n: { type: string }) =>
      /agent|openai|gemini|chat/i.test(n.type),
    ),
  );
  assert.ok(!JSON.stringify(flow).includes("Apikey "));
});

test("connection workflow grants are short lived, single use and scoped to the verified creator mapping", async () => {
  const token = crypto.randomUUID();
  const row = {
    state_hash: stateHash(token),
    owner_id: bob.id,
    platform: "instagram",
    encrypted_verifier: "n8n-managed-connect-v1",
    redirect_uri: "http://127.0.0.1:3000/connect",
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  assert.ok((await bob.db.from("reelready_oauth_states").insert(row)).error);
  assert.equal(
    (await admin.from("reelready_oauth_states").insert(row)).error,
    null,
  );
  await assert.rejects(() =>
    authorizeProviderConnection({
      connectionToken: token,
      profileUsername: "another-creator",
    }),
  );
  const canonical = await authorizeProviderConnection({
    connectionToken: token,
  });
  assert.equal(canonical.profileUsername, `rr_${bob.id.replaceAll("-", "")}`);
  assert.equal(canonical.platform, "instagram");
  assert.equal(canonical.needsCreation, false);
  await assert.rejects(
    () => authorizeProviderConnection({ connectionToken: token }),
    /already used/,
  );
  const expired = crypto.randomUUID();
  await admin.from("reelready_oauth_states").insert({
    ...row,
    state_hash: stateHash(expired),
    expires_at: new Date(0).toISOString(),
  });
  await assert.rejects(
    () => authorizeProviderConnection({ connectionToken: expired }),
    /expired/,
  );
});

test("account connection workflow creates only missing profiles and returns official authorization links through the app", () => {
  const flow = JSON.parse(
    readFileSync("automation/n8n/provider-connect-workflow.json", "utf8"),
  );
  assert.equal(flow.nodes[0].parameters.authentication, "jwtAuth");
  assert.equal(
    flow.nodes[1].parameters.url,
    "http://host.docker.internal:3010/connect-authorize",
  );
  assert.ok(
    flow.nodes.some(
      (n: { name: string }) => n.name === "New creator profile needed?",
    ),
  );
  const create = flow.nodes.find(
    (n: { name: string }) => n.name === "Create creator profile",
  );
  const start = flow.nodes.find(
    (n: { name: string }) => n.name === "Start selected account connection",
  );
  assert.ok(create.parameters.jsonBody.includes("Verify creator workspace"));
  assert.ok(start.parameters.jsonBody.includes("Verify creator workspace"));
  assert.ok(!start.parameters.jsonBody.includes("$json.body.profile"));
  assert.equal(create.retryOnFail, false);
});

test("processing and retryable platform results never become terminal failures or premature successes", () => {
  for (const status of [
    "pending",
    "queued",
    "processing",
    "in_progress",
    "retryable",
    "retrying",
  ]) {
    for (const success of [false, true]) {
      const result = providerDeliveries(
        {
          status: "processing",
          results: [{ platform: "instagram", status, success }],
        },
        ["instagram"],
      )[0];
      assert.equal(result.state, "processing", `${status}: ${success}`);
      assert.equal(result.url, undefined);
    }
  }
  assert.equal(
    providerDeliveries(
      {
        status: "processing",
        results: [{ platform: "instagram", success: false }],
      },
      ["instagram"],
    )[0].state,
    "processing",
  );
  assert.equal(
    providerDeliveries(
      { results: [{ platform: "youtube", success: true, message: "Queued" }] },
      ["youtube"],
    )[0].state,
    "processing",
  );
  const permanent = providerDeliveries(
    {
      status: "processing",
      results: [
        {
          platform: "instagram",
          status: "failed",
          success: false,
          error_code: "reauth_required",
        },
      ],
    },
    ["instagram"],
  )[0];
  assert.equal(permanent.state, "failed");
  assert.match(permanent.message!, /Reconnect/);
  const quota = providerDeliveries(
    {
      status: "failed",
      results: [
        {
          platform: "instagram",
          success: false,
          error_message: "plan_limit https://internal?token=private",
        },
      ],
    },
    ["instagram"],
  )[0];
  assert.match(quota.message!, /allowance/);
  assert.doesNotMatch(quota.message!, /private|internal|token=/);
});

async function asyncJob() {
  const { job } = await freshJob();
  await send(job.id);
  await advance();
  const stored = await admin
    .from("reelready_jobs")
    .select("provider_job_id")
    .eq("id", job.id)
    .single();
  const requestId = String(stored.data!.provider_job_id).slice(8);
  return { id: job.id, requestId };
}
function finalReceipt(requestId: string, instagram = true) {
  return {
    request_id: requestId,
    status: "completed",
    results: [
      {
        platform: "youtube",
        status: "completed",
        success: true,
        post_url: "https://www.youtube.com/watch?v=fixture",
      },
      {
        platform: "instagram",
        status: instagram ? "completed" : "failed",
        success: instagram,
        post_url: instagram
          ? "https://www.instagram.com/reel/finished/"
          : undefined,
      },
    ],
  };
}

test("delayed Instagram publication stays processing, polls to success and sends the video only once", async () => {
  const job = await asyncJob(),
    count = publications;
  statusOverrides.set(job.requestId, {
    request_id: job.requestId,
    status: "processing",
    completed: 1,
    total: 2,
    results: [
      { platform: "instagram", status: "processing", success: false },
      {
        platform: "youtube",
        status: "completed",
        success: true,
        post_url: "https://www.youtube.com/watch?v=fixture",
      },
    ],
  });
  await ready(job.id);
  await advance();
  const processing = await getJob(request(), job.id);
  assert.equal(processing.status, "processing");
  assert.equal(processing.done, false);
  assert.equal(
    processing.deliveries.find((d) => d.platform === "instagram")?.state,
    "processing",
  );
  assert.equal(
    processing.deliveries.find((d) => d.platform === "youtube")?.state,
    "published",
  );
  statusOverrides.set(job.requestId, finalReceipt(job.requestId));
  await ready(job.id);
  await advance();
  assert.equal((await getJob(request(), job.id)).status, "published");
  assert.equal(publications, count);
});

test("Check delivery reconciles a late success without uploading again and enforces ownership", async () => {
  const job = await asyncJob(),
    count = publications;
  statusOverrides.set(job.requestId, finalReceipt(job.requestId, false));
  await ready(job.id);
  await advance();
  assert.equal((await getJob(request(), job.id)).status, "failed");
  statusOverrides.set(job.requestId, finalReceipt(job.requestId));
  await admin
    .from("reelready_jobs")
    .update({ updated_at: new Date(0).toISOString() })
    .eq("id", job.id);
  const reads = statusReads.length;
  await assert.rejects(() => refreshJob(request(bob), job.id), /not found/);
  assert.equal(statusReads.length, reads);
  await Promise.all([
    refreshJob(request(), job.id),
    refreshJob(request(), job.id),
  ]);
  assert.equal((await getJob(request(), job.id)).status, "published");
  assert.equal(statusReads.length, reads + 1);
  assert.equal(publications, count);
});

test("retry checks the same request first and suppresses a resend after late success or an unreadable receipt", async () => {
  for (const unreadable of [false, true]) {
    const job = await asyncJob(),
      count = publications;
    statusOverrides.set(job.requestId, finalReceipt(job.requestId, false));
    await ready(job.id);
    await advance();
    assert.equal((await getJob(request(), job.id)).status, "failed");
    if (unreadable) failedStatusReads.add(job.requestId);
    else statusOverrides.set(job.requestId, finalReceipt(job.requestId));
    const retried = await publish(
      request(alice, { action: "retry", id: job.id, confirmed: true }),
    );
    assert.equal(retried.status, 200, await retried.clone().text());
    assert.equal(
      ((await retried.json()) as { status: string }).status,
      unreadable ? "processing" : "published",
    );
    assert.equal(publications, count);
    if (unreadable) {
      const checking = await getJob(request(), job.id);
      assert.equal(
        checking.deliveries.find((d) => d.platform === "instagram")?.state,
        "processing",
      );
      assert.equal(
        checking.deliveries.find((d) => d.platform === "youtube")?.state,
        "published",
      );
    }
    const stored = await admin
      .from("reelready_jobs")
      .select("provider_job_id")
      .eq("id", job.id)
      .single();
    assert.equal(stored.data!.provider_job_id, `request:${job.requestId}`);
    if (unreadable) {
      failedStatusReads.delete(job.requestId);
      statusOverrides.set(job.requestId, finalReceipt(job.requestId));
      await ready(job.id);
      await advance();
    }
  }
});
