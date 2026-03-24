import { spawnSync } from "node:child_process";

import type { TailscaleStatus } from "../core/types.js";

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  errorCode?: string;
};

type CommandRunner = (command: string, args: string[]) => CommandResult;

type StatusOptions = {
  gatewayOrigin?: string;
  basePath: string;
};

type InstallPlan = {
  shell: string;
  summary: string;
};

type TailscaleRuntime = {
  commandExists: (command: string) => boolean;
  run: CommandRunner;
};

const INSTALL_URL = "https://tailscale.com/download";

export function getTailscaleStatus(options: StatusOptions, runner: CommandRunner = runCommand): TailscaleStatus {
  const result = runner("tailscale", ["status", "--json"]);
  if (result.errorCode === "ENOENT") {
    const installPlan = getInstallPlan(process.platform, commandExists);
    return {
      status: "not-installed",
      loginState: "not-installed",
      installed: false,
      canAutoInstall: Boolean(installPlan),
      installUrl: INSTALL_URL,
      installCommand: installPlan?.shell,
      message: "Install Tailscale to expose the dashboard over your tailnet.",
      detail: "The tailscale CLI is not available on this machine."
    };
  }

  if (!result.ok) {
    return {
      status: "error",
      loginState: "error",
      installed: true,
      installUrl: INSTALL_URL,
      message: "Tailscale is installed but its status could not be read.",
      detail: result.stderr || result.stdout || `tailscale status exited with ${result.exitCode}`
    };
  }

  try {
    return summarizeTailscaleStatus(JSON.parse(result.stdout), options);
  } catch {
    return {
      status: "error",
      loginState: "error",
      installed: true,
      installUrl: INSTALL_URL,
      message: "Tailscale returned unreadable status output.",
      detail: result.stdout.slice(0, 2000)
    };
  }
}

export function beginTailscaleLogin(options: StatusOptions, runner: CommandRunner = runCommand): TailscaleStatus {
  const current = getTailscaleStatus(options, runner);
  if (current.status === "not-installed" || current.status === "connected") {
    return current;
  }

  const result = runner("tailscale", ["up", "--qr", "--timeout=5s"]);
  const loginUrl = parseLoginUrl(`${result.stdout}\n${result.stderr}`);

  if (loginUrl) {
    return {
      ...current,
      status: "needs-login",
      loginState: "needs-login",
      loginUrl,
      message: "Open the Tailscale sign-in page to connect this machine.",
      detail: "Complete the browser sign-in, then return here to enable Crew Copilot remote access."
    };
  }

  if (result.ok) {
    return getTailscaleStatus(options, runner);
  }

  return {
    ...current,
    status: current.status === "needs-login" ? current.status : "error",
    loginState: current.loginState === "needs-login" ? current.loginState : "error",
    message: "Tailscale login could not be started automatically.",
    detail: result.stderr || result.stdout || current.detail
  };
}

export function enableTailscaleServe(
  gatewayOrigin: string,
  options: StatusOptions,
  runner: CommandRunner = runCommand
): TailscaleStatus {
  const current = getTailscaleStatus({ ...options, gatewayOrigin }, runner);
  if (current.status === "not-installed" || current.status === "needs-login") {
    return current;
  }

  const command = buildServeCommand(gatewayOrigin, options.basePath);
  const target = `${trimTrailingSlash(gatewayOrigin)}${options.basePath}`;
  const result = runner("tailscale", ["serve", "--bg", `--set-path=${options.basePath}`, target]);
  const next = getTailscaleStatus({ ...options, gatewayOrigin }, runner);

  if (!result.ok) {
    return {
      ...next,
      serveCommand: command,
      message: "Crew Copilot remote access could not be enabled automatically.",
      detail: result.stderr || result.stdout || next.detail
    };
  }

  return {
    ...next,
    serveCommand: command,
    message: "Crew Copilot remote access is enabled for your tailnet."
  };
}

export function disableRemoteAccess(
  options: StatusOptions,
  runner: CommandRunner = runCommand
): { message: string; detail?: string } {
  const result = runner("tailscale", ["serve", "reset"]);

  if (!result.ok) {
    return {
      message: "Crew Copilot remote access could not be disabled automatically.",
      detail: result.stderr || result.stdout || "Run `tailscale serve reset` manually."
    };
  }

  return {
    message: `Crew Copilot remote access is disabled for ${options.basePath}.`
  };
}

export function resolveGatewayOrigin(defaultOrigin = "http://127.0.0.1:3000", runner: CommandRunner = runCommand): string {
  const override = process.env.OPENCLAW_GATEWAY_ORIGIN;
  if (override) {
    return override;
  }

  const result = runner("openclaw", ["gateway", "status", "--json"]);
  if (!result.ok) {
    return defaultOrigin;
  }

  return parseGatewayOriginFromStatusOutput(result.stdout) ?? defaultOrigin;
}

