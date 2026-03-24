import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CopilotRecorder } from "../../plugin/src/runtime/recorder.js";
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

describe("CopilotRecorder", () => {
  it("maps tool calls into run, task, agent, event, and artifact records", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onPromptResolved("session-1", "Generate TS types");
    recorder.onBeforeToolCall(
      { toolName: "write", params: { filePath: "src/types.ts", content: "export type Foo = string;" }, toolCallId: "tc-1" },
      { sessionId: "session-1", sessionKey: "feishu:chat-1", runId: "run-1", toolName: "write", toolCallId: "tc-1", agentId: "main" }
    );
    recorder.onAfterToolCall(
      { toolName: "write", params: { filePath: "src/types.ts", content: "export type Foo = string;" }, toolCallId: "tc-1", result: { ok: true }, durationMs: 25 },
      { sessionId: "session-1", sessionKey: "feishu:chat-1", runId: "run-1", toolName: "write", toolCallId: "tc-1", agentId: "main" }
    );

    const detail = store.getSessionDetail("session-1");
    expect(detail?.runs[0]?.userInput).toBe("Generate TS types");
    expect(detail?.runViews[0]?.tasks[0]?.agents[0]?.agent.name).toBe("main");
    expect(detail?.runViews[0]?.tasks[0]?.agents[0]?.toolCalls[0]?.status).toBe("done");
    expect(detail?.runViews[0]?.events.length).toBeGreaterThan(0);
    expect(detail?.runViews[0]?.artifacts[0]?.path).toBe("src/types.ts");
  });

  it("records sub-agent spawn and completion in the task tree", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onPromptResolved("session-1", "Refactor auth flow");
    recorder.onBeforeToolCall(
      { toolName: "read", params: { filePath: "src/auth.ts" }, toolCallId: "tc-1" },
      { sessionId: "session-1", sessionKey: "slack:1", runId: "run-1", toolName: "read", toolCallId: "tc-1", agentId: "main" }
    );
    recorder.onSubagentSpawned(
      { childSessionKey: "sub-1", agentId: "reviewer", label: "Review auth changes", mode: "run", threadRequested: false, runId: "run-1" },
      { requesterSessionKey: "session-1", childSessionKey: "sub-1", runId: "run-1" }
    );
    recorder.onSubagentEnded(
      { targetSessionKey: "sub-1", targetKind: "subagent", reason: "subagent-complete", outcome: "ok", runId: "run-1" },
      { requesterSessionKey: "session-1", childSessionKey: "sub-1", runId: "run-1" }
    );

    const detail = store.getSessionDetail("session-1");
    const agentNames = detail?.runViews[0]?.tasks.flatMap((task) => task.agents.map((agent) => agent.agent.name)) ?? [];
    expect(agentNames).toContain("reviewer");
  });

  it("links a parent sub-agent node to the spawned child session", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onBeforeToolCall(
      { toolName: "read", params: { filePath: "README.md" }, toolCallId: "tc-1" },
      { sessionId: "session-parent", sessionKey: "agent:main:main", runId: "run-parent", toolName: "read", toolCallId: "tc-1", agentId: "main" }
    );
    recorder.onSubagentSpawned(
      { childSessionKey: "agent:reviewer:subagent:abc", agentId: "reviewer", label: "Review changes", mode: "run", runId: "run-parent" },
      { runId: "run-parent", requesterSessionKey: "session-parent" }
    );
    recorder.onSessionStart("session-child", "agent:reviewer:subagent:abc");

    const detail = store.getSessionDetail("session-parent");
    const reviewer = detail?.runViews[0]?.tasks.flatMap((task) => task.agents.map((agent) => agent.agent)).find((agent) => agent.name === "reviewer");
    expect(reviewer?.linkedSessionId).toBe("session-child");
  });

  it("uses sanitized prompt text from the real sessionId as the session title", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onSessionStart("session-1", "feishu:chat-1");
    recorder.onPromptResolved(
      "session-1",
      [
        "Sender (untrusted metadata):",
        "```json",
        "{",
        '  "label": "openclaw-tui (gateway-client)",',
        '  "id": "gateway-client"',
        "}",
        "```",
        "",
        "[Tue 2026-03-24 10:04 GMT+8] 你好"
      ].join("\n")
    );
    recorder.onLlmInput({
      runId: "run-1",
      sessionId: "session-1",
      provider: "feishu",
      model: "qwen",
      prompt: [
        "Sender (untrusted metadata):",
        "```json",
        "{",
        '  "label": "openclaw-tui (gateway-client)",',
        '  "id": "gateway-client"',
        "}",
        "```",
        "",
        "[Tue 2026-03-24 10:04 GMT+8] 你好"
      ].join("\n")
    });

    recorder.onBeforeToolCall(
      { toolName: "read", params: { filePath: "README.md" }, toolCallId: "tc-1" },
      { sessionId: "session-1", sessionKey: "feishu:chat-1", runId: "run-1", toolName: "read", toolCallId: "tc-1", agentId: "main" }
    );

    const detail = store.getSessionDetail("session-1");
    expect(detail?.session.title).toBe("你好");
    expect(detail?.runs[0]?.userInput).toBe("你好");
    expect(detail?.runViews[0]?.events.find((event) => event.kind === "prompt")?.detail).toBe("你好");
  });

  it("marks the current run tree as completed when the agent ends", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onPromptResolved("session-1", "Inspect build failure");
    recorder.onBeforeToolCall(
      { toolName: "read", params: { filePath: "package.json" }, toolCallId: "tc-1" },
      { sessionId: "session-1", sessionKey: "feishu:chat-1", runId: "run-1", toolName: "read", toolCallId: "tc-1", agentId: "main" }
    );
    recorder.onAgentEnd("session-1", "feishu", true);

    const detail = store.getSessionDetail("session-1");
    expect(detail?.session.status).toBe("completed");
    expect(detail?.runs[0]?.status).toBe("done");
    expect(detail?.runViews[0]?.tasks[0]?.task.status).toBe("completed");
    expect(detail?.runViews[0]?.tasks[0]?.agents[0]?.agent.status).toBe("done");
  });

  it("keeps prompt text isolated per run within the same session", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onPromptResolved("session-1", "first prompt");
    recorder.onLlmInput({ runId: "run-1", sessionId: "session-1", provider: "feishu", model: "qwen", prompt: "first prompt" });
    recorder.onAgentEnd("session-1", "feishu", true);

    recorder.onLlmInput({ runId: "run-2", sessionId: "session-1", provider: "feishu", model: "qwen", prompt: "second prompt" });

    const detail = store.getSessionDetail("session-1");
    expect(detail?.runs.find((run) => run.id === "run-1")?.userInput).toBe("first prompt");
    expect(detail?.runs.find((run) => run.id === "run-2")?.userInput).toBe("second prompt");
  });

  it("attaches model prompt and reply events to the main task tree agent", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onLlmInput({ runId: "run-1", sessionId: "session-1", provider: "feishu", model: "qwen", prompt: "hello" });
    recorder.onLlmOutput({ runId: "run-1", sessionId: "session-1", provider: "feishu", model: "qwen", assistantTexts: ["done"] });

    const detail = store.getSessionDetail("session-1");
    const promptEvent = detail?.runViews[0]?.events.find((event) => event.kind === "prompt");
    const replyEvent = detail?.runViews[0]?.events.find((event) => event.kind === "out");
    expect(promptEvent?.taskId).toBeTruthy();
    expect(promptEvent?.agentId).toBeTruthy();
    expect(replyEvent?.taskId).toBe(promptEvent?.taskId);
    expect(replyEvent?.agentId).toBe(promptEvent?.agentId);
  });

  it("derives model event agent ownership from the session key for subagents", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onSessionStart("session-sub-1", "agent:reviewer:subagent:abc");
    recorder.onLlmInput({ runId: "run-1", sessionId: "session-sub-1", provider: "feishu", model: "qwen", prompt: "review this" });
    recorder.onLlmOutput({ runId: "run-1", sessionId: "session-sub-1", provider: "feishu", model: "qwen", assistantTexts: ["looks good"] });

    const detail = store.getSessionDetail("session-sub-1");
    const agentNames = detail?.runViews[0]?.tasks[0]?.agents.map((bundle) => bundle.agent.name) ?? [];
    const promptEvent = detail?.runViews[0]?.events.find((event) => event.kind === "prompt");
    const replyEvent = detail?.runViews[0]?.events.find((event) => event.kind === "out");

    expect(agentNames).toContain("reviewer");
    expect(promptEvent?.agentId).toBe(replyEvent?.agentId);
  });

  it("preserves the session channel key during llm input updates", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onSessionStart("session-writer", "agent:develop:subagent:abc");
    recorder.onLlmInput({ runId: "run-1", sessionId: "session-writer", provider: "huawei-glm", model: "qwen", prompt: "hello" });

    const detail = store.getSessionDetail("session-writer");
    expect(detail?.session.channelId).toBe("agent:develop:subagent:abc");
    expect(detail?.runViews[0]?.tasks[0]?.agents[0]?.agent.name).toBe("develop");
  });

  it("does not fall back to provider when no session key is known", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);
    const recorder = new CopilotRecorder(store);

    recorder.onLlmInput({ runId: "run-1", sessionId: "session-raw", provider: "huawei-glm", model: "qwen", prompt: "hello" });

    const detail = store.getSessionDetail("session-raw");
    expect(detail?.session.channelId).toBe("session-raw");
  });

  it("reuses the existing run task and agent when a later tool call arrives after recorder state is rebuilt", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "claw-copilot-runtime-"));
    dirs.push(root);
    const store = new CopilotStore(root);

    const firstRecorder = new CopilotRecorder(store);
    firstRecorder.onSessionStart("session-1", "agent:main:main");
    firstRecorder.onLlmInput({ runId: "run-1", sessionId: "session-1", provider: "feishu", model: "qwen", prompt: "call writer" });
    firstRecorder.onBeforeToolCall(
      { toolName: "exec", params: { command: "openclaw agent --agent writer" }, toolCallId: "tc-1" },
      { sessionId: "session-1", sessionKey: "agent:main:main", runId: "run-1", toolName: "exec", toolCallId: "tc-1", agentId: "main" }
    );

    const secondRecorder = new CopilotRecorder(store);
    secondRecorder.onSessionStart("session-1", "agent:main:main");
    secondRecorder.onBeforeToolCall(
      { toolName: "process", params: { action: "poll", sessionId: "child" }, toolCallId: "tc-2" },
      { sessionId: "session-1", sessionKey: "agent:main:main", runId: "run-1", toolName: "process", toolCallId: "tc-2", agentId: "main" }
    );
    secondRecorder.onAgentEnd("session-1", "agent:main:main", true);

    const detail = store.getSessionDetail("session-1");
    expect(detail?.runs).toHaveLength(1);
    expect(detail?.runs[0]?.userInput).toBe("call writer");
    expect(detail?.runViews[0]?.tasks).toHaveLength(1);
    expect(detail?.runViews[0]?.tasks[0]?.task.label).toBe("call writer");
    expect(detail?.runViews[0]?.tasks[0]?.task.status).toBe("completed");
    expect(detail?.runViews[0]?.tasks[0]?.agents).toHaveLength(1);
    expect(detail?.runViews[0]?.tasks[0]?.agents[0]?.agent.status).toBe("done");
  });
});
