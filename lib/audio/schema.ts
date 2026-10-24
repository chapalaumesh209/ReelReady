import { z } from "zod";
export const audioLanguages = [
  "English",
  "Telugu",
  "Hindi",
  "Tamil",
  "Hinglish",
] as const;
export const modes = [
  "keep",
  "mute",
  "replace",
  "mix",
  "add",
  "voiceover",
] as const;
export const modeLabels: Record<(typeof modes)[number], string> = {
  keep: "Keep original audio",
  mute: "Mute original audio",
  replace: "Translate or replace original audio",
  mix: "Mix original sound with narration",
  add: "Add narration to a silent video",
  voiceover: "Voiceover only",
};
export const styles = [
  "Natural",
  "Casual",
  "Friendly and conversational",
  "Clear and professional",
  "Energetic creator style",
  "Calm and explanatory",
  "Technical tutorial",
  "Warm storytelling",
] as const;
export const voices = [
  { id: "Kore", description: "Firm" },
  { id: "Puck", description: "Upbeat" },
  { id: "Charon", description: "Informative" },
  { id: "Aoede", description: "Breezy" },
  { id: "Iapetus", description: "Clear" },
  { id: "Sulafat", description: "Warm" },
  { id: "Achird", description: "Friendly" },
  { id: "Zephyr", description: "Bright" },
] as const;
export const settingsSchema = z.object({
  mode: z.enum(modes).default("keep"),
  originalVolume: z.number().min(0).max(2).default(1),
  narrationVolume: z.number().min(0).max(2).default(1),
  ducking: z.boolean().default(false),
  fade: z.number().min(0).max(3).default(0),
  sourceLanguage: z.enum(["Auto", ...audioLanguages]).default("Auto"),
  targetLanguage: z.enum(audioLanguages).default("English"),
  voice: z
    .enum(voices.map((v) => v.id) as [string, ...string[]])
    .default("Kore"),
  style: z.enum(styles).default("Friendly and conversational"),
  pace: z.enum(["natural", "slower", "faster"]).default("natural"),
  timing: z.enum(["preserve", "extend"]).default("preserve"),
  // Optional additions preserve the hash of approved legacy audio settings.
  durationMode: z.literal("fit-video").optional(),
  creatorInstructions: z.string().max(4000).optional(),
  voiceProfile: z
    .object({
      gender: z.enum(["natural", "male", "female"]),
      accent: z.enum(["en-US", "en-GB", "en-IN"]),
    })
    .optional(),
});
export type AudioSettings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): AudioSettings => settingsSchema.parse({});
export const segmentSchema = z
  .object({
    text: z.string().min(1).max(1500),
    original: z.string().max(1500).default(""),
    start: z.number().min(0).max(86400),
    end: z.number().positive().max(86400),
    assetId: z.string().uuid().nullable().default(null),
    duration: z.number().positive().nullable().default(null),
    fingerprint: z.string().default(""),
  })
  .refine((s) => s.end > s.start, "End must follow start");
export type Segment = z.infer<typeof segmentSchema>;
export const editSchema = z.object({
  settings: settingsSchema,
  transcript: z.string().max(4000).default(""),
  script: z.string().max(4000).default(""),
  classification: z
    .enum(["unknown", "speech", "background", "mixed", "silent", "none"])
    .default("unknown"),
  segments: z.array(segmentSchema).max(80).default([]),
});
export type Edit = z.infer<typeof editSchema>;
export type MediaInfo = {
  format: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  rotation: number;
  videoCodec: string;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  hasAudio: boolean;
  sound: "none" | "silent" | "unknown";
  meanDb: number | null;
  decoded: boolean;
};
export type AudioState = Edit & {
  source_id: string;
  rendered_id: string | null;
  approved_hash: string | null;
  updated_at: string;
};
export type MediaAsset = {
  id: string;
  kind: string;
  mime: string;
  bytes: number;
  metadata: Partial<MediaInfo>;
  name?: string;
};
export type MediaJob = {
  id: string;
  source_id?: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  result: Record<string, unknown> | null;
  safe_error: string | null;
  updated_at: string;
  created_at?: string;
};
export const needsNarration = (s: AudioSettings) =>
  !["keep", "mute"].includes(s.mode);
export const untouched = (s: AudioSettings) =>
  s.mode === "keep" && s.originalVolume === 1 && s.fade === 0;
export function splitScript(text: string, duration: number): Segment[] {
  const sentences =
    text
      .match(/[^.!?।]+[.!?।]*/gu)
      ?.map((t) => t.trim())
      .filter(Boolean) || [];
  const groups: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length > 1500)
      throw new Error("Split long sentences before generating narration.");
    if (groups.length && groups.at(-1)!.length + sentence.length < 180)
      groups[groups.length - 1] += ` ${sentence}`;
    else groups.push(sentence);
  }
  const total = groups.reduce((n, t) => n + t.length, 0);
  let start = 0;
  return groups.map((text) => {
    const end = start + (duration * text.length) / total;
    const s = {
      text,
      original: "",
      start,
      end,
      duration: null,
      assetId: null,
      fingerprint: "",
    };
    start = end;
    return s;
  });
}
