import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CopilotStore } from "../../plugin/src/storage/repository.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      new CopilotStore(dir).reset();
    } catch {
      // ignore cleanup issues in tests
    }
  }
});

describe("CopilotStore", () => {
  it("creates sessions and runs with stable numbering", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "crew-copilot-store-"));
    dirs.push(root);
    const store = new CopilotStore(root);

    store.upsertSession({
      id: "session-1",
      channelId: "feishu",
      startedAt: 100,
      status: "active",
      title: "Generate TS types"
    });

    const firstRun = store.upsertRun({
      id: "run-1",
      sessionId: "session-1",
      userInput: "Analyze project structure",
      startedAt: 100,
      status: "running"
    });

    const secondRun = store.upsertRun({
      id: "run-2",
      sessionId: "session-1",
      userInput: "Generate TS types",
      startedAt: 120,
      status: "completed"
    });

    expect(firstRun.runNumber).toBe(1);
    expect(secondRun.runNumber).toBe(2);
    expect(store.listSessions()[0]?.runCount).toBe(2);
  });

  it("returns paginated session results from the store", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "crew-copilot-store-"));
    dirs.push(root);
    const store = new CopilotStore(root);

    for (let index = 0; index < 5; index += 1) {
      store.upsertSession({
        id: `session-${index + 1}`,
        channelId: `agent:main:tui-${index + 1}`,
        startedAt: 100 + index,
        updatedAt: 200 + index,
        status: "completed",
        title: `Session ${index + 1}`
      });
    }

    const page = store.listSessionsPage(2, 2);

    expect(page.sessions.map((session) => session.id)).toEqual(["session-3", "session-2"]);
    expect(page.pagination.page).toBe(2);
    expect(page.pagination.totalCount).toBe(5);
    expect(page.pagination.totalPages).toBe(3);
  });

  it("groups artifacts, tasks, agents, and tools by run", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "crew-copilot-store-"));
    dirs.push(root);
    const store = new CopilotStore(root);

    store.upsertSession({
      id: "session-1",
      channelId: "slack",
      startedAt: 100,
      status: "active",
      title: "OAuth rollout"
    });

    const run = store.upsertRun({
      id: "run-1",
      sessionId: "session-1",
      userInput: "Implement OAuth 2.0 + PKCE",
      startedAt: 100,
      status: "completed"
    });

    const task = store.createTaskForRun(run.id, "session-1", "Implement OAuth 2.0 + PKCE");
    const agent = store.upsertAgent({
      id: "agent-1",
      sessionId: "session-1",
      runId: run.id,
      taskId: task.id,
      name: "main",
      status: "done",
      startedAt: 100,
      depth: 0
    });
    store.upsertToolCall({
      id: "tool-1",
      sessionId: "session-1",
      runId: run.id,
      taskId: task.id,
      agentId: agent.id,
      toolName: "write",
      argsText: "src/auth/oauth.ts",
      status: "done",
      startedAt: 101,
      durationMs: 42
    });

    store.appendArtifact({
      id: "artifact-1",
      sessionId: "session-1",
      runId: "run-1",
      path: "src/auth/oauth.ts",
      lifecycle: "permanent",
      sizeBytes: 245,
      createdAt: 101,
      agentName: "code-writer"
    });

    const detail = store.getSessionDetail("session-1");
    expect(detail?.runViews[0]?.run.id).toBe("run-1");
    expect(detail?.runViews[0]?.artifacts[0]?.lifecycle).toBe("permanent");
    expect(detail?.runViews[0]?.tasks[0]?.task.label).toBe("Implement OAuth 2.0 + PKCE");
    expect(detail?.runViews[0]?.tasks[0]?.agents[0]?.toolCalls[0]?.toolName).toBe("write");
  });
});
