import { test, expect } from "@playwright/test";
import { xCount } from "../lib/content";

test.describe("live Gemini generation", () => {
  test.skip(
    process.env.RUN_LIVE_TESTS !== "1",
    "Live tests use the configured server credential; enable explicitly.",
  );
  test.setTimeout(90000);
  test("custom video, creator voice, brand, URL and disclosure work end to end", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto("/");
    await expect(page.locator("#video-input")).toBeEnabled();
    await page
      .locator("#video-input")
      .fill(
        "I filmed a calm balcony gardening update. I watered my basil, removed the dry leaves, and showed two new leaves. Ask viewers what they are growing. Keep it matter-of-fact and do not add claims about health or yields.",
      );
    await page.getByRole("button", { name: "Add my details" }).click();
    await page
      .getByLabel("Make it sound like you")
      .fill(
        "A quiet morning on the balcony. A little water, a little patience. What are you growing?\nNew leaves today. Small things are worth noticing.",
      );
    await page.getByLabel("Brand or creator name").fill("Balcony Notes");
    await page.getByLabel("Link to include").fill("https://example.com/basil");
    await page
      .getByLabel("Call to action or disclosure")
      .fill("#ad — sample disclosure");
    await page.getByRole("button", { name: "Create my posts" }).click();
    await expect(
      page.getByRole("heading", { name: "Your publishing kit" }),
    ).toBeVisible({ timeout: 70000 });
    await expect(page.locator(".output-sheet")).toHaveCount(4);
    await expect(page.locator(".sample-notice")).toHaveCount(0);
    for (const id of ["instagram", "youtubeDescription", "x"]) {
      await expect(page.locator("#output-" + id)).toHaveValue(
        /https:\/\/example.com\/basil/,
      );
      await expect(page.locator("#output-" + id)).toHaveValue(
        /#ad — sample disclosure/,
      );
    }
    const title = await page.locator("#output-youtubeTitle").inputValue();
    expect(Array.from(title).length).toBeLessThanOrEqual(100);
    expect(
      xCount(await page.locator("#output-x").inputValue()),
    ).toBeLessThanOrEqual(280);
    await expect(page.locator(".output-warning")).toHaveCount(0);
    await page.getByRole("button", { name: "Copy all", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("Instagram caption");
    await page.locator("#output-instagram").fill("My final reviewed caption.");
    await page.reload();
    await expect(page.locator("#output-instagram")).toHaveValue(
      "My final reviewed caption.",
    );
    await page.screenshot({
      path: "artifacts/live-desktop.png",
      fullPage: true,
    });
  });
  test("mobile generates a Roman Telugu recording plan and native Hindi posts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator("#video-input")).toBeEnabled();
    await page
      .getByRole("button", { name: "Before recording", exact: true })
      .click();
    await page
      .locator("#video-input")
      .fill(
        "I want to film a friendly reel about growing mint in a pot on a small balcony. Show the pot, soil, watering, and where to keep it. Ask viewers what they would like to grow.",
      );
    await page.getByLabel("Output language").selectOption("Telugu");
    await page.getByLabel("Writing script").selectOption("roman");
    await page.getByRole("button", { name: "Create my plan" }).click();
    await expect(page.locator("#output-hook")).toBeVisible({ timeout: 70000 });
    await expect(page.locator(".output-sheet")).toHaveCount(3);
    for (const el of await page.locator(".output-text").all()) {
      expect(await el.inputValue()).not.toMatch(/[\u0C00-\u0C7F]/);
    }
    await page
      .getByRole("button", { name: "After recording", exact: true })
      .click();
    await page
      .locator("#video-input")
      .fill(
        "Maine apni balcony mein pudine ka paudha dikhaya. Mitti mein paani diya aur sukhe patte hataye. Video ka tone simple aur friendly hai. Logon se poochho ki unki balcony mein kya ug raha hai.",
      );
    await page.getByLabel("Output language").selectOption("Hindi");
    await page.getByLabel("Writing script").selectOption("native");
    await page.getByRole("button", { name: "Create my posts" }).click();
    await expect(page.locator("#output-instagram")).toBeVisible({
      timeout: 70000,
    });
    await expect(page.locator("#output-instagram")).toHaveValue(
      /[\u0900-\u097F]/,
    );
    await expect(page.locator(".sample-notice")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "artifacts/live-mobile.png",
      fullPage: true,
    });
  });
  test("native Telugu, Roman Hindi, and custom English plans are genuinely generated", async ({
    request,
  }) => {
    const cases = [
      {
        mode: "after",
        language: "Telugu",
        script: "native",
        input:
          "I recorded myself repairing a loose button on a blue shirt. I showed the needle, thread, and the finished button. Ask viewers what clothes they would repair instead of throwing away.",
      },
      {
        mode: "after",
        language: "Hindi",
        script: "roman",
        input:
          "I recorded a desk cleanup. I put loose cables into a small box and sorted my notebooks. Keep it friendly and ask viewers what part of their desk they would tidy first.",
      },
      {
        mode: "before",
        language: "English",
        script: "native",
        input:
          "I want to film a reel about packing a sketchbook and pencils for a weekend train trip. Show choosing the supplies, putting them into a bag, and a final packed-bag shot.",
      },
    ];
    for (const c of cases) {
      const r = await request.post("/api/generate", {
        data: c,
        timeout: 65000,
      });
      expect(r.status(), await r.text()).toBe(200);
      const data = await r.json();
      expect(data.sample).not.toBe(true);
      expect(data.outputs).toHaveLength(c.mode === "after" ? 4 : 3);
      expect(
        data.outputs.every((o: { text: string }) => o.text.trim().length > 0),
      ).toBeTruthy();
      const text = data.outputs.map((o: { text: string }) => o.text).join(" ");
      if (c.language === "Telugu") expect(text).toMatch(/[\u0C00-\u0C7F]/);
      if (c.language === "Hindi") expect(text).not.toMatch(/[\u0900-\u097F]/);
    }
  });
});
