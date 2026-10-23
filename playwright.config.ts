import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.RUN_LIVE_TESTS === "1"
            ? "artifacts/live-results.json"
            : "artifacts/browser-results.json",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    headless: true,
  },
  timeout: 45000,
});
