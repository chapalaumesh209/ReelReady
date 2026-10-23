import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify, capability, session } from "../lib/server";
import {
  deliveries,
  publishingFields,
  profileName,
  validatePublish,
  connections,
} from "../lib/upload-post";
import { videoStream } from "../lib/media-server";
import { POST as upload } from "../app/api/publish/route";
import type { PublishInput } from "../lib/workflow";
const payload: PublishInput = {
  draftId: "c93c4553-1945-4af5-bf90-3cd77c10d48e",
  platforms: ["instagram", "youtube", "x"],
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  instagram: "A bowl of mango and yogurt.",
  youtubeTitle: "Mango bowl",
  youtubeDescription: "A simple breakfast.",
  x: "A mango breakfast bowl.",
  language: "English",
  dubbed: true,
  size: 32,
  duration: 30,
  width: 360,
  height: 640,
};
const visitor = "c93c4553-1945-4af5-bf90-3cd77c10d48e";
test("signed capabilities reject tampering, wrong purposes and other visitor sessions", async () => {
  process.env.SESSION_SECRET = "test-signing-secret";
  const token = await sign({ visitor }, "video", 60);
  assert.equal((await verify(token, "video")).visitor, visitor);
  await assert.rejects(() => verify(token.slice(0, -4) + "xxxx", "video"));
  await assert.rejects(() => verify(token, "delivery"));
  const cookie = await sign(
    { id: "b93c4553-1945-4af5-bf90-3cd77c10d48e" },
    "session",
    60,
  );
  await assert.rejects(() =>
    capability(
      new Request("http://localhost", {
        headers: { cookie: `rr_session=${cookie}` },
      }),
      token,
      "video",
    ),
  );
  const expired = await sign({ visitor }, "video", -1);
  await assert.rejects(() => verify(expired, "video"));
});
test("session cookies are private and secure over HTTPS; cross-origin writes rejected", async () => {
  const s = await session(new Request("https://example.test"), true);
  assert.match(
    s.cookie || "",
    /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/,
  );
  await assert.rejects(() =>
    session(
      new Request("https://example.test", {
        headers: { origin: "https://evil.test" },
      }),
      true,
    ),
  );
});
test("provider results never treat skipped, retrying, queued or partial deliveries as published", () => {
  const data = deliveries(
    {
      status: "completed",
      results: [
        {
          platform: "instagram",
          success: true,
          status: "skipped",
          skipped: true,
        },
        { platform: "youtube", success: true, message: "Queued" },
        { platform: "x", success: false, error: "Reconnect" },
      ],
    },
    ["instagram", "youtube", "x"],
    null,
  );
  assert.deepEqual(
    data.map((d) => d.state),
    ["skipped", "processing", "failed"],
  );
  assert.equal(
    deliveries(
      {
        results: {
          instagram: { success: true, url: "https://instagram.com/reel/demo" },
        },
      },
      ["instagram"],
      null,
    )[0].state,
    "published",
  );
  assert.equal(
    deliveries({ job_id: "real-job" }, ["instagram"], payload.scheduledAt)[0]
      .state,
    "scheduled",
  );
  assert.equal(
    deliveries({ status: "failed", message: "No activity" }, ["x"], null)[0]
      .state,
    "failed",
  );
});
test("publishing validation and fields preserve timezone, platform text and synthetic voice disclosure", () => {
  validatePublish(payload);
  assert.throws(() =>
    validatePublish({ ...payload, scheduledAt: new Date(0).toISOString() }),
  );
  assert.throws(() => validatePublish({ ...payload, x: "x".repeat(281) }));
  assert.throws(() => validatePublish({ ...payload, width: 640, height: 360 }));
  const f = publishingFields(payload, visitor, "request-id");
  assert.ok(f.some(([k, v]) => k === "user" && v === profileName(visitor)));
  assert.ok(
    f.some(([k, v]) => k === "scheduled_date" && v === payload.scheduledAt),
  );
  assert.ok(f.some(([k, v]) => k === "containsSyntheticMedia" && v === "true"));
  assert.ok(!f.some(([k]) => k === "timezone"));
});
test("raw video stream validates file signature, size and actual bytes", async () => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  const r = new Request("http://localhost/api/video", {
    method: "POST",
    headers: { "Content-Type": "video/mp4", "X-File-Size": "32" },
    body: bytes,
  });
  const data = await videoStream(r);
  assert.equal((await new Response(data.stream).arrayBuffer()).byteLength, 32);
  await assert.rejects(() =>
    videoStream(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "video/mp4", "X-File-Size": "32" },
        body: new Uint8Array(32),
      }),
    ),
  );
  await assert.rejects(() =>
    videoStream(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "Content-Type": "video/mp4",
          "X-File-Size": String(81 * 1024 * 1024),
        },
        body: bytes,
      }),
    ),
  );
});
test("connection reads only the current anonymous profile and suppresses provider secrets", async () => {
  const old = globalThis.fetch;
  process.env.UPLOAD_POST_API_KEY = "private-test-key";
  let path = "";
  globalThis.fetch = async (input) => {
    path = String(input);
    return Response.json({
      profile: {
        social_accounts: {
          instagram: {
            handle: "foodcreator",
            username: "id",
            access_token: "secret",
            reauth_required: false,
          },
          x: { handle: "old", reauth_required: true },
          youtube: null,
        },
      },
    });
  };
  try {
    const result = await connections(visitor);
    assert.ok(path.endsWith(profileName(visitor)));
    assert.equal(result.accounts.instagram?.name, "foodcreator");
    assert.equal(result.accounts.x?.connected, false);
    assert.ok(!JSON.stringify(result).includes("secret"));
  } finally {
    globalThis.fetch = old;
  }
});
test("publishing retries get the same immutable request identifier without accepting an arbitrary owner profile", async () => {
  const cookie = await sign({ id: visitor }, "session", 60),
    old = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      profile: {
        social_accounts: Object.fromEntries(
          ["instagram", "youtube", "x"].map((p) => [p, { handle: "creator" }]),
        ),
      },
    });
  const req = () =>
    new Request("http://localhost/api/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `rr_session=${cookie}`,
      },
      body: JSON.stringify({ ...payload, user: "owner-profile" }),
    });
  try {
    const a = await upload(req()),
      b = await upload(req());
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const one = (await a.json()) as { token: string },
      two = (await b.json()) as { token: string };
    const c = await verify(one.token, "publish"),
      d = await verify(two.token, "publish");
    assert.equal(c.requestId, d.requestId);
    assert.equal(c.visitor, visitor);
    assert.ok(!("user" in (c.data as object)));
  } finally {
    globalThis.fetch = old;
    delete process.env.UPLOAD_POST_API_KEY;
  }
});

