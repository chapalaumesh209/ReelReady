import { spawn } from "node:child_process";
const next = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ],
  { stdio: "inherit" },
);
const worker = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/media-worker.ts"],
  { stdio: "inherit" },
);
let exiting = false;
function stop() {
  if (exiting) return;
  exiting = true;
  next.kill("SIGTERM");
  worker.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", stop);
worker.on("exit", stop);
