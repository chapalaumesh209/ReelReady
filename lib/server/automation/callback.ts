import { timingSafeEqual } from "node:crypto";
import { GenerationError } from "../../generation";
import { failure, json } from "../../server";

/** Machine callback: no browser session, no user identity supplied by n8n. */
export async function automationCallback(
  req: Request,
  handle: (input: unknown) => Promise<Record<string, unknown>>,
) {
  try {
    const key = process.env.N8N_PUBLISHER_SECRET || "";
    if (key.length < 32)
      throw new GenerationError(
        "Workflow authentication is not configured.",
        503,
      );
    const expected = Buffer.from(`Bearer ${key}`),
      supplied = Buffer.from(req.headers.get("authorization") || "");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new GenerationError("Workflow authentication required.", 401);
    if (req.method !== "POST") throw new GenerationError("Use POST.", 405);
    if (!req.body)
      throw new GenerationError("A workflow authorization is required.", 400);
    if (Number(req.headers.get("content-length") || 0) > 4096)
      throw new GenerationError("Request too large.", 413);
    const reader = req.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) {
        await reader.cancel();
        throw new GenerationError("Request too large.", 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new GenerationError("Invalid workflow authorization.", 400);
    }
    return json(await handle(input));
  } catch (error) {
    // Existing authorizers produce fixed safe errors; arbitrary upstream errors
    // must not expose credentials or storage addresses through this public route.
    return failure(error);
  }
}
