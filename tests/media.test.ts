import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  command,
  ffmpeg,
  probe,
  renderVideo,
  timeline,
} from "../lib/server/media/ffmpeg";
import {
  defaultSettings,
  editSchema,
  splitScript,
  type Segment,
} from "../lib/audio/schema";
import { processJob, type WorkerJob } from "../lib/server/media/worker";
import { storageAdmin, ensureVideoBucket, VIDEO_BUCKET } from "../lib/supabase";
import { audioState, editHash, enqueue } from "../lib/server/media/repository";
import { POST as audioPost } from "../app/api/audio/route";
import { POST as generateJob } from "../app/api/voiceover/generate/route";
import { POST as englishJob } from "../app/api/media/english/route";
import { GET as assetsGet } from "../app/api/media/assets/route";
import { GET as jobsGet } from "../app/api/media/jobs/route";
import {
  prepareInput,
  prepareJob,
  sendJob,
} from "../lib/server/publishing/jobs";
import { sign } from "../lib/server";
import {
  createNarrationPlan,
  narrationSegments,
  narrationSlots,
} from "../lib/server/media/narration";
import { voiceFingerprint } from "../lib/server/media/worker";
import { synthesize, transcribe } from "../lib/server/media/providers";
import {
  speechCooldown,
  recordSpeechCooldown,
} from "../lib/server/media/speech-capacity";
import { digest } from "../lib/server";
let dir: string,
  silent: string,
  sound: string,
  voice: string,
  originalBytes: Buffer;
