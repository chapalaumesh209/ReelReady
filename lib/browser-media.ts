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
/** Browser/OS file pickers sometimes omit MIME types or return an M4V alias. */
export function normalizeVideo(file: File): File {
  const raw = file.type.toLowerCase().split(";")[0];
  const inferred = /\.(mp4|m4v)$/i.test(file.name)
    ? "video/mp4"
    : /\.mov$/i.test(file.name)
      ? "video/quicktime"
      : /\.webm$/i.test(file.name)
        ? "video/webm"
        : "";
  const mime = ["video/mp4", "video/quicktime", "video/webm"].includes(raw)
    ? raw
    : ["", "application/octet-stream", "video/x-m4v", "video/mov"].includes(raw)
      ? inferred
      : raw;
  return mime && mime !== file.type
    ? new File([file], file.name, {
        type: mime,
        lastModified: file.lastModified,
      })
    : file;
}
export function metadata(
  blob: Blob,
  signal?: AbortSignal,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video"),
      url = URL.createObjectURL(blob);
    let settled = false;
    const clean = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      video.onloadedmetadata = null;
      video.ondurationchange = null;
      video.ontimeupdate = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clean();
      reject(new Error(message));
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      clean();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(
      () =>
        fail(
          "This video took too long to open. Try a local file or export it as an H.264 MP4, then choose it again.",
        ),
      15000,
    );
    const finish = () => {
      if (
        settled ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        !video.videoWidth
      )
        return;
      const data = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      settled = true;
      clean();
      resolve(data);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      finish();
      if (!settled && video.duration === Infinity) video.currentTime = 1e10;
    };
    video.ondurationchange = finish;
    video.ontimeupdate = finish;
    video.onerror = () =>
      fail(
        "This browser cannot open the recording. Try Chrome or Safari, or export the video as an H.264 MP4.",
      );
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    video.src = url;
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
      classWorkerURL: `${location.origin}/ffmpeg/worker.js`,
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

export function normalizeAudio(file: File) {
  const aliases: Record<string, string> = {
    "audio/x-wav": "audio/wav",
    "audio/mp3": "audio/mpeg",
    "audio/x-m4a": "audio/mp4",
  };
  const types: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    webm: "audio/webm",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
  };
  const raw = file.type.toLowerCase().split(";")[0],
    extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  const mime =
    aliases[raw] ||
    (!raw || raw === "application/octet-stream" ? types[extension] : raw);
  if (!Object.values(types).includes(mime))
    throw new Error(
      "Upload a WAV, MP3, M4A, WebM, Ogg, FLAC or AAC voice recording.",
    );
  return new File([file], file.name, {
    type: mime,
    lastModified: file.lastModified,
  });
}
