import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { publishingKit } from "../lib/server/kits";
import { storageAdmin, VIDEO_BUCKET } from "../lib/supabase";
import {
  defaultSettings,
  type AudioState,
  type MediaJob,
} from "../lib/audio/schema";
// Sample output is explicit in this isolated provider fixture, never in the app.
process.env.ALLOW_SAMPLE_OUTPUT = "true";
const admin = storageAdmin();
const ids = new Set<string>();
// External caption AI is mocked; private uploads, worker renders and publication persistence remain real.
test.beforeEach(async ({ page }) => {
  const address = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::3`;
  await page.route(/^http:\/\/127\.0\.0\.1:3002\/api\//, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-forwarded-for": address },
    }),
  );
  await page.route(
    /\/api\/(?:generate|ai\/change-request)(?:\?|$)/,
    async (route) => {
      const body = route.request().postDataJSON();
      const kit = await publishingKit(
        { ...body, professional: false },
        AbortSignal.timeout(1000),
      );
      if (
        body.professional &&
        !route.request().url().includes("change-request")
      )
        kit.discovery = {
          primaryKeyword: "creator reel",
          supportingKeywords: ["content planning"],
          searchIntent: "Sample strategy for browser coverage.",
          location: body.details?.location || "",
          liveTrendsChecked: false,
        };
      await route.fulfill({ json: kit });
    },
  );
});
test.afterEach(async ({ page }) => {
  try {
    const id = await page.evaluate(
      () => JSON.parse(localStorage.getItem("reelready.flow.v2") || "null")?.id,
    );
    if (id) ids.add(id);
  } catch {}
});
test.afterAll(async () => {
  for (const id of ids) {
    const media = await admin
      .from("reelready_media")
      .select("path")
      .eq("reel_id", id);
    if (media.data?.length)
      await admin.storage
        .from(VIDEO_BUCKET)
        .remove(media.data.map((m) => m.path));
    await admin.from("reelready_jobs").delete().eq("reel_id", id);
    await admin.from("reelready_reels").delete().eq("id", id);
  }
});
async function start(page: Page) {
  await page.goto("/studio?new=1");
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
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
  await expect(
    page.getByRole("heading", { name: "Make it yours. Hit record." }),
  ).toBeVisible();
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("button", { name: "I’ve recorded it", exact: false })
    .click();
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
async function upload(page: Page, name = "recording.webm") {
  const bytes = await fixture(page);
  await page.getByLabel("Choose recording").setInputFiles({
    name,
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByText("Recording uploaded and saved privately in Supabase.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 30000 });
}
test("root opens directly into one focused task on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Your reel idea", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /All reels|Accounts|Preferences|New reel/ }),
  ).toHaveCount(0);
  await expect(page.locator(".flow-progress")).toContainText("Step 1 of 6");
  await expect(page.locator(".flow-options").first()).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".creator-details")).not.toHaveAttribute(
    "open",
    "",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/flow-entry-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/flow-entry-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByText("Language & schedule", { exact: false }).click();
  await expect(page.getByLabel("When do you want to publish?")).toBeVisible();
  await page.getByLabel("Writing style").selectOption("roman");
  await expect(page.getByLabel("Writing style")).toHaveValue("roman");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("complete six-step flow, private upload, original audio and confirmed demo publishing survive refresh", async ({
  page,
}) => {
  test.setTimeout(150000);
  await start(page);
  await upload(page);
  await page.getByText("Add recording notes", { exact: false }).click();
  await page
    .getByLabel("Anything that changed while filming?")
    .fill("I showed a notebook and a cable clip.");
  await page.getByRole("button", { name: "Continue to audio & voice" }).click();
  await expect(
    page.getByRole("heading", { name: "How should your reel sound?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep original audio", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByText("Advanced", { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/audio-simple-original-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/audio-simple-original-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Continue to captions" }).click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).not.toBeEmpty();
  await page.locator("summary").filter({ hasText: "Add my details" }).click();
  await page
    .getByRole("textbox", { name: "Who should this reach?", exact: true })
    .fill("Creators planning helpful tutorials");
  await page
    .getByRole("textbox", { name: "Place featured in this video", exact: true })
    .fill("Hyderabad");
  await page
    .getByRole("textbox", { name: "What should viewers do next?", exact: true })
    .fill("Save the recording tips");
  await page
    .getByRole("textbox", { name: "Relevant words to include", exact: true })
    .fill("content planning, creator workflow");
  await page
    .getByRole("button", { name: "Regenerate captions", exact: true })
    .click();
  await page
    .getByText("Search phrases & caption strategy", { exact: true })
    .click();
  await expect(page.locator(".caption-strategy")).toContainText("Hyderabad");
  await expect(page.locator(".caption-strategy")).toContainText(
    "Live trends and search volumes haven’t been checked",
  );
  await page.locator("summary").filter({ hasText: "Add my details" }).click();
  await page.screenshot({
    path: "artifacts/caption-strategy-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/caption-strategy-mobile.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        width: e.getBoundingClientRect().width,
        text: e.textContent?.slice(0, 80),
      }))
      .slice(0, 20),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    JSON.stringify(overflow),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("textbox", { name: "Instagram caption", exact: true })
    .fill("My manually written caption. Keep my specific detail.");
  await expect(page.locator(".caption-strategy")).toHaveCount(0);
  await page.getByText("Ask for a caption change", { exact: true }).click();
  await page
    .getByLabel("Want to change the wording?")
    .fill("దీన్ని చిన్నగా చేయండి");
  await page
    .getByRole("button", { name: "Apply my changes", exact: false })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).toHaveValue("My manually written caption.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  ids.add(saved.id);
  expect(saved.originalAsset?.size).toBeGreaterThan(0);
  await page.goto(`/studio?id=${saved.id}`);
  await expect(
    page.getByRole("link", { name: "Download original", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/workflow-review-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await page.getByRole("radio", { name: "Publish now", exact: true }).check();
  const primary = page.locator("fieldset .action-row .primary").last();
  await primary.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep reviewing" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Keep reviewing" }).click();
  expect(
    (
      (await page.request
        .get(`/api/publish/status?reelId=${saved.id}`)
        .then((r) => r.json())) as { job: null }
    ).job,
  ).toBeNull();
  await primary.click();
  await page
    .getByRole("button", { name: "Confirm demo publication", exact: true })
    .click();
  await expect(
    page.getByText("Demo mode: nothing was posted.", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".delivery-row")).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByText("Simulated post. Nothing was posted.", { exact: true }),
  ).toHaveCount(2, { timeout: 15000 });
  const job = (
    await admin
      .from("reelready_jobs")
      .select("is_demo,status")
      .eq("reel_id", saved.id)
      .single()
  ).data;
  expect(job).toEqual({ is_demo: true, status: "demo" });
  await page.goto("/");
  await expect(page.locator(".delivery-row")).toHaveCount(2);
  // Starting another reel is safe: the previous receipt and source stay stored.
  await page
    .getByRole("button", { name: "Start a new reel", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your reel idea", exact: true }),
  ).toHaveValue("");
  const previous = await page.request.get(`/api/reels?id=${saved.id}`);
  expect(previous.ok()).toBe(true);
  expect((await previous.json()).state.originalAsset.path).toBe(
    saved.originalAsset.path,
  );
});
async function toPublish(page: Page) {
  await start(page);
  await page
    .getByRole("button", { name: "Use a sample video", exact: true })
    .click();
  await expect(
    page.getByText("Recording uploaded and saved privately", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Continue to audio & voice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue to captions", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).not.toBeEmpty();
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
}
test("account callbacks return to the same flow; missing credentials never simulate accounts", async ({
  page,
}) => {
  await toPublish(page);
  const reelID = await page.evaluate(
    () => JSON.parse(localStorage.getItem("reelready.flow.v2")!).id,
  );
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.evaluate(
    (id) => sessionStorage.setItem("reelready.return", `/?id=${id}`),
    reelID,
  );
  await page.goto("/connect?connect_status=success&platform=instagram");
  await expect(page).toHaveURL(new RegExp(`\\?id=${reelID}$`));
  await expect(
    page.getByRole("heading", { name: "One reel. Ready to go." }),
  ).toBeVisible();
  await expect(page.getByText("Not configured", { exact: true })).toHaveCount(
    3,
  );
  await expect(
    page.getByRole("button", { name: "Connect Instagram", exact: true }),
  ).toBeDisabled();
  expect(
    (
      await page.request.post("/api/connect/instagram", {
        data: { platform: "instagram" },
      })
    ).status(),
  ).toBe(503);
  await page.goto("/connect?connect_status=cancelled");
  await expect(
    page.getByText("Connection cancelled.", { exact: false }),
  ).toBeVisible();
  await page.goto(
    "/connect?connect_status=error&error_description=sk-private-do-not-display",
  );
  await expect(page.locator(".messages [role=alert]")).toContainText(
    "Couldn’t connect",
  );
  await expect(page.locator("body")).not.toContainText("sk-private");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("a failed replacement upload preserves the existing recording and provides a useful error", async ({
  page,
}) => {
  await start(page);
  await upload(page, "first.webm");
  const original = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("reelready.flow.v2")!).originalAsset.path,
  );
  await page.route("**/storage/v1/upload/resumable/sign**", (route) =>
    route.fulfill({ status: 413, body: "Maximum size exceeded" }),
  );
  const bytes = await fixture(page);
  await page.getByLabel("Choose recording").setInputFiles({
    name: "replacement.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator(".message.error")).toContainText(
    "project storage allowance",
  );
  await expect(page.getByText("first.webm", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("reelready.flow.v2")!).originalAsset
          .path,
    ),
  ).toBe(original);
});
test("nonconforming media is preserved with clear platform warnings", async ({
  page,
}) => {
  await start(page);
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 360;
    const stream = c.captureStream(10),
      chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const done = new Promise<Blob>(
      (r) =>
        (recorder.onstop = () => r(new Blob(chunks, { type: "video/webm" }))),
    );
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    for (let i = 0; i < 12; i++) {
      c.getContext("2d")!.fillRect(i, 0, 640, 360);
      await new Promise((r) => setTimeout(r, 100));
    }
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await (await done).arrayBuffer()));
  });
  await page.getByLabel("Choose recording").setInputFiles({
    name: "landscape.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByText("Landscape video:", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("landscape.webm", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "artifacts/upload-warning-desktop.png",
    fullPage: true,
  });
});

test("inline account controls open official consent and verify the return before showing connected", async ({
  page,
}) => {
  let verified = false,
    disconnected = false;
  // Establish the real anonymous cookie before replacing external account status.
  await page.request.get("/api/connections");
  await page.route("**/api/connections", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connectionMode: "real",
        demo: true,
        accounts: verified
          ? {
              youtube: {
                name: "Verified channel fixture",
                connected: true,
                reauth: false,
              },
            }
          : {},
      },
    }),
  );
  await page.route("**/api/connect/youtube", (route) =>
    route.fulfill({
      json: {
        url: "https://accounts.google.com/o/oauth2/auth?state=test-single-use",
        demo: false,
      },
    }),
  );
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Authorization screen fixture</h1>",
    }),
  );
  await page.route("**/api/connect/disconnect", async (route) => {
    expect(route.request().postDataJSON().platform).toBe("youtube");
    verified = false;
    disconnected = true;
    await route.fulfill({ json: { disconnected: true } });
  });
  await toPublish(page);
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(3);
  await page
    .getByRole("button", { name: "Connect YouTube", exact: true })
    .click();
  await expect(page).toHaveURL(
    /https:\/\/accounts.google.com\/o\/oauth2\/auth/,
  );
  await page.goto("/connect?connect_status=success&platform=youtube");
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(3);
  await page.goto("/connect?connect_status=cancelled");
  await expect(
    page.getByText("Connection cancelled.", { exact: false }),
  ).toBeVisible();
  verified = true;
  await page.reload();
  await expect(
    page.getByText("Verified channel fixture", { exact: true }),
  ).toBeVisible();
  await page.locator(".account-actions > summary").click();
  await page
    .getByRole("button", { name: "Disconnect YouTube", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disconnect account", exact: true })
    .click();
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(3);
  expect(disconnected).toBe(true);
  await expect(page.locator(".flow-progress")).toContainText("Step 6 of 6");
});

test("the active reel resumes without a dashboard and older deep links still work", async ({
  page,
}) => {
  await page.goto("/");
  const box = page.getByRole("textbox", {
    name: "Your reel idea",
    exact: true,
  });
  await expect(box).toBeEnabled();
  await box.fill(
    "నా కథ. मेरी रील. A day in my balcony garden, showing only my own plants.",
  );
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  await page.goto("/");
  await expect(box).toHaveValue(saved.input);
  await page.goto(`/studio?id=${saved.id}`);
  await expect(box).toHaveValue(saved.input);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.goto("/settings");
  await expect(box).toHaveValue(saved.input);
  await expect(
    page.getByRole("button", { name: "Save preferences" }),
  ).toHaveCount(0);
});
test("optional creator details stay inside the task and survive refresh", async ({
  page,
}) => {
  await page.goto("/?new=1");
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
  await page.locator(".creator-details > summary").click();
  const brand = page.getByRole("textbox", {
    name: "Brand or creator name",
    exact: true,
  });
  await brand.fill("నా క్రియేటర్ · My creator");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".creator-details")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.locator(".creator-details > summary").click();
  await expect(brand).toHaveValue("నా క్రియేటర్ · My creator");
  await page.locator(".creator-details > summary").click();
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate reel ideas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pick your starting point" }),
  ).toBeVisible();
  await expect(page.locator(".plan-brief")).not.toHaveAttribute("open", "");
  await page.locator(".plan-brief > summary").click();
  await expect(
    page.getByRole("textbox", { name: "Your reel idea", exact: true }),
  ).toBeVisible();
});

// These tests isolate the guided voiceover UI. Real FFmpeg and queue behavior stay in test:media.
async function mockVoiceover(
  page: Page,
  fail = false,
  faults: {
    lostCreate?: boolean;
    lostPolls?: boolean;
    cooldown?: boolean;
    freeVoice?: boolean;
    oldProviderFailure?: boolean;
  } = {},
) {
  const sourceId = crypto.randomUUID(),
    renderedId = crypto.randomUUID();
  let state: AudioState = {
    settings: defaultSettings(),
    transcript: "",
    script: "",
    classification: "unknown",
    segments: [],
    source_id: sourceId,
    rendered_id: null,
    approved_hash: null,
    updated_at: new Date().toISOString(),
  };
  let job: MediaJob | null = faults.oldProviderFailure
      ? {
          id: crypto.randomUUID(),
          source_id: sourceId,
          kind: "english",
          status: "failed",
          stage: "Needs attention",
          result: null,
          safe_error: "The speech provider’s daily allowance is used up.",
          speech_model: "gemini-3.8-flash-tts",
          updated_at: new Date().toISOString(),
        }
      : null,
    polls = 0,
    creates = 0;
  let createId = "",
    postDropped = false,
    pollsDropped = 0;
  const metadata = {
    decoded: true,
    hasAudio: true,
    duration: 8,
    width: 360,
    height: 640,
    videoCodec: "h264",
    audioCodec: "aac",
  };
  await page.route(/\/api\/audio(?:\?|$)/, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "save")
        state = {
          ...state,
          ...body.edit,
          rendered_id: null,
          approved_hash: null,
        };
      if (body.action === "original")
        state = {
          ...state,
          settings: {
            ...defaultSettings(),
            creatorInstructions: state.settings.creatorInstructions,
            voiceProfile: state.settings.voiceProfile,
            style: state.settings.style,
          },
          rendered_id: sourceId,
          approved_hash: "test-original",
        };
      await route.fulfill({ json: state });
    } else
      await route.fulfill({
        json: {
          state,
          assets: [{ id: sourceId, metadata }],
          workerReady: true,
          speechReady: !faults.cooldown,
          voiceDirectionsOnly: !!faults.freeVoice,
          speechModel: faults.freeVoice
            ? "fish-audio/s2.1-pro-free:free"
            : "gemini-3.8-flash-tts",
          speechUnavailableReason: faults.cooldown
            ? "The speech provider’s daily allowance is used up. Your script and completed voice segments are saved."
            : undefined,
          transcriptionReady: true,
        },
      });
  });
  await page.route(/\/api\/media\/jobs(?:\?|$)/, async (route) => {
    if (new URL(route.request().url()).searchParams.has("reelId")) {
      await route.fulfill({ json: { jobs: job ? [job] : [] } });
      return;
    }
    if (faults.lostPolls && pollsDropped++ < 2) {
      await route.abort("failed");
      return;
    }
    if (job && ++polls > 1) {
      state = {
        ...state,
        script: "Here is my story in English.",
        transcript: "Here is my story in English.",
        rendered_id: renderedId,
        approved_hash: "test-approved",
      };
      job = {
        ...job,
        status: "completed",
        stage: "Video ready",
        result: { assetId: renderedId, applied: true },
      };
    }
    await route.fulfill({ json: job });
  });
  await page.route("**/api/media/english", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.confirmed).toBe(true);
    expect(body.sourceId).toBe(sourceId);
    expect(state.settings.targetLanguage).toBe("English");
    expect(state.settings.durationMode).toBe("fit-video");
    expect(state.settings.voiceProfile).toBeDefined();
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    if (job && body.requestId === createId) {
      await route.fulfill({ json: job });
      return;
    }
    createId = body.requestId;
    creates++;
    if (fail) {
      await route.fulfill({
        status: 429,
        json: {
          error:
            "The speech service reached its usage limit. Your script is saved; retry later.",
        },
      });
      return;
    }
    polls = 0;
    job = {
      id: crypto.randomUUID(),
      source_id: sourceId,
      kind: "english",
      status: "queued",
      stage: "Creating your English video…",
      result: null,
      safe_error: null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    if (faults.lostCreate && !postDropped) {
      postDropped = true;
      await route.abort("failed");
      return;
    }
    await route.fulfill({ json: job });
  });
  await page.route(/\/api\/media\/assets\?/, async (route) => {
    const draft = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("reelready.flow.v2")!),
    );
    await route.fulfill({
      json: {
        id: new URL(route.request().url()).searchParams.get("id"),
        url: "/samples/reelready-demo.mp4",
        stored: draft.originalAsset,
        metadata,
      },
    });
  });
  return { state: () => state, creates: () => creates };
}

test("guided English voiceover accepts multilingual words, survives refresh, renders and continues (mocked provider)", async ({
  page,
}) => {
  await start(page);
  await upload(page);
  const voice = await mockVoiceover(page);
  await page.getByRole("button", { name: "Continue to audio & voice" }).click();
  await expect(
    page.getByRole("button", { name: "Keep original audio", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "Voiceover words", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "English voiceover", exact: false })
    .click();
  const words = page.getByRole("textbox", {
    name: "Voiceover words",
    exact: true,
  });
  await words.fill("నా కథ. मेरी कहानी. Tell only what I showed in this video.");
  await page.getByLabel("Voice", { exact: true }).selectOption("male");
  await page.getByLabel("Accent", { exact: true }).selectOption("en-IN");
  await page
    .getByLabel("Delivery", { exact: true })
    .selectOption("Clear and professional");
  await expect
    .poll(() => voice.state().settings.creatorInstructions || "")
    .toContain("నా కథ");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "English voiceover", exact: false })
    .click();
  await expect(words).toHaveValue(
    "నా కథ. मेरी कहानी. Tell only what I showed in this video.",
  );
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue("male");
  await expect(page.getByLabel("Accent", { exact: true })).toHaveValue("en-IN");
  await expect(page.getByLabel("Delivery", { exact: true })).toHaveValue(
    "Clear and professional",
  );
  await page.screenshot({
    path: "artifacts/audio-simple-english-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/audio-simple-english-mobile.png",
    fullPage: true,
  });
  const create = page.getByRole("button", {
    name: "Create English voiceover",
    exact: true,
  });
  await create.click();
  await expect(
    page.getByRole("link", { name: "Download selected video" }),
  ).toBeVisible({ timeout: 15000 });
  expect(voice.creates()).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Download selected video" }),
  ).toBeVisible();
  expect(voice.creates()).toBe(1);
  await expect(
    page.getByRole("radio", { name: "Use saved audio version", exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue to captions", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "artifacts/audio-simple-ready-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Change voice or words", exact: true })
    .click();
  await words.fill("Here is my updated story.");
  await page.getByLabel("Voice", { exact: true }).selectOption("female");
  await page.getByLabel("Accent", { exact: true }).selectOption("en-GB");
  await page.getByLabel("Delivery", { exact: true }).selectOption("Casual");
  await expect(
    page.getByRole("button", { name: "Continue to captions", exact: true }),
  ).toHaveCount(0);
  await create.click();
  await expect(
    page.getByRole("link", { name: "Download selected video" }),
  ).toBeVisible({ timeout: 15000 });
  expect(voice.creates()).toBe(2);
  await page
    .getByRole("button", { name: "Continue to captions", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).not.toBeEmpty();
});

test("voiceover quota errors keep words and offer original continuation (mocked provider)", async ({
  page,
}) => {
  await start(page);
  await upload(page);
  const voice = await mockVoiceover(page, true);
  await page.getByRole("button", { name: "Continue to audio & voice" }).click();
  await page
    .getByRole("button", { name: "English voiceover", exact: false })
    .click();
  await page.getByLabel("Voice", { exact: true }).selectOption("male");
  await page.getByLabel("Accent", { exact: true }).selectOption("en-IN");
  await page
    .getByLabel("Delivery", { exact: true })
    .selectOption("Clear and professional");
  const words = page.getByRole("textbox", {
    name: "Voiceover words",
    exact: true,
  });
  await words.fill(
    "Keep this exact script saved while the service is unavailable.",
  );
  await page
    .getByRole("button", { name: "Create English voiceover", exact: true })
    .click();
  await expect(page.locator(".audio-simple [role=alert]")).toContainText(
    "usage limit",
  );
  await expect(words).toHaveValue(
    "Keep this exact script saved while the service is unavailable.",
  );
  expect(voice.state().settings.creatorInstructions).toContain(
    "Keep this exact script",
  );
  await page
    .getByRole("button", { name: "Continue with original audio", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).not.toBeEmpty();
  await page
    .getByRole("button", { name: "Edit audio & voice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "English voiceover", exact: false })
    .click();
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue("male");
  await expect(page.getByLabel("Accent", { exact: true })).toHaveValue("en-IN");
  await expect(page.getByLabel("Delivery", { exact: true })).toHaveValue(
    "Clear and professional",
  );
  await expect(words).toHaveValue(
    "Keep this exact script saved while the service is unavailable.",
  );
});

test("live entry ignores sample links and offers no canned example shortcuts", async ({
  page,
}) => {
  await page.route("**/api/limits", (route) =>
    route.fulfill({
      json: { maxUploadMB: 200, maxVideoSeconds: 90, samplesAvailable: false },
    }),
  );
  await page.goto("/?sample=judge");
  await expect(
    page.getByRole("textbox", { name: "Your reel idea", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Try an example", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Use a sample video", exact: true }),
  ).toHaveCount(0);
  await expect(page).not.toHaveURL(/sample=/);
  await page.screenshot({
    path: "artifacts/live-entry-no-samples-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "artifacts/live-entry-no-samples-mobile.png",
    fullPage: true,
  });
});

test("cloud autosave retries a temporary failure and preserves unsaved multilingual edits through reload", async ({
  page,
}) => {
  await page.goto("/?new=1");
  const box = page.getByRole("textbox", {
    name: "Your reel idea",
    exact: true,
  });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  let failed = false;
  await page.route("**/api/draft", (route) => {
    if (route.request().method() === "POST" && !failed) {
      failed = true;
      return route.abort("failed");
    }
    return route.continue();
  });
  const words = "నా పొదుపు ఆలోచన — मेरी कहानी — keep my latest words.";
  await box.fill(words);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  expect(failed).toBe(true);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  expect(
    (await (await page.request.get(`/api/reels?id=${saved.id}`)).json()).state
      .input,
  ).toBe(words);
  await page.route("**/api/draft", (route) =>
    route.fulfill({ status: 503, json: { error: "Temporary outage" } }),
  );
  const latest = words + " Unsaved offline edit.";
  await box.fill(latest);
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("reelready.flow.v2")!).input,
        ),
    )
    .toBe(latest);
  await page.route("**/api/reels?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Temporary outage" } }),
  );
  await page.reload();
  await expect(box).toHaveValue(latest);
  await page.unroute("**/api/draft");
  await page.unroute("**/api/reels?*");
  // Recovering connectivity triggers a fresh storage check and queued save.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  expect(
    (await (await page.request.get(`/api/reels?id=${saved.id}`)).json()).state
      .input,
  ).toBe(latest);
  await page.screenshot({
    path: "artifacts/autosave-recovered-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(box).toHaveValue(latest);
  await page.screenshot({
    path: "artifacts/autosave-recovered-mobile.png",
    fullPage: false,
  });
});

test("failed cloud hydration without a matching browser copy cannot overwrite a saved reel", async ({
  page,
}) => {
  await page.goto("/?new=1");
  const box = page.getByRole("textbox", {
    name: "Your reel idea",
    exact: true,
  });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await box.fill("Preserve this cloud-only reel.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  await page.evaluate(() => localStorage.removeItem("reelready.flow.v2"));
  let writes = 0;
  await page.route("**/api/draft", (route) => {
    writes++;
    return route.continue();
  });
  await page.route("**/api/reels?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Temporary outage" } }),
  );
  await page.reload();
  await expect(
    page.getByText("Temporary outage", { exact: true }),
  ).toBeVisible();
  await expect(box).toHaveValue("");
  await page.waitForTimeout(1800);
  expect(writes).toBe(0);
  expect(
    await page.evaluate(() => localStorage.getItem("reelready.flow.v2")),
  ).toBeNull();
  await page.reload();
  await expect(
    page.getByText("Temporary outage", { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.unroute("**/api/reels?*");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(box).toHaveValue("Preserve this cloud-only reel.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Temporary outage", { exact: true })).toHaveCount(
    0,
  );
  expect(
    (await (await page.request.get(`/api/reels?id=${saved.id}`)).json()).state
      .input,
  ).toBe("Preserve this cloud-only reel.");
});

test("a changed anonymous workspace automatically saves a text-only recovered copy without changing the original", async ({
  page,
}) => {
  await page.goto("/?new=1");
  const box = page.getByRole("textbox", {
    name: "Your reel idea",
    exact: true,
  });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await box.fill("Original cloud idea remains private.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const original = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  await page.route("**/api/draft", (route) => {
    if (route.request().postDataJSON()?.state.id === original.id)
      return route.fulfill({
        status: 409,
        json: {
          error: "Private browser workspace changed",
          code: "REEL_WORKSPACE_CHANGED",
        },
      });
    return route.continue();
  });
  const latest = "Keep these browser edits — నా తాజా ఆలోచన";
  await box.fill(latest);
  await expect(
    page.getByText("Recovered copy saved. The original draft is unchanged.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  const recovered = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  expect(recovered.id).not.toBe(original.id);
  expect(recovered.input).toBe(latest);
  await expect(page).toHaveURL(new RegExp(recovered.id));
  expect(
    (await (await page.request.get(`/api/reels?id=${original.id}`)).json())
      .state.input,
  ).toBe(original.input);
  expect(
    (await (await page.request.get(`/api/reels?id=${recovered.id}`)).json())
      .state.input,
  ).toBe(latest);
  expect(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem(`reelready.recovery.${id}`)!).input,
      original.id,
    ),
  ).toBe(latest);
  // The suite cleanup must include both new fixtures.
  ids.add(original.id);
  await page.screenshot({
    path: "artifacts/workspace-recovered-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(box).toHaveValue(latest);
  await page.screenshot({
    path: "artifacts/workspace-recovered-mobile.png",
    fullPage: false,
  });
});

test("video workspace recovery requires a clear action and keeps the original upload private and intact", async ({
  page,
}) => {
  await start(page);
  await upload(page);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const original = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  ids.add(original.id);
  await page.route("**/api/draft", (route) =>
    route.request().postDataJSON()?.state.id === original.id
      ? route.fulfill({
          status: 409,
          json: {
            error: "Private browser workspace changed",
            code: "REEL_WORKSPACE_CHANGED",
          },
        })
      : route.continue(),
  );
  await page.reload();
  const recover = page.getByRole("button", {
    name: "Save a recovered copy",
    exact: true,
  });
  await expect(recover).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(new RegExp(original.id));
  await expect(
    page.getByText(/you’ll need to attach the video again/),
  ).toBeVisible();
  await recover.click();
  await expect(
    page.getByText(
      "Recovered copy saved. The original draft is unchanged. Attach your video again to continue.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 20000 });
  const copy = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  expect(copy.originalAsset).toBeNull();
  expect(copy.englishAsset).toBeNull();
  expect(copy.job).toBeNull();
  expect(copy.id).not.toBe(original.id);
  expect(copy.input).toBe(original.input);
  const originalMedia = await admin
    .from("reelready_media")
    .select("path")
    .eq("reel_id", original.id)
    .eq("path", original.originalAsset.path)
    .single();
  expect(originalMedia.error).toBeNull();
  expect(
    (await admin.storage.from(VIDEO_BUCKET).info(originalMedia.data!.path))
      .error,
  ).toBeNull();
});

test("voiceover recovers a lost create response and interrupted polling without a duplicate job", async ({
  page,
}) => {
  await start(page);
  await upload(page);
  const voice = await mockVoiceover(page, false, {
    lostCreate: true,
    lostPolls: true,
  });
  await page.getByRole("button", { name: "Continue to audio & voice" }).click();
  await page
    .getByRole("button", { name: "English voiceover", exact: false })
    .click();
  await page
    .getByRole("textbox", { name: "Voiceover words", exact: true })
    .fill("నా కథ. Narrate only the story shown in my reel.");
  await page.getByLabel("Voice", { exact: true }).selectOption("male");
  await page.getByLabel("Accent", { exact: true }).selectOption("en-IN");
  await page
    .getByLabel("Delivery", { exact: true })
    .selectOption("Clear and professional");
  await page
    .getByRole("button", { name: "Create English voiceover", exact: true })
    .click();
  await expect(page.getByText(/Reconnecting to your voiceover/)).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole("link", { name: "Download selected video" }),
  ).toBeVisible({ timeout: 20000 });
  expect(voice.creates()).toBe(1);
  await expect(page.locator(".audio-simple [role=alert]")).toHaveCount(0);
  await expect(page.getByText(/Reconnecting to your voiceover/)).toHaveCount(0);
});

test("a known speech cooldown explains the blocker without preventing script edits or original audio", async ({
  page,
}) => {
  await start(page);
  await upload(page);
  const voice = await mockVoiceover(page, false, { cooldown: true });
  await page.getByRole("button", { name: "Continue to audio & voice" }).click();
  await expect(page.getByText(/daily allowance is used up/)).toBeVisible();
  await page
    .getByRole("button", { name: "English voiceover", exact: false })
    .click();
  const words = page.getByRole("textbox", {
    name: "Voiceover words",
    exact: true,
  });
  await words.fill("मेरे शब्द सुरक्षित रहें. Keep my narration ready.");
  await expect(
    page.getByRole("button", { name: "Create English voiceover", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() => voice.state().settings.creatorInstructions)
    .toContain("मेरे शब्द");
  expect(voice.creates()).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/speech-cooldown-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Keep original instead", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue to captions", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).not.toBeEmpty();
});

test("free narration keeps the same simple controls and explains best-effort voice directions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await upload(page);
  const voice = await mockVoiceover(page, false, {
    freeVoice: true,
    oldProviderFailure: true,
  });
  await page.getByRole("button", { name: "Continue to audio & voice" }).click();

  await expect(
    page.getByText("Voice and accent are delivery directions", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("daily allowance is used up", { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel("Voice", { exact: true }).selectOption("male");
  await page.getByLabel("Accent", { exact: true }).selectOption("en-IN");
  await page
    .getByLabel("Delivery", { exact: true })
    .selectOption("Clear and professional");
  await page
    .getByRole("textbox", { name: "Voiceover words", exact: true })
    .fill("Keep the real story. నా కథ. मेरी कहानी.");
  await expect
    .poll(() => voice.state().settings.voiceProfile?.accent)
    .toBe("en-IN");
  await page.screenshot({
    path: "artifacts/free-voice-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Create English voiceover", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue to captions", exact: true }),
  ).toBeEnabled();
  expect(voice.creates()).toBe(1);
});
