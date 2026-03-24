import { describe, expect, it } from "vitest";

import { buildEventRows } from "../../dashboard/src/event-stream.js";
import type { RunView } from "../../dashboard/src/types.js";

describe("buildEventRows", () => {
  it("keeps model prompt and reply events visible in the stream with distinct statuses", () => {
    const runView: RunView = {
      run: {
        id: "run-1",
        sessionId: "session-1",
        runNumber: 1,
        userInput: "why did this fail?",
        startedAt: 1,
        status: "done"
      },
      tasks: [],
      artifacts: [],
      controls: [],
      events: [
        {
          id: "event-1",
          sessionId: "session-1",
          runId: "run-1",
          kind: "prompt",
          label: "Prompt · qwen",
          detail: "user prompt body",
          createdAt: 10
        },
        {
          id: "event-2",
          sessionId: "session-1",
          runId: "run-1",
          kind: "out",
          label: "Final response",
          detail: "assistant reply body",
          createdAt: 20
        }
      ]
    };

    const rows = buildEventRows(runView);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "prompt",
      label: "Model prompt · qwen",
      detail: "user prompt body",
      rowStatus: "done"
    });
    expect(rows[1]).toMatchObject({
      kind: "out",
      label: "Model reply",
      detail: "assistant reply body",
      rowStatus: "model-output"
    });
  });

  it("splits tool results into input output and meta sections", () => {
    const runView: RunView = {
      run: {
        id: "run-1",
        sessionId: "session-1",
        runNumber: 1,
        userInput: "ls",
        startedAt: 1,
        status: "done"
      },
      tasks: [
        {
          task: { id: "task-1", sessionId: "session-1", runId: "run-1", label: "ls", status: "completed", startedAt: 1, sortOrder: 1 },
          agents: [
            {
              agent: { id: "agent-1", sessionId: "session-1", runId: "run-1", taskId: "task-1", name: "main", status: "done", startedAt: 1, depth: 0 },
              toolCalls: [
                {
                  id: "tool-1",
                  sessionId: "session-1",
                  runId: "run-1",
                  taskId: "task-1",
                  agentId: "agent-1",
                  toolName: "exec",
                  argsText: "ls -la",
                  status: "done",
                  startedAt: 1,
                  endedAt: 2,
                  resultText: JSON.stringify({
                    content: [{ type: "text", text: "total 80" }, { type: "image", data: "...", mimeType: "image/png" }],
                    details: { status: "completed", exitCode: 0, durationMs: 28, cwd: "/tmp", aggregated: "total 80" }
                  })
                }
              ]
            }
          ]
        }
      ],
      artifacts: [],
      controls: [],
      events: [
        { id: "e1", sessionId: "session-1", runId: "run-1", toolCallId: "tool-1", kind: "tool", label: "Tool · exec", detail: "ls -la", createdAt: 2 }
      ]
    };

    const rows = buildEventRows(runView);
    expect(rows[0]?.toolDetail).toMatchObject({
      input: "ls -la",
      outputTexts: ["total 80"]
    });
    expect(rows[0]?.toolDetail?.meta).toEqual(expect.arrayContaining([
      { label: "Status", value: "completed" },
      { label: "Exit code", value: "0" }
    ]));
  });

  it("renders stored model prompt details without extra frontend rewriting", () => {
    const runView: RunView = {
      run: {
        id: "run-1",
        sessionId: "session-1",
        runNumber: 1,
        userInput: "hello",
        startedAt: 1,
        status: "running"
      },
      tasks: [],
      artifacts: [],
      controls: [],
      events: [
        {
          id: "event-1",
          sessionId: "session-1",
          runId: "run-1",
          kind: "prompt",
          label: "Prompt · qwen",
          detail: "你好",
          createdAt: 10
        }
      ]
    };

    const rows = buildEventRows(runView);
    expect(rows[0]?.detail).toBe("你好");
  });
});
