import { test } from "node:test";
import assert from "node:assert/strict";
import { publishingKit, kitInput } from "../lib/server/kits";
import { hashtagCount, isPlaceholderKit } from "../lib/content";
const brief = {
  mode: "after" as const,
  professional: true,
  input:
    "A creator filmed cold brew at a cafe in Hyderabad. The reel shows pouring the coffee and the creator's opinion that it tastes smooth. No price or offer was provided.",
  language: "English" as const,
  script: "native" as const,
  details: {
    voice: "I like short, conversational captions.",
    brand: "Demo creator",
    link: "https://example.com/reel",
    disclosure: "#ad",
    audience: "Coffee drinkers looking for a local cafe",
    location: "Hyderabad",
    goal: "Save this cafe idea",
    keywords: "Hyderabad cold brew, coffee",
  },
};
const generated = () => ({
  outputs: [
    {
      id: "instagram",
      text: "Hyderabad cold brew, poured slowly and reviewed honestly. I found this one smooth. Save this coffee idea for later. #ColdBrew #Hyderabad #CoffeeReview",
    },
    {
      id: "youtubeTitle",
      text: "Hyderabad cold brew: an honest coffee review",
    },
    {
      id: "youtubeDescription",
      text: "Hyderabad cold brew, from the pour to my first impression. I thought it tasted smooth. Save this cafe idea. #ColdBrew #Hyderabad",
    },
    {
      id: "x",
      text: "Hyderabad cold brew: the pour looked good and I found the coffee smooth. One for the cafe list. #ColdBrew",
    },
  ],
  discovery: {
    primaryKeyword: "Hyderabad cold brew",
    supportingKeywords: ["Hyderabad coffee review", "cold brew coffee"],
    searchIntent: "Find a local cold brew review before choosing a cafe.",
    location: "Hyderabad",
  },
});
async function mock(
  callback: (calls: {
    n: number;
    reviews: number;
    prompts: string[];
  }) => Promise<void>,
  produce: (n: number) => ReturnType<typeof generated> = () => generated(),
  review: (n: number) => { grounded: boolean; issues: string[] } = () => ({
    grounded: true,
    issues: [],
  }),
) {
  const oldFetch = globalThis.fetch,
    env = { ...process.env },
    calls = { n: 0, reviews: 0, prompts: [] as string[] };
  process.env.LLM_PROVIDER = "demo";
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(process.env.SUPABASE_URL!))
      return oldFetch(input, init);
    assert.ok(
      String(input).startsWith("https://generativelanguage.googleapis.com/"),
    );
    const body = JSON.parse(String(init?.body));
    const checking = JSON.stringify(body.systemInstruction).includes(
      "MATERIAL FACT CHECK",
    );
    let result;
    if (checking) {
      calls.reviews++;
      result = review(calls.reviews);
    } else {
      calls.n++;
      calls.prompts.push(JSON.stringify(body));
      result = produce(calls.n);
    }
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(result) }] },
        },
      ],
    });
  };
  try {
    await callback(calls);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ["LLM_PROVIDER", "GEMINI_API_KEY"])
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
  }
}
test("existing creator details remain valid and optional marketing fields are bounded", () => {
  const parsed = kitInput.parse({
    ...brief,
    professional: undefined,
    details: { voice: "", brand: "", link: "", disclosure: "" },
  });
  assert.equal(parsed.details.location, "");
  assert.equal(parsed.professional, false);
  assert.equal(
    kitInput.safeParse({
      ...brief,
      details: { ...brief.details, location: "x".repeat(151) },
    }).success,
    false,
  );
});
test("professional generation uses the configured Gemini key with a grounded agency brief and honest discovery notes", async () => {
  await mock(async (calls) => {
    const kit = await publishingKit(brief, AbortSignal.timeout(1000));
    assert.equal(kit.sample, false);
    assert.equal(kit.discovery!.liveTrendsChecked, false);
    assert.equal(kit.discovery!.primaryKeyword, "Hyderabad cold brew");
    assert.equal(calls.n, 1);
    assert.match(calls.prompts[0], /NO live trend research/);
    assert.match(
      calls.prompts[0],
      /Current manually edited outputs are the authoritative starting point/,
    );
    assert.match(calls.prompts[0], /Coffee drinkers/);
    assert.match(calls.prompts[0], /Hyderabad/);
    assert.ok(hashtagCount(kit.outputs[0].text) <= 5);
    assert.ok(kit.outputs[0].text.includes("#ad"));
    assert.ok(kit.outputs[2].text.includes(brief.details.link));
    assert.ok(!kit.outputs[3].text.includes("https://"));
    assert.ok(hashtagCount(kit.outputs[3].text) <= 2);
  });
});
test("natural search-phrase variants remain live captions; overstuffed hashtags are rejected", async () => {
  await mock(
    async (calls) => {
      const kit = await publishingKit(brief, AbortSignal.timeout(1000));
      assert.equal(kit.sample, false);
      assert.equal(calls.n, 1);
      assert.equal(calls.reviews, 1);
      assert.equal(
        kit.outputs.find((o) => o.id === "youtubeTitle")?.text,
        "A cold brew review from Hyderabad",
      );
    },
    (n) => {
      const value = generated();
      if (n === 1)
        value.outputs[1].text = "A cold brew review from Hyderabad";
      return value;
    },
  );
  await mock(
    async (calls) => {
      assert.equal(
        (await publishingKit(brief, AbortSignal.timeout(1000))).sample,
        true,
      );
      assert.equal(calls.n, 2);
    },
    () => {
      const value = generated();
      value.outputs[0].text += " #Extra1 #Extra2 #Extra3";
      return value;
    },
  );
});
test("one format repair receives the failed output and specific contract errors", async () => {
  await mock(
    async (calls) => {
      const kit = await publishingKit(brief, AbortSignal.timeout(2000));
      assert.equal(kit.sample, false);
      assert.equal(calls.n, 2);
      assert.equal(calls.reviews, 1);
      const repair = JSON.parse(calls.prompts[1]);
      const content = JSON.parse(repair.contents[0].parts[0].text);
      assert.equal(content.input, brief.input);
      assert.equal(content.validationFeedback.previousResult.outputs[3].id, "instagram");
      assert.match(
        JSON.stringify(content.validationFeedback.issues),
        /Exactly one output per platform field/,
      );
      assert.match(repair.systemInstruction.parts[0].text, /VALIDATION REPAIR/);
    },
    (n) => {
      const value = generated();
      if (n === 1) value.outputs[3].id = "instagram";
      return value;
    },
  );
});

