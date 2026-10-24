import { takeProviderCall, providerCapacity } from "../provider-budget";
import { GenerationError } from "../../generation";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { inferTranscriptLanguage } from "./transcript";
import { MediaError } from "./ffmpeg";
import { type AudioSettings } from "../../audio/schema";
const root = "https://generativelanguage.googleapis.com";
function headers() {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw new MediaError(
      "Gemini media services are not configured. Type a script or keep your original audio.",
    );
  return { "x-goog-api-key": key, "Content-Type": "application/json" };
}
export async function interaction(data: Record<string, unknown>) {
  headers();
  await takeProviderCall();
  const r = await fetch(`${root}/v1beta/interactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...data, store: false }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok)
    throw new MediaError(
      r.status === 429
        ? "Voice generation or transcription is temporarily unavailable because the speech provider has reached its allowance. Your script is saved. Keep original audio or upload your own narration; the site owner can check the provider quota."
        : "The configured speech model is unavailable. Check its model access and credentials. Your sources are safe.",
    );
  return await r.json();
}
const blockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    data: z.string().optional(),
    mime_type: z.string().optional(),
  })
  .passthrough();
export function interactionBlocks(raw: unknown) {
  const parsed = z
    .object({
      steps: z
        .array(
          z.object({
            type: z.string(),
            content: z.array(blockSchema).optional(),
          }),
        )
        .optional(),
    })
    .parse(raw);
  return (
    parsed.steps
      ?.filter((s) => s.type === "model_output")
      .flatMap((s) => s.content || []) || []
  );
}
type RegionalVoice = {
  id: string;
  gender: string;
  language_code: string;
  accent?: string;
};
const regionalCache = new Map<
  string,
  { expires: number; voice: RegionalVoice }
>();
export async function regionalVoice(
  profile: NonNullable<AudioSettings["voiceProfile"]>,
) {
  const cacheKey = `${profile.accent}:${profile.gender}`;
  const cached = regionalCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.voice;
  const url = new URL(`${root}/v1beta/voices`);
  url.searchParams.set("language_code", profile.accent);
  url.searchParams.set("type", "prebuilt");
  url.searchParams.set("page_size", "100");
  if (profile.gender !== "natural")
    url.searchParams.set("gender", profile.gender);
  const response = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new MediaError(
      "The requested voice catalogue is unavailable. Your choices are saved; retry or keep original audio.",
    );
  const data = z
    .object({
      voices: z
        .array(
          z.object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),
            gender: z.string(),
            language_code: z.string(),
            accent: z.string().optional(),
          }),
        )
        .default([]),
    })
    .parse(await response.json());
  const voice = data.voices.find(
    (v) =>
      v.language_code.toLowerCase() === profile.accent.toLowerCase() &&
      (profile.gender === "natural" ||
        v.gender.toLowerCase() === profile.gender),
  );
  if (!voice)
    throw new MediaError(
      "That voice and accent combination is unavailable. Choose another voice or keep original audio.",
    );
  regionalCache.set(cacheKey, { voice, expires: Date.now() + 3600000 });
  return voice;
}
export async function synthesize(script: string, settings: AudioSettings) {
  const selectedVoice = settings.voiceProfile
    ? (await regionalVoice(settings.voiceProfile)).id
    : settings.voice;
  const result = await interaction({
    model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: script,
            annotations: [
              {
                type: "speech_metadata",
                style: `${settings.style}. Speak in ${settings.targetLanguage}; ${settings.pace === "natural" ? "natural pace" : settings.pace === "slower" ? "slightly slower pace" : "slightly faster pace"}. Read the text verbatim.`,
              },
            ],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: selectedVoice }] },
  });
  const audio = interactionBlocks(result).findLast(
    (b) => b.type === "audio" && b.data,
  );
  if (!audio?.data)
    throw new MediaError(
      "The voice service returned no playable audio. Retry this segment.",
    );
  const bytes = Buffer.from(audio.data, "base64");
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new MediaError(
      "The voice service returned an unsupported audio format. Expected a WAV recording.",
    );
  return bytes;
}
export async function withGoogleFile<T>(
  path: string,
  mime: string,
  task: (file: { uri: string; mimeType: string }) => Promise<T>,
): Promise<T> {
  const size = (await stat(path)).size;
  const start = await fetch(`${root}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      ...headers(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mime,
    },
    body: JSON.stringify({
      file: { display_name: "ReelReady private processing" },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const location = start.headers.get("x-goog-upload-url");
  if (!start.ok || !location || new URL(location).origin !== root)
    throw new MediaError(
      "The media service could not start a private analysis upload. Retry later.",
    );
  const uploaded = await fetch(location, {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": mime,
      "Content-Length": String(size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: createReadStream(path) as unknown as BodyInit,
    duplex: "half",
    signal: AbortSignal.timeout(300000),
  } as RequestInit);
  if (!uploaded.ok)
    throw new MediaError(
      "The media service could not accept the analysis copy. The original is safe.",
    );
  const parsed = z
    .object({
      file: z.object({
        name: z.string().regex(/^files\/[\w-]+$/),
        uri: z.string().url(),
        mimeType: z.string(),
        state: z.string(),
      }),
    })
    .parse(await uploaded.json());
  let file = parsed.file;
  try {
    for (let i = 0; file.state === "PROCESSING" && i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`${root}/v1beta/${file.name}`, {
        headers: headers(),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok)
        throw new MediaError(
          "The media service could not check the analysis copy.",
        );
      file = z
        .object({
          name: z.string(),
          uri: z.string(),
          mimeType: z.string(),
          state: z.string(),
        })
        .parse(await res.json());
    }
    if (file.state !== "ACTIVE")
      throw new MediaError(
        "The media service could not process this recording. Try exporting it as MP4.",
      );
    return await task(file);
  } finally {
    await fetch(`${root}/v1beta/${parsed.file.name}`, {
      method: "DELETE",
      headers: headers(),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
}
export async function transcribe(path: string, sourceLanguage: string) {
  if (!(await providerCapacity()))
    throw new GenerationError(
      "Demo capacity reached for today. Keep original audio or try again tomorrow.",
      429,
    );
  return withGoogleFile(path, "audio/flac", async (file) => {
    const codes: Record<string, string[]> = {
      English: ["en-US"],
      Telugu: ["te-IN"],
      Hindi: ["hi-IN"],
      Tamil: ["ta-IN"],
      Hinglish: ["hi-IN", "en-IN"],
      Auto: [],
    };
    const raw = await interaction({
      model: process.env.TRANSCRIPTION_MODEL || "gemini-3.5-transcribe",
      input: [{ type: "audio", uri: file.uri, mime_type: file.mimeType }],
      generation_config: {
        transcription_config: {
          language_codes: codes[sourceLanguage] || [],
          mode: { type: "verbatim", timestamp_granularities: ["word"] },
        },
      },
    });
    const blocks = interactionBlocks(raw);
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("\n")
      .trim();
    if (!text)
      throw new MediaError(
        "No recognizable speech was returned. Inspect the audio or type the script yourself.",
      );
    // Keep optional structured provider timing when present; never manufacture word confidence.
    return {
      text,
      language:
        sourceLanguage === "Auto"
          ? inferTranscriptLanguage(text)
          : sourceLanguage,
      timing: blocks.flatMap((b) =>
        Array.isArray(b.annotations)
          ? b.annotations.filter(
              (a: { type?: string }) => a.type === "word_info",
            )
          : [],
      ),
      confidence: null,
    };
  });
}
