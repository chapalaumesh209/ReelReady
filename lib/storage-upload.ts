import type { StoredVideo } from "./supabase";
export async function cloudUpload(
  file: Blob,
  name: string,
  draftId: string,
  kind: "original" | "english" | "source_audio",
  signal: AbortSignal,
  progress: (label: string) => void,
  metadata?: { duration: number; width: number; height: number },
): Promise<StoredVideo> {
  async function post<T>(body: unknown): Promise<T> {
    const r = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const d = (await r.json()) as T & { error?: string };
    if (!r.ok)
      throw new Error(
        d.error || "Cloud upload could not finish. Please retry.",
      );
    return d;
  }
  const limits = await fetch("/api/limits", { signal }).then(
    (r) => r.json() as Promise<import("./limits").PublicLimits>,
  );
  const { uploadProblem } = await import("./limits");
  const problem = uploadProblem(file.size, metadata?.duration, limits);
  if (problem) throw new Error(problem);
  const prepared = await post<{
    alreadyUploaded: boolean;
    token: string;
    path: string;
    uploadToken: string;
    endpoint: string;
    publishableKey: string;
    bucket: string;
  }>({
    action: "prepare",
    metadata,
    draftId,
    kind,
    name,
    mime: file.type,
    size: file.size,
    lastModified: file instanceof File ? file.lastModified : 0,
  });
  if (!prepared.alreadyUploaded) {
    const { Upload } = await import("tus-js-client");
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const clean = () => signal.removeEventListener("abort", cancel);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clean();
        if (error) reject(error);
        else resolve();
      };
      const upload = new Upload(file, {
        endpoint: prepared.endpoint,
        headers: {
          apikey: prepared.publishableKey,
          "x-signature": prepared.uploadToken,
        },
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        fingerprint: async () => `reelready:${prepared.path}`,
        metadata: {
          bucketName: prepared.bucket,
          objectName: prepared.path,
          contentType: file.type,
          cacheControl: "3600",
        },
        onProgress: (sent, total) =>
          progress(
            `Saving ${kind === "english" ? "English video" : "recording"} to cloud… ${Math.min(100, Math.round((sent / total) * 100))}%`,
          ),
        onError: (error) => {
          const status =
            "originalResponse" in error
              ? error.originalResponse?.getStatus()
              : undefined;
          finish(
            new Error(
              status === 413
                ? "Storage could not accept this file. Try a smaller video or check the project storage allowance."
                : status === 401 || status === 403
                  ? "The upload link expired or cloud storage needs attention. Please retry."
                  : "The cloud upload was interrupted. Retry to resume the transfer.",
            ),
          );
        },
        onSuccess: () => finish(),
      });
      const cancel = () => {
        void upload.abort();
        finish(new DOMException("Cancelled", "AbortError"));
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      void upload
        .findPreviousUploads()
        .then((previous) => {
          if (settled) return;
          if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        })
        .catch(() => {
          if (!settled) upload.start();
        });
    });
  }
  return post<StoredVideo>({
    action: "complete",
    token: prepared.token,
    metadata,
  });
}
