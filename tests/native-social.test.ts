import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { storageAdmin } from "../lib/supabase";
import { startOAuth, finishOAuth } from "../lib/server/social/oauth";
import { requiredScopes } from "../lib/server/social/config";
import {
  encryptSocial,
  decryptSocial,
  stateHash,
} from "../lib/server/social/crypto";
import { getAccount, saveAccount } from "../lib/server/social/accounts";
import { socialFetch } from "../lib/server/social/http";
import {
  nativeAdapters,
  type PublishContext,
  type NativeState,
} from "../lib/server/social/publishing";
import { workflowProgress } from "../lib/workflow-progress";
import { fresh } from "../lib/reel";
import { samplePlan } from "../lib/server/ai";
const env = { ...process.env },
  baseFetch = fetch,
  admin = storageAdmin();
let owner = "",
  access = "";
const request = (url: string) =>
  new Request(url, { headers: { Authorization: `Bearer ${access}` } });
before(async () => {
  assert.match(
    process.env.SUPABASE_URL || "",
    /^http:\/\/(127\.0\.0\.1|localhost):/,
  );
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const r = await db.auth.signInAnonymously();
  assert.equal(r.error, null);
  owner = r.data.user!.id;
  access = r.data.session!.access_token;
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
    "base64",
  );
  for (const prefix of ["GOOGLE", "INSTAGRAM", "X"]) {
    process.env[`${prefix}_CLIENT_ID`] = "unit-client";
    process.env[`${prefix}_CLIENT_SECRET`] = "unit-client-secret";
  }
  globalThis.fetch = (input, init) => {
    const u = new URL(String(input));
    if (!["127.0.0.1", "localhost"].includes(u.hostname))
      throw new Error(
        "Unmocked external request forbidden in native integration tests",
      );
    return baseFetch(input, init);
  };
});
after(async () => {
  globalThis.fetch = baseFetch;
  await admin.auth.admin.deleteUser(owner);
  for (const key of Object.keys(process.env))
    if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});
