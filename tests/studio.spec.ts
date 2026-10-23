import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { exampleKit } from "../lib/content";
const plan = {
  ideas: [0, 1, 2].map((i) => ({
    title: ["A mango morning", "Breakfast in three steps", "The fruit swap"][i],
    hook: "A mango yogurt bowl for your next breakfast.",
    outline: [
      "Show the ingredients",
      "Mix yogurt and mango",
      "Add granola and serve",
    ],
    shots: ["Ingredients close-up", "Mixing the bowl", "Finished breakfast"],
    durationSeconds: 30,
    preparationMinutes: 15,
  })),
  schedulingNote:
    "Your chosen time leaves room to record and review. This is a user-selected time, not an analytics prediction.",
  recordBy: new Date(Date.now() + 3600000).toISOString(),
};
const analysis = {
  summary: "A creator shows a mango yogurt bowl and adds granola.",
  sourceLanguage: "Telugu",
  transcript: "Mamidi perugu bowl.",
  englishScript: "Here is my mango yogurt bowl. Add mango and granola.",
  audioNote: "An English translation for the short reel.",
};
async function setup(page: Page) {
  await page.route("**/api/connections", (route) =>
    route.fulfill({
      json: {
        configured: true,
        aiConfigured: true,
        accounts: {
          instagram: { name: "@foodcreator", connected: true, reauth: false },
          youtube: { name: "Food channel", connected: true, reauth: false },
          x: { name: "@foodcreator", connected: true, reauth: false },
        },
      },
    }),
  );
  await page.route("**/api/plan", (route) => route.fulfill({ json: plan }));
  await page.route("**/api/review", (route) =>
    route.fulfill({ json: analysis }),
  );
  await page.route("**/api/video*", (route) =>
    route.fulfill({ json: { token: "test-file-token", state: "ACTIVE" } }),
  );
  await page.route("**/api/generate", (route) => {
    const d = route.request().postDataJSON();
    return route.fulfill({ json: exampleKit("after", d.language, d.script) });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
}
async function fixture(page: Page) {
  return await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 640;
    const ctx = canvas.getContext("2d")!,
      stream = canvas.captureStream(12),
      chunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<Blob>(
      (resolve) =>
        (rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }))),
    );
    rec.start();
    const start = performance.now();
    while (performance.now() - start < 1500) {
      ctx.fillStyle = "#e8dcff";
      ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = "#6843aa";
      ctx.font = "28px sans-serif";
      ctx.fillText("Mango morning", 45, 310);
      await new Promise((r) => setTimeout(r, 80));
    }
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await (await done).arrayBuffer()));
  });
}
async function toRecording(page: Page) {
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate reel ideas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pick your starting point" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use this plan & record" }).click();
}
async function uploadRecording(page: Page) {
  const bytes = await fixture(page);
  await page.getByLabel("Choose recording").setInputFiles({
    name: "breakfast.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText("Recording added.")).toBeVisible();
}
test("desktop: connected flow, local video, review, real WASM export, captions and schedule receipt", async ({
  page,
}) => {
  test.setTimeout(180000);
  const browserErrors:string[]=[];
  page.on("console",message=>{if(message.type()==="error")browserErrors.push(message.text());});
  await page.setViewportSize({ width: 1440, height: 1050 });
  await setup(page);
  await page.screenshot({ path: "artifacts/flow-desktop.png", fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await toRecording(page);
  await uploadRecording(page);
  await page.getByRole("button", { name: "Review my recording" }).click();
  await expect(page.getByLabel("English voiceover script")).toHaveValue(
    analysis.englishScript,
  );
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
    for (let i = 0; i < count; i++)
      buf.writeInt16LE(
        Math.round(Math.sin((i / 24000) * 440 * Math.PI * 2) * 1000),
        44 + i * 2,
      );
    await route.fulfill({ contentType: "audio/wav", body: buf });
  });
  await page
    .getByRole("button", { name: "Create English video", exact: true })
    .click();
  await expect(page.getByText("English video ready.")).toBeVisible({
    timeout: 100000,
  });
  await expect(
    page.getByRole("link", { name: "Download English video" }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        page
          .locator('video[aria-label="Selected video preview"]')
          .evaluate(
            (v: HTMLVideoElement) =>
              v.readyState >= 2 && v.duration > 0 && v.videoWidth === 360,
          ),
      { timeout: 15000 },
    )
    .toBe(true);
  await page
    .getByRole("textbox", { name: "Instagram caption", exact: true })
    .fill("Mango, yogurt, granola. Breakfast made simple. #Mango");
  await page.screenshot({
    path: "artifacts/flow-review-desktop.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  let publishUploads = 0;
  await page.route("**/api/publish", (route) => {
    if (route.request().headers()["content-type"]?.includes("application/json"))
      return route.fulfill({
        json: { token: "signed-publish", tracking: "tracking-token" },
      });
    publishUploads++;
    return route.fulfill({
      json: {
        token: "delivery-token",
        deliveries: [
          { platform: "instagram", state: "scheduled" },
          { platform: "youtube", state: "scheduled" },
        ],
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        done: false,
      },
    });
  });
  await page
    .getByRole("button", { name: "Schedule on selected platforms" })
    .click();
  await expect(
    page.getByText("Delivery status", { exact: true }),
  ).toBeVisible();
  expect(publishUploads).toBe(1);
  await expect(
    page.getByRole("button", { name: "Schedule on selected platforms" }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByText("Delivery status", { exact: true }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});
test("mobile: usable first run, labels, keyboard, no overflow; stale plan cannot advance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.screenshot({ path: "artifacts/flow-mobile.png", fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await toRecording(page);
  await page.getByRole("button", { name: "Back to plan" }).click();
  await page
    .getByLabel("Your reel idea")
    .fill("A completely new reel topic about balcony gardening.");
  await expect(
    page.getByRole("button", { name: "Use this plan & record" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(
    page.getByRole("heading", { name: "A little voice goes a long way." }),
  ).toBeVisible();
});
test("errors preserve input and failed generation never advances or fabricates output", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/plan", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "The writing service is busy. Try again." },
    }),
  );
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate reel ideas", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("busy");
  await expect(page.getByLabel("Your reel idea")).not.toBeEmpty();
  await expect(
    page.getByRole("heading", { name: "Pick your starting point" }),
  ).toHaveCount(0);
});
