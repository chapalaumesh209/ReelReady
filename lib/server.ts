import { authContext } from "./supabase/server";
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
    (origin &&
      origin !==
        (process.env.APP_URL
          ? new URL(process.env.APP_URL).origin
          : new URL(req.url).origin)) ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new GenerationError(
      "Please use ReelReady in its own browser tab.",
      403,
    );
}
export async function body<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
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
  if (error instanceof z.ZodError)
    return json(
      {
        error:
          "Some details are missing or invalid. Review your input and try again.",
      },
      400,
    );
  if (error instanceof GenerationError)
    return json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      error.status,
    );
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
  const secret =
    process.env.SESSION_SECRET ||
    process.env.GEMINI_API_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
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
const authenticated = new WeakMap<
  Request,
  Promise<{ id: string; cookie: undefined }>
>();
export async function session(req: Request, create = false) {
  sameOrigin(req);
  let pending = authenticated.get(req);
  if (!pending) {
    pending = (async () => {
      const { db } = authContext(req);
      let { data, error } = await db.auth.getUser(
        req.headers.get("authorization")?.replace(/^Bearer /i, ""),
      );
      if ((error || !data.user) && create) {
        const signed = await db.auth.signInAnonymously();
        if (signed.error || !signed.data.user)
          throw new GenerationError(
            "Development setup: enable anonymous sign-ins in Supabase Auth. Your local draft is preserved.",
            503,
          );
        data = { user: signed.data.user };
        error = null;
      }
      if (error || !data.user)
        throw new GenerationError(
          "Your private session is unavailable. Refresh to reconnect to Supabase.",
          401,
        );
      return { id: data.user.id, cookie: undefined };
    })();
    authenticated.set(req, pending);
  }
  return pending;
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
