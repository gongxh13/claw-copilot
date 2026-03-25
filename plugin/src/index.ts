import { mkdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import qrcode from "qrcode-terminal";

import type { DashboardPayload, TailscaleStatus } from "./core/types.js";
import { CopilotRecorder } from "./runtime/recorder.js";
import { stopSessionViaCli, resolveGatewayTokenFromEnv } from "./runtime/stop-session.js";
import { injectDashboardShell, loadDashboardShell, resolveDashboardAssetPath } from "./server/dashboard-assets.js";
import { getOrCreateSseHub } from "./server/sse.js";
import { CopilotStore } from "./storage/repository.js";
import { beginTailscaleLogin, disableRemoteAccess, enableTailscaleServe, ensureTailscaleInstalled, resolveGatewayOrigin } from "./tailscale/service.js";

type PluginConfig = {
  basePath?: string;
  dashboardTitle?: string;
  imVerbosity?: "silent" | "normal" | "verbose";
};

const plugin = {
  id: "claw-copilot",
  name: "Claw Copilot",
  description: "Run-aware observability dashboard for OpenClaw",
  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as PluginConfig;
    const basePath = normalizeBasePath(pluginConfig.basePath);
    const title = pluginConfig.dashboardTitle ?? "Claw Copilot";
    const store = createStore(api, pluginConfig);
    store.markStaleRunsAsInterrupted(10 * 60 * 1000);
    const recorder = new CopilotRecorder(store);
    const sseHub = getOrCreateSseHub(store);
    const publishSoon = createPublishScheduler(() => sseHub.publish());

    api.runtime.events.onAgentEvent(() => {
      store.markStaleRunsAsInterrupted(10 * 60 * 1000);
      publishSoon();
    });
    api.runtime.events.onSessionTranscriptUpdate(() => {
      publishSoon();
    });

    let lastStaleCheck = 0;
    const checkStaleRuns = () => {
      const now = Date.now();
      if (now - lastStaleCheck > 5 * 60 * 1000) {
        lastStaleCheck = now;
        store.markStaleRunsAsInterrupted(10 * 60 * 1000);
      }
    };

    api.on("session_start", (event, ctx) => {
      checkStaleRuns();
      recorder.onSessionStart(event.sessionId, ctx.sessionKey ?? "openclaw");
      sseHub.publish();
    });

    api.on("before_model_resolve", (event, ctx) => {
      if (ctx.sessionId) {
        recorder.onPromptResolved(ctx.sessionId, event.prompt);
      }
    });

    api.on("message_received", (event, ctx) => {
      recorder.onMessageReceived(event, ctx);
      sseHub.publish();
    });

    api.on("message_sending", () => {
      sseHub.publish();
    });

    api.on("message_sent", () => {
      sseHub.publish();
    });

    api.on("llm_input", (event) => {
      recorder.onLlmInput(event);
      sseHub.publish();
    });

    api.on("before_tool_call", (event, ctx) => {
      recorder.onBeforeToolCall(event, ctx);
      sseHub.publish();
    });

    api.on("after_tool_call", (event, ctx) => {
      recorder.onAfterToolCall(event, ctx);
      sseHub.publish();
    });

    api.on("before_compaction", (event, ctx) => {
      recorder.onCompaction(ctx.sessionId, undefined, "before", `${event.messageCount} messages${event.tokenCount ? ` · ${event.tokenCount} tokens` : ""}`);
      sseHub.publish();
    });

    api.on("llm_output", (event) => {
      recorder.onLlmOutput(event);
      sseHub.publish();
    });

    api.on("after_compaction", (event, ctx) => {
      recorder.onCompaction(ctx.sessionId, undefined, "after", `${event.compactedCount} compacted${event.tokenCount ? ` · ${event.tokenCount} tokens` : ""}`);
      sseHub.publish();
    });

    api.on("subagent_spawned", (event, ctx) => {
      recorder.onSubagentSpawned(event, ctx);
      sseHub.publish();
    });

    api.on("subagent_ended", (event, ctx) => {
      recorder.onSubagentEnded(event, ctx);
      sseHub.publish();
    });

    api.on("agent_end", (event, ctx) => {
      recorder.onAgentEnd(ctx.sessionId, ctx.sessionKey, event.success);
      sseHub.publish();
    });

    api.registerHttpRoute({
      path: basePath,
      auth: "plugin",
      match: "prefix",
      async handler(req: IncomingMessage, res: ServerResponse) {
        if (!req.url) {
          res.statusCode = 400;
          res.end("Missing URL");
          return true;
        }

        const url = new URL(req.url, "http://localhost");
        const routeTarget = parseDashboardRoute(url.pathname, basePath);
        const payload = buildPayload(store, routeTarget.sessionId);

        if (url.pathname.startsWith(`${basePath}/assets/`) || url.pathname === `${basePath}/favicon.svg`) {
          const relativePath = url.pathname.slice(basePath.length + 1);
          const assetPath = resolveDashboardAssetPath(import.meta.url, relativePath);
          if (!assetPath) {
            res.statusCode = 404;
            res.end("Not found");
            return true;
          }

          res.setHeader("content-type", contentTypeFor(assetPath));
          res.end(readFileSync(assetPath));
          return true;
        }

        if (url.pathname === `${basePath}/api/bootstrap` || url.pathname === `${basePath}/api/sessions`) {
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store, max-age=0");
          const selectedSessionId = url.searchParams.get("sessionId") ?? undefined;
          const page = readPositiveInt(url.searchParams.get("page"), 1);
          const pageSize = readPositiveInt(url.searchParams.get("pageSize"), 20);
          res.end(JSON.stringify(buildPayload(store, selectedSessionId, page, pageSize)));
          return true;
        }

        if (url.pathname === `${basePath}/api/events`) {
          sseHub.connect(
            req,
            res,
            url.searchParams.get("sessionId") ?? undefined,
            readPositiveInt(url.searchParams.get("page"), 1),
            readPositiveInt(url.searchParams.get("pageSize"), 20)
          );
          return true;
        }

        if (url.pathname === `${basePath}/api/control/stop`) {
          const sessionKey = url.searchParams.get("sessionKey") ?? payload.selectedSession?.session.channelId;
          const sessionId = url.searchParams.get("sessionId") ?? payload.selectedSession?.session.id;
          let runIdParam = url.searchParams.get("runId");
          if (runIdParam === "" || runIdParam === "null") {
            runIdParam = null;
          }
          const hasExplicitRunId = !!(runIdParam && runIdParam.length > 0);
          const runId = hasExplicitRunId ? (runIdParam as string) : (payload.selectedSession?.runs.at(-1)?.id ?? undefined);
          if (!sessionId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing sessionId" }));
            return true;
          }
          const record = recorder.requestControl(sessionId, runId, "stop");
          sseHub.publish();

          let stopResult: { ok: boolean; error?: string } = { ok: true };
          if (sessionKey) {
            const envToken = resolveGatewayTokenFromEnv();
            const configToken = api.config.gateway?.auth?.token;
            const token = envToken ?? (typeof configToken === "string" ? configToken : undefined);
            if (token) {
              stopResult = await stopSessionViaCli(sessionKey, token, hasExplicitRunId ? runId : undefined);
            } else {
              stopResult = { ok: false, error: "No gateway token" };
            }
          }

          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store, max-age=0");
          res.end(JSON.stringify({ ...record, stopResult }));
          return true;
        }

        if (url.pathname === `${basePath}/api/control/pause` || url.pathname === `${basePath}/api/control/redirect`) {
          const action = url.pathname.endsWith("pause") ? "pause" : "redirect";
          const sessionId = url.searchParams.get("sessionId") ?? payload.selectedSession?.session.id;
          const runId = url.searchParams.get("runId") ?? payload.selectedSession?.runs.at(-1)?.id;
          const value = url.searchParams.get("value") ?? undefined;
          if (!sessionId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing sessionId" }));
            return true;
          }
          const record = recorder.requestControl(sessionId, runId, action, value);
          sseHub.publish();
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store, max-age=0");
          res.end(JSON.stringify(record));
          return true;
        }

        if (url.pathname.startsWith(`${basePath}/api/sessions/`)) {
          const sessionId = decodeURIComponent(url.pathname.slice(`${basePath}/api/sessions/`.length));
          const detail = store.getSessionDetail(sessionId);
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store, max-age=0");
          res.statusCode = detail ? 200 : 404;
          res.end(JSON.stringify(detail ?? { error: "Session not found" }));
          return true;
        }

        if (url.pathname === `${basePath}/health`) {
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: true, plugin: "claw-copilot" }));
          return true;
        }

        if (url.pathname === basePath || url.pathname === `${basePath}/` || url.pathname.startsWith(`${basePath}/session/`)) {
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.setHeader("cache-control", "no-store, max-age=0");
          const template = loadDashboardShell(import.meta.url);
          res.end(injectDashboardShell(template, { title, basePath, payload }));
          return true;
        }

        return false;
      }
    });

    api.registerCli(({ program }: { program: CliCommandLike }) => {
      const clawCopilot = program.command("claw-copilot").description("Claw Copilot plugin commands");

      clawCopilot
        .command("status")
        .description("Print Claw Copilot session summary")
        .action(() => {
          const sessions = store.listSessions();
          process.stdout.write(`${sessions.length} sessions tracked\n`);
        });

      const remote = clawCopilot.command("remote").description("Manage optional remote access for Claw Copilot");

      remote
        .command("status")
        .description("Show remote access status for Claw Copilot")
        .action(() => {
          const status = ensureTailscaleInstalled({ basePath, gatewayOrigin: getCliGatewayOrigin() });
          printRemoteAccessStatus(status, basePath, "status");
        });

      remote
        .command("enable")
        .description("Enable remote Claw Copilot access through Tailscale")
        .action(() => {
          const origin = getCliGatewayOrigin();
          const ensured = ensureTailscaleInstalled({ basePath, gatewayOrigin: origin });
          if (!ensured.installed) {
            printRemoteAccessStatus(ensured, basePath, "enable");
            return;
          }

          const loginStatus = beginTailscaleLogin({ basePath, gatewayOrigin: origin });
          if (loginStatus.loginState !== "logged-in") {
            printRemoteAccessStatus(loginStatus, basePath, "enable");
            return;
          }

          const status = enableTailscaleServe(origin, { basePath, gatewayOrigin: origin });
          printRemoteAccessStatus(status, basePath, "enable");
        });

      remote
        .command("disable")
        .description("Disable remote Claw Copilot access")
        .action(() => {
          const status = disableRemoteAccess({ basePath, gatewayOrigin: getCliGatewayOrigin() });
          process.stdout.write(`${status.message}\n`);
          if (status.detail) {
            process.stdout.write(`${status.detail}\n`);
          }
        });
    });
  }
};

