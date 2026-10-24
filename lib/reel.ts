import type { Language, Script, Kit } from "./content";
import type { Platform, Plan, Analysis, PublishJob } from "./workflow";
import type { StoredVideo } from "./supabase";
export type Details = {
  voice: string;
  brand: string;
  link: string;
  disclosure: string;
  audience?: string;
  location?: string;
  goal?: string;
  keywords?: string;
};
export type Draft = {
  version: 2;
  workflowVersion?: 3;
  audioReady?: boolean;
  audioLabel?: string;
  id: string;
  title?: string;
  archivedAt?: string | null;
  step: number;
  input: string;
  scheduledLocal: string;
  timezone: string;
  platforms: Platform[];
  languages: Language[];
  script: Script;
  plan: Plan | null;
  planSignature: string;
  selected: number;
  token: string;
  analysis: Analysis | null;
  kits: Partial<Record<Language, Kit>>;
  kitLanguage: Language;
  details: Details;
  fileName: string;
  originalAsset: StoredVideo | null;
  englishAsset: StoredVideo | null;
  meta: { duration: number; width: number; height: number } | null;
  dubScript: string;
  variant: "original" | "english";
  timing: "schedule" | "now";
  job: PublishJob | null;
  filmingNote: string;
  beatChecks: number[];
  shotChecks: number[];
};
export function tomorrow() {
  const day = new Date(Date.now() + 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(day);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T19:00`;
}
export const scheduledISO = (wall: string) =>
  new Date(wall + ":00+05:30").toISOString();
export function fresh(): Draft {
  return {
    version: 2,
    workflowVersion: 3,
    audioReady: false,
    audioLabel: "",
    id: "",
    step: 0,
    input: "",
    scheduledLocal: tomorrow(),
    timezone: "Asia/Kolkata",
    platforms: ["instagram", "youtube"],
    languages: ["English"],
    script: "native",
    plan: null,
    planSignature: "",
    selected: 0,
    token: "",
    analysis: null,
    kits: {},
    kitLanguage: "English",
    details: { voice: "", brand: "", link: "", disclosure: "" },
    fileName: "",
    originalAsset: null,
    englishAsset: null,
    meta: null,
    dubScript: "",
    variant: "original",
    timing: "schedule",
    job: null,
    filmingNote: "",
    beatChecks: [],
    shotChecks: [],
  };
}
export const sampleIdeas = {
  food: "రేపు కొత్త బిర్యానీ రెస్టారెంట్‌లో ఒక ఫుడ్ రివ్యూ రీల్ చేయాలి. వంటకం, వాసన, రుచి గురించి నిజాయితీగా చెప్పాలి. ధర గురించి ఊహించవద్దు.",
  garden:
    "A short reel about my balcony garden. Show the plants I am growing, how I check the soil, and one thing I learned. Do not invent plant names or results.",
};
