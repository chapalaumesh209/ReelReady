import { spawn } from "node:child_process";
import { connect } from "node:net";
import { n8nEnvironment, runnerEnvironment } from "./environment.mjs";
const env = n8nEnvironment(process.env);
let stopped = false,
  runner;
const main = spawn("n8n", ["start"], { env, stdio: "inherit" });
function shutdown(signal = "SIGTERM") {
  stopped = true;
  runner?.kill(signal);
  main.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => shutdown(signal));
main.on("error", () => {
  console.error("n8n could not start.");
  shutdown();
  process.exitCode = 1;
});
main.on("exit", (code) => {
  stopped = true;
  runner?.kill("SIGTERM");
  process.exitCode = code ?? 1;
});
const brokerReady = () =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: 5679 });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
while (!stopped && !(await brokerReady()))
  await new Promise((r) => setTimeout(r, 1000));
while (!stopped) {
  runner = spawn("/usr/local/bin/task-runner-launcher", ["javascript"], {
    env: runnerEnvironment(env),
    uid: 1001,
    gid: 1001,
    cwd: "/home/reelready-runner",
    stdio: "inherit",
  });
  await new Promise((resolve) => {
    runner.once("error", resolve);
    runner.once("exit", resolve);
  });
  if (!stopped) {
    console.error("Workflow runner stopped; reconnecting to the local broker.");
    await new Promise((r) => setTimeout(r, 3000));
  }
}
