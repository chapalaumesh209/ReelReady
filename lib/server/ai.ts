import { z } from "zod";
import {
  generateStructuredContent,
  generationConfiguration,
  GenerationError,
} from "../generation";

import { type Plan, type Analysis } from "../workflow";
export const sampleOutputsAllowed = () =>
  process.env.ALLOW_SAMPLE_OUTPUT === "true";
export const demoAI = () => !generationConfiguration().key;
export async function validated<T>(
  options: Parameters<typeof generateStructuredContent>[0],
  schema: z.ZodType<T>,
): Promise<T> {
  for (let n = 0; n < 2; n++) {
    try {
      return schema.parse(await generateStructuredContent(options));
    } catch (e) {
      if (options.signal.aborted) throw e;
      if (n === 1) throw e;
    }
  }
  throw new GenerationError("Please try again.", 502);
}
export function samplePlan(data: {
  input: string;
  scheduledAt: string;
  platforms: readonly string[];
  languages: readonly string[];
}): Plan {
  const topic = data.input.trim().slice(0, 100);
  return {
    sample: true,
    ideas: [
      ["Tell the story", "Start with the question your video answers."],
      ["Show the process", "Show one useful moment, then explain it."],
      ["Share the takeaway", "What should your viewers remember?"],
    ].map(([title, hook]) => ({
      title: `${title}: ${topic.slice(0, 40)}`,
      hook,
      outline: [
        "Introduce your topic in your own words",
        "Show the detail you want to explain",
        "End with your honest takeaway",
      ],
      shots: [
        "Opening portrait shot",
        "Close-up of your subject",
        "Show the key detail",
        "Closing shot with your takeaway",
      ],
      durationSeconds: 30,
      preparationMinutes: 15,
    })),
    recordBy: new Date(
      Math.max(Date.now(), Date.parse(data.scheduledAt) - 3600000),
    ).toISOString(),
    schedulingNote:
      "Suggestions from your inputs and general posting patterns, not your analytics.",
    suggestions: data.platforms.map((platform) => ({
      platform: platform as "instagram" | "youtube" | "x",
      time: data.scheduledAt,
      reason:
        "Your planned time, with room to review the final recording first.",
    })),
    languagePlan: `English captions${data.languages.filter((x) => x !== "English").length ? " plus " + data.languages.filter((x) => x !== "English").join(", ") : ""}.`,
  };
}
export function sampleAnalysis(
  idea: string,
  note: string,
  duration: number,
): Analysis {
  let description = idea;
  try {
    const plan = JSON.parse(idea) as { title?: unknown; hook?: unknown };
    description =
      [plan.title, plan.hook]
        .filter((v): v is string => typeof v === "string")
        .join(". ") || idea;
  } catch {
    /* Plain-text creator notes remain valid. */
  }
  return {
    sample: true,
    summary: `Creator-supplied plan: ${description.slice(0, 1500)}. Filming note: ${note || "None supplied."}`,
    sourceLanguage: "Not analyzed in demo",
    transcript: "Demo mode does not transcribe or inspect the recording.",
    englishScript:
      "Here is one moment from my reel. Watch the details and share your thoughts."
        .split(/\s+/)
        .slice(0, Math.max(3, Math.floor(duration * 2)))
        .join(" "),
    audioNote:
      "Suggested narration from your plan and filming note. The video was not analyzed in this demo.",
  };
}