test("all official OAuth callbacks exchange codes server-side and persist only authenticated encrypted grants", async () => {
  const old = fetch;
  let exchanges = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https:")) return old(input, init);
    if (url.includes("/token") || url.endsWith("oauth/access_token")) {
      exchanges++;
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.ok(form.get("code"));
      if (!url.includes("instagram")) assert.ok(form.get("code_verifier"));
      if (url.includes("api.x.com"))
        return Response.json({
          access_token: "x-unit-access",
          refresh_token: "x-unit-refresh",
          expires_in: 7200,
          scope: requiredScopes.x.join(" "),
        });
      if (url.includes("instagram"))
        return Response.json({
          access_token: "ig-unit-short",
          user_id: "ig-unit-id",
          permissions: requiredScopes.instagram,
        });
      return Response.json({
        access_token: "yt-unit-access",
        refresh_token: "yt-unit-refresh",
        expires_in: 3600,
        scope: requiredScopes.youtube.join(" "),
      });
    }
    if (url.includes("graph.instagram.com/access_token"))
      return Response.json({
        access_token: "ig-unit-long",
        expires_in: 5184000,
      });
    if (url.includes("/youtube/v3/channels"))
      return Response.json({
        items: [{ id: "youtube-unit-id", snippet: { title: "Unit channel" } }],
      });
    if (url.includes("/2/users/me"))
      return Response.json({
        data: { id: "x-unit-id", username: "unit_writer" },
      });
    if (url.includes("/me?"))
      return Response.json({
        user_id: "ig-unit-id",
        username: "unit_creator",
        account_type: "BUSINESS",
      });
    throw new Error("Unexpected OAuth fixture request");
  };
  try {
    for (const platform of ["youtube", "instagram", "x"] as const) {
      const started = new URL(
        (
          await startOAuth(
            request("http://127.0.0.1:3000/api/connect/" + platform),
            platform,
          )
        ).url,
      );
      const callback = request(
        `http://127.0.0.1:3000/api/connect/callback/${platform}?state=${started.searchParams.get("state")}&code=unit-code`,
      );
      assert.equal(await finishOAuth(callback, platform), "success");
      await assert.rejects(() => finishOAuth(callback, platform));
      const saved = await admin
        .from("reelready_social_credentials")
        .select("*")
        .eq("owner_id", owner)
        .eq("platform", platform)
        .single();
      assert.equal(saved.error, null);
      assert.ok(!saved.data!.encrypted_credentials.includes("unit-access"));
      assert.ok((await getAccount(owner, platform))?.credential.scopes.length);
    }
    assert.equal(exchanges, 3);
  } finally {
    globalThis.fetch = old;
  }
});
test("expired state and insufficient permissions fail without granting account access", async () => {
  const link = new URL(
      (
        await startOAuth(request("http://127.0.0.1:3000/api/connect/x"), "x")
      ).url,
    ),
    state = link.searchParams.get("state")!;
  await admin
    .from("reelready_oauth_states")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("state_hash", stateHash(state));
  await assert.rejects(
    () =>
      finishOAuth(
        request(
          `http://127.0.0.1:3000/api/connect/callback/x?state=${state}&code=expired`,
        ),
        "x",
      ),
    /expired/,
  );
  await assert.rejects(
    () =>
      saveAccount(owner, "x", {
        accountId: "not-granted",
        name: "Test",
        credential: {
          accessToken: "test",
          expiresAt: Date.now() + 100000,
          scopes: ["users.read"],
        },
      }),
    /permissions/,
  );
});
test("encrypted state rejects tampering and platform/context substitution", () => {
  const cipher = encryptSocial({ access: "unit-secret" }, `${owner}:x`),
    raw = Buffer.from(cipher, "base64url");
  raw[raw.length - 1] ^= 1;
  assert.throws(() => decryptSocial(raw.toString("base64url"), `${owner}:x`));
  assert.throws(() => decryptSocial(cipher, `${owner}:youtube`));
  assert.deepEqual(decryptSocial(cipher, `${owner}:x`), {
    access: "unit-secret",
  });
});
test("token refresh is coalesced and preserves a rotated refresh token", async () => {
  await saveAccount(owner, "x", {
    accountId: "x-unit-id",
    name: "Unit",
    credential: {
      accessToken: "expired-unit",
      refreshToken: "old-unit-refresh",
      expiresAt: Date.now() - 1000,
      scopes: requiredScopes.x,
    },
  });
  const old = fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/2/oauth2/token")) {
      calls++;
      return Response.json({
        access_token: "new-unit-access",
        refresh_token: "rotated-unit-refresh",
        expires_in: 7200,
        scope: requiredScopes.x.join(" "),
      });
    }
    return old(input, init);
  };
  try {
    const result = await Promise.all([
      getAccount(owner, "x"),
      getAccount(owner, "x"),
    ]);
    assert.equal(calls, 1);
    assert.equal(result[0]?.credential.refreshToken, "rotated-unit-refresh");
    assert.equal(result[1]?.credential.accessToken, "new-unit-access");
  } finally {
    globalThis.fetch = old;
  }
});
test("platform egress rejects credentials in URLs, local addresses, unapproved hosts and ports", async () => {
  for (const url of [
    "http://api.x.com/2/tweets",
    "https://user:secret@api.x.com/2/tweets",
    "https://127.0.0.1/a",
    "https://attacker.example/a",
    "https://www.googleapis.com:444/a",
  ])
    await assert.rejects(() => socialFetch(url), /unsupported/);
});
function context(
  platform: "instagram" | "youtube" | "x",
  state: NativeState,
): PublishContext {
  return {
    platform,
    state,
    account: {
      accountId: "unit-id",
      name: "Unit",
      credential: {
        accessToken: "unit-access",
        expiresAt: Date.now() + 3600000,
        scopes: requiredScopes[platform],
      },
    },
    bytes: 32,
    publicURL: "https://media.example/video.mp4",
    chunk: async () => new Uint8Array(32),
    checkpoint: async () => {},
    data: {
      draftId: crypto.randomUUID(),
      platforms: [platform],
      scheduledAt: null,
      instagram: "My approved caption",
      youtubeTitle: "My approved title",
      youtubeDescription: "My approved description",
      x: "My approved post",
      language: "English",
      dubbed: false,
      size: 32,
      duration: 8,
      width: 360,
      height: 640,
    },
  };
}
test("Instagram processing and unconfirmed publication never create a fake Published receipt", async () => {
  const old = fetch;
  let commits = 0,
    status = "IN_PROGRESS";
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("graph.instagram.com")) {
      if (init?.method === "POST") commits++;
      return Response.json({ status_code: status });
    }
    return old(input, init);
  };
  try {
    const c = context("instagram", { mediaId: "unit-container" });
    assert.equal(
      (await nativeAdapters.instagram.step(c)).delivery.state,
      "processing",
    );
    assert.equal(commits, 0);
    status = "PUBLISHED";
    const uncertain = await nativeAdapters.instagram.step(c);
    assert.equal(uncertain.delivery.state, "processing");
    assert.equal(uncertain.state.uncertain, true);
    assert.equal(commits, 0);
  } finally {
    globalThis.fetch = old;
  }
});
test("YouTube rejects an untrusted resumable session before video bytes or credentials reach it", async () => {
  const old = fetch;
  globalThis.fetch = async (input, init) =>
    String(input).includes("uploadType=resumable")
      ? new Response(null, {
          headers: { location: "https://attacker.example/collect" },
        })
      : old(input, init);
  try {
    await assert.rejects(
      () => nativeAdapters.youtube.step(context("youtube", {})),
      /unsupported/,
    );
  } finally {
    globalThis.fetch = old;
  }
});
test("X waits for successful video processing before creating a post and uses actual byte progress", async () => {
  const old = fetch;
  let commits = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("api.x.com/2/media/upload"))
      return Response.json({
        data: { processing_info: { state: "pending", check_after_secs: 15 } },
      });
    if (String(input).endsWith("/2/tweets")) {
      commits++;
      return Response.json({ data: { id: "must-not-happen" } });
    }
    return old(input, init);
  };
  try {
    const r = await nativeAdapters.x.step(
      context("x", { mediaId: "12345", phase: "processing" }),
    );
    assert.equal(r.delivery.state, "processing");
    assert.equal(commits, 0);
    assert.equal(r.delay, 15);
  } finally {
    globalThis.fetch = old;
  }
});
test("workflow completion follows saved data and never follows a clicked step number", () => {
  const draft = fresh();
  draft.step = 5;
  assert.deepEqual(workflowProgress(draft).completed, [
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  draft.input =
    "A quiet original waveform animation with no speech or product claims.";
  draft.plan = samplePlan({
    input: draft.input,
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    platforms: draft.platforms,
    languages: draft.languages,
  });
  draft.planSignature = JSON.stringify([
    draft.input,
    draft.scheduledLocal,
    draft.platforms,
    draft.languages,
    draft.script,
  ]);
  assert.equal(workflowProgress(draft).completed[0], true);
  draft.input += " Changed.";
  assert.equal(workflowProgress(draft).attention[0], true);
});

test("disconnect revokes only the owned platform grant and erases its encrypted credential", async () => {
  const { disconnect } = await import("../lib/server/connections");
  const old = fetch;
  let revokes = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/2/oauth2/revoke")) {
      revokes++;
      assert.equal(
        new URLSearchParams(String(init?.body)).get("token"),
        "rotated-unit-refresh",
      );
      return new Response(null, { status: 200 });
    }
    return old(input, init);
  };
  try {
    assert.equal(
      (
        await disconnect(
          request("http://127.0.0.1:3000/api/connect/disconnect"),
          "x",
        )
      ).revoked,
      true,
    );
    assert.equal(revokes, 1);
    assert.equal(await getAccount(owner, "x"), null);
    assert.ok(await getAccount(owner, "youtube"));
  } finally {
    globalThis.fetch = old;
  }
});

