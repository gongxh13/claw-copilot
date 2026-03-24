import { describe, expect, it } from "vitest";

import {
  disableRemoteAccess,
  buildServeCommand,
  ensureTailscaleInstalled,
  getInstallPlan,
  parseLoginUrl,
  parseGatewayOriginFromStatusOutput,
  summarizeTailscaleStatus
} from "../../plugin/src/tailscale/service.js";

describe("parseLoginUrl", () => {
  it("extracts interactive login URL from tailscale output", () => {
    const url = parseLoginUrl(
      "To authenticate, visit:\nhttps://login.tailscale.com/a/abcdef\nSuccess requires browser sign-in."
    );

    expect(url).toBe("https://login.tailscale.com/a/abcdef");
  });
});

describe("parseGatewayOriginFromStatusOutput", () => {
  it("extracts local gateway origin from gateway status json output", () => {
    const origin = parseGatewayOriginFromStatusOutput(`noise\n{"gateway":{"bindHost":"127.0.0.1","port":18789}}\nmore noise`);

    expect(origin).toBe("http://127.0.0.1:18789");
  });
});

describe("summarizeTailscaleStatus", () => {
  it("marks state as connected when status json has a self node", () => {
    const state = summarizeTailscaleStatus(
      {
        BackendState: "Running",
        Self: {
          HostName: "crew-host",
          DNSName: "crew-host.example.ts.net."
        }
      },
      {
        basePath: "/claw-copilot",
        gatewayOrigin: "http://127.0.0.1:3000"
      }
    );

    expect(state.status).toBe("connected");
    expect(state.loginState).toBe("logged-in");
    expect(state.tailnetUrl).toBe("https://crew-host.example.ts.net/claw-copilot");
    expect(state.serveCommand).toContain("--set-path=/claw-copilot");
  });

  it("marks state as needing login when backend requests auth", () => {
    const state = summarizeTailscaleStatus(
      {
        BackendState: "NeedsLogin"
      },
      {
        basePath: "/claw-copilot",
        gatewayOrigin: "http://127.0.0.1:3000"
      }
    );

    expect(state.status).toBe("needs-login");
    expect(state.loginState).toBe("needs-login");
  });
});

describe("buildServeCommand", () => {
  it("builds a path-scoped background serve command for local gateway origin", () => {
    expect(buildServeCommand("http://127.0.0.1:3000", "/claw-copilot")).toBe(
      "tailscale serve --bg --set-path=/claw-copilot http://127.0.0.1:3000/claw-copilot"
    );
  });
});

describe("getInstallPlan", () => {
  it("prefers Homebrew cask on macOS when brew exists", () => {
    const plan = getInstallPlan("darwin", (command) => command === "brew");

    expect(plan?.shell).toBe("brew install --cask tailscale");
  });

  it("uses the official install script on Linux when no package manager is detected", () => {
    const plan = getInstallPlan("linux", () => false);

    expect(plan?.shell).toBe("curl -fsSL https://tailscale.com/install.sh | sh");
  });
});

describe("ensureTailscaleInstalled", () => {
  it("returns install guidance when auto-install is unsupported", () => {
    const status = ensureTailscaleInstalled(
      { basePath: "/claw-copilot", gatewayOrigin: "http://127.0.0.1:3000" },
      "freebsd",
      {
        commandExists: () => false,
        run: () => ({ ok: false, stdout: "", stderr: "", exitCode: 1, errorCode: "ENOENT" })
      }
    );

    expect(status.status).toBe("not-installed");
    expect(status.canAutoInstall).toBe(false);
  });

  it("returns connected status immediately when tailscale is already installed", () => {
    const status = ensureTailscaleInstalled(
      { basePath: "/claw-copilot", gatewayOrigin: "http://127.0.0.1:3000" },
      "darwin",
      {
        commandExists: () => true,
        run: (_command, args) => {
          if (args[0] === "status") {
            return {
              ok: true,
              stdout: JSON.stringify({
                BackendState: "Running",
                Self: { HostName: "crew-host", DNSName: "crew-host.example.ts.net." }
              }),
              stderr: "",
              exitCode: 0
            };
          }
          return { ok: true, stdout: "", stderr: "", exitCode: 0 };
        }
      }
    );

    expect(status.status).toBe("connected");
  });
});

describe("disableRemoteAccess", () => {
  it("uses tailscale serve reset to disable the remote route", () => {
    let called = false;
    const status = disableRemoteAccess(
      { basePath: "/claw-copilot", gatewayOrigin: "http://127.0.0.1:3000" },
      (_command, args) => {
        called = args.join(" ") === "serve reset";
        return { ok: true, stdout: "", stderr: "", exitCode: 0 };
      }
    );

    expect(called).toBe(true);
    expect(status.message).toContain("disabled");
  });
});
