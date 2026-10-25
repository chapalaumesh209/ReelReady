import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  readMP4Metadata,
  mp4RangeReader,
} from "../lib/server/media/mp4-inspection";
import { mediaSpecIssues } from "../lib/server/publishing/preflight";
const fixture = await readFile("public/samples/reelready-demo.mp4");
const inspect = (bytes: Uint8Array) =>
  readMP4Metadata(bytes.length, async (a, b) => bytes.subarray(a, b + 1));
test("actual MP4 stream metadata passes Instagram preflight without decoding or a worker", async () => {
  const info = await inspect(fixture);
  assert.equal(info.videoCodec, "h264");
  assert.equal(info.audioCodec, "aac");
  assert.equal(info.duration, 8);
  assert.equal(info.width, 360);
  assert.equal(info.height, 640);
  assert.equal(info.inspectionMethod, "mp4-container");
  assert.equal("decoded" in info, false);
  assert.deepEqual(mediaSpecIssues(info, "video/mp4"), []);
  assert.ok(
    mediaSpecIssues({ ...info, streamInspected: false }, "video/mp4").some(
      (x) => /could not be verified/.test(x),
    ),
  );
});
test("MP4 extension cannot disguise unsupported codecs or a missing AAC track", async () => {
  for (const [from, to, codec] of [
    ["avc1", "hvc1", "videoCodec"],
    ["mp4a", "ac-3", "audioCodec"],
  ]) {
    const bytes = Buffer.from(fixture);
    const marker = bytes.indexOf(from, bytes.indexOf("stsd"));
    assert.ok(marker > 0);
    bytes.write(to, marker);
    const info = await inspect(bytes);
    assert.notEqual(
      info[codec as "videoCodec" | "audioCodec"],
      codec === "videoCodec" ? "h264" : "aac",
    );
    assert.ok(
      mediaSpecIssues(info, "video/mp4").some((x) => /needs H.264/.test(x)),
    );
  }
  const info = await inspect(fixture);
  assert.ok(
    mediaSpecIssues({ ...info, audioCodec: null }, "video/mp4").some((x) =>
      /AAC/.test(x),
    ),
  );
});
test("large mdat payloads are skipped to inspect end-of-file moov using bounded ranges", async () => {
  const boxes: Buffer[] = [];
  for (let i = 0; i < fixture.length; ) {
    const length = fixture.readUInt32BE(i);
    boxes.push(fixture.subarray(i, i + length));
    i += length;
  }
  const ftyp = boxes.find((b) => b.toString("ascii", 4, 8) === "ftyp")!;
  const moov = boxes.find((b) => b.toString("ascii", 4, 8) === "moov")!;
  const mdatSize = 100 * 1024 * 1024;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(mdatSize);
  header.write("mdat", 4);
  const prefix = Buffer.concat([ftyp, header]);
  const moovStart = ftyp.length + mdatSize;
  const size = moovStart + moov.length;
  const ranges: number[] = [];
  let downloaded = 0;
  const info = await readMP4Metadata(size, async (a, b) => {
    ranges.push(a);
    const bytes = Buffer.alloc(b - a + 1);
    downloaded += bytes.length;
    for (const [offset, part] of [
      [0, prefix],
      [moovStart, moov],
    ] as const) {
      const start = Math.max(a, offset),
        end = Math.min(b + 1, offset + part.length);
      if (end > start)
        part.copy(bytes, start - a, start - offset, end - offset);
    }
    return bytes;
  });
  assert.equal(info.videoCodec, "h264");
  assert.ok(ranges.some((x) => x === moovStart));
  assert.ok(downloaded < 1024 * 1024);
});
test("malformed, truncated and metadata-only inputs never get a verification marker", async () => {
  for (const bytes of [
    Buffer.from("not an MP4"),
    fixture.subarray(0, 32),
    Buffer.alloc(64),
  ])
    await assert.rejects(() => inspect(bytes));
  await assert.rejects(
    () => readMP4Metadata(fixture.length, async () => new Uint8Array(3)),
    /incomplete/,
  );
});
test("display rotation and actual duration remain subject to Instagram limits", async () => {
  const bytes = Buffer.from(fixture);
  const matrix = bytes.indexOf("tkhd") + 44;
  [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824].forEach((v, i) =>
    bytes.writeInt32BE(v, matrix + i * 4),
  );
  const info = await inspect(bytes);
  assert.equal(info.width, 640);
  assert.equal(info.height, 360);
  assert.ok(mediaSpecIssues(info, "video/mp4").some((x) => /portrait/.test(x)));
  assert.ok(
    mediaSpecIssues({ ...info, duration: 91 }, "video/mp4").some((x) =>
      /5 to 90/.test(x),
    ),
  );
});
test("range reader refuses redirects/full large responses, mismatched ranges and oversized bodies", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(new Uint8Array(100), { status: 200 });
    await assert.rejects(
      () =>
        mp4RangeReader(
          "https://storage.example/video",
          1000,
          AbortSignal.timeout(1000),
        )(0, 99),
      /Storage/,
    );
    globalThis.fetch = async () =>
      new Response(new Uint8Array(100), {
        status: 206,
        headers: { "content-range": "bytes 1-100/1000" },
      });
    await assert.rejects(
      () =>
        mp4RangeReader(
          "https://storage.example/video",
          1000,
          AbortSignal.timeout(1000),
        )(0, 99),
      /Storage/,
    );
    globalThis.fetch = async () =>
      new Response(new Uint8Array(101), {
        status: 206,
        headers: { "content-range": "bytes 0-99/1000" },
      });
    await assert.rejects(
      () =>
        mp4RangeReader(
          "https://storage.example/video",
          1000,
          AbortSignal.timeout(1000),
        )(0, 99),
      /too large/,
    );
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.redirect, "error");
      assert.equal(
        (init?.headers as Record<string, string>).Range,
        "bytes=0-99",
      );
      return new Response(new Uint8Array(100), {
        status: 206,
        headers: { "content-range": "bytes 0-99/1000" },
      });
    };
    assert.equal(
      (
        await mp4RangeReader(
          "https://storage.example/video",
          1000,
          AbortSignal.timeout(1000),
        )(0, 99)
      ).length,
      100,
    );
  } finally {
    globalThis.fetch = original;
  }
});