export default plugin;

function createStore(api: OpenClawPluginApi, _pluginConfig: PluginConfig): CopilotStore {
  const root = path.join(api.runtime.state.resolveStateDir(), "claw-copilot");
  mkdirSync(root, { recursive: true });
  return new CopilotStore(root);
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  return "application/octet-stream";
}

function buildPayload(store: CopilotStore, preferredSessionId?: string, page = 1, pageSize = 20): DashboardPayload {
  const resolvedPage = preferredSessionId ? store.findSessionPage(preferredSessionId, pageSize) : page;
  const { sessions, pagination } = store.listSessionsPage(resolvedPage, pageSize);
  const selectedId = preferredSessionId && sessions.some((session) => session.id === preferredSessionId)
    ? preferredSessionId
    : sessions[0]?.id;
  const selectedSession = selectedId ? store.getSessionDetail(selectedId) : undefined;
  return { sessions, sessionPagination: pagination, selectedSession };
}

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDashboardRoute(pathname: string, basePath: string): { sessionId?: string; runId?: string } {
  if (!pathname.startsWith(basePath)) {
    return {};
  }

  const suffix = pathname.slice(basePath.length).replace(/^\/+|\/+$/g, "");
  if (!suffix) {
    return {};
  }

  const segments = suffix.split("/").map((segment) => decodeURIComponent(segment));
  if (segments[0] !== "session") {
    return {};
  }

  const sessionId = segments[1];
  if (!sessionId) {
    return {};
  }

  if (segments.length >= 4 && segments[2] === "run" && segments[3]) {
    return { sessionId, runId: segments[3] };
  }

  return { sessionId };
}

