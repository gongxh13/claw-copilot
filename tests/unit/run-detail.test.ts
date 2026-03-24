import { describe, expect, it } from "vitest";

import { resolveSelectedRunId, summarizeRunView } from "../../dashboard/src/run-detail.js";
import type { RunView } from "../../dashboard/src/types.js";

describe("run detail helpers", () => {
  it("keeps the selected run when it still exists", () => {
    const runViews = [makeRunView("run-1"), makeRunView("run-2")];

    expect(resolveSelectedRunId(runViews, "run-1")).toBe("run-1");
  });

  it("falls back to the latest run when the current one is missing", () => {
    const runViews = [makeRunView("run-1"), makeRunView("run-2")];

    expect(resolveSelectedRunId(runViews, "run-9")).toBe("run-2");
  });

  it("summarizes tasks tools and artifacts for the selected run", () => {
    const runView = makeRunView("run-1");
    runView.tasks = [
      {
        task: { id: "task-1", sessionId: "session-1", runId: "run-1", label: "Investigate", status: "completed", startedAt: 1, sortOrder: 1 },
        agents: [
          {
            agent: { id: "agent-1", sessionId: "session-1", runId: "run-1", taskId: "task-1", name: "main", status: "done", startedAt: 1, depth: 0 },
            toolCalls: [
              { id: "tool-1", sessionId: "session-1", runId: "run-1", taskId: "task-1", agentId: "agent-1", toolName: "read", argsText: "README", status: "done", startedAt: 2 }
            ]
          }
        ]
      }
    ];
    runView.artifacts = [
      { id: "artifact-1", sessionId: "session-1", runId: "run-1", path: "README.md", lifecycle: "permanent", sizeBytes: 12, createdAt: 3 }
    ];

    expect(summarizeRunView(runView)).toMatchObject({
      taskCount: 1,
      agentCount: 1,
      toolCount: 1,
      artifactCount: 1
    });
  });
});

function makeRunView(id: string): RunView {
  return {
    run: { id, sessionId: "session-1", runNumber: Number(id.split("-").at(-1)), userInput: id, startedAt: 1, status: "done" },
    tasks: [],
    events: [],
    artifacts: [],
    controls: []
  };
}
