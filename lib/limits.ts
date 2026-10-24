/** Public configuration contains limits only, never credentials. */
export type PublicLimits = { maxUploadMB: number; maxVideoSeconds: number };
export function uploadProblem(
  bytes: number,
  duration: number | undefined,
  limits: PublicLimits,
): string | null {
  if (bytes > limits.maxUploadMB * 1024 * 1024)
    return `Choose a file under ${limits.maxUploadMB} MB. Your original stays on your device.`;
  if (
    duration !== undefined &&
    (!Number.isFinite(duration) ||
      duration <= 0 ||
      duration > limits.maxVideoSeconds)
  )
    return `Choose a video up to ${limits.maxVideoSeconds} seconds long.`;
  return null;
}
