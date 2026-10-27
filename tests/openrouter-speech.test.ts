import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  requestFreeSpeech,
  verifyFreeSpeech,
  freeVoiceInstructions,
  normalizeFreeSpeech,
} from "../lib/server/media/openrouter-speech";
import {
  FREE_SPEECH_MODEL,
  ttsConfiguration,
} from "../lib/server/media/tts-config";
import { defaultSettings } from "../lib/audio/schema";
import { command, ffmpeg, probe } from "../lib/server/media/ffmpeg";
import { voiceFingerprint } from "../lib/server/media/worker";
const original = {
  key: process.env.OPENROUTER_API_KEY,
  provider: process.env.TTS_PROVIDER,
  model: process.env.OPENROUTER_TTS_MODEL,
};
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-private-key";
  process.env.TTS_PROVIDER = "openrouter";
  delete process.env.OPENROUTER_TTS_MODEL;
});
afterEach(() => {
  for (const [key, value] of Object.entries({
    OPENROUTER_API_KEY: original.key,
    TTS_PROVIDER: original.provider,
    OPENROUTER_TTS_MODEL: original.model,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const settings = {
  ...defaultSettings(),
  voiceProfile: { gender: "male" as const, accent: "en-IN" as const },
  style: "Clear and professional" as const,
};
const model = {
  id: FREE_SPEECH_MODEL,
  pricing: { prompt: "0", completion: "0" },
  architecture: { output_modalities: ["speech"] },
};
const routes = {
  data: {
    endpoints: [{ pricing: { prompt: "0", completion: "0", discount: 0 } }],
  },
};
function transport(
  audio: (init?: RequestInit) => Response | Promise<Response>,
  pricing = model,
  endpoints = routes,
): typeof fetch {
  return async (url, init) =>
    String(url).endsWith("/audio/speech")
      ? audio(init)
      : Response.json(
          String(url).endsWith("/endpoints") ? endpoints : { data: [pricing] },
        );
}
const runtime = {
  budget: async () => {},
  cooldown: async () => null,
  block: async () => {},
  pause: async () => {},
};
test("free narration pins zero-priced model and sends real audio request with delivery directions", async () => {
  let calls = 0,
    budgets = 0,
    checks = 0;
  const bytes = Buffer.alloc(150, 1);
  const result = await requestFreeSpeech(
    "A real creator script.",
    settings,
    {
      beforeAttempt: async () => {
        checks++;
      },
    },
    {
      ...runtime,
      budget: async () => {
        budgets++;
      },
      fetch: transport((init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, FREE_SPEECH_MODEL);
        assert.equal(body.input, "A real creator script.");
        assert.equal(body.response_format, "mp3");
        assert.match(
          body.instructions,
          /male narrator, Indian English.*professional/i,
        );
        assert.equal(body.voice, undefined);
        assert.equal(body.models, undefined);
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer test-private-key",
        );
        assert.equal(init?.redirect, "error");
        return new Response(bytes, {
          headers: { "content-type": "audio/mpeg" },
        });
      }),
    },
  );
  assert.deepEqual(result, bytes);
  assert.equal(calls, 1);
  assert.equal(budgets, 1);
  assert.equal(checks, 1);
  assert.equal(ttsConfiguration().voiceDirectionsOnly, true);
});
test("free-only verification fails closed on paid, missing and invalid pricing and paid routes", async () => {
  for (const pricing of [
    { prompt: "0.01", completion: "0" },
    { prompt: "0", completion: "" },
    { prompt: "0", completion: "NaN" },
  ])
    await assert.rejects(
      verifyFreeSpeech(
        transport(
          () => {
            throw Error("Must not synthesize");
          },
          { ...model, pricing },
        ),
      ),
      /free voice is unavailable/i,
    );
  await assert.rejects(
    verifyFreeSpeech(
      transport(
        () => {
          throw Error("Must not synthesize");
        },
        model,
        {
          data: {
            endpoints: [
              { pricing: { prompt: "0", completion: "0.1", discount: 0 } },
            ],
          },
        },
      ),
    ),
    /free voice route/i,
  );
  await assert.rejects(
    verifyFreeSpeech(async () => Response.json({ data: [] })),
    /free voice is unavailable/i,
  );
});
test("paid model override and missing key never call any provider", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {
    calls++;
    throw Error("Must not call");
  };
  process.env.OPENROUTER_TTS_MODEL = "fish-audio/s2.1-pro";
  assert.equal(ttsConfiguration().configured, false);
  await assert.rejects(
    requestFreeSpeech("Text", settings, {}, { ...runtime, fetch }),
    /not configured/,
  );
  delete process.env.OPENROUTER_TTS_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(
    requestFreeSpeech("Text", settings, {}, { ...runtime, fetch }),
    /not configured/,
  );
  assert.equal(calls, 0);
});
test("input cap, cancellation and global budget stop before synthesis", async () => {
  let calls = 0;
  const fetch = transport(() => {
    calls++;
    throw Error("Must not synthesize");
  });
  for (const script of [" ", "x".repeat(4001)])
    await assert.rejects(
      requestFreeSpeech(script, settings, {}, { ...runtime, fetch }),
      /4,000/,
    );
  await assert.rejects(
    requestFreeSpeech(
      "Text",
      settings,
      {
        beforeAttempt: async () => {
          throw Error("cancelled");
        },
      },
      { ...runtime, fetch },
    ),
    /cancelled/,
  );
  await assert.rejects(
    requestFreeSpeech(
      "Text",
      settings,
      {},
      {
        ...runtime,
        fetch,
        budget: async () => {
          throw Error("capacity reached");
        },
      },
    ),
    /capacity reached/,
  );
  assert.equal(calls, 0);
});
test("free quota persists model-specific cooldown without a paid fallback or quota retry", async () => {
  let calls = 0,
    blocked = "";
  await assert.rejects(
    requestFreeSpeech(
      "Text",
      settings,
      {},
      {
        ...runtime,
        block: async (_, model) => {
          blocked = model || "";
        },
        fetch: transport(() => {
          calls++;
          return Response.json(
            { error: { message: "Daily free limit exceeded" } },
            { status: 429, headers: { "retry-after": "3600" } },
          );
        }),
      },
    ),
    /no paid fallback/i,
  );
  assert.equal(calls, 1);
  assert.equal(blocked, FREE_SPEECH_MODEL);
  await assert.rejects(
    requestFreeSpeech(
      "Text",
      settings,
      {},
      {
        ...runtime,
        cooldown: async () => ({
          until: new Date(Date.now() + 60000).toISOString(),
          daily: true,
        }),
        fetch: async () => {
          throw Error("Must not call");
        },
      },
    ),
    /daily allowance/,
  );
});
test("free provider transient failures retry at most once, auth and lost responses never replay", async () => {
  let calls = 0;
  const waits: number[] = [];
  const audio = () =>
    new Response(Buffer.alloc(150), {
      headers: { "content-type": "audio/mpeg" },
    });
  await requestFreeSpeech(
    "Text",
    settings,
    {},
    {
      ...runtime,
      pause: async (ms) => {
        waits.push(ms);
      },
      fetch: transport(() =>
        ++calls === 1
          ? Response.json({}, { status: 503, headers: { "retry-after": "3" } })
          : audio(),
      ),
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [3000]);
  for (const status of [401, 403, 500]) {
    calls = 0;
    await assert.rejects(
      requestFreeSpeech(
        "Text",
        settings,
        {},
        {
          ...runtime,
          fetch: transport(() => {
            calls++;
            return Response.json(
              { error: { message: "test-private-key" } },
              { status },
            );
          }),
        },
      ),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("test-private-key"));
        return true;
      },
    );
    assert.equal(calls, status === 500 ? 2 : 1);
  }
  calls = 0;
  await assert.rejects(
    requestFreeSpeech(
      "Text",
      settings,
      {},
      {
        ...runtime,
        fetch: transport(() => {
          calls++;
          throw Error("fetch failed test-private-key");
        }),
      },
    ),
    /connection was interrupted/,
  );
  assert.equal(calls, 1);
});
test("free speech rejects JSON, empty and oversized audio instead of saving a fake recording", async () => {
  for (const response of [
    Response.json({ error: "not audio" }),
    new Response(new Uint8Array(0), {
      headers: { "content-type": "audio/mpeg" },
    }),
    new Response(new Uint8Array(12 * 1024 * 1024 + 1), {
      headers: { "content-type": "audio/mpeg" },
    }),
  ])
    await assert.rejects(
      requestFreeSpeech(
        "Text",
        settings,
        {},
        { ...runtime, fetch: transport(() => response) },
      ),
      /playable audio|empty audio|too large/,
    );
});
test("voice fingerprint isolates providers while preserving previous Gemini cache identity", async () => {
  process.env.TTS_PROVIDER = "gemini";
  const old = await voiceFingerprint("Same words", settings);
  process.env.TTS_PROVIDER = "openrouter";
  const next = await voiceFingerprint("Same words", settings);
  assert.notEqual(old, next);
  process.env.TTS_PROVIDER = "gemini";
  assert.equal(await voiceFingerprint("Same words", settings), old);
  for (const gender of ["natural", "female", "male"] as const)
    assert.match(
      freeVoiceInstructions({
        ...settings,
        voiceProfile: { gender, accent: "en-GB" },
      }),
      /British English/,
    );
});
test("actual compressed audio normalizes to a decodable WAV for the existing worker render contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reelready-free-test-"));
  try {
    const mp3 = join(dir, "tone.mp3"),
      wav = join(dir, "voice.wav");
    await command(ffmpeg(), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-c:a",
      "libmp3lame",
      mp3,
    ]);
    const bytes = await normalizeFreeSpeech(await readFile(mp3));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    await writeFile(wav, bytes);
    const info = await probe(wav, true);
    assert.equal(info.hasAudio, true);
    assert.equal(info.audioCodec, "pcm_s16le");
    assert.ok(info.duration > 0.4);
    await assert.rejects(
      normalizeFreeSpeech(Buffer.from("not an audio file")),
      /decoded or rendered/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("media progress recovers transient storage reads without retrying schema or permission errors", async () => {
  const { mediaPersistence } = await import("../lib/server/media/persistence");
  const waits: number[] = [];
  let calls = 0;
  const result = await mediaPersistence(
    async () =>
      ++calls < 3
        ? {
            error: { code: "", message: "TypeError: fetch failed" },
            data: null,
          }
        : { error: null, data: "saved" },
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.equal(result.data, "saved");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [350, 1000]);
  for (const code of ["42501", "42703", "23505"]) {
    calls = 0;
    await mediaPersistence(
      async () => {
        calls++;
        return { error: { code, message: "permanent failure" } };
      },
      async () => {},
    );
    assert.equal(calls, 1);
  }
  calls = 0;
  await mediaPersistence(
    async () => {
      calls++;
      return { error: { status: 503 } };
    },
    async () => {},
  );
  assert.equal(calls, 3);
});
