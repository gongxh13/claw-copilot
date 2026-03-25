import { describe, expect, it } from "vitest";

import { buildAgentSteps } from "../../dashboard/src/task-tree.js";
import type { EventRecord, ToolCallRecord } from "../../dashboard/src/types.js";

describe("buildAgentSteps", () => {
  it("keeps execution steps focused on tool activity", () => {
    const events: EventRecord[] = [
      {
        id: "prompt-1",
        sessionId: "session-1",
        runId: "run-1",
        taskId: "task-1",
        agentId: "agent-1",
        kind: "prompt",
        label: "Prompt · qwen",
        detail: "hello",
        createdAt: 10
      },
      {
        id: "reply-1",
        sessionId: "session-1",
        runId: "run-1",
        taskId: "task-1",
        agentId: "agent-1",
        kind: "out",
        label: "Final response",
        detail: "done",
        createdAt: 30
      }
    ];
    const toolCalls: ToolCallRecord[] = [
      {
        id: "tool-1",
        sessionId: "session-1",
        runId: "run-1",
        taskId: "task-1",
        agentId: "agent-1",
        toolName: "read",
        argsText: "README.md",
        status: "done",
        startedAt: 20,
        resultText: "ok"
      }
    ];

    const steps = buildAgentSteps(toolCalls, new Set(["agent-1"]));

    expect(steps.map((step) => step.kind)).toEqual(["tool"]);
    expect(steps.map((step) => step.label)).toEqual(["read"]);
  });
});
