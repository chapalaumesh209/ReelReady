// Explicitly enable fixture output only in the isolated automated test process.
process.env.ALLOW_SAMPLE_OUTPUT = "true";
// Test-only transport scoping: exercise the real limiter RPC without consuming live allowance.
// This file is loaded only by test scripts. Production code and budget keys are unchanged.
import { after } from "node:test";
import { randomUUID } from "node:crypto";
const root = process.env.SUPABASE_URL || "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(root))
  throw new Error("Provider budget integration tests require local Supabase.");
const baseFetch = globalThis.fetch,
  origin = new URL(root).origin;
const suffix = `:isolated-test:${randomUUID()}`;
const created = new Set();
const scoped = (value) => {
  if (
    typeof value !== "string" ||
    !/^provider-day:\d{4}-\d{2}-\d{2}$/.test(value)
  )
    return value;
  const key = value + suffix;
  created.add(key);
  return key;
};
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== origin) return baseFetch(input, init);
  let options = init;
  if (
    url.pathname.endsWith("/rpc/reelready_take_limit") &&
    typeof init?.body === "string"
  ) {
    const body = JSON.parse(init.body);
    if (/^provider-day:/.test(body.p_key || "")) {
      body.p_key = scoped(body.p_key);
      const headers = new Headers(init.headers);
      headers.delete("content-length");
      options = { ...init, headers, body: JSON.stringify(body) };
    }
  }
  if (url.pathname.endsWith("/reelready_rate_limits")) {
    const key = url.searchParams.get("key");
    if (key?.startsWith("eq.provider-day:"))
      url.searchParams.set("key", "eq." + scoped(key.slice(3)));
  }
  return baseFetch(
    input instanceof Request ? new Request(url, input) : url,
    options,
  );
};
after(async () => {
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const key of created) {
    const url = new URL("/rest/v1/reelready_rate_limits", origin);
    url.searchParams.set("key", `eq.${key}`);
    const response = await baseFetch(url, {
      method: "DELETE",
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    });
    if (!response.ok)
      throw new Error(
        "Could not clean up this test's isolated provider counter.",
      );
  }
});
