import { z } from "zod";
export const platforms = ["instagram", "youtube", "x"] as const;
export type Platform = (typeof platforms)[number];
export const platformNames: Record<Platform, string> = {
  instagram: "Instagram Reels",
  youtube: "YouTube Shorts",
  x: "X",
};
export const languages = ["English", "Telugu", "Hindi"] as const;
export const planInput = z.object({
  input: z.string().min(20).max(6000),
  scheduledAt: z.string().datetime(),
  timezone: z.string().max(80),
  platforms: z.array(z.enum(platforms)).min(1).max(3),
  languages: z.array(z.enum(languages)).min(1).max(3),
  script: z.enum(["native", "roman"]),
});
export const ideaSchema = z.object({
  title: z.string().min(1).max(160),
  hook: z.string().min(1).max(500),
  outline: z.array(z.string().max(500)).min(2).max(6),
  shots: z.array(z.string().max(300)).min(2).max(8),
  durationSeconds: z.number().int().min(10).max(120),
  preparationMinutes: z.number().int().min(5).max(180),
});
export const planSchema = z.object({
  ideas: z.array(ideaSchema).length(3),
  schedulingNote: z.string().max(700),
  recordBy: z.string().max(80),
});
export type Plan = z.infer<typeof planSchema>;
export type Idea = z.infer<typeof ideaSchema>;
export const analysisSchema = z.object({
  summary: z.string().max(3000),
  sourceLanguage: z.string().max(100),
  transcript: z.string().max(12000),
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
  size: z
    .number()
    .int()
    .positive()
    .max(80 * 1024 * 1024),
  duration: z.number().min(1).max(180),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type PublishInput = z.infer<typeof publishInput>;
export type Delivery = {
  platform: string;
  state: "processing" | "scheduled" | "published" | "failed" | "skipped";
  message?: string;
  url?: string;
};
export type PublishJob = {
  token: string;
  deliveries: Delivery[];
  scheduledAt: string | null;
  done: boolean;
};
export type Connections = {
  configured: boolean;
  accounts: Partial<
    Record<Platform, { name: string; connected: boolean; reauth: boolean }>
  >;
};
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
