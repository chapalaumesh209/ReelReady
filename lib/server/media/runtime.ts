import { createServer } from "node:http";

export function mediaWorkerRuntime(
  env: Record<string, string | undefined> = process.env,
) {
  const raw = env.MEDIA_HEALTH_PORT;
  const port = raw ? Number(raw) : undefined;
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  )
    throw new Error("MEDIA_HEALTH_PORT must be a valid port.");
  return {
    only: env.MEDIA_WORKER_ONLY === "true",
    port,
    host: env.MEDIA_HEALTH_HOST || "127.0.0.1",
  };
}

/** Health only: never exposes the queue, media, environment or credentials. */
export function createMediaHealthServer(ready: () => boolean) {
  return createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (!["/", "/health"].includes(req.url || "")) {
      res.writeHead(404).end('{"error":"Not found"}');
      return;
    }
    if (!["GET", "HEAD"].includes(req.method || "")) {
      res.setHeader("Allow", "GET, HEAD");
      res.writeHead(405).end('{"error":"Use GET"}');
      return;
    }
    const healthy = ready();
    res.writeHead(healthy ? 200 : 503);
    res.end(
      req.method === "HEAD" ? undefined : JSON.stringify({ ready: healthy }),
    );
  });
}
