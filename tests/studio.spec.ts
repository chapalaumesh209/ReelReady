import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { exampleKit } from "../lib/content";
import type { Page } from "@playwright/test";
async function mockExamples(page: Page) {
  await page.route("**/api/generate", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { configured: false } });
      return;
    }
    const data = route.request().postDataJSON();
    await route.fulfill({
      json: exampleKit(data.mode, data.language, data.script),
    });
  });
}

test("open studio: examples, validation, editable outputs, persistence, copy, and mode isolation", async ({
  page,
  context,
}) => {
  await mockExamples(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#composer")).toHaveAttribute("data-ready", "true");
  await expect(
    page.getByRole("button", { name: /sign in|log in|sign up/i }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/desktop-initial.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create my posts" }).click();
  await expect(page.getByRole("alert")).toContainText("Tell us a little more");
  await expect(page.locator("#video-input")).toBeFocused();
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Create my posts" }).click();
  await expect(
    page.getByRole("heading", { name: "Your publishing kit" }),
  ).toBeVisible();
  await expect(page.locator(".output-sheet")).toHaveCount(4);
  await expect(page.locator(".sample-notice")).toBeVisible();
  await page.locator("#output-instagram").fill("My own edited caption. #Mango");
  await expect(page.locator(".output-sheet").first()).toContainText(
    "1 hashtag",
  );
  await page
    .getByRole("button", { name: "Copy Instagram caption", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("My own edited caption. #Mango");
  await page.reload();
  await expect(page.locator("#output-instagram")).toHaveValue(
    "My own edited caption. #Mango",
  );
  await page
    .getByRole("button", { name: "Before recording", exact: true })
    .click();
  await expect(page.locator("#video-input")).toHaveValue("");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Create my plan" }).click();
  await expect(page.locator(".output-sheet")).toHaveCount(3);
  await page
    .getByRole("button", { name: "After recording", exact: true })
    .click();
  await expect(page.locator("#output-instagram")).toHaveValue(
    "My own edited caption. #Mango",
  );
  await page.locator("#output-x").fill("word ".repeat(80));
  await expect(page.locator(".output-sheet").last()).toContainText(
    "Over limit",
  );
  await page.getByLabel("Output language").selectOption("Telugu");
  await page.getByLabel("Writing script").selectOption("roman");
  await page.getByRole("button", { name: "Create my posts" }).click();
  await expect(page.locator("#output-instagram")).toHaveValue(/perugu/);
  await expect(page.locator("#output-instagram")).not.toHaveValue(
    /[\u0C00-\u0C7F]/,
  );
  await page.getByLabel("Writing script").selectOption("native");
  await page.getByRole("button", { name: "Create my posts" }).click();
  await expect(page.locator("#output-instagram")).toHaveValue(
    /[\u0C00-\u0C7F]/,
  );
  await page.screenshot({
    path: "artifacts/desktop-results.png",
    fullPage: true,
  });
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Clear saved data", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep my work" }).click();
  await expect(page.locator("#output-instagram")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear saved data", exact: true })
    .click();
  await page
    .locator(".clear-confirm")
    .getByRole("button", { name: "Clear saved data", exact: true })
    .click();
  await expect(page.locator("#video-input")).toHaveValue("");
  await expect(page.locator(".output-sheet")).toHaveCount(0);
});

test("mobile, native selects, optional details, help, keyboard, and reduced motion", async ({
  page,
}) => {
  await mockExamples(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#composer")).toHaveAttribute("data-ready", "true");
  await page.screenshot({
    path: "artifacts/mobile-initial.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Made for Wispr Flow" }).click();
  await expect(page.locator("#flow-guide")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#flow-guide")).toHaveCount(0);
  await page.getByRole("button", { name: "Add my details" }).click();
  await page
    .getByLabel("Make it sound like you")
    .fill("Keep it friendly and short.");
  await page.getByLabel("Brand or creator name").fill("My kitchen");
  await page.reload();
  await page.getByRole("button", { name: "Add my details" }).click();
  await expect(page.getByLabel("Brand or creator name")).toHaveValue(
    "My kitchen",
  );
  await page.getByLabel("Make it sound like you").fill("");
  await page.getByLabel("Brand or creator name").fill("");
  await page.getByLabel("Output language").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByLabel("Output language").selectOption("Hindi");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.locator("#video-input").press("Enter");
  await expect(page.locator("#output-instagram")).toHaveValue(
    /[\u0900-\u097F]/,
  );
  await page.screenshot({
    path: "artifacts/mobile-results.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
});

test("failure and slow response preserve input; cancel prevents stale output", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#composer")).toHaveAttribute("data-ready", "true");
  await page
    .locator("#video-input")
    .fill("I filmed a real video about growing basil on a sunny balcony.");
  await page.route("**/api/generate", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "The writing service is busy. Try again shortly.",
        }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Create my posts" }).click();
  await expect(page.getByRole("alert")).toContainText("Try again");
  await expect(page.locator("#video-input")).toHaveValue(/basil/);
  await page.unroute("**/api/generate");
  let pending: (() => void) | undefined;
  await page.route("**/api/generate", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise<void>((resolve) => {
        pending = resolve;
      });
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            mode: "after",
            language: "English",
            script: "native",
            outputs: [
              {
                id: "instagram",
                title: "Instagram caption",
                text: "stale output",
              },
            ],
          }),
        });
      } catch {}
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Create my posts" }).click();
  await expect(
    page.getByRole("button", { name: /Creating your posts/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(page.getByRole("alert")).toContainText("Generation stopped");
  pending?.();
  await expect(page.locator(".output-sheet")).toHaveCount(0);
  await expect(page.locator("#video-input")).toHaveValue(/basil/);
});
