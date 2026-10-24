import type { Draft } from "./reel";
import { characterCount, xCount, hasLinks } from "./content";
export const workflowNames = [
  "Plan",
  "Record",
  "Upload",
  "Audio & Voice",
  "Review",
  "Publish",
];
export function workflowProgress(draft: Partial<Draft>) {
  const kit = draft.kits?.[draft.kitLanguage || "English"],
    outputs = Object.fromEntries(kit?.outputs.map((o) => [o.id, o.text]) || []);
  const kitValid =
    !!kit &&
    !!draft.platforms?.length &&
    (draft.platforms || []).every((platform) =>
      platform === "instagram"
        ? !!outputs.instagram?.trim() &&
          characterCount(outputs.instagram) <= 2200
        : platform === "youtube"
          ? !!outputs.youtubeTitle?.trim() &&
            characterCount(outputs.youtubeTitle) <= 100
          : !!outputs.x?.trim() &&
            xCount(outputs.x) <= 280 &&
            !hasLinks(outputs.x),
    );
  const planValid =
    !!draft.plan &&
    draft.planSignature ===
      JSON.stringify([
        draft.input,
        draft.scheduledLocal,
        draft.platforms,
        draft.languages,
        draft.script,
      ]);
  const completed = [
    planValid,
    !!draft.originalAsset,
    !!draft.originalAsset,
    !!draft.audioReady,
    !!draft.analysis && kitValid,
    !!draft.job?.done &&
      draft.job.deliveries.every(
        (d) => d.state === "published" || d.state === "demo",
      ),
  ];
  const failed =
    draft.job?.deliveries.some((d) => d.state === "failed") ||
    draft.job?.status === "uncertain";
  return {
    completed,
    count: completed.filter(Boolean).length,
    attention: completed.map((_, i) =>
      i === 5 ? !!failed : i === 0 ? !!draft.plan && !planValid : false,
    ),
  };
}