function normalizeBasePath(value?: string): string {
  if (!value) {
    return "/claw-copilot";
  }

  return value.startsWith("/") ? value.replace(/\/$/, "") : `/${value.replace(/\/$/, "")}`;
}

function getCliGatewayOrigin(): string {
  return resolveGatewayOrigin();
}

function createPublishScheduler(publish: () => void, delayMs = 100): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      publish();
    }, delayMs);
  };
}

function printRemoteAccessStatus(status: TailscaleStatus, basePath: string, mode: "status" | "enable"): void {
  const lines = [
    "",
    "=== Claw Copilot Remote Access ===",
    `Status: ${status.status}`,
    `${status.message}`
  ];

  if (status.tailnetUrl) {
    lines.push("", `Claw Copilot URL: ${status.tailnetUrl}`);
  }
  if (status.loginUrl) {
    lines.push("", `Tailscale login URL: ${status.loginUrl}`);
  }
  if (status.installCommand) {
    lines.push("", `Install command: ${status.installCommand}`);
  }
  if (status.serveCommand) {
    lines.push(`Serve command: ${status.serveCommand}`);
  }
  if (status.detail) {
    lines.push("", status.detail);
  }

  lines.push(...buildRemoteNextSteps(status, basePath, mode));
  process.stdout.write(`${lines.join("\n")}\n`);

  const qrTargets = buildQrTargets(status);
  for (const target of qrTargets) {
    process.stdout.write(`\n${target.label}\n`);
    qrcode.generate(target.value, { small: true });
    process.stdout.write(`${target.value}\n`);
  }
}

