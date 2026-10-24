import { spawn } from "node:child_process";
const studio = process.argv.includes("--studio"),
  port = studio ? 3002 : 3001;
const env = {
  ...process.env,
  APP_URL: `http://127.0.0.1:${port}`,
  DEMO_MODE: "true",
  ALLOW_SAMPLE_OUTPUT: "true",
  PUBLISH_EXECUTOR: studio ? "native" : "n8n",
  PUBLISH_PROVIDER: "native",
  N8N_PUBLISHER_SECRET: "",
  LLM_PROVIDER: "demo",
  LLM_API_KEY: "",
  GEMINI_API_KEY: "",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  UPLOAD_POST_API_KEY: "",
  UPLOADPOST_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  INSTAGRAM_CLIENT_ID: "",
  INSTAGRAM_CLIENT_SECRET: "",
  X_CLIENT_ID: "",
  X_CLIENT_SECRET: "",
  WORKER_POOL: studio ? "default" : "offline-verification",
  REELREADY_BUILD_DIR: studio ? ".next-test-studio" : ".next-offline",
};
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env, stdio: "inherit" },
);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
child.on("exit", (code) => process.exit(code || 0));
