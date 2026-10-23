import { z } from "zod";
import { GenerationError } from "./generation";
export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (
    (origin && origin !== new URL(req.url).origin) ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new GenerationError(
      "Please use ReelReady in its own browser tab.",
      403,
    );
}
export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  sameOrigin(req);
  if (!req.body)
    throw new GenerationError("The request is empty. Try again.", 400);
  const reader = req.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > 96000) {
      await reader.cancel();
      throw new GenerationError(
        "Please shorten the text before trying again.",
        413,
      );
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = new TextDecoder().decode(bytes);
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new GenerationError(
      "Some details are missing or invalid. Check the form and try again.",
      400,
    );
  }
}
export function failure(error: unknown) {
  if (error instanceof GenerationError)
    return json({ error: error.message }, error.status);
  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  )
    return json(
      { error: "This took too long. Your draft is safe. Please try again." },
      504,
    );
  return json(
    {
      error:
        "This step could not finish. Your draft is safe. Please try again.",
    },
    502,
  );
}
const encoder = new TextEncoder();
function encode(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function decode(value: string) {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
async function signingKey() {
  const secret = process.env.SESSION_SECRET || process.env.GEMINI_API_KEY;
  if (!secret)
    throw new GenerationError(
      "The server connection needs to be configured.",
      503,
    );
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`reelready.session.v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function sign(
  data: Record<string, unknown>,
  purpose: string,
  seconds: number,
) {
  const payload = encode(
    encoder.encode(
      JSON.stringify({ ...data, purpose, exp: Date.now() + seconds * 1000 }),
    ),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    encoder.encode(payload),
  );
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verify(
  token: string,
  purpose: string,
): Promise<Record<string, unknown>> {
  try {
    const [payload, signature, ...rest] = token.split(".");
    if (rest.length || !payload || !signature || token.length > 96000)
      throw new Error();
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await signingKey(),
        decode(signature),
        encoder.encode(payload),
      ))
    )
      throw new Error();
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (
      data.purpose !== purpose ||
      typeof data.exp !== "number" ||
      data.exp < Date.now()
    )
      throw new Error();
    return data;
  } catch {
    throw new GenerationError(
      "This session or file has expired. Reload the page or upload the video again.",
      401,
    );
  }
}
export async function session(req: Request, create = false) {
  sameOrigin(req);
  const token = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("rr_session="))
    ?.slice(11);
  if (token) {
    try {
      const data = await verify(token, "session");
      if (typeof data.id === "string" && /^[a-f0-9-]{36}$/.test(data.id))
        return { id: data.id, cookie: undefined };
    } catch {}
  }
  if (!create)
    throw new GenerationError(
      "Your browser session expired. Refresh the page to continue.",
      401,
    );
  const id = crypto.randomUUID();
  return {
    id,
    cookie: `rr_session=${await sign({ id }, "session", 2592000)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`,
  };
}
export async function capability(req: Request, token: string, purpose: string) {
  const visitor = await session(req);
  const data = await verify(token, purpose);
  if (data.visitor !== visitor.id)
    throw new GenerationError(
      "This file or publishing request belongs to another browser session.",
      403,
    );
  return data;
}
const limits = new Map<string, { n: number; until: number }>();
export function limit(
  id: string,
  action: string,
  max: number,
  window = 3600000,
) {
  if (limits.size > 5000)
    for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
  const key = `${id}:${action}`,
    old = limits.get(key),
    bucket =
      old && old.until > Date.now()
        ? old
        : { n: 0, until: Date.now() + window };
  if (bucket.n >= max)
    throw new GenerationError(
      "You have reached this step’s temporary usage limit. Please try again later.",
      429,
    );
  bucket.n++;
  limits.set(key, bucket);
}
export async function digest(value: string) {
  return encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