test("persistent malformed live captions return a clear error without overwriting manual text", async () => {
  const previous = process.env.ALLOW_SAMPLE_OUTPUT;
  try {
    await mock(
      async (calls) => {
        process.env.ALLOW_SAMPLE_OUTPUT = "false";
        const current = kitInput.parse({
          ...brief,
          current: generated().outputs,
        }).current!;
        const saved = structuredClone(current);
        await assert.rejects(
          () => publishingKit({ ...brief, current }, AbortSignal.timeout(2000)),
          (error: unknown) =>
            error instanceof Error &&
            "code" in error &&
            error.code === "CAPTION_FORMAT_INVALID",
        );
        assert.equal(calls.n, 2);
        assert.equal(calls.reviews, 0);
        assert.deepEqual(current, saved);
      },
      () => {
        const value = generated();
        value.outputs[3].id = "instagram";
        return value;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.ALLOW_SAMPLE_OUTPUT;
    else process.env.ALLOW_SAMPLE_OUTPUT = previous;
  }
});
test("caption revisions carry current manual facts without enforcing the new-caption keyword formula", async () => {
  const current = generated().outputs.map((o) => ({
    ...o,
    id: o.id as "instagram" | "youtubeTitle" | "youtubeDescription" | "x",
    text:
      o.id === "instagram"
        ? "My manual detail: I went with my sister."
        : o.text,
  }));
  await mock(
    async (calls) => {
      const kit = await publishingKit(
        {
          ...brief,
          current,
          instruction:
            "Shorten the other lines; retain my detail about my sister.",
        },
        AbortSignal.timeout(1000),
      );
      assert.match(calls.prompts[0], /I went with my sister/);
      assert.match(kit.outputs[0].text, /my sister/);
    },
    () => ({ ...generated(), outputs: current }),
  );
});

test("independent editorial review retries unsupported advice once and fails safely if it persists", async () => {
  await mock(
    async (calls) => {
      await publishingKit(brief, AbortSignal.timeout(1000));
      assert.equal(calls.n, 2);
      assert.equal(calls.reviews, 2);
      assert.match(calls.prompts[1], /Unsupported price/);
    },
    () => generated(),
    (n) =>
      n === 1
        ? { grounded: false, issues: ["Unsupported price: remove it."] }
        : { grounded: true, issues: [] },
  );
  await mock(
    async (calls) => {
      const kit = await publishingKit(brief, AbortSignal.timeout(1000));
      assert.equal(kit.sample, true);
      assert.ok(!kit.outputs.some((o) => /invented tutorial/.test(o.text)));
      assert.equal(calls.n, 2);
      assert.equal(calls.reviews, 2);
    },
    () => generated(),
    () => ({ grounded: false, issues: ["Remove invented tutorial steps."] }),
  );
});

test("rewriting a selected output preserves every unrelated manual field exactly", async () => {
  const old = process.env.LLM_PROVIDER,
    oldKey = process.env.GEMINI_API_KEY;
  process.env.LLM_PROVIDER = "demo";
  delete process.env.GEMINI_API_KEY;
  try {
    const current = [
      {
        id: "instagram" as const,
        text: "My detailed caption with my exact words and useful details.",
      },
      { id: "youtubeTitle" as const, text: "My manually chosen title" },
      {
        id: "youtubeDescription" as const,
        text: "Do not overwrite my manual description.",
      },
      { id: "x" as const, text: "నా స్వంత పోస్ట్. My manual post." },
    ];
    const kit = await publishingKit(
      {
        input:
          "An original creator reel with no product claims or added facts.",
        language: "English",
        script: "native",
        instruction: "Make this shorter",
        fields: ["instagram"],
        current,
      },
      AbortSignal.timeout(2000),
    );
    assert.equal(kit.sample, true);
    for (const field of current.slice(1))
      assert.equal(
        kit.outputs.find((o) => o.id === field.id)?.text,
        field.text,
      );
  } finally {
    if (old === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = old;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});

test("production never substitutes stock captions when generation is unavailable or fails", async () => {
  const env = { ...process.env },
    oldFetch = globalThis.fetch;
  process.env.ALLOW_SAMPLE_OUTPUT = "false";
  process.env.LLM_PROVIDER = "demo";
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    await assert.rejects(
      () => publishingKit(brief, AbortSignal.timeout(1000)),
      /unavailable/,
    );
    process.env.GEMINI_API_KEY = "test-key";
    let attempts = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(process.env.SUPABASE_URL!))
        return oldFetch(input, init);
      attempts++;
      return Response.json(
        { error: { message: "Unavailable" } },
        { status: 503 },
      );
    };
    const current = kitInput.parse({
      ...brief,
      current: generated().outputs,
    }).current!;
    const original = structuredClone(current);
    await assert.rejects(() =>
      publishingKit(
        { ...brief, current, instruction: "Shorten this." },
        AbortSignal.timeout(3000),
      ),
    );
    assert.equal(attempts, 2);
    assert.deepEqual(current, original);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of [
      "ALLOW_SAMPLE_OUTPUT",
      "LLM_PROVIDER",
      "GEMINI_API_KEY",
      "LLM_API_KEY",
    ])
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
  }
});

