import { createFile, type Movie, type MP4BoxBuffer } from "mp4box";
import { storageAdmin, VIDEO_BUCKET } from "../../supabase";
import { databaseError } from "../repository";

const CHUNK = 256 * 1024;
const MAX_METADATA = 4 * 1024 * 1024;
export class MP4InspectionError extends Error {}

/** Inspect actual stored container bytes, never browser-supplied codec claims.
 * MP4Box skips mdat payloads, including when moov is at the end of a large file.
 * This verifies stream metadata; it does not claim to decode/transcode media. */
export async function readMP4Metadata(
  size: number,
  read: (start: number, end: number) => Promise<Uint8Array>,
) {
  if (!Number.isSafeInteger(size) || size < 16)
    throw new MP4InspectionError("This is not a complete MP4 video.");
  const file = createFile(false);
  let info: Movie | undefined;
  let parseError = false;
  file.onReady = (value) => {
    info = value;
  };
  file.onError = () => {
    parseError = true;
  };
  let offset = 0,
    downloaded = 0;
  for (let requests = 0; !info && requests < 20; requests++) {
    if (offset >= size || downloaded >= MAX_METADATA || parseError) break;
    const end = Math.min(
      size,
      offset + CHUNK,
      offset + MAX_METADATA - downloaded,
    );
    const bytes = await read(offset, end - 1);
    if (bytes.byteLength !== end - offset)
      throw new MP4InspectionError(
        "The video inspection was incomplete. Try checking again.",
      );
    downloaded += bytes.byteLength;
    const buffer = Uint8Array.from(bytes).buffer as MP4BoxBuffer;
    buffer.fileStart = offset;
    const next = file.appendBuffer(buffer, end === size);
    if (parseError) break;
    if (!Number.isSafeInteger(next) || next <= offset) break;
    offset = next;
  }
  if (!info || parseError || info.isFragmented || info.brands.includes("qt  "))
    throw new MP4InspectionError(
      "Export a standard MP4 with H.264 video and AAC audio, then upload it again.",
    );
  const video = info.videoTracks[0],
    audio = info.audioTracks[0];
  const duration = info.duration / info.timescale;
  if (
    !video ||
    !video.nb_samples ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new MP4InspectionError(
      "This video has no readable video stream or duration.",
    );
  const matrix = video.matrix;
  const rotated =
    matrix &&
    matrix[0] === 0 &&
    matrix[4] === 0 &&
    matrix[1] !== 0 &&
    matrix[3] !== 0;
  const width = video.track_width || video.video?.width || 0;
  const height = video.track_height || video.video?.height || 0;
  if (!(width > 0 && height > 0))
    throw new MP4InspectionError("The video dimensions could not be verified.");
  return {
    streamInspected: true,
    inspectionVersion: 1,
    inspectionMethod: "mp4-container",
    container: "mp4",
    duration,
    width: rotated ? height : width,
    height: rotated ? width : height,
    videoCodec: /^avc[13]\.[a-f\d]{6}$/i.test(video.codec)
      ? "h264"
      : video.codec,
    audioCodec: audio
      ? /^mp4a\.40\.(2|5|29)$/.test(audio.codec)
        ? "aac"
        : audio.codec
      : null,
    hasAudio: !!audio,
  };
}

/** Range responses are bounded even if an origin ignores Range. Signed URLs
 * are created here for an already-authorized storage row and never logged. */
export function mp4RangeReader(url: string, size: number, signal: AbortSignal) {
  return async (start: number, end: number) => {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${start}-${end}`,
        "Accept-Encoding": "identity",
      },
      redirect: "error",
      cache: "no-store",
      signal,
    });
    const expected = end - start + 1;
    const range = response.headers.get("content-range");
    const fullSmallFile =
      response.status === 200 && start === 0 && expected === size;
    if (
      !response.body ||
      (!fullSmallFile &&
        (response.status !== 206 || range !== `bytes ${start}-${end}/${size}`))
    ) {
      await response.body?.cancel();
      throw new MP4InspectionError(
        "Storage could not read the video for inspection. Try checking again.",
      );
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(expected);
    let count = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (count + chunk.value.byteLength > expected)
          throw new MP4InspectionError(
            "The video inspection response was too large.",
          );
        bytes.set(chunk.value, count);
        count += chunk.value.byteLength;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (count !== expected)
      throw new MP4InspectionError(
        "The video inspection was incomplete. Try checking again.",
      );
    return bytes;
  };
}

type StoredMedia = {
  id: string;
  owner_id: string;
  path: string;
  mime: string;
  bytes: number;
  metadata: Record<string, unknown>;
};
export async function inspectStoredMP4(asset: StoredMedia) {
  if (
    asset.mime !== "video/mp4" ||
    asset.metadata.decoded === true ||
    (asset.metadata.streamInspected === true &&
      asset.metadata.inspectionVersion === 1)
  )
    return asset.metadata;
  const admin = storageAdmin();
  const signed = await admin.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(asset.path, 60);
  if (signed.error || !signed.data)
    throw new MP4InspectionError(
      "Storage could not open the video for inspection. Try checking again.",
    );
  const inspected = await readMP4Metadata(
    Number(asset.bytes),
    mp4RangeReader(
      signed.data.signedUrl,
      Number(asset.bytes),
      AbortSignal.timeout(15000),
    ),
  );
  const metadata = { ...asset.metadata, ...inspected };
  const saved = await admin
    .from("reelready_media")
    .update({ metadata })
    .eq("id", asset.id)
    .eq("owner_id", asset.owner_id)
    .eq("path", asset.path)
    .eq("metadata", JSON.stringify(asset.metadata))
    .select("metadata");
  if (saved.error) databaseError(saved.error);
  if (saved.data?.length)
    return saved.data[0].metadata as Record<string, unknown>;
  // A worker may have completed inspection concurrently. Do not overwrite it.
  const current = await admin
    .from("reelready_media")
    .select("metadata")
    .eq("id", asset.id)
    .eq("owner_id", asset.owner_id)
    .eq("path", asset.path)
    .single();
  if (current.error) databaseError(current.error);
  return current.data!.metadata as Record<string, unknown>;
}
