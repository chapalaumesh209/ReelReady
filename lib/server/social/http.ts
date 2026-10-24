import { GenerationError } from "../../generation";
export class SocialAPIError extends GenerationError {
  constructor(public readonly providerStatus: number) {
    super(
      providerStatus === 429
        ? "This platform is busy or has reached its allowance. Please try again later."
        : providerStatus === 401 || providerStatus === 403
          ? "Reconnect this account and check that publishing permissions are approved."
          : "The platform could not complete this operation. Your reel is safe.",
      providerStatus === 429
        ? 429
        : providerStatus === 401 || providerStatus === 403
          ? 409
          : 502,
    );
  }
}
export async function socialFetch(url: string, options: RequestInit = {}) {
  const u = new URL(url);
  const allowed = [
    "www.googleapis.com",
    "youtube.googleapis.com",
    "oauth2.googleapis.com",
    "api.x.com",
    "api.instagram.com",
    "graph.instagram.com",
  ];
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !allowed.includes(u.hostname) ||
    (u.port && u.port !== "443")
  )
    throw new GenerationError(
      "The platform returned an unsupported endpoint.",
      502,
    );
  try {
    return await fetch(u, {
      ...options,
      redirect: options.redirect || "error",
      signal: options.signal || AbortSignal.timeout(30000),
    });
  } catch {
    throw new GenerationError(
      "The platform response could not be confirmed. Check delivery before trying again.",
      502,
    );
  }
}
export async function socialJSON<T = Record<string, unknown>>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await socialFetch(url, options);
  if (!r.ok) throw new SocialAPIError(r.status);
  if (r.status === 204) return {} as T;
  try {
    return (await r.json()) as T;
  } catch {
    throw new GenerationError(
      "The platform returned an incomplete response. Please check delivery.",
      502,
    );
  }
}
export const bearer = (access: string) => ({
  Authorization: `Bearer ${access}`,
});
