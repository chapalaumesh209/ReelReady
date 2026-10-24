import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { storageAdmin, VIDEO_BUCKET } from "../lib/supabase";
const admin = storageAdmin(),
  ids = new Set<string>();
test.beforeEach(async ({ page }) => {
  const address = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::4`;
  await page.route(/^http:\/\/127\.0\.0\.1:3001\/api\//, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-forwarded-for": address },
    }),
  );
});
test.afterEach(async ({ page }) => {
  const id = await page
    .evaluate(
      () => JSON.parse(localStorage.getItem("reelready.flow.v2") || "null")?.id,
    )
    .catch(() => null);
  if (id) ids.add(id);
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
async function toUpload(page: Page) {
  await page.goto("/studio?sample=judge");
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Generate reel ideas", exact: true })
    .click();
  await expect(page.getByText("Sample output", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Use this plan & record" }).click();
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("button", { name: "I’ve recorded it", exact: false })
    .click();
}
async function toReview(page: Page) {
  await toUpload(page);
  await page
    .getByRole("button", { name: "Use a sample video", exact: true })
    .click();
  await expect(
    page.getByText("Recording uploaded and saved privately", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Continue to audio & voice", exact: true })
    .click();
  await expect(
    page.getByText("Audio processing is unavailable right now", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "English voiceover", exact: false }),
  ).toBeDisabled();
  await expect(page.getByText("Advanced", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Keep original audio", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Continue to captions", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Continue to captions", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).not.toBeEmpty({ timeout: 30000 });
}
test("judge without worker, provider keys, Wispr or connected accounts completes all six steps on 390px in demo mode", async ({
  page,
  request,
}) => {
  const started = Date.now();
  expect(await (await request.get("/api/health")).json()).toEqual({
    generation: "sample",
    transcription: "sample",
    voice: "sample",
    worker: "offline",
    publish: "demo",
    publishingExecutor: { executor: "n8n", status: "offline" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Your reel idea", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /All reels|Preferences|Accounts/ }),
  ).toHaveCount(0);
  await toReview(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/offline-review-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check publishing setup", exact: true })
    .click();
  await expect(
    page.getByText("Ready for a demo send.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Schedule on selected platforms",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirm demo publication", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Delivery status", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".delivery-state")).toHaveText([
    "Demo — not posted",
    "Demo — not posted",
    "Demo — not posted",
  ]);
  await expect(
    page.getByText("If YouTube shows this video as private", { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/offline-publish-mobile.png",
    fullPage: true,
  });
  expect(Date.now() - started).toBeLessThan(60000);
});
test("Wispr-friendly idea box submits Enter, keeps Shift+Enter and renders multilingual text", async ({
  page,
}) => {
  await page.goto("/studio?new=1");
  const box = page.getByRole("textbox", {
    name: "Your reel idea",
    exact: true,
  });
  await expect(
    page.getByRole("button", { name: "Generate reel ideas", exact: true }),
  ).toBeEnabled();
  await box.fill("నా కొత్త రీల్ గురించి ఒక చిన్న కథ. मेरी रील की कहानी।");
  await box.press("Shift+Enter");
  expect(await box.inputValue()).toContain("\n");
  await expect(
    page.getByRole("heading", {
      name: "Pick your starting point",
      exact: true,
    }),
  ).toHaveCount(0);
  await box.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Pick your starting point",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Sample output", { exact: false })).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Using Wispr Flow?" })
    .click();
  await expect(
    page.getByText("Choose your languages in Wispr", {
      exact: false,
    }),
  ).toBeVisible();
});
test("Telugu and Hindi round-trip through kit editing, revision and saved draft reload", async ({
  page,
}) => {
  await toReview(page);
  const caption = page.getByRole("textbox", {
    name: "Instagram caption",
    exact: true,
  });
  const native = "ఇది నా నిజమైన కథ. यह मेरी असली कहानी है। #తెలుగు #हिन्दी";
  await caption.fill(native);
  await page.getByText("Ask for a caption change", { exact: true }).click();
  await page
    .getByLabel("Want to change the wording?")
    .fill("Keep my words unchanged");
  await page
    .getByRole("button", { name: "Apply my changes", exact: false })
    .click();
  await expect(caption).toHaveValue(native);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(caption).toHaveValue(native, { timeout: 30000 });
});

test("a queued render older than three minutes offers cancellation and original continuation", async ({
  page,
}) => {
  await toUpload(page);
  await page
    .getByRole("button", { name: "Use a sample video", exact: true })
    .click();
  await expect(
    page.getByText("Recording uploaded and saved privately", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("reelready.flow.v2")!),
  );
  const source = await admin
    .from("reelready_media")
    .select("id,owner_id")
    .eq("reel_id", draft.id)
    .eq("kind", "original")
    .single();
  expect(source.error).toBeNull();
  const job = await admin
    .from("reelready_media_jobs")
    .insert({
      owner_id: source.data!.owner_id,
      reel_id: draft.id,
      source_id: source.data!.id,
      kind: "render",
      fingerprint: crypto.randomUUID(),
      payload: {},
      pool: "offline-verification",
      created_at: new Date(Date.now() - 240000).toISOString(),
    })
    .select("id")
    .single();
  expect(job.error).toBeNull();
  await page
    .getByRole("button", { name: "Continue to audio & voice", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Continue with original audio",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel job", exact: true }).click();
  await expect(
    page.getByText("Job cancelled. Your sources are unchanged.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await admin
        .from("reelready_media_jobs")
        .select("status")
        .eq("id", job.data!.id)
        .single()
    ).data!.status,
  ).toBe("cancelled");
  await page
    .getByRole("button", { name: "Continue to captions", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Instagram caption", exact: true }),
  ).not.toBeEmpty({ timeout: 30000 });
  expect(
    (
      await admin
        .from("reelready_media")
        .select("id")
        .eq("id", source.data!.id)
        .single()
    ).error,
  ).toBeNull();
});

test("real publishing has no PIN field and preserves the final confirmation (mocked delivery)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The real connections endpoint normally establishes this anonymous session.
  // Create it before mocking account status so private storage can hydrate.
  expect((await page.request.get("/api/session")).ok()).toBe(true);
  await page.route("**/api/connections", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connectionMode: "real",
        demo: false,
        accounts: Object.fromEntries(
          ["instagram", "youtube", "x"].map((platform) => [
            platform,
            { connected: true, name: "Test creator" },
          ]),
        ),
      },
    }),
  );
  await page.route("**/api/publish/preflight", (route) => {
    expect(route.request().postDataJSON()).not.toHaveProperty("pin");
    return route.fulfill({
      json: {
        demo: false,
        connected: { instagram: true, youtube: true, x: true },
        captions: {
          instagramHashtags: 3,
          instagramHashtagLimit: 5,
          youtubeTitleCharacters: 30,
          xCharacters: 40,
        },
        blockers: [],
        warnings: [],
        media: {
          public: true,
          expiresAt: new Date(Date.now() + 172800000).toISOString(),
        },
        usage: { uploadsThisMonth: 0, xPostsToday: 0 },
      },
    });
  });
  // This test exercises real-mode confirmation with mocked verified AI output.
  // Sample analysis must never unlock real publishing.
  await page.route("**/api/review", async (route) => {
    const assetPath = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("reelready.flow.v2") || "null")
          ?.originalAsset?.path,
    );
    await route.fulfill({
      json: {
        origin: "recording",
        assetPath,
        summary:
          "An original purple waveform animation with a quiet test tone.",
        sourceLanguage: "No speech",
        transcript: "No speech",
        englishScript: "An original waveform animation.",
        audioNote: "Suggested narration for the animation.",
      },
    });
  });
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      json: {
        mode: "after",
        language: "English",
        script: "native",
        sample: false,
        outputs: [
          {
            id: "instagram",
            title: "Instagram caption",
            text: "An original purple waveform animation. #Animation",
          },
          {
            id: "youtubeTitle",
            title: "YouTube Shorts title",
            text: "Original purple waveform animation",
          },
          {
            id: "youtubeDescription",
            title: "YouTube Shorts description",
            text: "An original purple waveform animation with a quiet test tone.",
          },
          {
            id: "x",
            title: "X post",
            text: "An original purple waveform animation.",
          },
        ],
      },
    }),
  );
  const actions: string[] = [],
    jobId = crypto.randomUUID();
  await page.route("**/api/publish", (route) => {
    const payload = route.request().postDataJSON();
    expect(payload).not.toHaveProperty("pin");
    expect(payload.confirmed).toBe(true);
    actions.push(payload.action);
    return route.fulfill({
      json: {
        id: jobId,
        token: jobId,
        demo: false,
        status: payload.action === "prepare" ? "pending" : "published",
        done: payload.action !== "prepare",
        scheduledAt: null,
        deliveries: ["instagram", "youtube", "x"].map((platform) => ({
          platform,
          state: payload.action === "prepare" ? "pending" : "published",
        })),
      },
    });
  });
  await toReview(page);
  const caption = page.getByRole("textbox", {
    name: "Instagram caption",
    exact: true,
  });
  const savedCaption = await caption.inputValue();
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error:
          "Live caption generation is temporarily unavailable. Your captions are saved.",
      },
    }),
  );
  await page
    .getByRole("button", { name: "Regenerate captions", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Live caption generation" }),
  ).toContainText("Your captions are saved");
  await expect(caption).toHaveValue(savedCaption);
  await expect(page.getByText("Sample output", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await page.getByRole("radio", { name: "Publish now", exact: true }).check();
  await expect(page.getByLabel("Publishing PIN", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Check publishing setup", exact: true })
    .click();
  await expect(
    page.getByText("Ready for your final confirmation.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/no-pin-publish-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({
    path: "artifacts/no-pin-publish-desktop.png",
    fullPage: true,
  });
  const publish = page.getByRole("button", {
    name: "Publish on selected platforms",
    exact: true,
  });
  await publish.click();
  await expect(
    page.getByRole("button", { name: "Keep reviewing", exact: true }),
  ).toBeFocused();
  expect(actions).toEqual([]);
  await page
    .getByRole("button", { name: "Keep reviewing", exact: true })
    .click();
  expect(actions).toEqual([]);
  await publish.click();
  await page
    .getByRole("button", { name: "Confirm publish", exact: true })
    .click();
  await expect(page.locator(".delivery-state")).toHaveText([
    "Published",
    "Published",
    "Published",
  ]);
  expect(actions).toEqual(["prepare", "send"]);
});
