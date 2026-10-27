import {
  ENERGETIC_STYLE,
  ENERGETIC_AUDIO_FILTER,
} from "../../audio/voice-delivery";
import { spawn } from "node:child_process";
import {
  type AudioSettings,
  type MediaInfo,
  type Segment,
  needsNarration,
} from "../../audio/schema";
export class MediaError extends Error {}
export async function command(
  binary: string,
  args: string[],
  timeout = 600000,
) {
  return new Promise<{ out: string; err: string }>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let out = "",
      err = "",
      ended = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new MediaError(
          "Media processing timed out. The original remains safe; try a shorter recording.",
        ),
      );
    }, timeout);
    child.stdout.on("data", (b) => {
      out = (out + b.toString()).slice(-2000000);
    });
    child.stderr.on("data", (b) => {
      err = (err + b.toString()).slice(-100000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      ended = true;
      reject(
        new MediaError(
          "FFmpeg or FFprobe is unavailable. Install both and restart the media worker.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (ended) return;
      ended = true;
      if (code !== 0)
        reject(
          new MediaError(
            "The media could not be decoded or rendered. Export as MP4/H.264 with AAC audio and retry; your original is intact.",
          ),
        );
      else resolve({ out, err });
    });
  });
}
export const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobe = () => process.env.FFPROBE_PATH || "ffprobe";
const safeInput = ["-protocol_whitelist", "file,pipe,crypto,data"];
export async function probe(path: string, decode = false): Promise<MediaInfo> {
  const { out } = await command(
    ffprobe(),
    [
      "-v",
      "error",
      ...safeInput,
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      path,
    ],
    60000,
  );
  const data = JSON.parse(out);
  const video = data.streams?.find(
    (s: { codec_type: string; disposition?: { attached_pic?: boolean } }) =>
      s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const audio = data.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );
  const duration = Number(
    data.format?.duration || video?.duration || audio?.duration,
  );
  if (!Number.isFinite(duration) || duration <= 0 || (!video && !audio))
    throw new MediaError(
      "This file has no decodable media stream or valid duration.",
    );
  const rotation = Number(
    video?.side_data_list?.find(
      (s: { rotation?: number }) => s.rotation !== undefined,
    )?.rotation ||
      video?.tags?.rotate ||
      0,
  );
  const rotated = Math.abs(rotation) % 180 === 90;
  const rate = String(video?.avg_frame_rate || "0/1")
    .split("/")
    .map(Number);
  let meanDb: number | null = null;
  if (decode) {
    // Decode both streams; volumedetect distinguishes empty/silent tracks, not speech from music.
    const analysis = await command(
      ffmpeg(),
      [
        "-nostdin",
        "-v",
        "info",
        ...safeInput,
        "-i",
        path,
        ...(audio ? ["-af", "volumedetect"] : []),
        "-f",
        "null",
        "-",
      ],
      Number(process.env.MEDIA_COMMAND_TIMEOUT_MS || 600000),
    );
    const mean = /mean_volume:\s*(-?[\d.]+|inf) dB/.exec(analysis.err)?.[1];
    meanDb = mean === "inf" ? -100 : mean !== undefined ? Number(mean) : null;
  }
  return {
    format: data.format?.format_name || "unknown",
    duration,
    width: Number(rotated ? video?.height : video?.width) || 0,
    height: Number(rotated ? video?.width : video?.height) || 0,
    fps: rate[1] ? rate[0] / rate[1] : 0,
    rotation,
    videoCodec: video?.codec_name || "",
    audioCodec: audio?.codec_name || null,
    hasAudio: !!audio,
    sampleRate: audio ? Number(audio.sample_rate) : null,
    channels: audio?.channels || null,
    channelLayout: audio?.channel_layout || null,
    meanDb,
    sound: !audio
      ? "none"
      : meanDb !== null && meanDb < -55
        ? "silent"
        : "unknown",
    decoded: decode,
  };
}
export async function extractAudio(input: string, output: string) {
  await command(ffmpeg(), [
    "-nostdin",
    "-y",
    ...safeInput,
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "flac",
    output,
  ]);
}
export function timeline(
  segments: Array<Segment & { file: string }>,
  settings: AudioSettings,
  duration: number,
) {
  let previous = 0;
  return segments.map((s) => {
    if (!s.duration)
      throw new MediaError(
        "A narration segment has not been measured. Generate it again.",
      );
    const budget = s.end - s.start;
    let speed = 1,
      start = s.start;
    if (settings.durationMode === "fit-video") {
      if (s.start < previous - 0.01 || s.end > duration + 0.05 || budget <= 0)
        throw new MediaError(
          "The narration windows do not fit this video. Recreate the English version.",
        );
      const ratio = s.duration / budget;
      if (ratio > 1.15)
        throw new MediaError(
          "The narration still needs shorter wording to fit naturally. Try creating the English version again.",
        );
      // Small tempo correction only; spread short speech with natural gaps, never a 3x slowdown.
      speed = Math.max(0.85, ratio);
      const spoken = s.duration / speed;
      start =
        s.start <= 0.01
          ? 0
          : s.end >= duration - 0.01
            ? duration - spoken
            : s.start + (budget - spoken) / 2;
    } else if (settings.timing === "extend") start = Math.max(previous, start);
    else {
      if (s.start < previous - 0.01)
        throw new MediaError(
          "Narration segments overlap. Adjust their start and end times.",
        );
      if (s.end > duration + 0.05)
        throw new MediaError(
          "A segment extends beyond the video. Adjust its timing or choose Extend video.",
        );
      if (s.duration > budget) {
        speed = s.duration / budget;
        if (speed > 1.12)
          throw new MediaError(
            "Narration is too long for its time slot. Shorten the script, adjust segment timing, or choose Extend video. No words were cut.",
          );
      }
    }
    previous = start + s.duration / speed;
    return { ...s, start, speed, actualEnd: previous };
  });
}
export async function renderVideo(
  input: string,
  output: string,
  media: MediaInfo,
  settings: AudioSettings,
  segments: Array<Segment & { file: string }>,
) {
  if (!media.videoCodec)
    throw new MediaError("The original asset has no video stream.");
  const narration = needsNarration(settings);
  if (narration && !segments.length)
    throw new MediaError("Add narration audio before rendering this mode.");
  if (settings.mode === "add" && media.hasAudio && media.sound !== "silent")
    throw new MediaError(
      "This video contains sound. Choose Mix, Replace, or Voiceover only to decide what happens to it.",
    );
  const placed = narration ? timeline(segments, settings, media.duration) : [];
  const duration =
    settings.durationMode === "fit-video"
      ? media.duration
      : Math.max(media.duration, ...placed.map((s) => s.actualEnd));
  const args = ["-nostdin", "-y", "-v", "error", ...safeInput, "-i", input];
  for (const s of placed) args.push(...safeInput, "-i", s.file);
  const filters: string[] = [];
  const hasOriginal = media.hasAudio && ["keep", "mix"].includes(settings.mode);
  const hasOutputAudio = hasOriginal || narration;
  if (hasOriginal)
    filters.push(
      `[0:a:0]aresample=48000,volume=${settings.originalVolume},apad,atrim=duration=${duration}[original]`,
    );
  if (narration) {
    placed.forEach((s, i) =>
      filters.push(
        `[${i + 1}:a:0]aresample=48000,atempo=${s.speed},volume=${settings.narrationVolume},adelay=${Math.round(s.start * 1000)}:all=1[segment${i}]`,
      ),
    );
    filters.push(
      `${placed.map((_, i) => `[segment${i}]`).join("")}amix=inputs=${placed.length}:duration=longest:normalize=0,apad,atrim=duration=${duration}[voice]`,
    );
  }
  let audioLabel = hasOriginal ? "original" : "voice";
  if (hasOriginal && narration) {
    if (settings.ducking) {
      filters.push(
        "[voice]asplit=2[voiceMix][voiceSide]",
        "[original][voiceSide]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]",
        "[ducked][voiceMix]amix=inputs=2:duration=longest:normalize=0[mixed]",
      );
    } else
      filters.push(
        "[original][voice]amix=inputs=2:duration=longest:normalize=0[mixed]",
      );
    audioLabel = "mixed";
  }
  if (hasOutputAudio) {
    const mastering =
      narration && settings.style === ENERGETIC_STYLE
        ? ENERGETIC_AUDIO_FILTER
        : "alimiter=limit=0.95:latency=1";
    filters.push(
      `[${audioLabel}]${mastering}${settings.fade ? `,afade=t=in:d=${Math.min(settings.fade, duration / 2)},afade=t=out:st=${Math.max(0, duration - settings.fade)}:d=${Math.min(settings.fade, duration / 2)}` : ""}[finalAudio]`,
    );
  }
  const extend = duration > media.duration + 0.02;
  if (extend)
    filters.push(
      `[0:v:0]tpad=stop_mode=clone:stop_duration=${duration - media.duration}[finalVideo]`,
    );
  if (filters.length) args.push("-filter_complex", filters.join(";"));
  args.push("-map", extend ? "[finalVideo]" : "0:v:0");
  if (hasOutputAudio)
    args.push("-map", "[finalAudio]", "-c:a", "aac", "-b:a", "192k");
  else args.push("-an");
  // Copy compatible H.264 video when no visual filter is required. Other inputs get a social-compatible encode.
  args.push(
    "-c:v",
    media.videoCodec === "h264" && !extend ? "copy" : "libx264",
  );
  if (media.videoCodec !== "h264" || extend)
    args.push(
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "2",
    );
  args.push("-t", String(duration), "-movflags", "+faststart", output);
  await command(
    ffmpeg(),
    args,
    Number(process.env.MEDIA_COMMAND_TIMEOUT_MS || 600000),
  );
  const verified = await probe(output, true);
  if (
    verified.videoCodec !== "h264" ||
    (hasOutputAudio && verified.audioCodec !== "aac") ||
    (!hasOutputAudio && verified.hasAudio) ||
    Math.abs(verified.duration - duration) > 0.35 ||
    verified.width !== media.width ||
    verified.height !== media.height
  )
    throw new MediaError(
      "The rendered output failed its duration, codec or dimension check. The original is safe; retry rendering.",
    );
  return {
    metadata: verified,
    placements: placed.map((s) => ({
      start: s.start,
      duration: s.duration,
      speed: s.speed,
      end: s.actualEnd,
    })),
    extended: extend,
  };
}
