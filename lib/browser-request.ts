/** Only reads, or writes backed by a server idempotency key, may be replayed. */
export class BrowserRequestError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code?: string,
  ) {
    super(message);
    this.name = "BrowserRequestError";
  }
}
export async function browserRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
  options: { idempotent?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const replayable = body === undefined || options.idempotent === true;
  for (let attempt = 0; attempt < (replayable ? 2 : 1); attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 20000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let failure: BrowserRequestError;
    try {
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestSignal,
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data !== null) return data as T;
      const detail =
        data && typeof data === "object"
          ? (data as { error?: unknown; code?: unknown })
          : {};
      failure = new BrowserRequestError(
        typeof detail.error === "string"
          ? detail.error
          : "The server could not finish this request. Your recording and words are safe. Please try again.",
        response.ok ? 502 : response.status,
        typeof detail.code === "string" ? detail.code : undefined,
      );
    } catch {
      signal?.throwIfAborted();
      failure = new BrowserRequestError(
        timeout.aborted
          ? "The connection took too long. Your recording and words are safe. Please try again."
          : "ReelReady could not be reached. Check your connection, then try again. Your recording and words are safe.",
      );
    }
    if (
      !replayable ||
      attempt === 1 ||
      ![0, 408, 502, 503, 504].includes(failure.status)
    )
      throw failure;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        signal?.removeEventListener("abort", cancel);
        resolve();
      };
      const timer = setTimeout(done, 600);
      const cancel = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }
  throw new BrowserRequestError("Please try again. Your recording is safe.");
}
