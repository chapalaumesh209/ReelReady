import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/generate/route";
import {
  samples,
  definitions,
  exampleKit,
  characterCount,
  hashtagCount,
  xCount,
} from "../lib/content";
const base = {
  mode: "after",
  input:
    "I filmed a video about growing basil on my balcony. I watered the soil and showed the new leaves.",
  language: "English",
  script: "native",
  details: { voice: "", brand: "", link: "", disclosure: "" },
};
const request = (data: unknown) =>
  new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });

test("validation rejects incomplete, unsupported and unsafe link input", async () => {
  for (const body of [
    { ...base, input: "hi" },
    { ...base, language: "unsupported" },
    { ...base, details: { ...base.details, link: "javascript:alert(1)" } },
  ])
    assert.equal((await POST(request(body))).status, 400);
  const cross = new Request("http://localhost/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://another.example",
    },
    body: JSON.stringify(base),
  });
  assert.equal((await POST(cross)).status, 403);
});
test("unconfigured service is honest and samples are only for the exact built-in input", async () => {
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal((await POST(request(base))).status, 503);
    const response = await POST(request({ ...base, input: samples.after }));
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      sample: boolean;
      outputs: unknown[];
    };
    assert.equal(result.sample, true);
    assert.equal(result.outputs.length, 4);
    assert.equal(
      (
        await POST(
          request({
            ...base,
            input: samples.after,
            details: { ...base.details, brand: "Custom brand" },
          }),
        )
      ).status,
      503,
    );
  } finally {
    if (key) process.env.OPENAI_API_KEY = key;
  }
});
test("all example languages and scripts produce complete distinct kits", () => {
  for (const mode of ["before", "after"] as const)
    for (const language of ["English", "Telugu", "Hindi"] as const)
      for (const script of ["native", "roman"] as const) {
        const kit = exampleKit(mode, language, script);
        assert.deepEqual(
          kit.outputs.map((o) => o.id),
          definitions[mode].map((o) => o.id),
        );
        assert.ok(kit.outputs.every((o) => o.text.length > 0));
        if (language !== "English") {
          const regex =
            language === "Telugu" ? /[\u0C00-\u0C7F]/ : /[\u0900-\u097F]/;
          assert.equal(
            regex.test(kit.outputs.map((o) => o.text).join("")),
            script === "native",
          );
        }
      }
});
test("Unicode, links, emoji, and multilingual hashtags are counted correctly", () => {
  assert.equal(characterCount("Hi 👋"), 4);
  assert.equal(hashtagCount("#తెలుగు #हिन्दी #Mango"), 3);
  assert.equal(xCount("https://example.com/a-long-link"), 23);
  assert.equal(xCount("👨‍👩‍👧‍👦"), 2);
});
test("provider results are validated and failures never become a fabricated kit", async () => {
  const original = globalThis.fetch;
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "unit-test-not-a-real-key";
  try {
    let upstream: Record<string, unknown> = {};
    globalThis.fetch = async (_url, options) => {
      upstream = JSON.parse(String(options?.body));
      return Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  clarification: "",
                  outputs: definitions.after.map((o) => ({
                    id: o.id,
                    text: "Valid supplied facts.",
                  })),
                }),
              },
            ],
          },
        ],
      });
    };
    const result = await POST(request(base));
    assert.equal(result.status, 200);
    assert.equal(
      ((await result.json()) as { outputs: unknown[] }).outputs.length,
      4,
    );
    assert.equal(upstream.store, false);
    assert.ok(
      String(upstream.instructions).includes("OUTPUT LANGUAGE: English"),
    );
    globalThis.fetch = async () =>
      Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: '{"clarification":"","outputs":[]}',
              },
            ],
          },
        ],
      });
    assert.equal((await POST(request(base))).status, 502);
    globalThis.fetch = async () =>
      Response.json({ error: "unavailable" }, { status: 429 });
    assert.equal((await POST(request(base))).status, 503);
    globalThis.fetch = async () =>
      Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  clarification: "What is the topic of your video?",
                  outputs: [],
                }),
              },
            ],
          },
        ],
      });
    const clar = await POST(request(base));
    assert.equal(clar.status, 200);
    assert.ok(
      ((await clar.json()) as { clarification: string }).clarification.includes(
        "topic",
      ),
    );
  } finally {
    globalThis.fetch = original;
    if (key) process.env.OPENAI_API_KEY = key;
    else delete process.env.OPENAI_API_KEY;
  }
});