test("legacy placeholders cannot masquerade as creator facts after their sample flag is lost", async () => {
  const env = { ...process.env };
  process.env.LLM_PROVIDER = "demo";
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLM_API_KEY;
  process.env.ALLOW_SAMPLE_OUTPUT = "true";
  try {
    const sample = await publishingKit(brief, AbortSignal.timeout(1000));
    assert.equal(isPlaceholderKit({ ...sample, sample: false }), true);
    assert.equal(isPlaceholderKit({ outputs: generated().outputs }), false);
    await mock(async (calls) => {
      process.env.ALLOW_SAMPLE_OUTPUT = "false";
      const kit = await publishingKit(
        kitInput.parse({
          ...brief,
          current: sample.outputs,
          instruction: "Keep these facts",
        }),
        AbortSignal.timeout(3000),
      );
      assert.equal(kit.sample, false);
      const request = JSON.parse(calls.prompts[0]);
      const content = JSON.parse(request.contents[0].parts[0].text);
      assert.equal(content.current, undefined);
      assert.equal(content.instruction, "");
    });
  } finally {
    for (const key of [
      "ALLOW_SAMPLE_OUTPUT",
      "LLM_PROVIDER",
      "GEMINI_API_KEY",
      "LLM_API_KEY",
    ])
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
  }
});
