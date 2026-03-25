import { spawn } from "node:child_process";

export async function stopSessionViaCli(
  sessionKey: string,
  gatewayToken: string,
  runId?: string
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let args: string[];

    if (runId) {
      const params = JSON.stringify({ sessionKey, runId });
      args = [
        "gateway", "call", "chat.abort",
        "--params", params,
        "--json",
        "--token", gatewayToken
      ];
    } else {
      const idempotencyKey = `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const params = JSON.stringify({
        sessionKey,
        message: "/stop",
        idempotencyKey,
      });
      args = [
        "gateway", "call", "chat.send",
        "--params", params,
        "--json",
        "--token", gatewayToken
      ];
    }

    const proc = spawn("openclaw", args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", () => {
      try {
        const lines = stdout.split("\n");
        let jsonLine = "";
        let foundOpenBrace = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("{")) {
            foundOpenBrace = true;
          }
          if (foundOpenBrace) {
            jsonLine += trimmed + "\n";
            if (trimmed.includes("}")) {
              break;
            }
          }
        }

        if (!jsonLine) {
          resolve({ ok: false, error: "No JSON in CLI output" });
          return;
        }

        const result = JSON.parse(jsonLine.trim());
        if (result.runId || result.aborted !== undefined) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: JSON.stringify(result) });
        }
      } catch {
        resolve({ ok: false, error: "Failed to parse CLI response" });
      }
    });

    proc.on("error", () => {
      resolve({ ok: false, error: "Failed to spawn CLI" });
    });

    proc.unref();
  });
}

export function resolveGatewayTokenFromEnv(): string | undefined {
  return process.env.OPENCLAW_GATEWAY_TOKEN;
}