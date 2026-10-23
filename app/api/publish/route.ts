import { z } from "zod";
import { storedURL } from "@/lib/supabase";
import { GenerationError } from "@/lib/generation";
import {
  body,
  capability,
  digest,
  failure,
  json,
  limit,
  session,
  sign,
} from "@/lib/server";
import { publishInput, type Platform } from "@/lib/workflow";
import {
  connections,
  deliveries,
  providerFailure,
  publishingFields,
  uploadPost,
  validatePublish,
} from "@/lib/upload-post";
import { videoStream, publishingStream } from "@/lib/media-server";
export async function POST(req: Request) {
  try {
    const visitor = await session(req);
    let preparedCap: Record<string, unknown> | undefined;
    // Prepare a signed, immutable publishing request before sending the large video.
    if (req.headers.get("content-type")?.includes("application/json")) {
      limit(visitor.id, "publish-prepare", 12);
      const incoming = await body(
        req,
        z.union([
          publishInput,
          z.object({ action: z.literal("send"), token: z.string().max(96000) }),
        ]),
      );
      if ("action" in incoming) {
        preparedCap = await capability(req, incoming.token, "publish");
      } else {
        const data = incoming;
        validatePublish(data);
        const state = await connections(visitor.id);
        if (!state.configured)
          throw new GenerationError(
            "Upload-Post is not connected on the server yet.",
            503,
          );
        for (const p of data.platforms)
          if (!state.accounts[p]?.connected)
            throw new GenerationError(
              `Connect your ${p} account before publishing.`,
              409,
            );
        // Same reel + same payload => same upstream job across retries, browser reloads and server instances.
        const requestId = await digest(
          JSON.stringify({ visitor: visitor.id, ...data }),
        );
        const token = await sign(
          { visitor: visitor.id, data, requestId },
          "publish",
          3600,
        );
        const tracking = await sign(
          {
            visitor: visitor.id,
            requestId,
            platforms: data.platforms,
            scheduledAt: data.scheduledAt,
          },
          "delivery",
          366 * 86400,
        );
        return json({ token, tracking });
      }
    }
    limit(visitor.id, "publish-upload", 12);
    let videoRequest: Request | undefined;
    let cap = preparedCap;
    if (!cap) {
      const packed = await publishingStream(req);
      videoRequest = packed.videoRequest;
      cap = await capability(req, packed.token, "publish");
    }
    const data = publishInput.parse(cap.data);
    validatePublish(data);
    let response: Response;
    if (data.assetToken) {
      const ttl = data.scheduledAt
        ? Math.max(
            3600,
            Math.ceil((Date.parse(data.scheduledAt) - Date.now()) / 1000) +
              2 * 86400,
          )
        : 86400;
      const { url, cap: asset } = await storedURL(req, data.assetToken, ttl);
      if (asset.size !== data.size)
        return json(
          { error: "The stored video does not match the reviewed file." },
          409,
        );
      const form = new FormData();
      for (const [key, value] of publishingFields(
        data,
        visitor.id,
        String(cap.requestId),
      ))
        form.append(key, value);
      form.append("video", url);
      response = await uploadPost("/api/upload", {
        method: "POST",
        headers: { "Idempotency-Key": String(cap.requestId) },
        body: form,
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(60000)]),
      });
    } else {
      if (!videoRequest)
        return json(
          { error: "Upload the selected video before sending." },
          400,
        );
      const { mime, stream, size } = await videoStream(videoRequest, data.size);
      const boundary = `rr${crypto.randomUUID().replaceAll("-", "")}`,
        enc = new TextEncoder();
      let preamble = "";
      for (const [key, value] of publishingFields(
        data,
        visitor.id,
        String(cap.requestId),
      ))
        preamble += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
      preamble += `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="reel.${mime === "video/webm" ? "webm" : mime === "video/quicktime" ? "mov" : "mp4"}"\r\nContent-Type: ${mime}\r\n\r\n`;
      const first = enc.encode(preamble),
        last = enc.encode(`\r\n--${boundary}--\r\n`),
        reader = stream.getReader();
      let stage = 0;
      const multipart = new ReadableStream<Uint8Array>({
        async pull(c) {
          if (stage === 0) {
            stage = 1;
            c.enqueue(first);
            return;
          }
          const r = await reader.read();
          if (!r.done) {
            c.enqueue(r.value);
            return;
          }
          c.enqueue(last);
          c.close();
        },
        cancel() {
          return reader.cancel();
        },
      });
      response = await uploadPost("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(first.byteLength + size + last.byteLength),
          "Idempotency-Key": String(cap.requestId),
        },
        body: multipart,
        duplex: "half",
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(180000)]),
      } as RequestInit);
    }
    if (!response.ok) return providerFailure(response);
    const raw = (await response.json()) as Record<string, unknown>;
    if (raw.success === false)
      throw new GenerationError(
        "The publishing service did not accept this reel. Check its status before retrying.",
        502,
      );
    const requestId = String(raw.request_id || cap.requestId),
      jobId = typeof raw.job_id === "string" ? raw.job_id : undefined;
    const token = await sign(
      {
        visitor: visitor.id,
        requestId,
        jobId,
        platforms: data.platforms,
        scheduledAt: data.scheduledAt,
      },
      "delivery",
      366 * 86400,
    );
    const results = deliveries(raw, data.platforms, data.scheduledAt);
    return json({
      token,
      deliveries: results,
      scheduledAt: data.scheduledAt,
      done: results.every((r) =>
        ["published", "failed", "skipped"].includes(r.state),
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function GET(req: Request) {
  try {
    const cap = await capability(
      req,
      new URL(req.url).searchParams.get("token") || "",
      "delivery",
    );
    const query = cap.jobId
      ? `job_id=${encodeURIComponent(String(cap.jobId))}`
      : `request_id=${encodeURIComponent(String(cap.requestId))}`;
    const response = await uploadPost(`/api/uploadposts/status?${query}`);
    if (response.status === 404)
      return json(
        {
          error:
            "No delivery has been found yet. Wait a moment and check again before resending.",
        },
        404,
      );
    if (!response.ok) return providerFailure(response);
    const raw = (await response.json()) as Record<string, unknown>;
    const results = deliveries(
      raw,
      cap.platforms as Platform[],
      cap.scheduledAt as string | null,
    );
    return json({
      token: new URL(req.url).searchParams.get("token"),
      deliveries: results,
      scheduledAt: cap.scheduledAt,
      done: results.every((r) =>
        ["published", "failed", "skipped"].includes(r.state),
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
