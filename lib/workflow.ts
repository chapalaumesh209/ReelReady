import { z } from "zod";
export const platforms = ["instagram", "youtube", "x"] as const;
export type Platform = (typeof platforms)[number];
export const platformNames: Record<Platform, string> = {
  instagram: "Instagram Reels",
  youtube: "YouTube Shorts",
  x: "X",
};
export const languages = ["English", "Telugu", "Hindi", "Tamil"] as const;
export const planInput = z.object({
  input: z.string().min(20).max(4000),
  scheduledAt: z.string().datetime(),
  timezone: z.string().max(80),
  platforms: z.array(z.enum(platforms)).min(1).max(3),
  languages: z.array(z.enum(languages)).min(1).max(4),
  script: z.enum(["native", "roman"]),
});
export const ideaSchema = z.object({
  title: z.string().min(1).max(160),
  hook: z.string().min(1).max(500),
  outline: z.array(z.string().max(500)).min(3).max(5),
  shots: z.array(z.string().max(300)).min(4).max(6),
  durationSeconds: z.number().int().min(10).max(60),
  preparationMinutes: z.number().int().min(5).max(180),
});
export const planSchema = z.object({
  ideas: z.array(ideaSchema).length(3),
  schedulingNote: z.string().max(700),
  recordBy: z.string().max(80),
  suggestions: z
    .array(
      z.object({
        platform: z.enum(platforms),
        time: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  languagePlan: z
    .string()
    .default("English plus your selected creator language."),
  sample: z.boolean().optional(),
});
export type Plan = z.infer<typeof planSchema>;
export type Idea = z.infer<typeof ideaSchema>;
export const analysisSchema = z.object({
  origin: z.enum(["recording", "notes"]).optional(),
  assetPath: z.string().max(1000).optional(),
  sample: z.boolean().optional(),
  summary: z.string().max(3000),
  sourceLanguage: z.string().max(100),
  transcript: z.string().max(4000),
  englishScript: z.string().max(3000),
  audioNote: z.string().max(700),
});
export type Analysis = z.infer<typeof analysisSchema>;
export const publishInput = z.object({
  draftId: z.string().uuid(),
  platforms: z.array(z.enum(platforms)).min(1).max(3),
  scheduledAt: z.string().datetime().nullable(),
  instagram: z.string().max(2200),
  youtubeTitle: z.string().max(100),
  youtubeDescription: z.string().max(5000),
  x: z.string().max(1000),
  language: z.enum(languages),
  dubbed: z.boolean(),
  assetToken: z.string().max(5000).optional(),
  size: z.number().int().positive().refine(Number.isSafeInteger),
  duration: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type PublishInput = z.infer<typeof publishInput>;
export type Delivery = {
  platform: string;
  state:
    | "processing"
    | "scheduled"
    | "published"
    | "failed"
    | "skipped"
    | "demo"
    | "pending";
  message?: string;
  url?: string;
};
export type PublishJob = {
  token: string;
  id?: string;
  status?: string;
  demo?: boolean;
  legacy?: boolean;
  deliveries: Delivery[];
  scheduledAt: string | null;
  done: boolean;
};
export type Connections = {
  /** demo describes publishing only; account authorization is always real. */
  connectionMode?: "real";
  configured: boolean;
  issue?: string;
  demo?: boolean;
  accounts: Partial<
    Record<
      Platform,
      {
        name: string;
        connected: boolean;
        reauth: boolean;
        accountId?: string;
        configured?: boolean;
        unavailable?: boolean;
      }
    >
  >;
};
