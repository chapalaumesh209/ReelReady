import { test } from "node:test";
import assert from "node:assert/strict";
import { xCount, characterCount, hashtagCount } from "../lib/content";
import { planInput, planSchema } from "../lib/workflow";
import { samplePlan } from "../lib/server/ai";
import { publishingKit } from "../lib/server/kits";
import { validatePublish } from "../lib/server/publishing/validation";
import {
  youtubeMetadata,
  youtubeDelivery,
} from "../lib/server/social/publishing";
import { scheduledISO, tomorrow } from "../lib/reel";
import { generateStructuredContent } from "../lib/generation";
import { validated } from "../lib/server/ai";
import { z } from "zod";
const planned = {
  input: "A reel about checking the soil in my balcony garden.",
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  timezone: "Asia/Kolkata",
  platforms: ["instagram", "youtube"] as const,
  languages: ["English"] as const,
  script: "native" as const,
};
test("planning validates bounds and demo plans are labelled, complete and fact conservative", () => {
  assert.equal(
    planInput.safeParse({
      ...planned,
      platforms: [...planned.platforms],
      languages: [...planned.languages],
    }).success,
    true,
  );
  assert.equal(
    planInput.safeParse({ ...planned, input: "x".repeat(4001) }).success,
    false,
  );
  const p = planSchema.parse(samplePlan(planned));
  assert.equal(p.sample, true);
  assert.equal(p.ideas.length, 3);
  assert.ok(
    p.ideas.every(
      (i) =>
        i.outline.length >= 3 && i.shots.length >= 4 && i.durationSeconds <= 60,
    ),
  );
  assert.match(p.schedulingNote, /not your analytics/);
});
test("IST planned times are explicit UTC instants and tomorrow defaults to 7 PM", () => {
  assert.equal(scheduledISO("2026-10-24T19:00"), "2026-10-24T13:30:00.000Z");
  assert.match(tomorrow(), /T19:00$/);
});
test("Unicode, X weighted counts and multilingual hashtags are correct", () => {
  assert.equal(characterCount("Hi 👋"), 4);
  assert.equal(xCount("https://example.com/long"), 23);
  assert.equal(xCount("👨‍👩‍👧‍👦"), 2);
  assert.equal(hashtagCount("#తెలుగు #हिन्दी #தமிழ்"), 3);
});
test("demo kits work without AI keys in English and three regional scripts, preserving edits on revision", async () => {
  const previous = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "demo";
  try {
    for (const language of ["English", "Telugu", "Hindi", "Tamil"] as const)
      for (const script of ["native", "roman"] as const) {
        const kit = await publishingKit(
          {
            mode: "after",
            input: planned.input,
            language,
            script,
            details: { voice: "", brand: "", link: "", disclosure: "" },
            instruction: "",
          },
          AbortSignal.timeout(1000),
        );
        assert.equal(kit.sample, true);
        assert.equal(kit.outputs.length, 4);
        assert.ok(kit.outputs.every((o) => o.text));
        assert.ok(!/https?:/.test(kit.outputs.find((o) => o.id === "x")!.text));
        const current = kit.outputs.map((o) => ({
          id: o.id as "instagram" | "youtubeTitle" | "youtubeDescription" | "x",
          text:
            o.id === "instagram"
              ? "My manually edited caption. Keep this detail."
              : o.text,
        }));
        const revised = await publishingKit(
          {
            mode: "after",
            input: planned.input,
            language,
            script,
            details: { voice: "", brand: "", link: "", disclosure: "" },
            instruction: "దీన్ని చిన్నగా చేయండి",
            current,
          },
          AbortSignal.timeout(1000),
        );
        assert.equal(
          revised.outputs.find((o) => o.id === "instagram")!.text,
          "My manually edited caption.",
        );
      }
  } finally {
    process.env.LLM_PROVIDER = previous;
  }
});
test("native YouTube receipts never treat processing, rejected or private videos as published", () => {
  assert.equal(
    youtubeDelivery({
      id: "owned-id",
      status: { uploadStatus: "processed", privacyStatus: "public" },
    }).state,
    "published",
  );
  assert.equal(
    youtubeDelivery({
      id: "owned-id",
      status: { uploadStatus: "uploaded", privacyStatus: "public" },
    }).state,
    "processing",
  );
  assert.equal(
    youtubeDelivery({
      id: "owned-id",
      status: { uploadStatus: "processed", privacyStatus: "private" },
    }).state,
    "processing",
  );
  assert.equal(
    youtubeDelivery({
      id: "owned-id",
      status: { uploadStatus: "rejected", privacyStatus: "private" },
    }).state,
    "failed",
  );
  assert.throws(() => youtubeDelivery({ success: true, message: "Queued" }));
});
test("AI validation retries once; OpenAI and Anthropic requests stay server side and use structured schemas", async () => {
  const old = fetch,
    env = { ...process.env };
  try {
    const schema = {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    };
    for (const provider of ["openai", "anthropic"]) {
      process.env.LLM_PROVIDER = provider;
      process.env.LLM_API_KEY = "test-only";
      process.env.LLM_MODEL = "test-model";
      let count = 0;
      globalThis.fetch = async (input, options) => {
        if (String(input).startsWith(process.env.SUPABASE_URL!))
          return old(input, options);
        count++;
        const body = JSON.parse(String(options?.body));
        assert.ok(
          String(input).startsWith(
            provider === "openai"
              ? "https://api.openai.com/"
              : "https://api.anthropic.com/",
          ),
        );
        if (provider === "openai")
          assert.equal(body.text.format.type, "json_schema");
        else assert.equal(body.tools[0].name, "reelready_result");
        const value = count === 1 ? { wrong: "shape" } : { value: "validated" };
        return Response.json(
          provider === "openai"
            ? {
                output: [
                  {
                    content: [
                      { type: "output_text", text: JSON.stringify(value) },
                    ],
                  },
                ],
              }
            : { content: [{ type: "tool_use", input: value }] },
        );
      };
      const value = await validated(
        {
          instructions: "Return JSON.",
          content: { input: "safe" },
          schema,
          signal: AbortSignal.timeout(1000),
        },
        z.object({ value: z.string() }),
      );
      assert.equal(value.value, "validated");
      assert.equal(count, 2);
    }
  } finally {
    globalThis.fetch = old;
    for (const key of ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL"]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  }
});
// Import validation helpers here so changes to supported provider fields remain covered.
void validatePublish;
void youtubeMetadata;
void generateStructuredContent;

test("slow generation retries within the longer provider window without cancelling the creator request", async () => {
  const oldFetch = fetch,
    oldTimeout = AbortSignal.timeout;
  const env = { ...process.env };
  const windows: number[] = [];
  let calls = 0;
  const parent = new AbortController();
  try {
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_API_KEY = "test-only";
    delete process.env.AI_REQUEST_TIMEOUT_MS;
    AbortSignal.timeout = (ms) => {
      windows.push(ms);
      if (ms !== 45000) return oldTimeout(ms);
      const controller = new AbortController();
      setTimeout(
        () =>
          controller.abort(new DOMException("slow provider", "TimeoutError")),
        20,
      );
      return controller.signal;
    };
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(process.env.SUPABASE_URL!))
        return oldFetch(input, init);
      calls++;
      if (calls === 1)
        return new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        });
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: '{"value":"ready"}' }] },
          },
        ],
      });
    };
    const result = await validated(
      {
        instructions: "Return JSON",
        content: {},
        schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        signal: parent.signal,
      },
      z.object({ value: z.string() }),
    );
    assert.equal(result.value, "ready");
    assert.equal(calls, 2);
    assert.ok(windows.includes(45000));
    assert.equal(parent.signal.aborted, false);
  } finally {
    globalThis.fetch = oldFetch;
    AbortSignal.timeout = oldTimeout;
    for (const key of ["LLM_PROVIDER", "LLM_API_KEY", "AI_REQUEST_TIMEOUT_MS"])
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
  }
});