let alice: { id: string; token: string; db: SupabaseClient }, bob: typeof alice;
let reelId: string, sourceId: string, sourceToken: string;
const admin = storageAdmin();
const ip = `2001:db8:${crypto.randomUUID().slice(0, 4)}::1`;
function request(user = alice, data?: unknown, path = "/api/audio") {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
async function user() {
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const r = await db.auth.signInAnonymously();
  assert.equal(r.error, null);
  return { db, id: r.data.user!.id, token: r.data.session!.access_token };
}
async function save(edit = editSchema.parse({ settings: defaultSettings() })) {
  const r = await audioPost(
    request(alice, { action: "save", reelId, sourceId, edit }),
  );
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}
async function workerJob(
  kind: string,
  edit = editSchema.parse({ settings: defaultSettings() }),
): Promise<WorkerJob> {
  return {
    id: crypto.randomUUID(),
    owner_id: alice.id,
    reel_id: reelId,
    source_id: sourceId,
    kind,
    payload: { ...edit, stateHash: await editHash(edit) },
    lease_token: crypto.randomUUID(),
  };
}
before(async () => {
  assert.match(
    process.env.SUPABASE_URL || "",
    /^http:\/\/(127\.0\.0\.1|localhost):/,
  );
  dir = await mkdtemp(join(tmpdir(), "rr-tests-"));
  silent = join(dir, "silent.mp4");
  sound = join(dir, "sound.mp4");
  voice = join(dir, "voice.wav");
  await command(ffmpeg(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=180x320:r=12:d=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    silent,
  ]);
  await command(ffmpeg(), [
    "-v",
    "error",
    "-i",
    silent,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    sound,
  ]);
  await command(ffmpeg(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=800:duration=1",
    "-ar",
    "24000",
    "-ac",
    "1",
    voice,
  ]);
  originalBytes = await readFile(silent);
  [alice, bob] = await Promise.all([user(), user()]);
  await ensureVideoBucket();
  reelId = crypto.randomUUID();
  assert.equal(
    (
      await admin.from("reelready_reels").insert({
        id: reelId,
        owner_id: alice.id,
        title: "Audio tests",
        state: { id: reelId, version: 2, step: 3 },
      })
    ).error,
    null,
  );
  const path = `${alice.id}/${reelId}/original.mp4`;
  assert.equal(
    (
      await admin.storage
        .from(VIDEO_BUCKET)
        .upload(path, originalBytes, { contentType: "video/mp4" })
    ).error,
    null,
  );
  const asset = await admin
    .from("reelready_media")
    .insert({
      owner_id: alice.id,
      reel_id: reelId,
      kind: "original",
      path,
      mime: "video/mp4",
      bytes: originalBytes.length,
      metadata: await probe(silent, true),
    })
    .select("id")
    .single();
  assert.equal(asset.error, null);
  sourceId = asset.data!.id;
  sourceToken = await sign(
    {
      visitor: alice.id,
      path,
      size: originalBytes.length,
      mime: "video/mp4",
      name: "silent.mp4",
      kind: "original",
    },
    "stored-video",
    3600,
  );
  const r = await audioPost(
    request(alice, { action: "init", reelId, token: sourceToken }),
  );
  assert.equal(r.status, 200, await r.clone().text());
});
after(async () => {
  if (reelId) {
    const media = await admin
      .from("reelready_media")
      .select("path")
      .eq("reel_id", reelId);
    if (media.data?.length)
      await admin.storage
        .from(VIDEO_BUCKET)
        .remove(media.data.map((x) => x.path));
    await admin.from("reelready_jobs").delete().eq("reel_id", reelId);
    await admin.from("reelready_reels").delete().eq("id", reelId);
  }
  for (const u of [alice, bob]) if (u) await admin.auth.admin.deleteUser(u.id);
  if (dir) await rm(dir, { recursive: true, force: true });
});
test("real FFprobe distinguishes no audio, effectively silent track and usable unclassified sound", async () => {
  const a = await probe(silent, true),
    b = await probe(sound, true);
  assert.equal(a.hasAudio, false);
  assert.equal(a.sound, "none");
  assert.equal(b.hasAudio, true);
  assert.equal(b.sound, "unknown");
  assert.equal(b.audioCodec, "aac");
  assert.equal(b.decoded, true);
  const silentTrack = join(dir, "silent-track.mp4");
  await command(ffmpeg(), [
    "-v",
    "error",
    "-i",
    silent,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=mono",
    "-t",
    "3",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    silentTrack,
  ]);
  assert.equal((await probe(silentTrack, true)).sound, "silent");
  const invalid = join(dir, "invalid.mp4");
  await writeFile(invalid, "not media");
  await assert.rejects(() => probe(invalid, true));
});
test("native rendering keeps, mutes, replaces, mixes, ducks and adds narration while preserving source and measured duration", async () => {
  for (const mode of [
    "keep",
    "mute",
    "replace",
    "mix",
    "add",
    "voiceover",
  ] as const) {
    const input = mode === "add" ? silent : sound,
      meta = await probe(input, true),
      settings = {
        ...defaultSettings(),
        mode,
        ducking: mode === "mix",
        originalVolume: mode === "mix" ? 0.2 : 1,
        fade: 0.1,
      };
    const segment: Segment & { file: string } = {
      text: "Fixture tone, not synthetic speech",
      original: "",
      start: 0.5,
      end: 2.5,
      duration: (await probe(voice)).duration,
      assetId: null,
      fingerprint: "",
      file: voice,
    };
    const r = await renderVideo(
      input,
      join(dir, `render-${mode}.mp4`),
      meta,
      settings,
      [segment],
    );
    assert.equal(r.metadata.videoCodec, "h264");
    assert.equal(r.metadata.hasAudio, mode !== "mute");
    assert.ok(Math.abs(r.metadata.duration - 3) < 0.15);
    assert.equal(r.metadata.width, 180);
    if (mode !== "keep" && mode !== "mute")
      assert.equal(r.placements[0].start, 0.5);
  }
  assert.deepEqual(await readFile(silent), originalBytes);
});
test("timeline never truncates long speech; deliberate extension preserves every second and short speech pads video", async () => {
  const segment = {
    text: "Long recording",
    original: "",
    start: 0,
    end: 1,
    duration: 3,
    assetId: null,
    fingerprint: "",
    file: voice,
  };
  assert.throws(
    () => timeline([segment], { ...defaultSettings(), mode: "replace" }, 3),
    /too long/,
  );
  assert.equal(
    timeline(
      [segment],
      { ...defaultSettings(), mode: "replace", timing: "extend" },
      3,
    )[0].actualEnd,
    3,
  );
  const longer = join(dir, "long.wav");
  await command(ffmpeg(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=700:duration=4",
    longer,
  ]);
  const r = await renderVideo(
    silent,
    join(dir, "extended.mp4"),
    await probe(silent, true),
    { ...defaultSettings(), mode: "add", timing: "extend" },
    [{ ...segment, file: longer, duration: 4 }],
  );
  assert.ok(Math.abs(r.metadata.duration - 4) < 0.15);
  assert.equal(r.extended, true);
});
test("audio state, assets and jobs are owner restricted; client cannot forge privileged worker calls", async () => {
  const edit = editSchema.parse({
    settings: {
      ...defaultSettings(),
      targetLanguage: "Telugu",
      sourceLanguage: "Hindi",
    },
    classification: "background",
    transcript: "Editable original",
    script: "సరైన పదాలు",
  });
  await save(edit);
  const recovered = await audioState(request(), reelId);
  assert.equal(recovered!.classification, "background");
  assert.equal(recovered!.settings.targetLanguage, "Telugu");
  assert.equal(recovered!.transcript, "Editable original");
  assert.equal(
    (await audioPost(request(bob, { action: "save", reelId, sourceId, edit })))
      .status,
    404,
  );
  assert.equal(
    (
      await assetsGet(
        request(bob, undefined, `/api/media/assets?id=${sourceId}`),
      )
    ).status,
    404,
  );
  assert.equal(
    (await bob.db.from("reelready_audio_edits").select()).data?.length,
    0,
  );
  assert.ok(
    (
      await alice.db.rpc("reelready_claim_media_job", {
        p_lease: crypto.randomUUID(),
      })
    ).error,
  );
  const [a, b] = await Promise.all([
    enqueue(request(), reelId, sourceId, "analyze", {
      ...edit,
      stateHash: await editHash(edit),
    }),
    enqueue(request(), reelId, sourceId, "analyze", {
      ...edit,
      stateHash: await editHash(edit),
    }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    (await jobsGet(request(bob, undefined, `/api/media/jobs?id=${a.id}`)))
      .status,
    404,
  );
});
test("mocked speech transcription and TTS persist real measured audio without publishing or re-uploading source", async () => {
  await save();
  const silentJob = await workerJob("transcribe");
  await assert.rejects(() => processJob(silentJob), /no audio track/);
  const path = `${alice.id}/${reelId}/source-audio.wav`,
    audioBytes = await readFile(voice);
  assert.equal(
    (
      await admin.storage
        .from(VIDEO_BUCKET)
        .upload(path, audioBytes, { contentType: "audio/wav" })
    ).error,
    null,
  );
  const recording = await admin
    .from("reelready_media")
    .insert({
      owner_id: alice.id,
      reel_id: reelId,
      kind: "source_audio",
      path,
      mime: "audio/wav",
      bytes: audioBytes.length,
      metadata: await probe(voice, true),
    })
    .select("id")
    .single();
  assert.equal(recording.error, null);
  const job = await workerJob("transcribe");
  job.payload.recordingId = recording.data!.id;
  const transcribed = await processJob(job, {
    synthesize,
    transcribe: async () => ({
      text: "హలో ప్రపంచం",
      language: "Telugu",
      timing: [{ start: 0, end: 1 }],
      confidence: null,
    }),
  });
  assert.equal(transcribed.applied, true);
  assert.equal(
    (await audioState(request(), reelId))!.transcript,
    "హలో ప్రపంచం",
  );
  let calls = 0;
  const edit = editSchema.parse({
    settings: {
      ...defaultSettings(),
      mode: "add",
      targetLanguage: "Telugu",
      voice: "Puck",
    },
    script: "హలో ప్రపంచం",
    segments: splitScript("హలో ప్రపంచం", 3),
  });
  await save(edit);
  const generated = await processJob(await workerJob("generate", edit), {
    transcribe,
    synthesize: async (text, settings) => {
      calls++;
      assert.equal(text, "హలో ప్రపంచం");
      assert.equal(settings.voice, "Puck");
      return audioBytes;
    },
  });
  assert.equal(calls, 1);
  assert.equal(generated.applied, true);
  const state = (await audioState(request(), reelId))!;
  assert.equal(state.segments[0].duration, 1);
  assert.ok(state.segments[0].assetId);
  const rendered = await processJob(await workerJob("render", state));
  assert.equal(rendered.applied, true);
  const finalState = (await audioState(request(), reelId))!;
  assert.equal(finalState.rendered_id, rendered.assetId);
  const finalAsset = await assetsGet(
    request(alice, undefined, `/api/media/assets?id=${rendered.assetId}`),
  );
  assert.equal(finalAsset.status, 200);
  const linked = (await finalAsset.json()) as {
    stored: { token: string };
    metadata: { duration: number; synthetic: boolean };
  };
  assert.ok(Math.abs(linked.metadata.duration - 3) < 0.15);
  assert.equal(linked.metadata.synthetic, true);
  const input = {
    action: "prepare" as const,
    confirmed: true as const,
    draftId: reelId,
    platforms: ["instagram"],
    scheduledAt: null,
    instagram: "A real test rendering",
    youtubeTitle: "",
    youtubeDescription: "",
    x: "",
    language: "English",
    dubbed: true,
    size: 1,
    duration: 3,
    width: 180,
    height: 320,
  };
  const prepared = await prepareJob(
    request(),
    prepareInput.parse({ ...input, assetToken: linked.stored.token }),
  );
  assert.ok(prepared.id);
  await assert.rejects(
    () =>
      prepareJob(
        request(),
        prepareInput.parse({ ...input, assetToken: sourceToken }),
      ),
    /exact selected soundtrack/,
  );
  await save({ ...edit, script: "Changed after approval", segments: [] });
  await assert.rejects(
    () => sendJob(request(), prepared.id!),
    /soundtrack changed/,
  );
  await assert.rejects(
    () =>
      prepareJob(
        request(),
        prepareInput.parse({ ...input, assetToken: linked.stored.token }),
      ),
    /exact selected soundtrack/,
  );
  const original = await admin
    .from("reelready_media")
    .select("path")
    .eq("id", sourceId)
    .single();
  const downloaded = await admin.storage
    .from(VIDEO_BUCKET)
    .download(original.data!.path);
  assert.deepEqual(
    Buffer.from(await downloaded.data!.arrayBuffer()),
    originalBytes,
  );
  assert.equal(
    (await generateJob(request(alice, { reelId, sourceId, confirmed: false })))
      .status,
    400,
  );
});

test("Gemini documented REST adapters preserve voice, style, language and optional word timing; no full render on preview", async () => {
  const originalFetch = globalThis.fetch,
    previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-key";
  let deletes = 0;
  const audioBytes = await readFile(voice);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(process.env.SUPABASE_URL!))
      return originalFetch(input, init);
    if (url.endsWith("/upload/v1beta/files"))
      return new Response(null, {
        headers: {
          "x-goog-upload-url":
            "https://generativelanguage.googleapis.com/upload/test",
        },
      });
    if (url.endsWith("/upload/test"))
      return Response.json({
        file: {
          name: "files/test",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/test",
          mimeType: "audio/flac",
          state: "ACTIVE",
        },
      });
    if (init?.method === "DELETE") {
      deletes++;
      return new Response(null);
    }
    assert.ok(url.endsWith("/v1beta/interactions"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    if (body.model === "gemini-3.5-transcribe") {
      assert.deepEqual(
        body.generation_config.transcription_config.language_codes,
        ["te-IN"],
      );
      return Response.json({
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: "హలో ప్రపంచం",
                annotations: [
                  {
                    type: "word_info",
                    text: "హలో",
                    start_offset: "0.1s",
                    end_offset: "0.5s",
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    assert.equal(body.model, "gemini-3.8-flash-tts");
    assert.equal(body.generation_config.speech_config[0].voice, "Puck");
    assert.match(body.input[0].content[0].annotations[0].style, /Tamil/);
    return Response.json({
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "audio",
              mime_type: "audio/wav",
              data: audioBytes.toString("base64"),
            },
          ],
        },
      ],
    });
  };
  try {
    const text = await transcribe(voice, "Telugu");
    assert.equal(text.text, "హలో ప్రపంచం");
    assert.equal(text.timing.length, 1);
    assert.equal(deletes, 1);
    const bytes = await synthesize("வணக்கம்", {
      ...defaultSettings(),
      voice: "Puck",
      targetLanguage: "Tamil",
    });
    assert.deepEqual(bytes, audioBytes);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test("translation preserves timestamp budgets; previews and voice changes never create publication jobs", async () => {
  const oldFetch = globalThis.fetch;
  const env = {
    provider: process.env.LLM_PROVIDER,
    key: process.env.LLM_API_KEY,
  };
  const edit = editSchema.parse({
    settings: {
      ...defaultSettings(),
      mode: "add",
      sourceLanguage: "Hindi",
      targetLanguage: "English",
    },
    transcript: "मेरा बगीचा",
    script: "मेरा बगीचा",
    segments: [
      { text: "मेरा बगीचा", original: "मेरा बगीचा", start: 0.3, end: 3 },
    ],
  });
  await save(edit);
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_API_KEY = "test-only";
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.openai.com/")) {
      const payload = JSON.parse(String(init?.body));
      assert.match(payload.input, /Hindi|मेरा बगीचा/);
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  script: "My garden.",
                  segments: ["My garden."],
                }),
              },
            ],
          },
        ],
      });
    }
    return oldFetch(input, init);
  };
  try {
    const job = await workerJob("translate", edit);
    const translated = await processJob(job);
    assert.equal(translated.applied, true);
    const state = (await audioState(request(), reelId))!;
    assert.equal(state.script, "My garden.");
    assert.equal(state.segments[0].start, 0.3);
    assert.equal(state.segments[0].end, 3);
    assert.equal(state.segments[0].original, "मेरा बगीचा");
    const before = await admin
      .from("reelready_jobs")
      .select("id")
      .eq("reel_id", reelId);
    const preview = await processJob(await workerJob("preview", state), {
      transcribe,
      synthesize: async () => readFile(voice),
    });
    assert.equal(preview.preview, true);
    const after = await admin
      .from("reelready_jobs")
      .select("id")
      .eq("reel_id", reelId);
    assert.deepEqual(after.data, before.data);
    assert.equal((await audioState(request(), reelId))!.rendered_id, null);
  } finally {
    globalThis.fetch = oldFetch;
    if (env.provider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = env.provider;
    if (env.key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = env.key;
  }
});

