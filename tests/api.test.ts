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
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
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
    if (key) process.env.GEMINI_API_KEY = key;
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
test("Gemini results are validated and failures never become a fabricated kit", async () => {
  const original = globalThis.fetch;
  const key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "unit-test-not-a-real-key";
  const providerBody = (result: unknown) => ({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(result) }] },
      },
    ],
  });
  try {
    let upstream: Record<string, unknown> = {};
    let destination = "";
    globalThis.fetch = async (url, options) => {
      destination = String(url);
      upstream = JSON.parse(String(options?.body));
      return Response.json(
        providerBody({
          clarification: "",
          outputs: definitions.after.map((o) => ({
            id: o.id,
            text: "Valid supplied facts.",
          })),
        }),
      );
    };
    const response = await POST(request(base));
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { outputs: unknown[] }).outputs.length,
      4,
    );
    assert.ok(
      destination.startsWith("https://generativelanguage.googleapis.com/"),
    );
    assert.ok(!destination.includes("unit-test"));
    assert.ok(
      JSON.stringify(upstream.systemInstruction).includes(
        "OUTPUT LANGUAGE: English",
      ),
    );
    assert.equal(
      (upstream.generationConfig as { responseMimeType: string })
        .responseMimeType,
      "application/json",
    );
    globalThis.fetch = async () =>
      Response.json(providerBody({ clarification: "", outputs: [] }));
    assert.equal((await POST(request(base))).status, 502);
    globalThis.fetch = async () =>
      Response.json({ error: "unavailable" }, { status: 429 });
    assert.equal((await POST(request(base))).status, 503);
    globalThis.fetch = async () =>
      Response.json(
        providerBody({
          clarification: "What is the topic of your video?",
          outputs: [],
        }),
      );
    const clar = await POST(request(base));
    assert.equal(clar.status, 200);
    assert.ok(
      ((await clar.json()) as { clarification: string }).clarification.includes(
        "topic",
      ),
    );
    globalThis.fetch = async () =>
      Response.json({ candidates: [{ finishReason: "SAFETY" }] });
    assert.equal((await POST(request(base))).status, 422);
  } finally {
    globalThis.fetch = original;
    if (key) process.env.GEMINI_API_KEY = key;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("supplied disclosures and URLs survive rewriting; overlong posts get a bounded repair", async () => {
  const original = globalThis.fetch;
  const key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "unit-test-not-a-real-key";
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    clarification: "",
                    outputs: definitions.after.map((o) => ({
                      id: o.id,
                      text:
                        o.id === "x" && calls === 1
                          ? "word ".repeat(80)
                          : "Basil on my balcony.",
                    })),
                  }),
                },
              ],
            },
          },
        ],
      });
    };
    const response = await POST(
      request({
        ...base,
        details: {
          ...base.details,
          link: "https://example.com",
          disclosure: "#ad — supplied disclosure",
        },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    const kit = (await response.json()) as {
      outputs: Array<{ id: string; text: string; warning?: string }>;
    };
    for (const o of kit.outputs.filter((o) => o.id !== "youtubeTitle")) {
      assert.ok(o.text.includes("https://example.com"));
      assert.ok(o.text.includes("#ad — supplied disclosure"));
      assert.equal(o.warning, undefined);
    }
  } finally {
    globalThis.fetch = original;
    if (key) process.env.GEMINI_API_KEY = key;
    else delete process.env.GEMINI_API_KEY;
  }
});
