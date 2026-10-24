import { GenerationError } from "../generation";
import { uploadProblem } from "../limits";
export function positiveEnv(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
export const workerPool = () => process.env.WORKER_POOL || "default";
export const publicLimits = () => ({
  maxUploadMB: positiveEnv("MAX_UPLOAD_MB", 200),
  maxVideoSeconds: positiveEnv("MAX_VIDEO_SECONDS", 90),
});
export function enforceUpload(bytes: number, duration?: number) {
  const problem = uploadProblem(bytes, duration, publicLimits());
  if (problem) throw new GenerationError(problem, 400);
}
