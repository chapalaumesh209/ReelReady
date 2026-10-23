/** Server-only Gemini adapter. The browser only calls our same-origin route. */
export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
  ) {
    super(message);
  }
}
export function generationConfiguration() {
  return {
    key: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
  };
}
export async function generateStructuredContent(options: {
  instructions: string;
  content: unknown;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  mediaParts?: Array<{ fileData: { fileUri: string; mimeType: string } }>;
}): Promise<unknown> {
  const { key, model } = generationConfiguration();
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
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      signal: options.signal,
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
