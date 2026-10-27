export class DraftSaveError extends Error {
  constructor(public status: number) {
    super("Draft saving did not finish.");
  }
}
export async function sendDraft<T>(state: T, signal: AbortSignal) {
  const response = await fetch("/api/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new DraftSaveError(response.status);
  }
  const result = (await response.json()) as { saved?: boolean };
  if (result.saved !== true) throw new DraftSaveError(502);
}

/** One in-flight save per editor. New edits supersede queued snapshots but
 * never abort a request that may already be committing on the server. */
export function createDraftAutosave<T>(options: {
  send: (value: T, signal: AbortSignal) => Promise<void>;
  onStatus: (status: "saving" | "saved" | "local") => void;
  onSaved?: (value: T) => void;
  debounceMs?: number;
  retryDelays?: number[];
  timeoutMs?: number;
}) {
  let latest: T,
    version = 0,
    savedVersion = 0,
    attempts = 0;
  let running = false,
    stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  const delays = options.retryDelays ?? [1000, 2500, 5000];
  function schedule(delay: number) {
    clearTimeout(timer);
    if (!stopped && !running) timer = setTimeout(() => void flush(), delay);
  }
  async function flush() {
    if (stopped || running || version === savedVersion) return;
    running = true;
    const snapshot = latest,
      snapshotVersion = version;
    active = new AbortController();
    const request = active;
    const timeout = setTimeout(
      () => request.abort(new DOMException("Save timed out", "TimeoutError")),
      options.timeoutMs ?? 20000,
    );
    let nextDelay: number | undefined;
    try {
      await options.send(snapshot, request.signal);
      if (stopped) return;
      savedVersion = snapshotVersion;
      attempts = 0;
      if (snapshotVersion === version) {
        options.onStatus("saved");
        options.onSaved?.(snapshot);
      } else nextDelay = options.debounceMs ?? 1200;
    } catch (error) {
      if (stopped) return;
      const retryable =
        !(error instanceof DraftSaveError) ||
        error.status === 408 ||
        error.status === 409 ||
        error.status === 429 ||
        error.status >= 500;
      if (snapshotVersion !== version) nextDelay = options.debounceMs ?? 1200;
      else if (retryable && attempts < delays.length)
        nextDelay = delays[attempts++];
      else options.onStatus("local");
    } finally {
      clearTimeout(timeout);
      running = false;
      active = undefined;
      if (nextDelay !== undefined) schedule(nextDelay);
    }
  }
  return {
    submit(value: T) {
      if (stopped) return;
      latest = value;
      version++;
      attempts = 0;
      options.onStatus("saving");
      schedule(options.debounceMs ?? 1200);
    },
    retry() {
      if (stopped || version === savedVersion) return;
      attempts = 0;
      options.onStatus("saving");
      schedule(0);
    },
    dispose() {
      stopped = true;
      clearTimeout(timer);
      active?.abort();
    },
  };
}
