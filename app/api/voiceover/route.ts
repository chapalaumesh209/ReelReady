import { z } from "zod";
import { GenerationError } from "@/lib/generation";
import { body, failure, limit, session } from "@/lib/server";
import { googleHeaders } from "@/lib/media-server";
export async function POST(req: Request) {
  try {
    const visitor = await session(req);
    limit(visitor.id, "voiceover", 10);
    const { script } = await body(
      req,
      z.object({ script: z.string().min(5).max(3000) }),
    );
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
      {
        method: "POST",
        headers: { ...googleHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Read the following English voiceover exactly as written, in a clear, friendly natural voice. Do not read this instruction.\n\n${script}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(120000)]),
      },
    );
    if (!response.ok)
      throw new GenerationError(
        response.status === 429
          ? "The voice service has reached its usage limit. Try again later; your approved script is saved."
          : "English voice generation is unavailable. Your original video and script are safe.",
        503,
      );
    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { data: string; mimeType: string } }>;
        };
      }>;
    };
    const audio = data.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData,
    )?.inlineData;
    if (!audio || !audio.mimeType.startsWith("audio/L16"))
      throw new GenerationError(
        "The voice service did not return usable audio. Please try again.",
        502,
      );
    const pcm = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
    const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] || 24000);
    const wav = new Uint8Array(44 + pcm.length),
      view = new DataView(wav.buffer),
      text = new TextEncoder();
    wav.set(text.encode("RIFF"), 0);
    view.setUint32(4, 36 + pcm.length, true);
    wav.set(text.encode("WAVEfmt "), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    wav.set(text.encode("data"), 36);
    view.setUint32(40, pcm.length, true);
    wav.set(pcm, 44);
    return new Response(wav, {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
