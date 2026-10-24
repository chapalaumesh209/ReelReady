import { GenerationError } from "./generation";
export function googleHeaders() {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    throw new GenerationError("Video understanding is not connected yet.", 503);
  return { "x-goog-api-key": key };
}
/** Stream uploads through the Worker; never buffer an entire video in its 128MB isolate. */
export async function videoStream(req: Request, expectedSize?: number) {
  const size = Number(req.headers.get("x-file-size")),
    mime = req.headers.get("content-type")?.split(";")[0] || "";
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    (expectedSize !== undefined && size !== expectedSize)
  )
    throw new GenerationError(
      "The video size must be valid and match the reviewed file.",
      413,
    );
  if (
    !["video/mp4", "video/webm", "video/quicktime"].includes(mime) ||
    !req.body
  )
    throw new GenerationError("Upload an MP4, MOV or WebM video.", 415);
  const reader = req.body.getReader();
  let first = new Uint8Array(0);
  while (first.length < 12) {
    const next = await reader.read();
    if (next.done) break;
    const joined = new Uint8Array(first.length + next.value.length);
    joined.set(first);
    joined.set(next.value, first.length);
    first = joined;
  }
  const mp4 = String.fromCharCode(...first.slice(4, 8)) === "ftyp",
    webm =
      first[0] === 0x1a &&
      first[1] === 0x45 &&
      first[2] === 0xdf &&
      first[3] === 0xa3;
  if (mime === "video/webm" ? !webm : !mp4) {
    await reader.cancel();
    throw new GenerationError(
      "This file does not look like a supported video. Export it as MP4 and try again.",
      415,
    );
  }
  let total = first.length,
    initial = true;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (initial) {
        initial = false;
        controller.enqueue(first);
        return;
      }
      const next = await reader.read();
      if (next.done) {
        if (total !== size) {
          controller.error(new Error("Upload size mismatch"));
          return;
        }
        controller.close();
        return;
      }
      total += next.value.length;
      if (total > size) {
        await reader.cancel();
        controller.error(new Error("Upload too large"));
        return;
      }
      controller.enqueue(next.value);
    },
    cancel() {
      return reader.cancel();
    },
  });
  return { size, mime, stream };
}
export async function googleFile(name: string, signal: AbortSignal) {
  if (!/^files\/[a-zA-Z0-9_-]+$/.test(name))
    throw new GenerationError("Upload this video again.", 400);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${name}`,
    { headers: googleHeaders(), signal },
  );
  if (response.status === 404)
    throw new GenerationError(
      "The analysis copy of this video has expired. Upload it again; your local draft is safe.",
      410,
    );
  if (!response.ok)
    throw new GenerationError(
      "The video service could not check this file. Try again.",
      502,
    );
  return (await response.json()) as {
    name: string;
    uri: string;
    mimeType: string;
    state: string;
  };
}

/** A small signed prefix precedes the raw video, avoiding oversized HTTP headers
 * when multilingual captions contain many UTF-8 bytes. */
export async function publishingStream(req: Request) {
  if (!req.body) throw new GenerationError("Choose a video to publish.", 400);
  const reader = req.body.getReader();
  let prefix = new Uint8Array(0),
    remaining = new Uint8Array(0);
  while (true) {
    const r = await reader.read();
    if (r.done)
      throw new GenerationError("The publishing request was incomplete.", 400);
    const end = r.value.indexOf(10);
    const part = end < 0 ? r.value : r.value.slice(0, end);
    if (prefix.length + part.length > 100000) {
      await reader.cancel();
      throw new GenerationError("Publishing text is too long.", 413);
    }
    const combined = new Uint8Array(prefix.length + part.length);
    combined.set(prefix);
    combined.set(part, prefix.length);
    prefix = combined;
    if (end >= 0) {
      remaining = r.value.slice(end + 1);
      break;
    }
  }
  let token: string;
  try {
    token = JSON.parse(new TextDecoder().decode(prefix)).token;
    if (typeof token !== "string") throw new Error();
  } catch {
    await reader.cancel();
    throw new GenerationError("The publishing request could not be read.", 400);
  }
  let first = true;
  const stream = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (first) {
        first = false;
        if (remaining.length) {
          c.enqueue(remaining);
          return;
        }
      }
      const r = await reader.read();
      if (r.done) c.close();
      else c.enqueue(r.value);
    },
    cancel() {
      return reader.cancel();
    },
  });
  const headers = new Headers(req.headers);
  headers.set("content-type", headers.get("x-video-type") || "");
  headers.delete("content-length");
  const videoRequest = new Request(req.url, {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
    signal: req.signal,
  } as RequestInit);
  return { token, videoRequest };
}
