import { z } from "zod";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AudioSettings } from "../../audio/schema";
import { takeProviderCall } from "../provider-budget";
import { command, ffmpeg, MediaError } from "./ffmpeg";
import {
  speechCooldown,
  recordSpeechCooldown,
  speechCooldownMessage,
} from "./speech-capacity";
import { type SpeechRetryOptions, speechRateLimit } from "./speech-request";
import { FREE_SPEECH_MODEL } from "./tts-config";

const root = "https://openrouter.ai/api/v1";
const maxBytes = 12 * 1024 * 1024;
let verifiedUntil = 0;
function zeroPricing(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value);
  return (
    entries.some(([key]) => key === "prompt") &&
    entries.some(([key]) => key === "completion") &&
    entries.every(
      ([, price]) =>
        (typeof price === "string" || typeof price === "number") &&
        String(price).trim() !== "" &&
        Number.isFinite(Number(price)) &&
        Number(price) === 0,
    )
  );
}
/** Fail closed if the exact free model or any advertised endpoint starts charging. */
export async function verifyFreeSpeech(call: typeof fetch = fetch) {
  const r = await call(`${root}/models?output_modalities=speech`, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok)
    throw new MediaError(
      "Free voice pricing could not be verified. Your script is saved; retry later.",
    );
  const data = z
    .object({
      data: z.array(
        z.object({
          id: z.string(),
          pricing: z.unknown(),
          architecture: z
            .object({ output_modalities: z.array(z.string()) })
            .optional(),
        }),
      ),
    })
    .parse(await r.json());
  const model = Array.isArray(data.data)
    ? data.data.find((m: { id?: string }) => m.id === FREE_SPEECH_MODEL)
    : null;
  if (
    !model ||
    !zeroPricing(model.pricing) ||
    !model.architecture?.output_modalities?.includes("speech")
  )
    throw new MediaError(
      "The configured free voice is unavailable. No paid voice was used.",
    );
  const endpoints = await call(
    `${root}/models/${FREE_SPEECH_MODEL}/endpoints`,
    { signal: AbortSignal.timeout(15000), redirect: "error" },
  );
  if (!endpoints.ok)
    throw new MediaError(
      "Free voice pricing could not be verified. Your script is saved; retry later.",
    );
  const detail = z
    .object({
      data: z.object({
        endpoints: z.array(z.object({ pricing: z.unknown() })),
      }),
    })
    .parse(await endpoints.json());
  const routes = detail.data?.endpoints;
  if (
    !Array.isArray(routes) ||
    !routes.length ||
    routes.some((e: { pricing?: unknown }) => !zeroPricing(e.pricing))
  )
    throw new MediaError(
      "A free voice route could not be verified. No paid voice was used.",
    );
}
export function freeVoiceInstructions(settings: AudioSettings) {
  const accent = {
    "en-IN": "Indian English",
    "en-GB": "British English",
    "en-US": "US English",
  };
  return `${settings.voiceProfile?.gender === "natural" || !settings.voiceProfile ? "A natural narrator" : `A ${settings.voiceProfile.gender} narrator`}, ${settings.voiceProfile ? accent[settings.voiceProfile.accent] : settings.targetLanguage}. ${settings.style}. ${settings.pace === "natural" ? "Natural pace" : settings.pace === "slower" ? "Slightly slower pace" : "Slightly faster pace"}. Read the input verbatim in ${settings.targetLanguage}. No music or sound effects.`;
}
type Runtime = {
  fetch?: typeof fetch;
  budget?: () => Promise<void>;
  cooldown?: typeof speechCooldown;
  block?: typeof recordSpeechCooldown;
  pause?: (ms: number) => Promise<void>;
};
export async function requestFreeSpeech(
  script: string,
  settings: AudioSettings,
  options: SpeechRetryOptions = {},
  runtime: Runtime = {},
) {
  if (!script.trim() || script.length > 4000)
    throw new MediaError("Use a narration of 1 to 4,000 characters.");
  const key = process.env.OPENROUTER_API_KEY;
  if (
    !key ||
    (process.env.OPENROUTER_TTS_MODEL &&
      process.env.OPENROUTER_TTS_MODEL !== FREE_SPEECH_MODEL)
  )
    throw new MediaError(
      "The free voice service is not configured. Your script is saved.",
    );
  const call = runtime.fetch || fetch;
  const cooldown = await (runtime.cooldown || speechCooldown)(
    FREE_SPEECH_MODEL,
  );
  if (cooldown) throw new MediaError(speechCooldownMessage(cooldown));
  if (runtime.fetch || Date.now() >= verifiedUntil) {
    try {
      await verifyFreeSpeech(call);
    } catch (e) {
      if (e instanceof MediaError) throw e;
      throw new MediaError(
        "Free voice pricing could not be verified. Your script is saved; retry later.",
      );
    }
    if (!runtime.fetch) verifiedUntil = Date.now() + 300000;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await options.beforeAttempt?.();
    await (runtime.budget || takeProviderCall)();
    let r: Response;
    try {
      r = await call(`${root}/audio/speech`, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: FREE_SPEECH_MODEL,
          input: script,
          instructions: freeVoiceInstructions(settings),
          response_format: "mp3",
        }),
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      // A lost response may have consumed a free request. Do not replay blindly.
      throw new MediaError(
        "The free voice connection was interrupted. Your script is saved; retry when the connection is available.",
      );
    }
    if (r.ok) {
      if (!r.headers.get("content-type")?.startsWith("audio/") || !r.body)
        throw new MediaError(
          "The free voice service returned no playable audio. Your script is saved.",
        );
      const reader = r.body.getReader(),
        chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > maxBytes) {
            await reader.cancel();
            throw new MediaError(
              "The narration response was too large. Try shorter segments.",
            );
          }
          chunks.push(Buffer.from(next.value));
        }
      } catch (e) {
        if (e instanceof MediaError) throw e;
        throw new MediaError(
          "The voice download was interrupted. Your script is saved; retry later.",
        );
      } finally {
        reader.releaseLock();
      }
      if (size < 100)
        throw new MediaError(
          "The free voice service returned empty audio. Your script is saved.",
        );
      return Buffer.concat(chunks);
    }
    const detail = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status === 402) {
      const limit = speechRateLimit(r, detail);
      const delayMs = limit.delayMs ?? 300000;
      const block = {
        until: new Date(Date.now() + Math.max(1000, delayMs)).toISOString(),
        daily: limit.hardQuota,
      };
      await (runtime.block || recordSpeechCooldown)(block, FREE_SPEECH_MODEL);
      throw new MediaError(
        "The free voice allowance is temporarily unavailable. Your script and completed segments are saved. Retry later; no paid fallback was used.",
      );
    }
    if (attempt === 0 && (r.status >= 500 || r.status === 408)) {
      const delayMs = Math.max(2000, speechRateLimit(r, detail).delayMs ?? 0);
      if (delayMs > 30000)
        throw new MediaError(
          "The free voice service needs more time. Your script is saved; retry later.",
        );
      await options.onRetry?.({ delayMs, attempt: 1, status: r.status });
      await (runtime.pause || ((ms) => new Promise((r) => setTimeout(r, ms))))(
        delayMs,
      );
      continue;
    }
    throw new MediaError(
      "The free voice service is unavailable. Your script is saved. No paid fallback was used.",
    );
  }
  throw new MediaError(
    "Free voice generation is unavailable. Your script is saved.",
  );
}
/** Normalize real compressed audio to the worker's existing WAV contract. */
export async function freeSpeechWav(
  script: string,
  settings: AudioSettings,
  options?: SpeechRetryOptions,
) {
  const audio = await requestFreeSpeech(script, settings, options);
  await options?.beforeAttempt?.();
  return normalizeFreeSpeech(audio);
}
export async function normalizeFreeSpeech(audio: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "reelready-free-voice-"));
  try {
    const input = join(dir, "speech.mp3"),
      output = join(dir, "speech.wav");
    await writeFile(input, audio, { mode: 0o600 });
    await command(
      ffmpeg(),
      [
        "-y",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe,crypto,data",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      60000,
    );
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
