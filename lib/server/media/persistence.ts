/** Retry only reads and explicitly lease/version-guarded progress writes.
 * Never use this for queue claims, paid calls, inserts or publishing. */
export async function mediaPersistence<T extends { error: unknown }>(
  operation: () => PromiseLike<T>,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await operation();
    if (!result.error || attempt >= 2 || !transientMediaError(result.error))
      return result;
    await pause(attempt === 0 ? 350 : 1000);
  }
}
export function transientMediaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  // Schema, auth and ownership failures are permanent; never hide them in retries.
  if (
    code &&
    ![
      "08000",
      "08003",
      "08006",
      "57P01",
      "57P03",
      "53300",
      "PGRST000",
      "PGRST001",
      "PGRST002",
    ].includes(code)
  )
    return false;
  return (
    !!code ||
    [408, 502, 503, 504].includes(Number(e.status)) ||
    (typeof e.message === "string" &&
      /fetch failed|network|timed?\s*out|timeout|abort|connection reset|socket|bad gateway|service unavailable/i.test(
        e.message,
      ))
  );
}