test("retryable provider failure remains processing while the provider retries", () => {
  assert.equal(
    deliveries(
      { results: [{ platform: "x", status: "retryable", success: false }] },
      ["x"],
      null,
    )[0].state,
    "processing",
  );
});

test("signed publishing upload streams exact video and captions, then tracks the real scheduled job", async () => {
  process.env.UPLOAD_POST_API_KEY = "private-test-key";
  const old = globalThis.fetch,
    cookie = await sign({ id: visitor }, "session", 60);
  const cap = await sign(
    { visitor, data: payload, requestId: "stable-request-id" },
    "publish",
    60,
  );
  const video = new Uint8Array(32);
  video.set(new TextEncoder().encode("ftyp"), 4);
  const packed = new Blob([JSON.stringify({ token: cap }) + "\n", video]);
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), "https://api.upload-post.com/api/upload");
    assert.equal(
      (options?.headers as Record<string, string>)["Idempotency-Key"],
      "stable-request-id",
    );
    const request = new Request(String(input), {
      ...options,
      duplex: "half",
    } as unknown as RequestInit);
    const form = await request.formData();
    assert.equal(form.get("user"), profileName(visitor));
    assert.equal(form.get("instagram_title"), payload.instagram);
    assert.equal(form.get("scheduled_date"), payload.scheduledAt);
    assert.deepEqual(form.getAll("platform[]"), ["instagram", "youtube", "x"]);
    assert.equal(
      (await (form.get("video") as File).arrayBuffer()).byteLength,
      32,
    );
    return Response.json(
      { success: true, job_id: "scheduled-job-id" },
      { status: 202 },
    );
  };
  try {
    const result = await upload(
      new Request("http://localhost/api/publish", {
        method: "POST",
        headers: {
          cookie: `rr_session=${cookie}`,
          "Content-Type": "application/x-reelready-video",
          "X-Video-Type": "video/mp4",
          "X-File-Size": "32",
        },
        body: packed,
      }),
    );
    assert.equal(result.status, 200);
    const job = (await result.json()) as {
      token: string;
      deliveries: Array<{ state: string }>;
    };
    assert.deepEqual(
      job.deliveries.map((d) => d.state),
      ["scheduled", "scheduled", "scheduled"],
    );
    const signed = await verify(job.token, "delivery");
    assert.equal(signed.jobId, "scheduled-job-id");
    assert.equal(signed.visitor, visitor);
  } finally {
    globalThis.fetch = old;
    delete process.env.UPLOAD_POST_API_KEY;
  }
});

test('social service failure still establishes the anonymous session needed for AI work',async()=>{
 const {GET}=await import('../app/api/connections/route');const old=globalThis.fetch;process.env.UPLOAD_POST_API_KEY='private-test-key';
 globalThis.fetch=async()=>new Response('Unavailable',{status:503});
 try{const response=await GET(new Request('https://reelready.test/api/connections'));assert.equal(response.status,502);assert.match(response.headers.get('set-cookie')||'',/rr_session=.*HttpOnly/);}finally{globalThis.fetch=old;delete process.env.UPLOAD_POST_API_KEY;}
});