test("video generation has its own window and preserves an explicit creator cancellation without retry", async () => {
  const oldFetch = fetch,
    oldTimeout = AbortSignal.timeout;
  const env = { ...process.env };
  let window = 0,
    calls = 0;
  const parent = new AbortController();
  try {
    process.env.GEMINI_API_KEY = "test-only";
    delete process.env.AI_MEDIA_TIMEOUT_MS;
    AbortSignal.timeout = (ms) => {
      if (ms === 90000) window = ms;
      return oldTimeout(ms);
    };
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(process.env.SUPABASE_URL!))
        return oldFetch(input, init);
      calls++;
      parent.abort(new DOMException("Creator cancelled", "AbortError"));
      throw init!.signal!.reason;
    };
    await assert.rejects(
      () =>
        validated(
          {
            instructions: "Review video",
            content: {},
            schema: { type: "object" },
            mediaParts: [
              {
                fileData: {
                  fileUri: "https://example.com/video",
                  mimeType: "video/mp4",
                },
              },
            ],
            signal: parent.signal,
          },
          z.object({}),
        ),
      { name: "AbortError" },
    );
    assert.equal(window, 90000);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    AbortSignal.timeout = oldTimeout;
    for (const key of ["GEMINI_API_KEY", "AI_MEDIA_TIMEOUT_MS"])
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
  }
});

test("scheduled provider fields use the exact UTC instant and receipts remain scheduled until posted", () => {
  const scheduledAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const data = {
    draftId: crypto.randomUUID(),
    platforms: ["youtube"] as Array<"youtube">,
    scheduledAt,
    instagram: "",
    youtubeTitle: "A creator reel",
    youtubeDescription: "The approved description.",
    x: "",
    language: "English" as const,
    dubbed: true,
    size: 1024,
    duration: 30,
    width: 360,
    height: 640,
  };
  validatePublish(data);
  const metadata = youtubeMetadata(data);
  assert.equal(metadata.snippet.title, data.youtubeTitle);
  assert.equal(metadata.snippet.description, data.youtubeDescription);
  assert.equal(metadata.status.privacyStatus, "public");
  assert.equal(metadata.status.containsSyntheticMedia, true);
  // Scheduling belongs to the durable worker, not an immediate cross-platform upload.
  assert.ok(!("publishAt" in metadata.status));
  assert.throws(() =>
    validatePublish({ ...data, scheduledAt: new Date(0).toISOString() }),
  );
});
