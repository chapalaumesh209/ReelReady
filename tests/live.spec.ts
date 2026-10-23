import { test, expect } from "@playwright/test";
test.skip(
  process.env.RUN_LIVE_TESTS !== "1",
  "Opt-in real Gemini video, plan and voice service verification.",
);
test("real plan, streamed video upload, video understanding, kit and English speech", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
  const state = await page.request.get("/api/connections");
  expect(state.ok()).toBeTruthy();
  const plan = await page.request.post("/api/plan", {
    data: {
      input:
        "I want to record a helpful short reel about three ways to keep a desk tidy. Show a notebook, a tray for small items and a cable clip.",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      timezone: "Asia/Kolkata",
      platforms: ["instagram", "youtube"],
      languages: ["English", "Telugu"],
      script: "native",
    },
  });
  expect(plan.status()).toBe(200);
  const idea = await plan.json();
  expect(idea.ideas).toHaveLength(3);
  const recording = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 640;
    const ctx = c.getContext("2d")!,
      stream = c.captureStream(12),
      chunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<Blob>(
      (resolve) =>
        (rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }))),
    );
    rec.start();
    const start = performance.now();
    while (performance.now() - start < 3000) {
      ctx.fillStyle = "#e8dcff";
      ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = "#6843aa";
      ctx.font = "26px sans-serif";
      ctx.fillText("Three desk tips", 55, 260);
      ctx.font = "20px sans-serif";
      ctx.fillText("Notebook. Tray. Cable clip.", 40, 320);
      await new Promise((r) => setTimeout(r, 80));
    }
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await (await done).arrayBuffer()));
  });
  const upload = await page.request.post("/api/video", {
    headers: {
      "Content-Type": "video/webm",
      "X-File-Size": String(recording.length),
    },
    data: Buffer.from(recording),
    timeout: 120000,
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const file = await upload.json();
  try {
    let active = file.state === "ACTIVE";
    for (let i = 0; i < 30 && !active; i++) {
      await page.waitForTimeout(2000);
      const result = await page.request.get(
        `/api/video?token=${encodeURIComponent(file.token)}`,
      );
      expect(result.ok()).toBeTruthy();
      active = (await result.json()).state === "ACTIVE";
    }
    expect(active).toBeTruthy();
    const reviewed = await page.request.post("/api/review", {
      data: {
        token: file.token,
        idea: JSON.stringify(idea.ideas[0]),
        duration: 3,
      },
      timeout: 100000,
    });
    expect(reviewed.status(), await reviewed.text()).toBe(200);
    const analysis = await reviewed.json();
    expect(analysis.summary.length).toBeGreaterThan(10);
    expect(analysis.englishScript.length).toBeGreaterThan(5);
    expect(analysis.sourceLanguage.toLowerCase()).toMatch(
      /no|none|silent|english/,
    );
    const kit = await page.request.post("/api/generate", {
      data: {
        mode: "after",
        input: `Actual video: ${analysis.summary}. English script: ${analysis.englishScript}`,
        language: "Telugu",
        script: "roman",
        details: { voice: "", brand: "", link: "", disclosure: "" },
      },
      timeout: 70000,
    });
    expect(kit.status(), await kit.text()).toBe(200);
    expect((await kit.json()).outputs).toHaveLength(4);
    const voice = await page.request.post("/api/voiceover", {
      data: {
        script: "Three desk tips. Keep a notebook, a tray, and a cable clip.",
      },
      timeout: 120000,
    });
    expect(
      voice.status(),
      voice.status() === 200 ? "" : await voice.text(),
    ).toBe(200);
    const wav = await voice.body();
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.length).toBeGreaterThan(24000);
  } finally {
    const removed = await page.request.delete("/api/video", {
      data: { token: file.token },
    });
    expect(removed.ok()).toBeTruthy();
  }
});
