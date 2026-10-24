import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { GenerationError } from "../../generation";

type Dependencies = {
  secret: string;
  run: () => Promise<boolean>;
  heartbeat: () => Promise<void>;
  demo: () => boolean;
  authorize?: (input: unknown) => Promise<Record<string, unknown>>;
  connect?: (input: unknown) => Promise<Record<string, unknown>>;
  media?: (
    input: unknown,
    signal: AbortSignal,
  ) => Promise<{
    stream: ReadableStream<Uint8Array>;
    size: number;
    mime: string;
  }>;
};

// Private worker control plane. Tick accepts no payload; authorization endpoints
// consume server-minted proofs and derive canonical fields from owned records.
export function createPublisherBridge(deps: Dependencies): Server {
  if (deps.secret.length < 32)
    throw new Error(
      "Publisher bridge requires a secret of at least 32 characters.",
    );
  const expected = Buffer.from(`Bearer ${deps.secret}`);
  let busy = false;
  const server = createServer(async (req, res) => {
    const reply = (status: number, body: Record<string, unknown>) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/healthz") {
      reply(200, { status: "online" });
      return;
    }
    const authorize =
      req.url === "/authorize"
        ? deps.authorize
        : req.url === "/connect-authorize"
          ? deps.connect
          : undefined;
    const mediaTransfer = req.url === "/media-download" && deps.media;
    if (req.url !== "/tick" && !authorize && !mediaTransfer) {
      reply(404, { error: "Not found." });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      reply(405, { error: "Use POST." });
      return;
    }
    const supplied = Buffer.from(req.headers.authorization || "");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      reply(401, { error: "Publisher authentication required." });
      return;
    }
    if (authorize || mediaTransfer) {
      if (Number(req.headers["content-length"] || 0) > 4096) {
        req.resume();
        reply(413, { error: "Request too large." });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size <= 4096) chunks.push(chunk);
          });
          req.once("end", resolve);
          req.once("error", reject);
        });
        if (size > 4096) {
          reply(413, { error: "Request too large." });
          return;
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (mediaTransfer && deps.media) {
          const abort = new AbortController();
          res.once("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          const file = await deps.media(input, abort.signal);
          res.writeHead(200, {
            "Content-Type": file.mime,
            "Content-Length": file.size,
            "Content-Disposition": 'attachment; filename="reelready.mp4"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          await pipeline(Readable.fromWeb(file.stream as never), res);
        } else reply(200, await authorize!(input));
      } catch (e) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        reply(e instanceof GenerationError ? e.status : 400, {
          error: "Publication authorization could not be confirmed.",
        });
      }
      return;
    }
    if (
      req.headers["transfer-encoding"] ||
      Number(req.headers["content-length"] || 0) !== 0
    ) {
      req.resume();
      reply(400, { error: "This endpoint accepts no request payload." });
      return;
    }
    if (busy) {
      reply(202, { busy: true });
      return;
    }
    busy = true;
    try {
      await deps.heartbeat();
      const demo = deps.demo();
      // Demo mode must never execute real delivery, even with a populated queue.
      const claimed = demo ? false : await deps.run();
      reply(200, { claimed, demo });
    } catch {
      // Never echo upstream responses, credentials, job payloads or source URLs.
      reply(503, {
        error:
          "Publishing is temporarily unavailable. Saved jobs remain queued.",
      });
    } finally {
      busy = false;
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}