test("English voiceover preset adapts creator notes, synthesizes and mixes a real MP4 with one queued operation", async () => {
  const oldFetch = globalThis.fetch,
    previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-preset-key";
  let textCalls = 0,
    voiceCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (
      String(input).startsWith("https://generativelanguage.googleapis.com/") &&
      String(input).includes(":generateContent")
    ) {
      textCalls++;
      const body = JSON.parse(String(init?.body));
      assert.match(JSON.stringify(body), /English/);
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    script: "A story from my garden.",
                    segments: [],
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    return oldFetch(input, init);
  };
  try {
    const edit = editSchema.parse({
      settings: defaultSettings(),
      script: "मेरे बगीचे की कहानी",
      transcript: "मेरे बगीचे की कहानी",
    });
    await save(edit);
    const result = await processJob(await workerJob("english", edit), {
      transcribe: async () => {
        throw new Error("Creator notes should avoid transcription");
      },
      synthesize: async (text, settings) => {
        voiceCalls++;
        assert.equal(text, "A story from my garden.");
        assert.equal(settings.targetLanguage, "English");
        return readFile(voice);
      },
    });
    assert.equal(result.applied, true);
    assert.equal(textCalls, 1);
    assert.equal(voiceCalls, 1);
    const state = (await audioState(request(), reelId))!;
    assert.equal(state.settings.mode, "mix");
    assert.equal(state.settings.originalVolume, 0.2);
    assert.equal(state.settings.ducking, true);
    assert.equal(state.script, "A story from my garden.");
    assert.ok(state.rendered_id);
    assert.deepEqual(await readFile(silent), originalBytes);
  } finally {
    globalThis.fetch = oldFetch;
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test("verified regional voice metadata selects male/female accents and changes the audio fingerprint", async () => {
  const originalFetch = globalThis.fetch,
    previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-regional-key";
  const wav = await readFile(voice);
  const selected: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "generativelanguage.googleapis.com")
      return originalFetch(input, init);
    if (url.pathname.endsWith("/voices")) {
      const locale = url.searchParams.get("language_code")!,
        gender = url.searchParams.get("gender") || "female";
      return Response.json({
        voices: [
          { id: "wrong-region", gender, language_code: "fr-FR" },
          {
            id: `${locale}-${gender}`,
            gender,
            language_code: locale,
            accent: "Verified test accent",
          },
        ],
      });
    }
    const body = JSON.parse(String(init?.body));
    selected.push(body.generation_config.speech_config[0].voice);
    assert.match(
      body.input[0].content[0].annotations[0].style,
      /Clear and professional/,
    );
    return Response.json({
      steps: [
        {
          type: "model_output",
          content: [{ type: "audio", data: wav.toString("base64") }],
        },
      ],
    });
  };
  try {
    const male = {
      ...defaultSettings(),
      style: "Clear and professional" as const,
      voiceProfile: { gender: "male" as const, accent: "en-IN" as const },
    };
    const female = {
      ...male,
      voiceProfile: { gender: "female" as const, accent: "en-GB" as const },
    };
    await synthesize("A short narration.", male);
    await synthesize("A short narration.", female);
    assert.deepEqual(selected, ["en-IN-male", "en-GB-female"]);
    assert.notEqual(
      await voiceFingerprint("Same words", male),
      await voiceFingerprint("Same words", female),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test("video narration planning combines original speech, creator changes and visual evidence, with schema retry", async () => {
  const originalFetch = globalThis.fetch,
    previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-planning-key";
  let plans = 0,
    deleted = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://generativelanguage.googleapis.com/"))
      return originalFetch(input, init);
    if (url.includes("/upload/v1beta/files"))
      return new Response(null, {
        headers: {
          "x-goog-upload-url":
            "https://generativelanguage.googleapis.com/upload/fit-test",
        },
      });
    if (url.endsWith("/upload/fit-test"))
      return Response.json({
        file: {
          name: "files/fit-test",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/fit-test",
          mimeType: "video/mp4",
          state: "ACTIVE",
        },
      });
    if (init?.method === "DELETE") {
      deleted++;
      return new Response(null);
    }
    assert.ok(url.includes(":generateContent"));
    const body = JSON.parse(String(init?.body));
    assert.match(JSON.stringify(body), /Original: a balcony garden/);
    assert.match(JSON.stringify(body), /Add the creator.s watering tip/);
    assert.match(JSON.stringify(body), /fileData/);
    plans++;
    const count = plans === 1 ? 1 : 6;
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  segments: Array.from({ length: count }, (_, i) => ({
                    text: `Grounded garden detail ${i + 1}.`,
                    evidence:
                      "The plants are visible and the creator supplied the watering tip.",
                  })),
                }),
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const plan = await createNarrationPlan({
      path: silent,
      mime: "video/mp4",
      duration: 90,
      transcript: "Original: a balcony garden",
      instructions: "Add the creator’s watering tip",
      style: "Natural",
    });
    assert.equal(plan.length, 6);
    assert.equal(plan[0].start, 0);
    assert.equal(plan[5].end, 90);
    assert.equal(plans, 2);
    assert.equal(deleted, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test("30 seconds of short speech spans a 90-second video without extreme slowdown or a frozen-frame extension", async () => {
  const video = join(dir, "ninety.mp4"),
    five = join(dir, "five.wav"),
    output = join(dir, "ninety-fit.mp4");
  await command(ffmpeg(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=96x160:r=5:d=90",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    video,
  ]);
  await command(ffmpeg(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=700:duration=5:sample_rate=24000",
    five,
  ]);
  const settings = {
    ...defaultSettings(),
    mode: "voiceover" as const,
    durationMode: "fit-video" as const,
  };
  const segments = narrationSegments(
    Array.from({ length: 6 }, (_, i) => `Scene ${i + 1}.`),
    90,
  ).map((s) => ({ ...s, duration: 5, file: five }));
  const result = await renderVideo(
    video,
    output,
    await probe(video, true),
    settings,
    segments,
  );
  assert.ok(Math.abs(result.metadata.duration - 90) < 0.15);
  assert.equal(result.extended, false);
  assert.equal(result.placements.length, 6);
  assert.ok(result.placements.every((p) => p.speed >= 0.85 && p.speed <= 1.15));
  assert.ok(result.placements[4].start >= 60);
  assert.ok(Math.abs(result.placements[5].end - 90) < 0.01);
  const endAudio = await command(ffmpeg(), [
    "-v",
    "info",
    "-ss",
    "85",
    "-i",
    output,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  assert.doesNotMatch(endAudio.err, /mean_volume: -inf/);
  assert.throws(
    () => narrationSegments(["Too few scenes"], 90),
    /could not be fitted/,
  );
  assert.equal(narrationSlots(90).length, 6);
});

test("fitted worker uses original speech plus creator changes, repairs long speech, and reuses context for voice changes", async () => {
  const soundBytes = await readFile(sound),
    path = `${alice.id}/${reelId}/fitted-speech-source.mp4`;
  assert.equal(
    (
      await admin.storage
        .from(VIDEO_BUCKET)
        .upload(path, soundBytes, { contentType: "video/mp4" })
    ).error,
    null,
  );
  const asset = await admin
    .from("reelready_media")
    .insert({
      owner_id: alice.id,
      reel_id: reelId,
      kind: "original",
      path,
      mime: "video/mp4",
      bytes: soundBytes.length,
      metadata: await probe(sound, true),
    })
    .select("id")
    .single();
  assert.equal(asset.error, null);
  const newSourceId = asset.data!.id;
  const token = await sign(
    {
      visitor: alice.id,
      path,
      size: soundBytes.length,
      mime: "video/mp4",
      name: "sound.mp4",
      kind: "original",
    },
    "stored-video",
    3600,
  );
  assert.equal(
    (await audioPost(request(alice, { action: "init", reelId, token }))).status,
    200,
  );
  const initial = editSchema.parse({
    settings: {
      ...defaultSettings(),
      durationMode: "fit-video",
      creatorInstructions: "Include my extra tip, but keep the original point.",
      voiceProfile: { gender: "male", accent: "en-IN" },
      style: "Clear and professional",
    },
  });
  const post = await audioPost(
    request(alice, {
      action: "save",
      reelId,
      sourceId: newSourceId,
      edit: initial,
    }),
  );
  assert.equal(post.status, 200);
  const longer = join(dir, "too-long.wav");
  await command(ffmpeg(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=650:duration=5:sample_rate=24000",
    longer,
  ]);
  let reads = 0,
    plans = 0,
    voices = 0;
  const leased = {
    ...(await workerJob("english", initial)),
    source_id: newSourceId,
  };
  const queued = await admin.from("reelready_media_jobs").insert({
    id: leased.id,
    owner_id: alice.id,
    reel_id: reelId,
    source_id: newSourceId,
    kind: "english",
    status: "running",
    lease_token: leased.lease_token,
    fingerprint: crypto.randomUUID(),
    payload: leased.payload,
    pool: `fitting-test-${crypto.randomUUID()}`,
  });
  assert.equal(queued.error, null);
  const fitted = await processJob(leased, {
    transcribe: async () => {
      reads++;
      return {
        text: "The original speaker explains a useful point.",
        language: "English",
        timing: [],
        confidence: null,
      };
    },
    planNarration: async (input) => {
      plans++;
      assert.match(input.transcript, /original speaker/);
      assert.match(input.instructions, /extra tip/);
      if (plans === 2)
        assert.ok(input.previous![0].measured > input.previous![0].budget);
      return narrationSegments(
        [
          plans === 1
            ? "Long source point and extra creator tip."
            : "Source point. Extra tip.",
        ],
        input.duration,
      );
    },
    synthesize: async (text, settings) => {
      voices++;
      assert.equal(settings.voiceProfile!.gender, "male");
      assert.equal(settings.voiceProfile!.accent, "en-IN");
      return readFile(text.startsWith("Long") ? longer : voice);
    },
  });
  assert.equal(fitted.applied, true);
  assert.equal(reads, 1);
  assert.equal(plans, 2);
  assert.equal(voices, 2);
  const state = (await audioState(request(), reelId))!;
  assert.match(state.transcript, /original speaker/);
  assert.match(state.script, /Extra tip/);
  const linked = (await (
    await assetsGet(
      request(alice, undefined, `/api/media/assets?id=${state.rendered_id}`),
    )
  ).json()) as { metadata: { duration: number } };
  assert.ok(
    Math.abs(linked.metadata.duration - (await probe(sound)).duration) < 0.15,
  );
  const revised = editSchema.parse({
    ...state,
    settings: {
      ...state.settings,
      voiceProfile: { gender: "female", accent: "en-GB" },
      style: "Casual",
    },
    segments: state.segments.map((s) => ({
      ...s,
      assetId: null,
      duration: null,
      fingerprint: "",
    })),
  });
  assert.equal(
    (
      await audioPost(
        request(alice, {
          action: "save",
          reelId,
          sourceId: newSourceId,
          edit: revised,
        }),
      )
    ).status,
    200,
  );
  const revoiced = await processJob(
    { ...(await workerJob("english", revised)), source_id: newSourceId },
    {
      transcribe: async () => {
        throw new Error("Cached original transcript should be reused");
      },
      planNarration: async () => {
        throw new Error("A voice-only change must retain the prepared script");
      },
      synthesize: async (_text, settings) => {
        assert.equal(settings.voiceProfile!.gender, "female");
        assert.equal(settings.voiceProfile!.accent, "en-GB");
        assert.equal(settings.style, "Casual");
        return readFile(voice);
      },
    },
  );
  assert.equal(revoiced.applied, true);
  assert.equal(
    (
      await audioPost(
        request(alice, { action: "original", reelId, sourceId: newSourceId }),
      )
    ).status,
    200,
  );
  const kept = (await audioState(request(), reelId))!;
  assert.equal(
    kept.settings.creatorInstructions,
    revised.settings.creatorInstructions,
  );
  assert.deepEqual(kept.settings.voiceProfile, {
    gender: "female",
    accent: "en-GB",
  });
  const original = await admin.storage.from(VIDEO_BUCKET).download(path);
  assert.deepEqual(Buffer.from(await original.data!.arrayBuffer()), soundBytes);
});

test("lost enqueue responses replay one owned job without spending another hourly admission", async () => {
  const previous = {
    key: process.env.GEMINI_API_KEY,
    rate: process.env.RATE_MEDIA_ENGLISH_PER_HOUR,
    pool: process.env.WORKER_POOL,
  };
  process.env.GEMINI_API_KEY = `idempotency-${crypto.randomUUID()}`;
  process.env.RATE_MEDIA_ENGLISH_PER_HOUR = "1";
  process.env.WORKER_POOL = `idempotency-${crypto.randomUUID()}`;
  try {
    const state = (await audioState(request(), reelId))!;
    const input = {
      reelId,
      sourceId: state.source_id,
      confirmed: true,
      requestId: crypto.randomUUID(),
    };
    const first = await englishJob(request(alice, input));
    assert.equal(first.status, 202, await first.clone().text());
    const job = (await first.json()) as { id: string };
    const replay = await englishJob(request(alice, input));
    assert.equal(replay.status, 202, await replay.clone().text());
    assert.equal(((await replay.json()) as { id: string }).id, job.id);
    // A known failure is returned, never secretly restarted by a transport retry.
    assert.equal(
      (
        await admin
          .from("reelready_media_jobs")
          .update({ status: "failed", safe_error: "Saved fixture failure" })
          .eq("id", job.id)
      ).error,
      null,
    );
    const failed = await englishJob(request(alice, { ...input, retry: true }));
    assert.equal(
      ((await failed.json()) as { status: string }).status,
      "failed",
    );
    assert.equal(
      (
        await englishJob(
          request(alice, { ...input, requestId: crypto.randomUUID() }),
        )
      ).status,
      429,
    );
    assert.equal((await englishJob(request(bob, input))).status, 404);
  } finally {
    for (const [name, value] of Object.entries({
      GEMINI_API_KEY: previous.key,
      RATE_MEDIA_ENGLISH_PER_HOUR: previous.rate,
      WORKER_POOL: previous.pool,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("persistent speech cooldown is private, expires, and blocks before consuming queue allowance", async () => {
  const previous = {
    key: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_TTS_MODEL,
  };
  process.env.GEMINI_API_KEY = `capacity-${crypto.randomUUID()}`;
  process.env.GEMINI_TTS_MODEL = "test-speech-capacity";
  const isolatedKey = process.env.GEMINI_API_KEY;
  const key = `speech-cooldown:${await digest(JSON.stringify([process.env.GEMINI_TTS_MODEL, process.env.GEMINI_API_KEY]))}`;
  try {
    const until = new Date(Date.now() + 86400000).toISOString();
    await recordSpeechCooldown({ until, daily: true });
    assert.equal((await speechCooldown())?.daily, true);
    assert.equal(await speechCooldown("separate-transcription-model"), null);
    const hidden = await alice.db
      .from("reelready_rate_limits")
      .select("key")
      .eq("key", key);
    assert.ok(hidden.error || hidden.data?.length === 0);
    assert.ok(
      (
        await alice.db
          .from("reelready_rate_limits")
          .upsert({ key, count: 0, expires_at: until })
      ).error,
    );
    const state = (await audioState(request(), reelId))!;
    const rateKey = await digest(
      `${process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY}:media-english:user:${alice.id}`,
    );
    const before = await admin
      .from("reelready_rate_limits")
      .select("count")
      .eq("key", rateKey)
      .maybeSingle();
    const blocked = await englishJob(
      request(alice, {
        reelId,
        sourceId: state.source_id,
        confirmed: true,
        requestId: crypto.randomUUID(),
      }),
    );
    assert.equal(blocked.status, 429);
    assert.equal(
      ((await blocked.json()) as { code: string }).code,
      "SPEECH_PROVIDER_LIMIT",
    );
    const after = await admin
      .from("reelready_rate_limits")
      .select("count")
      .eq("key", rateKey)
      .maybeSingle();
    assert.deepEqual(after.data, before.data);
    // A new provider key cannot inherit the old key's quota state.
    process.env.GEMINI_API_KEY += "-changed";
    assert.equal(await speechCooldown(), null);
    assert.equal(
      (
        await admin
          .from("reelready_rate_limits")
          .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
          .eq("key", key)
      ).error,
      null,
    );
    process.env.GEMINI_API_KEY = isolatedKey;
    assert.equal(await speechCooldown(), null);
  } finally {
    await admin.from("reelready_rate_limits").delete().eq("key", key);
    for (const [name, value] of Object.entries({
      GEMINI_API_KEY: previous.key,
      GEMINI_TTS_MODEL: previous.model,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
