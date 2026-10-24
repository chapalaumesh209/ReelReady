import { storageAdmin } from "@/lib/supabase";
import { databaseError } from "@/lib/server/repository";
import { demoAI, sampleAnalysis, sampleOutputsAllowed } from "@/lib/server/ai";
import { rateLimit } from "@/lib/server/rate-limit";
import { withSession } from "@/lib/supabase/server";
import { reviewRecording } from "@/lib/server/video-review";
import { z } from "zod";
import { GenerationError } from "@/lib/generation";
import { analysisSchema } from "@/lib/workflow";
import { body, capability, failure, json, session } from "@/lib/server";
import { googleFile } from "@/lib/media-server";
const input = z.object({
  token: z.string().max(4000),
  idea: z.string().max(4000),
  revision: z.string().max(3000).default(""),
  previous: analysisSchema.nullable().default(null),
  duration: z.number().positive(),
  filmingNote: z.string().max(4000).default(""),
});
async function handlePOST(req: Request) {
  try {
    const visitor = await session(req);
    await rateLimit(req, "change-request", 20);
    const data = await body(req, input),
      cap = await capability(req, data.token, "video");
    if (demoAI() && sampleOutputsAllowed()) {
      if (cap.path) {
        const saved = await storageAdmin()
          .from("reelready_media")
          .update({ processing_state: "reviewed" })
          .eq("path", String(cap.path))
          .eq("owner_id", visitor.id);
        if (saved.error) databaseError(saved.error);
      }
      return json(sampleAnalysis(data.idea, data.filmingNote, data.duration));
    }
    if (demoAI())
      throw new GenerationError(
        "Live video analysis is not configured. Your recording is safe; no sample analysis was generated.",
        503,
      );
    if (["notes", "demo"].includes(String(cap.name)) && !sampleOutputsAllowed())
      throw new GenerationError(
        "This recording has not been analyzed. Analyze the saved video again to generate accurate captions.",
        409,
      );
    const file = ["notes", "demo"].includes(String(cap.name))
      ? null
      : await googleFile(String(cap.name), AbortSignal.timeout(15000));
    if (file && file.state !== "ACTIVE")
      throw new GenerationError(
        "The uploaded video is still processing. Please try again shortly.",
        409,
      );
    let analysis;
    try {
      analysis = await reviewRecording(
        file,
        {
          idea: data.idea,
          revision: data.revision,
          previous:
            data.previous?.origin === "recording" &&
            !data.previous.sample &&
            data.previous.assetPath === cap.path
              ? data.previous
              : null,
          duration: data.duration,
          filmingNote: data.filmingNote,
        },
        AbortSignal.any([req.signal, AbortSignal.timeout(55000)]),
      );
      delete analysis.sample;
      analysis.assetPath = cap.path ? String(cap.path) : undefined;
    } catch (error) {
      if (!sampleOutputsAllowed()) throw error;
      analysis = sampleAnalysis(data.idea, data.filmingNote, data.duration);
    }
    if (cap.path) {
      const saved = await storageAdmin()
        .from("reelready_media")
        .update({ processing_state: "reviewed" })
        .eq("path", String(cap.path))
        .eq("owner_id", visitor.id);
      if (saved.error) databaseError(saved.error);
    }
    return json(analysis);
  } catch (e) {
    return failure(e);
  }
}

export const POST = withSession(handlePOST);

export const maxDuration = 60;
