import { takeProviderCall } from "../provider-budget";
import { MediaError } from "./ffmpeg";
import {
  speechCooldown,
  recordSpeechCooldown,
  speechCooldownMessage,
  type SpeechCooldown,
} from "./speech-capacity";

export type SpeechRetryOptions = {
  beforeAttempt?: () => Promise<void>;
  onRetry?: (retry: {
    delayMs: number;
    attempt: number;
    status: number;
  }) => Promise<void>;
};
type ProviderError = {
  error?: {
    message?: string;
    details?: Array<{
      "@type"?: string;
      retryDelay?: string;
      violations?: Array<{
        quotaMetric?: string;
        quotaId?: string;
        quotaValue?: string | number;
      }>;
    }>;
  };
};
export function speechRateLimit(response: Response, body: unknown) {
  const raw = (body as ProviderError | null)?.error?.details;
  const details = Array.isArray(raw)
    ? raw.filter((d) => d && typeof d === "object")
    : [];
  const violations = details.flatMap((d) =>
    Array.isArray(d.violations)
      ? d.violations.filter((v) => v && typeof v === "object")
      : [],
  );
  const message = (body as ProviderError | null)?.error?.message;
  // Interactions also returns { error: { code: "too_many_requests", message } }
  // without Google's RPC details. It must not be treated as per-minute congestion.
  const hardQuota =
    (typeof message === "string" &&
      /\b(?:per\s+(?:day|month)|daily|monthly)\b/i.test(message)) ||
    violations.some(
      (v) =>
        /per.?day|daily|per.?month|monthly/i.test(
          `${v.quotaMetric || ""} ${v.quotaId || ""}`,
        ) || String(v.quotaValue) === "0",
    );
  const retry = details.find(
    (d) => typeof d["@type"] === "string" && d["@type"].endsWith("RetryInfo"),
  )?.retryDelay;
  const retrySeconds =
    typeof retry === "string" && /^\d+(\.\d+)?s$/.test(retry)
      ? Number(retry.slice(0, -1))
      : NaN;
  const header = response.headers.get("retry-after");
  const headerMs = header
    ? /^\d+(\.\d+)?$/.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - Date.now()
    : NaN;
  const delays = [retrySeconds * 1000, headerMs].filter(
    (n) => Number.isFinite(n) && n >= 0,
  );
  return {
    hardQuota,
    delayMs: delays.length ? Math.max(...delays) : undefined,
  };
}

/** Speech has model/project rate limits separate from our daily safety budget.
 * Never log the response body, API key, transcript or narrated text. */
export async function requestSpeech(
  payload: Record<string, unknown>,
  headers: HeadersInit,
  options: SpeechRetryOptions = {},
  runtime: {
    fetch?: typeof fetch;
    pause?: (ms: number) => Promise<void>;
    budget?: () => Promise<void>;
    now?: () => number;
    cooldown?: () => Promise<SpeechCooldown | null>;
    block?: (cooldown: SpeechCooldown) => Promise<void>;
  } = {},
) {
  const call = runtime.fetch || fetch;
  const pause =
    runtime.pause ||
    ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = runtime.now || Date.now;
  const model = typeof payload.model === "string" ? payload.model : undefined;
  const blocked = await (runtime.cooldown || (() => speechCooldown(model)))();
  if (blocked) throw new MediaError(speechCooldownMessage(blocked));
  const deadline = now() + 180000;
  const body = JSON.stringify({ ...payload, store: false });
  for (let attempt = 0; attempt < 4; attempt++) {
    await options.beforeAttempt?.();
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await (runtime.budget || takeProviderCall)();
    let response: Response;
    try {
      response = await call(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(Math.min(120000, remaining)),
        },
      );
    } catch {
      // Socket resets and request timeouts used to escape as raw "fetch failed".
      // Retry only here, inside the already-deduplicated media operation.
      const delayMs = 2000 * 2 ** attempt;
      if (attempt === 3 || now() + delayMs >= deadline)
        throw new MediaError(
          "The speech service connection was interrupted. Your script and completed voice segments are saved. Retry when the connection is available.",
        );
      await options.onRetry?.({ delayMs, attempt: attempt + 1, status: 0 });
      await pause(delayMs);
      continue;
    }
    if (response.ok) return await response.json();
    const detail = await response.json().catch(() => ({}));
    const limit = speechRateLimit(response, detail);
    if (
      response.status === 429 &&
      (limit.hardQuota || (limit.delayMs ?? 0) > 65000)
    ) {
      const cooldown = {
        until: new Date(now() + (limit.delayMs ?? 300000)).toISOString(),
        daily: limit.hardQuota,
      };
      await (runtime.block || ((value) => recordSpeechCooldown(value, model)))(
        cooldown,
      );
      throw new MediaError(speechCooldownMessage(cooldown));
    }
    if (![408, 429].includes(response.status) && response.status < 500)
      throw new MediaError(
        "The configured speech model is unavailable. Check its model access and credentials. Your sources are safe.",
      );
    // Respect a provider cooldown; never shorten it to squeeze in a retry.
    const delayMs =
      Math.max(
        1000,
        limit.delayMs ??
          (response.status === 429 ? 20000 : 2000) * 2 ** attempt,
      ) + 250;
    if (attempt === 3 || delayMs > 65000 || now() + delayMs >= deadline) break;
    await options.onRetry?.({
      delayMs,
      attempt: attempt + 1,
      status: response.status,
    });
    await pause(delayMs);
  }
  throw new MediaError(
    "The speech service is still busy after waiting and retrying. Your script and completed voice segments are saved. Retry shortly; completed segments will be reused.",
  );
}
