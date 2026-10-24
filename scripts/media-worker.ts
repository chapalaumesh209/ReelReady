import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
const { mediaWorkerRuntime, createMediaHealthServer } = await import(
  "../lib/server/media/runtime"
);
const runtime = mediaWorkerRuntime();
const { publisherCoordinatorPrefix } = await import(
  "../lib/server/automation/status"
);
const { workerPool } = await import("../lib/server/hardening");
const { storageAdmin } = await import("../lib/supabase");
const { workerOnce, checkBinaries } = await import(
  "../lib/server/media/worker"
);
const { publicationWorkerOnce } = await import("../lib/server/social/worker");
const { publishExecutor, publisherBridgeConfiguration } = await import(
  "../lib/server/automation/config"
);
const { createPublisherBridge } = await import(
  "../lib/server/automation/bridge"
);
const { demoMode } = await import("../lib/server/config");
const { publishingProvider } = await import("../lib/server/provider/config");
const { authorizeProviderDelivery, providerMediaStream } = await import(
  "../lib/server/provider/delivery"
);
const { authorizeProviderConnection } = await import(
  "../lib/server/provider/accounts"
);
const { callPublishingWorkflow } = await import(
  "../lib/server/provider/webhook"
);
await checkBinaries();
const id = `worker-${crypto.randomUUID()}`;
const coordinatorId = `${publisherCoordinatorPrefix()}${id}`;
const executor = publishExecutor();
const provider = publishingProvider();
const admin = storageAdmin();
let stopped = false;
let lastHeartbeat = 0;
const health = runtime.port
  ? createMediaHealthServer(
      () => !stopped && Date.now() - lastHeartbeat < 60000,
    )
  : undefined;
const bridge =
  executor === "n8n" && !runtime.only
    ? createPublisherBridge({
        ...publisherBridgeConfiguration(),
        demo: demoMode,
        run: () =>
          provider === "native"
            ? publicationWorkerOnce(id)
            : Promise.resolve(false),
        authorize: authorizeProviderDelivery,
        media: providerMediaStream,
        connect: authorizeProviderConnection,
        heartbeat: async () => {
          const r = await admin.from("reelready_workers").upsert({
            id: coordinatorId,
            pool: workerPool(),
            heartbeat: new Date().toISOString(),
          });
          if (r.error) throw new Error("Coordinator heartbeat unavailable");
        },
      })
    : undefined;
const bridgeClosed = bridge
  ? new Promise<void>((resolve) => bridge.once("close", resolve))
  : Promise.resolve();
if (bridge) {
  const { host, port } = publisherBridgeConfiguration();
  await new Promise<void>((resolve, reject) => {
    bridge.once("error", reject);
    bridge.listen(port, host, () => {
      bridge.off("error", reject);
      resolve();
    });
  });
  console.log(
    "Private publishing bridge ready. Execution is controlled by n8n.",
  );
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
    bridge?.close();
    health?.close();
  });
async function heartbeat() {
  const r = await admin
    .from("reelready_workers")
    .upsert({ id, pool: workerPool(), heartbeat: new Date().toISOString() });
  if (r.error)
    console.error(
      "Media worker database unavailable; verify local migrations.",
    );
  else lastHeartbeat = Date.now();
  if (!runtime.only && executor === "n8n" && provider === "uploadpost") {
    try {
      const health = await callPublishingWorkflow("health", {});
      if (health.ready === true)
        await admin.from("reelready_workers").upsert({
          id: coordinatorId,
          pool: workerPool(),
          heartbeat: new Date().toISOString(),
        });
    } catch {
      /* Missing/offline workflows become stale; no publication is triggered by health. */
    }
  }
}
await heartbeat();
if (health) {
  await new Promise<void>((resolve, reject) => {
    health.once("error", reject);
    health.listen(runtime.port, runtime.host, () => {
      health.off("error", reject);
      resolve();
    });
  });
}
const timer = setInterval(() => void heartbeat(), 15000);
console.log(
  "ReelReady media worker ready. Concurrency: 1. Private FFmpeg processing enabled.",
);
while (!stopped) {
  try {
    const mediaWorked = await workerOnce();
    const publishingWorked =
      !runtime.only &&
      executor === "native" &&
      (await publicationWorkerOnce(id));
    if (!mediaWorked && !publishingWorked)
      await new Promise((r) => setTimeout(r, 1000));
  } catch {
    console.error("Media queue unavailable; retrying in 5 seconds.");
    await new Promise((r) => setTimeout(r, 5000));
  }
}
clearInterval(timer);
// server.close() stops admission immediately but existing requests finish safely.
if (bridge?.listening) bridge.close();
await bridgeClosed;
await admin.from("reelready_workers").delete().eq("id", id);
await admin.from("reelready_workers").delete().eq("id", coordinatorId);
console.log("Media worker stopped after completing its active job.");