function buildRemoteNextSteps(status: TailscaleStatus, basePath: string, mode: "status" | "enable"): string[] {
  const lines = ["", "Next steps:"];
  if (!status.installed) {
    lines.push("1. Install Tailscale on this machine.");
    lines.push("2. Install Tailscale on your phone or other computer.");
    lines.push("3. Run `openclaw claw-copilot remote enable` again.");
    return lines;
  }
  if (status.loginState !== "logged-in") {
    lines.push("1. Complete Tailscale sign-in on this machine.");
    lines.push("2. Install Tailscale on your phone or laptop and sign into the same tailnet.");
    lines.push(`3. Re-run \`openclaw claw-copilot remote ${mode}\` after login finishes.`);
    return lines;
  }
  if (status.tailnetUrl) {
    lines.push("1. Open Tailscale on your phone or laptop and sign into the same tailnet.");
    lines.push("2. Visit the Claw Copilot URL above from any connected device.");
    lines.push(`3. Keep using Tailscale so you do not need to expose ${basePath} on the public internet.`);
    return lines;
  }
  lines.push("1. Run `openclaw claw-copilot remote enable` to expose Claw Copilot to your tailnet.");
  lines.push("2. Install Tailscale on your phone or laptop and sign into the same tailnet.");
  return lines;
}

function buildQrTargets(status: TailscaleStatus): Array<{ label: string; value: string }> {
  const targets: Array<{ label: string; value: string }> = [];
  if (status.loginUrl) {
    targets.push({ label: "Scan to finish Tailscale login:", value: status.loginUrl });
  }
  if (status.tailnetUrl) {
    targets.push({ label: "Scan to open Claw Copilot on your phone:", value: status.tailnetUrl });
  } else if (status.installUrl) {
    targets.push({ label: "Scan to install Tailscale on your phone:", value: status.installUrl });
  }
  return targets;
}

type CliCommandLike = {
  command: (name: string) => CliCommandLike;
  description: (value: string) => CliCommandLike;
  action: (handler: () => void) => CliCommandLike;
};
