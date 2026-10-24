import { type Segment } from "../../audio/schema";
/** Provider word timestamps are optional evidence, never invented confidence. */
export function timedTranscript(
  words: unknown[],
  videoDuration: number,
): Segment[] {
  const result: Segment[] = [];
  function seconds(value: unknown) {
    return typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:\.\d+)?s?$/.test(value)
        ? parseFloat(value)
        : NaN;
  }
  for (const word of words) {
    const w = word as {
      text?: string;
      start_offset?: unknown;
      end_offset?: unknown;
    };
    const start = seconds(w.start_offset),
      end = seconds(w.end_offset);
    if (
      !w.text ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > videoDuration + 0.1
    )
      continue;
    const last = result.at(-1);
    if (
      last &&
      start - last.end < 0.8 &&
      last.text.length + w.text.length < 180
    ) {
      last.text += ` ${w.text}`;
      last.original = last.text;
      last.end = end;
    } else
      result.push({
        text: w.text,
        original: w.text,
        start,
        end,
        assetId: null,
        duration: null,
        fingerprint: "",
      });
  }
  // Use available gaps as budgets while preserving observed start positions.
  return result.map((s, i) => ({
    ...s,
    end: result[i + 1]?.start || videoDuration,
  }));
}

export function inferTranscriptLanguage(text: string) {
  if (/\p{Script=Telugu}/u.test(text))
    return "Telugu script (estimated; correct the source language if needed)";
  if (/\p{Script=Tamil}/u.test(text))
    return "Tamil script (estimated; correct the source language if needed)";
  if (/\p{Script=Devanagari}/u.test(text))
    return "Devanagari script (Hindi is possible; choose the source language)";
  return "Language auto-detected for recognition; choose the source language if the transcript needs correction";
}
