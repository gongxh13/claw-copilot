import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import plugin from "../../plugin/src/index.js";

describe("plugin runtime event wiring", () => {
  it("subscribes to runtime agent and transcript updates", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "crew-copilot-plugin-"));
    const onAgentEvent = vi.fn(() => () => true);
    const onSessionTranscriptUpdate = vi.fn(() => () => {});

    plugin.register({
      pluginConfig: {},
      runtime: {
        state: {
          resolveStateDir: () => root
        },
        events: {
          onAgentEvent,
          onSessionTranscriptUpdate
        }
      },
      on: vi.fn(),
      registerHttpRoute: vi.fn(),
      registerCli: vi.fn()
    } as never);

    expect(onAgentEvent).toHaveBeenCalledTimes(1);
    expect(onSessionTranscriptUpdate).toHaveBeenCalledTimes(1);
  });
});