export function ensureTailscaleInstalled(
  options: StatusOptions,
  platform: NodeJS.Platform = process.platform,
  runtime: TailscaleRuntime = { commandExists, run: runCommand }
): TailscaleStatus {
  const current = getTailscaleStatus(options, runtime.run);
  if (current.installed) {
    return current;
  }

  const plan = getInstallPlan(platform, runtime.commandExists);
  if (!plan) {
    return {
      status: "not-installed",
      loginState: "not-installed",
      installed: false,
      canAutoInstall: false,
      installUrl: INSTALL_URL,
      message: "Automatic Tailscale installation is not available on this platform.",
      detail: "Open the official download page and install Tailscale manually."
    };
  }

  const result = runInstallPlan(plan, runtime.run, platform);
  const status = getTailscaleStatus(options, runtime.run);

  if (!result.ok) {
    return {
      ...status,
      status: "not-installed",
      loginState: "not-installed",
      installed: false,
      canAutoInstall: true,
      installUrl: INSTALL_URL,
      installCommand: plan.shell,
      message: "Automatic Tailscale installation failed.",
      detail: result.stderr || result.stdout || plan.summary
    };
  }

  return {
    ...status,
    canAutoInstall: true,
    installCommand: plan.shell,
    message: status.installed
      ? "Tailscale installation finished. Run `openclaw copilot tailscale login` next."
      : status.message
  };
}

export function summarizeTailscaleStatus(raw: Record<string, unknown>, options: StatusOptions): TailscaleStatus {
  const backendState = typeof raw.BackendState === "string" ? raw.BackendState : "Unknown";
  const self = isObject(raw.Self) ? raw.Self : undefined;
  const hostname = self && typeof self.HostName === "string" ? self.HostName : undefined;
  const dnsNameRaw = self && typeof self.DNSName === "string" ? self.DNSName : undefined;
  const dnsName = dnsNameRaw?.replace(/\.$/, "");
  const serveCommand = options.gatewayOrigin ? buildServeCommand(options.gatewayOrigin, options.basePath) : undefined;

  if (backendState === "NeedsLogin" || !self) {
    return {
      status: "needs-login",
      loginState: "needs-login",
      installed: true,
      hostname,
      serveCommand,
      installUrl: INSTALL_URL,
      message: "Sign in to Tailscale to make Crew Copilot remotely reachable from your tailnet.",
      detail: `Current backend state: ${backendState}`
    };
  }

  return {
    status: "connected",
    loginState: "logged-in",
    installed: true,
    hostname,
    dnsName,
    tailnetUrl: dnsName ? `https://${dnsName}${options.basePath}` : undefined,
    serveCommand,
    installUrl: INSTALL_URL,
    message: dnsName
      ? "This machine is connected to Tailscale. You can expose only Crew Copilot to your tailnet."
      : "This machine is connected to Tailscale."
  };
}

export function parseLoginUrl(text: string): string | undefined {
  return text.match(/https:\/\/[^\s)"']+/)?.[0];
}

export function parseGatewayOriginFromStatusOutput(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      gateway?: { bindHost?: string; port?: number };
    };
    const host = parsed.gateway?.bindHost;
    const port = parsed.gateway?.port;
    if (host && port) {
      return `http://${host}:${port}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function buildServeCommand(gatewayOrigin: string, basePath: string): string {
  return `tailscale serve --bg --set-path=${basePath} ${trimTrailingSlash(gatewayOrigin)}${basePath}`;
}

export function getInstallPlan(
  platform: NodeJS.Platform,
  hasCommand: (command: string) => boolean
): InstallPlan | undefined {
  if (platform === "darwin") {
    if (hasCommand("brew")) {
      return {
        shell: "brew install --cask tailscale",
        summary: "Install Tailscale via Homebrew cask"
      };
    }

    return {
      shell: "open https://tailscale.com/download/mac",
      summary: "Open the macOS download page"
    };
  }

  if (platform === "win32") {
    if (hasCommand("winget")) {
      return {
        shell: "winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements",
        summary: "Install Tailscale via winget"
      };
    }
    if (hasCommand("choco")) {
      return {
        shell: "choco install tailscale -y",
        summary: "Install Tailscale via Chocolatey"
      };
    }

    return {
      shell: "start https://tailscale.com/download/windows",
      summary: "Open the Windows download page"
    };
  }

  if (platform === "linux") {
    if (hasCommand("apt-get") || hasCommand("dnf") || hasCommand("yum") || hasCommand("pacman") || hasCommand("zypper")) {
      return {
        shell: "curl -fsSL https://tailscale.com/install.sh | sh",
        summary: "Install Tailscale via the official Linux installer"
      };
    }

    return {
      shell: "curl -fsSL https://tailscale.com/install.sh | sh",
      summary: "Run the official Linux installer"
    };
  }

  return undefined;
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 8_000
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
    errorCode: result.error && "code" in result.error ? String(result.error.code) : undefined
  };
}

function commandExists(command: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], {
    encoding: "utf8",
    timeout: 4_000
  });
  return result.status === 0;
}

function runInstallPlan(plan: InstallPlan, runner: CommandRunner, platform: NodeJS.Platform): CommandResult {
  if (platform === "win32") {
    return runner("cmd", ["/c", plan.shell]);
  }
  return runner("sh", ["-c", plan.shell]);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
