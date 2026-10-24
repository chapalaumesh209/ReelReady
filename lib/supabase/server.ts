import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { GenerationError } from "../generation";
export type CookieChange = {
  name: string;
  value: string;
  options: CookieOptions;
};
export function publicConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    key:
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      "",
  };
}
const requests = new WeakMap<Request, ReturnType<typeof createContext>>();
function createContext(req: Request) {
  const { url, key } = publicConfig();
  if (!url || !key)
    throw new GenerationError(
      "Development setup: configure Supabase and enable anonymous sign-ins to start your private workspace.",
      503,
    );
  const changes: CookieChange[] = [];
  const jar = new Map(
    (req.headers.get("cookie") || "")
      .split(";")
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1)] as [string, string];
      })
      .filter(([k]) => !!k),
  );
  const db = createServerClient(url, key, {
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal || AbortSignal.timeout(15000),
        }),
      headers: req.headers.get("authorization")
        ? { Authorization: req.headers.get("authorization")! }
        : {},
    },
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(req.url).protocol === "https:",
      path: "/",
    },
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (all) => {
        for (const c of all) {
          jar.set(c.name, c.value);
          changes.push(c);
        }
      },
    },
  });
  return { db, changes };
}
export function authContext(req: Request) {
  let c = requests.get(req);
  if (!c) {
    c = createContext(req);
    requests.set(req, c);
  }
  return c;
}
export function withSession<
  T extends (req: Request, ...args: never[]) => Promise<Response>,
>(handler: T): T {
  return (async (req: Request, ...args: never[]) => {
    const response = await handler(req, ...args);
    for (const c of requests.get(req)?.changes || []) {
      const o = c.options;
      response.headers.append(
        "Set-Cookie",
        `${c.name}=${c.value}; Path=${o.path || "/"}; HttpOnly; SameSite=Lax${o.secure ? "; Secure" : ""}${o.maxAge !== undefined ? `; Max-Age=${o.maxAge}` : ""}`,
      );
    }
    return response;
  }) as T;
}
