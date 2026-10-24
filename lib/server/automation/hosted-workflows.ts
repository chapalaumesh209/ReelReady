import { readFileSync } from "node:fs";
import { publicMediaURL } from "../publishing/preflight";

type Workflow = {
  id: string;
  name: string;
  versionId?: string;
  nodes: Array<{
    id: string;
    name: string;
    parameters: Record<string, unknown>;
    credentials?: Record<string, { id: string; name: string }>;
    [key: string]: unknown;
  }>;
  connections: Record<
    string,
    { main: Array<Array<{ node: string; type: string; index: number }>> }
  >;
  settings: Record<string, unknown>;
  [key: string]: unknown;
};
export const hostedActions = [
  "publish",
  "status",
  "health",
  "connect",
] as const;
export type HostedAction = (typeof hostedActions)[number];
export function hostedWorkflows(
  appURL: string,
  actions: readonly HostedAction[] = hostedActions,
): Workflow[] {
  let origin = "";
  if (actions.some((a) => a === "publish" || a === "connect")) {
    if (!publicMediaURL(appURL))
      throw new Error(
        "Set APP_URL to the public HTTPS Vercel application URL before preparing account and publishing workflows.",
      );
    const url = new URL(appURL);
    if (url.pathname !== "/" || url.search || url.hash)
      throw new Error(
        "APP_URL must be the application origin, without paths, queries or fragments.",
      );
    origin = url.origin;
  }
  return actions.map((action) => {
    const flow = JSON.parse(
      readFileSync(`automation/n8n/provider-${action}-workflow.json`, "utf8"),
    ) as Workflow;
    flow.settings.saveDataSuccessExecution = "none";
    flow.settings.saveDataErrorExecution = "none";
    flow.settings.saveManualExecutions = false;
    flow.settings.saveExecutionProgress = false;
    if (action === "connect") {
      flow.nodes.find((n) => n.id === "claim")!.parameters.url =
        `${origin}/api/automation/connect-authorize`;
    }
    if (action === "publish") {
      flow.nodes.find((n) => n.id === "claim")!.parameters.url =
        `${origin}/api/automation/authorize`;
      const download = flow.nodes.find(
        (n) => n.id === "download-private-video",
      )!;
      delete flow.connections[download.name];
      flow.nodes = flow.nodes.filter((n) => n.id !== download.id);
      const upload = flow.nodes.find((n) => n.id === "publish")!;
      flow.connections["Verify and consume approved job"] = {
        main: [[{ node: upload.name, type: "main", index: 0 }]],
      };
      const parameters = (
        upload.parameters.bodyParameters as {
          parameters: Array<Record<string, unknown>>;
        }
      ).parameters;
      const video = parameters.findIndex((p) => p.name === "video");
      if (video < 0) throw new Error("Publishing template has no video field.");
      parameters[video] = { name: "video", value: "={{ $json.videoUrl }}" };
    }
    const serialized = JSON.stringify(flow);
    if (
      /host\.docker\.internal|127\.0\.0\.1|localhost|webhook-test/.test(
        serialized,
      )
    )
      throw new Error(
        "Hosted workflow contains a local or temporary endpoint.",
      );
    return flow;
  });
}

export function hostedCoordinator(appURL: string): Workflow {
  if (!publicMediaURL(appURL))
    throw new Error("The coordinator requires the public HTTPS app origin.");
  const url = new URL(appURL);
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("APP_URL must be an origin.");
  return {
    id: "ReelReadyHostedCoordinatorV1",
    name: "ReelReady — hosted publishing coordinator",
    nodes: [
      {
        id: "schedule",
        name: "Advance confirmed publishing jobs",
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: {
          rule: { interval: [{ field: "seconds", secondsInterval: 20 }] },
        },
      },
      {
        id: "tick",
        name: "Ask ReelReady to check its queue",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [260, 0],
        retryOnFail: false,
        parameters: {
          method: "POST",
          url: `${url.origin}/api/automation/tick`,
          authentication: "genericCredentialType",
          genericAuthType: "httpHeaderAuth",
          sendBody: true,
          specifyBody: "json",
          jsonBody: "{}",
          options: {
            timeout: 30000,
            redirect: { redirect: { followRedirects: false } },
          },
        },
        credentials: {
          httpHeaderAuth: {
            id: "ReelReadyPublisherBridge",
            name: "ReelReady hosted callback authentication",
          },
        },
      },
    ],
    connections: {
      "Advance confirmed publishing jobs": {
        main: [
          [
            {
              node: "Ask ReelReady to check its queue",
              type: "main",
              index: 0,
            },
          ],
        ],
      },
    },
    settings: {
      executionOrder: "v1",
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "none",
      saveManualExecutions: false,
      saveExecutionProgress: false,
      executionTimeout: 60,
    },
  };
}
