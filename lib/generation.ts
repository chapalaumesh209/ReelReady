import { z } from "zod";
import { takeProviderCall } from "./server/provider-budget";
/** Server-only Gemini adapter. The browser only calls our same-origin route. */
export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
    public readonly code?: string,
  ) {
    super(message);
  }
}
export function generationConfiguration() {
  const requested = process.env.LLM_PROVIDER || "gemini";
  const provider =
    requested === "demo" && process.env.GEMINI_API_KEY ? "gemini" : requested;
  return {
    provider,
    key:
      provider === "demo"
        ? ""
        : process.env.LLM_API_KEY ||
          (provider === "gemini"
            ? process.env.GEMINI_API_KEY
            : provider === "openai"
              ? process.env.OPENAI_API_KEY
              : process.env.ANTHROPIC_API_KEY),
    model:
      process.env.LLM_MODEL ||
      (provider === "gemini"
        ? process.env.GEMINI_MODEL || "gemini-3.1-flash-lite"
        : provider === "openai"
          ? "gpt-4.1-mini"
          : "claude-sonnet-4-6"),
  };
}
type GenerationOptions = {
  instructions: string;
  content: unknown;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  providerOverride?: "gemini";
  mediaParts?: Array<{ fileData: { fileUri: string; mimeType: string } }>;
};
export function generationRequestTimeout(media = false) {
  const fallback = media ? 90000 : 45000;
  const value = Number(
    process.env[media ? "AI_MEDIA_TIMEOUT_MS" : "AI_REQUEST_TIMEOUT_MS"] ||
      fallback,
  );
  return Number.isSafeInteger(value) && value >= 1000 && value <= 120000
    ? value
    : fallback;
}
export async function generateStructuredContent(
  options: GenerationOptions,
): Promise<unknown> {
  const media = !!options.mediaParts?.length;
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(generationRequestTimeout(media)),
  ]);
  try {
    return await requestStructuredContent({ ...options, signal });
  } catch (error) {
    // Preserve an explicit cancellation, including its reason. A slow provider
    // can be retried once by validated() while the enclosing route has time left.
    if (options.signal.aborted) throw error;
    if (
      signal.aborted ||
      (error instanceof Error && error.name === "TimeoutError")
    )
      throw new GenerationError(
        media
          ? "Video analysis took longer than expected. Your uploaded recording is saved; retry the review."
          : "The writing service took longer than expected. Your input and existing captions are saved; try again.",
        504,
      );
    throw error;
  }
}
async function requestStructuredContent(
  options: GenerationOptions,
): Promise<unknown> {
  let { key, model, provider } = generationConfiguration();
  const signal = options.signal;
  if (options.mediaParts?.length || options.providerOverride === "gemini") {
    provider = "gemini";
    key = process.env.GEMINI_API_KEY;
    model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  }
  if (provider === "openai" || provider === "anthropic") {
    if (!key)
      throw new GenerationError(
        "Live writing needs a server-side AI connection.",
        503,
      );
    await takeProviderCall();
    const response = await fetch(
      provider === "openai"
        ? "https://api.openai.com/v1/responses"
        : "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        signal,
        headers:
          provider === "openai"
            ? {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
              }
            : {
                "Content-Type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
              },
        body: JSON.stringify(
          provider === "openai"
            ? {
                model,
                instructions: options.instructions,
                input: JSON.stringify(options.content),
                text: {
                  format: {
                    type: "json_schema",
                    name: "reelready",
                    schema: options.schema,
                    strict: true,
                  },
                },
                max_output_tokens: 4000,
              }
            : {
                model,
                max_tokens: 4000,
                system: options.instructions,
                messages: [
                  { role: "user", content: JSON.stringify(options.content) },
                ],
                tools: [
                  {
                    name: "reelready_result",
                    description: "Return the requested structured result.",
                    input_schema: options.schema,
                  },
                ],
                tool_choice: { type: "tool", name: "reelready_result" },
              },
        ),
      },
    );
    if (!response.ok)
      throw new GenerationError(
        "The writing service could not finish. Check its server connection or try again later.",
        response.status === 429 ? 429 : 502,
      );
    const raw = z
      .object({
        content: z
          .array(z.object({ type: z.string(), input: z.unknown().optional() }))
          .optional(),
        output: z
          .array(
            z.object({
              content: z
                .array(
                  z.object({ type: z.string(), text: z.string().optional() }),
                )
                .optional(),
            }),
          )
          .optional(),
      })
      .parse(await response.json());
    if (provider === "anthropic") {
      const result = raw.content?.find(
        (c: { type: string }) => c.type === "tool_use",
      );
      if (result) return result.input;
    } else {
      const value = raw.output
        ?.flatMap((o) => o.content || [])
        .find((c: { type: string }) => c.type === "output_text")?.text;
      if (value) return JSON.parse(value);
    }
    throw new GenerationError(
      "The writing service returned an incomplete result.",
      502,
    );
  }
  if (!key)
    throw new GenerationError(
      "Live generation is not connected yet. Your input is saved.",
      503,
    );
  if (!/^[a-zA-Z0-9._-]+$/.test(model))
    throw new GenerationError(
      "The writing service needs its model configuration updated.",
      503,
    );
  await takeProviderCall();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.instructions }] },
        contents: [
          {
            role: "user",
            parts: [
              ...(options.mediaParts || []),
              { text: JSON.stringify(options.content) },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 3500,
          responseMimeType: "application/json",
          responseJsonSchema: options.schema,
        },
      }),
    },
  );
  if (!response.ok) {
    if (response.status === 429)
      throw new GenerationError(
        "The writing service is busy or has reached its usage limit. Your input is safe—please try again shortly.",
        503,
      );
    if (response.status === 401 || response.status === 403)
      throw new GenerationError(
        "The writing service needs its connection updated. Your input is saved.",
        503,
      );
    if (response.status === 404)
      throw new GenerationError(
        "The writing model is temporarily unavailable. Your input is saved—please try again later.",
        503,
      );
    throw new GenerationError(
      "The writing service could not finish this kit. Please try again.",
    );
  }
  const data = (await response.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };
  const candidate = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY")
    throw new GenerationError(
      "We could not draft this content. Try describing the video in a different way.",
      422,
    );
  if (candidate?.finishReason !== "STOP")
    throw new GenerationError(
      "The writing service stopped before finishing. Please shorten your input or try again.",
    );
  const raw = candidate.content?.parts
    ?.filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  try {
    return JSON.parse(raw || "");
  } catch {
    throw new GenerationError(
      "The kit arrived in an unexpected format. Your input is saved—please try again.",
    );
  }
}
