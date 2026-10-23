import { z } from "zod";
import { GenerationError } from "@/lib/generation";
import {
  body,
  capability,
  failure,
  json,
  limit,
  session,
  sign,
} from "@/lib/server";
import { storedURL } from "@/lib/supabase";
import { googleFile, googleHeaders, videoStream } from "@/lib/media-server";
export async function POST(req: Request) {
  try {
    const visitor = await session(req);
    limit(visitor.id, "upload", 12);
    let source = req;
    if (req.headers.get("content-type")?.includes("application/json")) {
      const { assetToken } = await body(
        req,
        z.object({ assetToken: z.string().max(5000) }),
      );
      const { cap, url } = await storedURL(req, assetToken, 600);
      const remote = await fetch(url, {
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(300000)]),
      });
      if (!remote.ok || !remote.body)
        throw new GenerationError(
          "The saved recording could not be opened for analysis. Please retry.",
          502,
        );
      source = new Request(req.url, {
        method: "POST",
        headers: {
          "Content-Type": String(cap.mime),
          "X-File-Size": String(cap.size),
        },
        body: remote.body,
        duplex: "half",
        signal: req.signal,
      } as RequestInit);
    }
    const { size, mime, stream } = await videoStream(source);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(120000)]);
    const start = await fetch(
      "https://generativelanguage.googleapis.com/upload/v1beta/files",
      {
        method: "POST",
        headers: {
          ...googleHeaders(),
          "Content-Type": "application/json",
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(size),
          "X-Goog-Upload-Header-Content-Type": mime,
        },
        body: JSON.stringify({ file: { display_name: "ReelReady recording" } }),
        signal,
      },
    );
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (
      !start.ok ||
      !uploadUrl ||
      new URL(uploadUrl).hostname !== "generativelanguage.googleapis.com"
    )
      throw new GenerationError(
        "The video service could not start this upload. Try again.",
        502,
      );
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        ...googleHeaders(),
        "Content-Type": mime,
        "Content-Length": String(size),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: stream,
      duplex: "half",
      signal,
    } as RequestInit);
    if (!response.ok)
      throw new GenerationError(
        response.status === 413 || response.status === 400
          ? "The video is saved, but Gemini could not accept it under its current file-processing limits. Use a smaller analysis export for this step."
          : "The analysis service could not receive this video. The saved original is safe; please retry.",
        response.status === 413 ? 413 : 502,
      );
    const { file } = (await response.json()) as {
      file: { name: string; uri: string; mimeType: string; state: string };
    };
    if (!file?.name || !file.uri)
      throw new GenerationError(
        "The video service returned an incomplete file. Try again.",
        502,
      );
    const token = await sign(
      { visitor: visitor.id, name: file.name },
      "video",
      47 * 3600,
    );
    return json({ token, state: file.state });
  } catch (e) {
    return failure(e);
  }
}
export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token") || "";
    const data = await capability(req, token, "video");
    const file = await googleFile(
      String(data.name),
      AbortSignal.timeout(15000),
    );
    return json({ state: file.state });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    const { token } = await body(
      req,
      z.object({ token: z.string().max(4000) }),
    );
    const data = await capability(req, token, "video");
    const name = String(data.name);
    if (!/^files\/[a-zA-Z0-9_-]+$/.test(name))
      throw new GenerationError("Invalid file.", 400);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}`,
      {
        method: "DELETE",
        headers: googleHeaders(),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok && response.status !== 404)
      throw new GenerationError(
        "The remote analysis copy could not be removed yet. It expires automatically within 48 hours.",
        502,
      );
    return json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}
