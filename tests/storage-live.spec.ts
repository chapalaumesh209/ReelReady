import { test, expect } from "@playwright/test";
import { storageAdmin, VIDEO_BUCKET } from "../lib/supabase";
test.skip(
  process.env.RUN_LIVE_TESTS !== "1",
  "Opt-in real Supabase connection and resumable storage verification.",
);
test("real Supabase upload, private access, database draft recovery and Google analysis", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  let assetToken = "",
    englishToken = "",
    fileToken = "",
    draftId = "";
  const plan = {
    ideas: [0, 1, 2].map(() => ({
      title: "A desk reel",
      hook: "Three simple desk tips.",
      outline: ["Show notebook", "Show tray and cable clip"],
      shots: ["Notebook close-up", "Tray and clip"],
      durationSeconds: 15,
      preparationMinutes: 10,
    })),
    schedulingNote: "Your chosen time.",
    recordBy: new Date(Date.now() + 3600000).toISOString(),
  };
  await page.route("**/api/plan", (route) => route.fulfill({ json: plan }));
  try {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Generate reel ideas", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Try an example", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Generate reel ideas", exact: true })
      .click();
    await page.getByRole("button", { name: "Use this plan & record" }).click();
    draftId = await page.evaluate(
      () => JSON.parse(localStorage.getItem("reelready.flow.v2")!).id,
    );
    const bytes = await page.evaluate(async () => {
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
          (rec.onstop = () =>
            resolve(new Blob(chunks, { type: "video/webm" }))),
      );
      rec.start();
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = "#e8dcff";
        ctx.fillRect(0, 0, 360, 640);
        ctx.fillStyle = "#6843aa";
        ctx.font = "23px sans-serif";
        ctx.fillText("Notebook. Tray. Cable clip.", 30, 300);
        await new Promise((r) => setTimeout(r, 100));
      }
      rec.stop();
      stream.getTracks().forEach((t) => t.stop());
      return Array.from(new Uint8Array(await (await done).arrayBuffer()));
    });
    const chooser = page.waitForEvent("filechooser");
    await page.getByLabel("Choose recording").click();
    await (
      await chooser
    ).setFiles({
      name: "desk.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(bytes),
    });
    await expect(
      page.getByText("Recording uploaded and saved privately in Supabase.", {
        exact: false,
      }),
    ).toBeVisible({ timeout: 60000 });
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("reelready.flow.v2")!),
    );
    assetToken = state.originalAsset.token;
    draftId = state.id;
    const stored = await page.request.get(
      `/api/storage?token=${encodeURIComponent(assetToken)}`,
    );
    expect(stored.status()).toBe(200);
    const { url } = await stored.json();
    expect((await page.request.get(url)).status()).toBe(200);
    await expect(
      page.getByText("Draft saved in Supabase", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem("reelready.flow.v2"));
    await page.reload();
    await expect(page.getByText("desk.webm", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("button", { name: "Review my recording" }),
    ).toBeEnabled();
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/");
    await strangerPage.request.get("/api/connections");
    expect(
      (
        await strangerPage.request.get(
          `/api/storage?token=${encodeURIComponent(assetToken)}`,
        )
      ).status(),
    ).toBe(403);
    expect(
      (await (await strangerPage.request.get("/api/draft")).json()).state?.id,
    ).not.toBe(draftId);
    await stranger.close();
    await page.getByRole("button", { name: "Review my recording" }).click();
    await expect(page.getByLabel("English voiceover script")).not.toBeEmpty({
      timeout: 100000,
    });
    fileToken = (
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("reelready.flow.v2")!),
      )
    ).token;
    await page.getByLabel("English voiceover script").fill("Three desk tips.");
    await page.route("**/api/voiceover", async (route) => {
      const count = 24000,
        buf = Buffer.alloc(44 + count * 2);
      buf.write("RIFF");
      buf.writeUInt32LE(36 + count * 2, 4);
      buf.write("WAVEfmt ", 8);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(24000, 24);
      buf.writeUInt32LE(48000, 28);
      buf.writeUInt16LE(2, 32);
      buf.writeUInt16LE(16, 34);
      buf.write("data", 36);
      buf.writeUInt32LE(count * 2, 40);
      await route.fulfill({ contentType: "audio/wav", body: buf });
    });
    await page
      .getByRole("button", { name: "Create English video", exact: true })
      .click();
    await expect(
      page.getByText("English video ready.", { exact: false }),
    ).toBeVisible({ timeout: 100000 });
    englishToken = (
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("reelready.flow.v2")!),
      )
    ).englishAsset.token;
    await expect(
      page.getByText("Draft saved in Supabase", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem("reelready.flow.v2"));
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Download English video" }),
    ).toBeVisible({ timeout: 15000 });
    const english = await page.request.get(
      `/api/storage?token=${encodeURIComponent(englishToken)}`,
    );
    expect(english.status()).toBe(200);
    expect((await english.json()).mime).toBe("video/mp4");
    const { data, error } = await storageAdmin()
      .from("reelready_drafts")
      .select("draft_id")
      .eq("draft_id", draftId)
      .single();
    expect(error).toBeNull();
    expect(data?.draft_id).toBe(draftId);
  } finally {
    if (englishToken)
      await page.request.delete("/api/storage", {
        data: { token: englishToken },
      });
    if (fileToken)
      await page.request.delete("/api/video", { data: { token: fileToken } });
    if (assetToken)
      await page.request.delete("/api/storage", {
        data: { token: assetToken },
      });
    if (draftId)
      await storageAdmin()
        .from("reelready_drafts")
        .delete()
        .eq("draft_id", draftId);
  }
});
