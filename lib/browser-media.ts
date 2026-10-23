import type { FFmpeg } from "@ffmpeg/ffmpeg";
const DB = "reelready-media-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function storeMedia(key: string, value: Blob | null) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("files", "readwrite");
      if (value) t.objectStore("files").put(value, key);
      else t.objectStore("files").delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
export async function loadMedia(key: string): Promise<Blob | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("files").objectStore("files").get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export function metadata(
  blob: Blob,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video"),
      url = URL.createObjectURL(blob);
    v.preload = "metadata";
    const clean = () => {
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      v.load();
    };
    v.onloadedmetadata = () => {
      const data = {
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
      };
      clean();
      if (!Number.isFinite(data.duration) || !data.width)
        reject(
          new Error(
            "This video could not be read. Export it as MP4 and try again.",
          ),
        );
      else resolve(data);
    };
    v.onerror = () => {
      clean();
      reject(
        new Error(
          "This browser cannot read the video. Export it as MP4 and try again.",
        ),
      );
    };
    v.src = url;
  });
}
export async function exportDub(
  original: Blob,
  audio: Blob,
  duration: number,
  onProgress: (s: string) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ff: FFmpeg = new FFmpeg();
  let wasmURL = "";
  const cancel = () => ff.terminate();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    onProgress("Loading video tools (31 MB, first use)…");
    const parts = await Promise.all(
      [0, 1].map(async (n) => {
        const r = await fetch(`/ffmpeg/core-${n}.bin`, { signal });
        if (!r.ok)
          throw new Error("Video tools could not load. Please try again.");
        return r.blob();
      }),
    );
    wasmURL = URL.createObjectURL(
      new Blob(parts, { type: "application/wasm" }),
    );
    await ff.load({
      classWorkerURL: "/ffmpeg/worker.js",
      coreURL: `${location.origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL,
    });
    const wavBuffer = await audio.arrayBuffer(),
      view = new DataView(wavBuffer),
      rate = view.getUint32(24, true),
      bytesPerSecond = view.getUint32(28, true),
      audioDuration = (wavBuffer.byteLength - 44) / bytesPerSecond;
    void rate;
    const speed = Math.max(1, audioDuration / duration);
    if (speed > 1.35)
      throw new Error(
        "The English script is too long for this reel. Shorten it, then create the English video again.",
      );
    const name = original.type === "video/webm" ? "input.webm" : "input.mp4";
    await ff.writeFile(name, new Uint8Array(await original.arrayBuffer()));
    await ff.writeFile("voice.wav", new Uint8Array(wavBuffer));
    ff.on("progress", ({ progress }) =>
      onProgress(
        `Creating English MP4… ${Math.max(0, Math.min(99, Math.round(progress * 100)))}%`,
      ),
    );
    onProgress("Creating English MP4…");
    const code = await ff.exec(
      [
        "-i",
        name,
        "-i",
        "voice.wav",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-af",
        `atempo=${speed.toFixed(4)},apad`,
        "-t",
        String(duration),
        "-movflags",
        "+faststart",
        "out.mp4",
      ],
      180000,
    );
    if (code !== 0)
      throw new Error(
        "The video could not be exported. Try a shorter MP4. Your original is safe.",
      );
    const output = await ff.readFile("out.mp4");
    if (typeof output === "string") throw new Error("Invalid video export.");
    return new Blob([new Uint8Array(output)], { type: "video/mp4" });
  } finally {
    signal.removeEventListener("abort", cancel);
    ff.terminate();
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
}