test("publication admission is atomic, capped, service-only and never claims a future schedule early", async () => {
  const ids: string[] = [],
    pool = `cap-test-${crypto.randomUUID()}`;
  try {
    for (let i = 0; i < 3; i++) {
      const reel = crypto.randomUUID(),
        id = crypto.randomUUID();
      ids.push(id);
      assert.equal(
        (
          await admin
            .from("reelready_reels")
            .insert({ id: reel, owner_id: owner, state: {} })
        ).error,
        null,
      );
      assert.equal(
        (
          await admin.from("reelready_jobs").insert({
            id,
            owner_id: owner,
            reel_id: reel,
            idempotency_key: id,
            is_demo: false,
            status: "pending",
            scheduled_at: new Date(Date.now() + 86400000).toISOString(),
            payload: {},
          })
        ).error,
        null,
      );
      await admin.from("reelready_targets").insert({
        job_id: id,
        owner_id: owner,
        platform: "x",
        caption: "Unit test",
        status: "pending",
      });
    }
    const queue = (id: string, userLimit = 1, globalLimit = 1000) =>
      admin.rpc("reelready_queue_publication", {
        p_job: id,
        p_owner: owner,
        p_pool: pool,
        p_user_limit: userLimit,
        p_global_limit: globalLimit,
      });
    assert.equal((await queue(ids[0])).data, true);
    assert.match((await queue(ids[1])).error?.message || "", /USER_CAP/);
    assert.match(
      (await queue(ids[2], 100, 0)).error?.message || "",
      /QUEUE_CAP/,
    );
    const target = await admin
      .from("reelready_targets")
      .select("status")
      .eq("job_id", ids[0])
      .single();
    assert.equal(target.data!.status, "scheduled");
    const claim = await admin.rpc("reelready_claim_publication", {
      p_pool: pool,
      p_worker: "unit-worker",
    });
    assert.deepEqual(claim.data, []);
    const db = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${access}` } },
        auth: { persistSession: false },
      },
    );
    assert.ok(
      (
        await db.rpc("reelready_claim_publication", {
          p_pool: pool,
          p_worker: "forged-worker",
        })
      ).error,
    );
  } finally {
    for (const id of ids)
      await admin.from("reelready_jobs").delete().eq("id", id);
  }
});

test("an in-flight token refresh cannot overwrite a newly reconnected account", async () => {
  await saveAccount(owner, "x", {
    accountId: "old-account",
    name: "Old",
    credential: {
      accessToken: "expired",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1000,
      scopes: requiredScopes.x,
    },
  });
  const old = fetch;
  let signalStarted: () => void = () => {},
    finish: (r: Response) => void = () => {};
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/2/oauth2/token")) {
      signalStarted();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return old(input, init);
  };
  try {
    const pending = getAccount(owner, "x");
    // Observe rejection immediately to avoid an unhandled promise during the deliberate race.
    const rejected = assert.rejects(pending, /changed/);
    await started;
    await saveAccount(owner, "x", {
      accountId: "new-account",
      name: "New",
      credential: {
        accessToken: "new-account-access",
        refreshToken: "new-account-refresh",
        expiresAt: Date.now() + 3600000,
        scopes: requiredScopes.x,
      },
    });
    finish(
      Response.json({
        access_token: "stale-refresh-result",
        refresh_token: "stale-refresh",
        expires_in: 7200,
        scope: requiredScopes.x.join(" "),
      }),
    );
    await rejected;
    const current = await getAccount(owner, "x");
    assert.equal(current?.accountId, "new-account");
    assert.equal(current?.credential.accessToken, "new-account-access");
  } finally {
    globalThis.fetch = old;
  }
});

test("an expired grant without a refresh token requires reconnection rather than a fake temporary success", async () => {
  const { connectionStatus } = await import("../lib/server/connections");
  const google = process.env.GOOGLE_CLIENT_ID,
    instagram = process.env.INSTAGRAM_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.INSTAGRAM_CLIENT_ID;
  try {
    await saveAccount(owner, "x", {
      accountId: "expired-account",
      name: "Expired",
      credential: {
        accessToken: "expired-unit-access",
        expiresAt: Date.now() - 1000,
        scopes: requiredScopes.x,
      },
    });
    const status = await connectionStatus(
      request("http://127.0.0.1:3000/api/connect/status"),
    );
    assert.equal(status.accounts.x?.connected, false);
    assert.equal(status.accounts.x?.reauth, true);
    assert.equal(status.accounts.x?.unavailable, false);
  } finally {
    if (google) process.env.GOOGLE_CLIENT_ID = google;
    if (instagram) process.env.INSTAGRAM_CLIENT_ID = instagram;
  }
});

test("native upload initialization uses the stored video's real MIME type", async () => {
  const old = fetch;
  let checked = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("uploadType=resumable")) {
      assert.equal(
        new Headers(init?.headers).get("X-Upload-Content-Type"),
        "video/webm",
      );
      checked++;
      return new Response(null, {
        headers: { location: "https://www.googleapis.com/upload/unit-session" },
      });
    }
    if (String(input).endsWith("/2/media/upload/initialize")) {
      assert.equal(JSON.parse(String(init?.body)).media_type, "video/webm");
      checked++;
      return Response.json({ data: { id: "12345" } });
    }
    return old(input, init);
  };
  try {
    for (const platform of ["youtube", "x"] as const) {
      const c = { ...context(platform, {}), mime: "video/webm" };
      assert.equal(
        (await nativeAdapters[platform].step(c)).delivery.state,
        "processing",
      );
    }
    assert.equal(checked, 2);
  } finally {
    globalThis.fetch = old;
  }
});
