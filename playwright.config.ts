import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  projects: [
    {
      name: "studio",
      testMatch: "**/studio.spec.ts",
      use: { baseURL: "http://127.0.0.1:3002" },
    },
    {
      name: "offline",
      testMatch: "**/offline.spec.ts",
      use: { baseURL: "http://127.0.0.1:3001" },
    },
  ],
  webServer: [
    {
      command: "node scripts/offline-test-server.mjs",
      url: "http://127.0.0.1:3001/api/health",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "node scripts/offline-test-server.mjs --studio",
      url: "http://127.0.0.1:3002/api/health",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
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
