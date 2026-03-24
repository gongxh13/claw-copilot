import { randomUUID } from "node:crypto";

import { classifyArtifactLifecycle } from "../core/classify-artifact.js";
import type {
  ArtifactRecord,
  ControlActionKind,
  ControlActionRecord,
  RunStatus,
  SessionStatus,
  ToolCallRecord
} from "../core/types.js";
import { CopilotStore } from "../storage/repository.js";

type ToolContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolCallId?: string;
};

type BeforeToolEvent = {
  toolName: string;
  params: Record<string, unknown>;
  toolCallId?: string;
};

type AfterToolEvent = BeforeToolEvent & {
  result?: unknown;
  error?: string;
  durationMs?: number;
};

type SubagentSpawnedEvent = {
  childSessionKey: string;
  agentId: string;
  label?: string;
  mode: "run" | "session";
  runId: string;
  threadRequested?: boolean;
};

type SubagentContext = {
  runId?: string;
  childSessionKey?: string;
  requesterSessionKey?: string;
};

type SubagentEndedEvent = {
  targetSessionKey: string;
  targetKind: "subagent" | "acp";
  reason: string;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
  error?: string;
  runId?: string;
  endedAt?: number;
};

type LlmOutputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
};

type LlmInputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  prompt: string;
};

type MessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

type MessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

type SubagentParentRef = {
  agentId: string;
  sessionId: string;
  runId: string;
  taskId: string;
  name: string;
  startedAt: number;
  depth: number;
};

export class CopilotRecorder {
  private readonly promptBySession = new Map<string, string>();
  private readonly promptByRun = new Map<string, string>();
  private readonly sessionKeyBySessionId = new Map<string, string>();
  private readonly agentIdBySessionId = new Map<string, string>();
  private readonly rootTaskByRun = new Map<string, string>();
  private readonly agentByRunAndSource = new Map<string, string>();
  private readonly toolCallByRunAndKey = new Map<string, string>();
  private readonly subagentByChildSession = new Map<string, string>();
  private readonly subagentNameByChildSession = new Map<string, string>();
  private readonly subagentParentRefByChildSession = new Map<string, SubagentParentRef>();

  constructor(private readonly store: CopilotStore) {}

  onSessionStart(sessionId: string, sessionKey: string): void {
    this.sessionKeyBySessionId.set(sessionId, sessionKey);
    this.agentIdBySessionId.set(sessionId, resolveAgentIdFromSessionKey(sessionKey));

    const subagentParentRef = this.subagentParentRefByChildSession.get(sessionKey);
    if (subagentParentRef) {
      this.store.upsertAgent({
        id: subagentParentRef.agentId,
        sessionId: subagentParentRef.sessionId,
        runId: subagentParentRef.runId,
        taskId: subagentParentRef.taskId,
        sourceAgentId: subagentParentRef.name,
        linkedSessionId: sessionId,
        name: subagentParentRef.name,
        status: "active",
        startedAt: subagentParentRef.startedAt,
        depth: subagentParentRef.depth
      });
    }

    this.store.upsertSession({
      id: sessionId,
      channelId: sessionKey,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
      title: "OpenClaw session"
    });
  }

  onPromptResolved(sessionId: string, prompt: string): void {
    const cleanPrompt = sanitizeIncomingMessage(prompt);
    this.promptBySession.set(sessionId, cleanPrompt || prompt.trim());
  }

  onMessageReceived(_event: MessageReceivedEvent, _ctx: MessageContext): void {
    // message_received does not expose the real sessionId; use later hooks that do.
  }

  onBeforeToolCall(event: BeforeToolEvent, ctx: ToolContext): void {
    if (!ctx.sessionId || !ctx.runId) {
      return;
    }

    const now = Date.now();
    const existingDetail = this.store.getSessionDetail(ctx.sessionId);
    const existingRun = existingDetail?.runs.find((run) => run.id === ctx.runId);
    const userInput = this.promptByRun.get(ctx.runId) ?? existingRun?.userInput ?? this.promptBySession.get(ctx.sessionId) ?? `Tool flow: ${event.toolName}`;
    if (userInput === "Agent-to-agent announce step.") {
      return;
    }
    this.store.upsertSession({
      id: ctx.sessionId,
      channelId: ctx.sessionKey ?? ctx.sessionId,
      startedAt: now,
      updatedAt: now,
      status: "running",
      title: userInput
    });
    const run = this.store.upsertRun({
      id: ctx.runId,
      sessionId: ctx.sessionId,
      userInput,
      startedAt: now,
      status: "running"
    });
    const task = this.ensureRootTask(run.id, ctx.sessionId, userInput, now);
    const agentId = ctx.agentId ?? this.resolveAgentIdForSession(ctx.sessionId);
    const agent = this.ensureAgent(run.id, ctx.sessionId, task.id, agentId, now, agentId === "main" ? 0 : 1);
    const toolCall = this.store.upsertToolCall({
      id: this.ensureToolCallId(run.id, event.toolCallId, event.toolName),
      sessionId: ctx.sessionId,
      runId: run.id,
      taskId: task.id,
      agentId: agent.id,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      argsText: summarizeToolArgs(event.params),
      status: "running",
      startedAt: now
    });
    this.store.appendEvent({
      id: randomUUID(),
      sessionId: ctx.sessionId,
      runId: run.id,
      taskId: task.id,
      agentId: agent.id,
      toolCallId: toolCall.id,
      kind: "tool",
      label: `Tool · ${event.toolName}`,
      detail: toolCall.argsText,
      createdAt: now
    });
  }

  onAfterToolCall(event: AfterToolEvent, ctx: ToolContext): void {
    if (!ctx.sessionId || !ctx.runId) {
      return;
    }

    const now = Date.now();
    const taskId = this.rootTaskByRun.get(ctx.runId);
    const agentId = this.agentByRunAndSource.get(this.agentKey(ctx.runId, ctx.agentId ?? "main"));
    const toolCallIdKey1 = this.toolCallKey(ctx.runId, event.toolCallId, event.toolName);
    const toolCallIdKey2 = this.toolCallKey(ctx.runId, ctx.toolCallId, event.toolName);
    let toolCallId = this.toolCallByRunAndKey.get(toolCallIdKey1) ?? this.toolCallByRunAndKey.get(toolCallIdKey2);

    if (toolCallId) {
      this.store.upsertToolCall({
        id: toolCallId,
        sessionId: ctx.sessionId,
        runId: ctx.runId,
        taskId,
        agentId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        argsText: summarizeToolArgs(event.params),
        status: event.error ? "error" : "done",
        startedAt: now,
        endedAt: now,
        durationMs: event.durationMs,
        error: event.error,
        resultText: summarize(event.result)
      });
    }

    this.store.appendEvent({
      id: randomUUID(),
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      taskId,
      agentId,
      toolCallId,
      kind: event.error ? "warn" : "done",
      label: event.error ? `Tool failed · ${event.toolName}` : `Tool done · ${event.toolName}`,
      detail: event.error ?? (typeof event.result === "string" ? event.result : JSON.stringify(event.result)),
      createdAt: now
    });

    if (event.toolName === "sessions_send" && !event.error && event.result && taskId) {
      try {
        const resultObj = typeof event.result === "string" ? JSON.parse(event.result) : event.result;
        const content = resultObj?.content?.[0];
        const parsed = content?.text ? JSON.parse(content.text) : content;
        if (parsed?.sessionKey) {
          const subagentName = parsed.sessionKey.split(":")[1] ?? "subagent";
          const subagentId = `subagent-${ctx.runId}-${Date.now()}`;
          this.store.upsertAgent({
            id: subagentId,
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            taskId: taskId,
            name: subagentName,
            status: "done",
            startedAt: now,
            endedAt: now,
            depth: 1,
            linkedSessionId: parsed.sessionKey,
            triggeredRunId: parsed.runId
          });
          this.store.appendEvent({
            id: randomUUID(),
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            taskId,
            agentId: subagentId,
            kind: "subagent",
            label: `Subagent · ${subagentName}`,
            detail: parsed.sessionKey,
            createdAt: now
          });
        }
      } catch {
        // ignore parse errors
      }
    }

    const artifact = this.createArtifactFromTool(ctx.sessionId, ctx.runId, event, ctx.agentId ?? "main", toolCallId);
    if (artifact) {
      this.store.appendArtifact(artifact);
      this.store.appendEvent({
        id: randomUUID(),
        sessionId: ctx.sessionId,
        runId: ctx.runId,
        taskId,
        agentId,
        toolCallId,
        kind: "write",
        label: "Artifact written",
        detail: artifact.path,
        createdAt: now
      });
    }
  }

  onCompaction(sessionId: string | undefined, runId: string | undefined, stage: "before" | "after", detail: string): void {
    this.store.appendEvent({
      id: randomUUID(),
      sessionId,
      runId,
      kind: "compaction",
      label: stage === "before" ? "Compaction started" : "Compaction finished",
      detail,
      createdAt: Date.now()
    });
  }

  onLlmInput(event: LlmInputEvent): void {
    const now = Date.now();
    const cleanPrompt = sanitizeIncomingMessage(event.prompt) || event.prompt.trim();
    const title = cleanPrompt;
    if (title === "Agent-to-agent announce step.") {
      return;
    }
    const existingSession = this.store.getSession(event.sessionId);
    const channelId = this.sessionKeyBySessionId.get(event.sessionId)
      ?? existingSession?.channelId
      ?? event.sessionId;
    this.promptBySession.set(event.sessionId, title);
    this.promptByRun.set(event.runId, title);
    this.store.upsertSession({
      id: event.sessionId,
      channelId,
      startedAt: now,
      updatedAt: now,
      status: "running",
      title
    });
    const run = this.store.upsertRun({
      id: event.runId,
      sessionId: event.sessionId,
      userInput: title,
      startedAt: now,
      status: "running"
    });
    const task = this.ensureRootTask(run.id, event.sessionId, title, now);
    const sourceAgentId = this.resolveAgentIdForSession(event.sessionId);
    const agent = this.ensureAgent(run.id, event.sessionId, task.id, sourceAgentId, now, sourceAgentId === "main" ? 0 : 1);
    this.store.appendEvent({
      id: randomUUID(),
      sessionId: event.sessionId,
      runId: event.runId,
      taskId: task.id,
      agentId: agent.id,
      kind: "prompt",
      label: `Prompt · ${event.model}`,
      detail: cleanPrompt,
      createdAt: now
    });
  }

  onLlmOutput(event: LlmOutputEvent): void {
    const text = event.assistantTexts.at(-1)?.trim();
    if (!text) {
      return;
    }

    const existing = this.store.getSessionDetail(event.sessionId);
    const latestRun = existing?.runs.find((run) => run.id === event.runId) ?? existing?.runs.at(-1);
    const taskId = latestRun ? this.rootTaskByRun.get(latestRun.id) : undefined;
    const sourceAgentId = this.resolveAgentIdForSession(event.sessionId);
    const agentId = latestRun ? this.agentByRunAndSource.get(this.agentKey(latestRun.id, sourceAgentId)) : undefined;
    this.store.appendArtifact({
      id: randomUUID(),
      sessionId: event.sessionId,
      runId: event.runId,
      path: `reply://${event.model}`,
      lifecycle: "referenced",
      purpose: "final-reply",
      sizeBytes: Buffer.byteLength(text, "utf8"),
      createdAt: Date.now(),
      agentName: "assistant"
    });
    this.store.appendEvent({
      id: randomUUID(),
      sessionId: event.sessionId,
      runId: latestRun?.id ?? event.runId,
      taskId,
      agentId,
      kind: "out",
      label: "Final response",
      detail: text,
      createdAt: Date.now()
    });
  }

  onSubagentSpawned(event: SubagentSpawnedEvent, ctx: SubagentContext): void {
    const runId = event.runId ?? ctx.runId;
    const sessionId = ctx.requesterSessionKey;
    if (!runId || !sessionId) {
      return;
    }

    const task = this.store.createTaskForRun(runId, sessionId, event.label ?? event.agentId);
    const agent = this.store.upsertAgent({
      id: randomUUID(),
      sessionId,
      runId,
      taskId: task.id,
      sourceAgentId: event.agentId,
      name: event.agentId,
      status: "active",
      startedAt: Date.now(),
      depth: 1
    });
    this.subagentByChildSession.set(event.childSessionKey, agent.id);
    this.subagentNameByChildSession.set(event.childSessionKey, event.agentId);
    this.subagentParentRefByChildSession.set(event.childSessionKey, {
      agentId: agent.id,
      sessionId,
      runId,
      taskId: task.id,
      name: event.agentId,
      startedAt: agent.startedAt,
      depth: 1
    });
    this.store.appendEvent({
      id: randomUUID(),
      sessionId,
      runId,
      taskId: task.id,
      agentId: agent.id,
      kind: "subagent",
      label: `Sub-agent · ${event.agentId}`,
      detail: event.label ?? event.childSessionKey,
      createdAt: Date.now()
    });
  }

  onSubagentEnded(event: SubagentEndedEvent, ctx: SubagentContext): void {
    const runId = event.runId ?? ctx.runId;
    const sessionId = ctx.requesterSessionKey;
    if (!runId || !sessionId) {
      return;
    }

    const agentId = this.subagentByChildSession.get(event.targetSessionKey);
    if (agentId) {
      const taskId = this.findTaskIdForAgent(runId, sessionId, agentId);
      this.store.upsertAgent({
        id: agentId,
        sessionId,
        runId,
        taskId,
        name: this.subagentNameByChildSession.get(event.targetSessionKey) ?? agentId,
        status: event.outcome === "ok" ? "done" : event.outcome === "killed" ? "killed" : "error",
        startedAt: event.endedAt ?? Date.now(),
        endedAt: event.endedAt ?? Date.now(),
        depth: 1
      });
    }

    this.store.appendEvent({
      id: randomUUID(),
      sessionId,
      runId,
      agentId,
      kind: event.outcome === "ok" ? "done" : "warn",
      label: `Sub-agent ended · ${event.targetKind}`,
      detail: event.error ?? event.reason,
      createdAt: event.endedAt ?? Date.now()
    });
  }

  onAgentEnd(sessionId: string | undefined, channelId: string | undefined, success: boolean): void {
    if (!sessionId) {
      return;
    }

    const now = Date.now();
    const title = this.promptBySession.get(sessionId) ?? "OpenClaw session";
    const detail = this.store.getSessionDetail(sessionId);
    const latestRun = detail?.runs.at(-1);
      if (latestRun) {
        this.store.upsertRun({
          ...latestRun,
          status: success ? "done" : "error",
          endedAt: now
        });

      const rootTaskId = this.rootTaskByRun.get(latestRun.id);
      if (rootTaskId) {
        const rootTask = detail?.runViews
          .find((runView) => runView.run.id === latestRun.id)
          ?.tasks.find((taskNode) => taskNode.task.id === rootTaskId)?.task;
        if (rootTask) {
          this.store.upsertTask({
            ...rootTask,
            status: success ? "completed" : "error",
            endedAt: now,
            durationMs: now - rootTask.startedAt
          });
        }
      }

      const latestRunView = detail?.runViews.find((runView) => runView.run.id === latestRun.id);
      for (const taskNode of latestRunView?.tasks ?? []) {
        this.store.upsertTask({
          ...taskNode.task,
          status: success ? "completed" : "error",
          endedAt: now,
          durationMs: now - taskNode.task.startedAt
        });
        for (const bundle of taskNode.agents) {
          this.store.upsertAgent({
            ...bundle.agent,
            status: success ? "done" : "error",
            endedAt: now
          });
          for (const toolCall of bundle.toolCalls) {
            if (toolCall.status === "running") {
              this.store.upsertToolCall({
                ...toolCall,
                status: success ? "done" : "error",
                endedAt: now,
                durationMs: toolCall.durationMs ?? now - toolCall.startedAt
              });
            }
          }
        }
      }
    }

    this.store.upsertSession({
      id: sessionId,
      channelId: channelId ?? sessionId,
      startedAt: now,
      updatedAt: now,
      status: success ? "completed" : "abandoned",
      title
    });
  }

  requestControl(sessionId: string, runId: string | undefined, kind: ControlActionKind, payload?: string): ControlActionRecord {
    return this.store.appendControlAction({
      id: randomUUID(),
      sessionId,
      runId,
      kind,
      status: "requested",
      payload,
      createdAt: Date.now()
    });
  }

  private ensureRootTask(runId: string, sessionId: string, label: string, now: number) {
    const existingId = this.rootTaskByRun.get(runId);
    if (existingId) {
      return this.store.upsertTask({
        id: existingId,
        sessionId,
        runId,
        label,
        status: "running",
        startedAt: now,
        sortOrder: 1
      });
    }

    const existingTask = this.store.getSessionDetail(sessionId)?.runViews
      .find((runView) => runView.run.id === runId)
      ?.tasks.find((taskNode) => !taskNode.task.parentTaskId)?.task;
    if (existingTask) {
      this.rootTaskByRun.set(runId, existingTask.id);
      return this.store.upsertTask({
        ...existingTask,
        label,
        status: existingTask.status === "completed" || existingTask.status === "error" ? existingTask.status : "running",
        startedAt: existingTask.startedAt,
        endedAt: existingTask.endedAt,
        durationMs: existingTask.durationMs,
        sortOrder: existingTask.sortOrder
      });
    }

    const task = this.store.upsertTask({
      id: randomUUID(),
      sessionId,
      runId,
      label,
      status: "running",
      startedAt: now,
      sortOrder: 1
    });
    this.rootTaskByRun.set(runId, task.id);
    return task;
  }

  private ensureAgent(runId: string, sessionId: string, taskId: string, sourceAgentId: string, now: number, depth: number) {
    const key = this.agentKey(runId, sourceAgentId);
    const existing = this.agentByRunAndSource.get(key);
    if (existing) {
      return this.store.upsertAgent({
        id: existing,
        sessionId,
        runId,
        taskId,
        sourceAgentId,
        name: sourceAgentId,
        status: "active",
        startedAt: now,
        depth
      });
    }

    const existingAgent = this.store.getSessionDetail(sessionId)?.runViews
      .find((runView) => runView.run.id === runId)
      ?.tasks.flatMap((taskNode) => taskNode.agents)
      .map((bundle) => bundle.agent)
      .find((agent) => (agent.sourceAgentId ?? agent.name) === sourceAgentId);
    if (existingAgent) {
      this.agentByRunAndSource.set(key, existingAgent.id);
      return this.store.upsertAgent({
        ...existingAgent,
        taskId,
        sourceAgentId,
        name: existingAgent.name,
        status: existingAgent.status === "done" || existingAgent.status === "error" ? existingAgent.status : "active",
        startedAt: existingAgent.startedAt,
        endedAt: existingAgent.endedAt,
        depth: existingAgent.depth
      });
    }

    const agent = this.store.upsertAgent({
      id: randomUUID(),
      sessionId,
      runId,
      taskId,
      sourceAgentId,
      name: sourceAgentId,
      status: "active",
      startedAt: now,
      depth
    });
    this.agentByRunAndSource.set(key, agent.id);
    return agent;
  }

  private ensureToolCallId(runId: string, toolCallId: string | undefined, toolName: string): string {
    const key = this.toolCallKey(runId, toolCallId, toolName);
    const existing = this.toolCallByRunAndKey.get(key);
    if (existing) {
      return existing;
    }
    const id = randomUUID();
    this.toolCallByRunAndKey.set(key, id);
    return id;
  }

  private toolCallKey(runId: string, toolCallId: string | undefined, toolName: string): string {
    return `${runId}:${toolCallId ?? toolName}`;
  }

  private agentKey(runId: string, agentId: string): string {
    return `${runId}:${agentId}`;
  }

  private resolveAgentIdForSession(sessionId: string): string {
    const cached = this.agentIdBySessionId.get(sessionId);
    if (cached) {
      return cached;
    }
    const sessionKey = this.sessionKeyBySessionId.get(sessionId);
    if (sessionKey) {
      return resolveAgentIdFromSessionKey(sessionKey);
    }
    const session = this.store.getSession(sessionId);
    return resolveAgentIdFromSessionKey(session?.channelId);
  }

  private findTaskIdForAgent(runId: string, sessionId: string, agentId: string): string {
    const detail = this.store.getSessionDetail(sessionId);
    const runView = detail?.runViews.find((item) => item.run.id === runId);
    const match = runView?.tasks.find((task) => task.agents.some((agent) => agent.agent.id === agentId));
    return match?.task.id ?? this.rootTaskByRun.get(runId) ?? this.store.createTaskForRun(runId, sessionId, "Run").id;
  }

  private createArtifactFromTool(
    sessionId: string,
    runId: string,
    event: AfterToolEvent,
    agentName: string,
    toolCallId?: string
  ): ArtifactRecord | undefined {
    if (!["write", "apply_patch"].includes(event.toolName)) {
      return undefined;
    }

    const pathValue = extractPath(event.params);
    if (!pathValue) {
      return undefined;
    }

    const content = typeof event.params.content === "string" ? event.params.content : "";
    return {
      id: randomUUID(),
      sessionId,
      runId,
      toolCallId,
      agentName,
      path: pathValue,
      lifecycle: classifyArtifactLifecycle(pathValue),
      sizeBytes: Buffer.byteLength(content, "utf8"),
      createdAt: Date.now()
    };
  }
}

function extractPath(params: Record<string, unknown>): string | undefined {
  const direct = [params.filePath, params.path, params.filename];
  for (const value of direct) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function summarize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeToolArgs(value: unknown): string {
  if (!isRecord(value)) {
    return summarize(value);
  }

  const pathValue = firstString(value.filePath, value.path, value.filename);
  if (pathValue) {
    return pathValue;
  }

  const query = firstString(value.query, value.pattern, value.command);
  if (query) {
    return query.length > 120 ? `${query.slice(0, 117)}...` : query;
  }

  return summarize(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeIncomingMessage(value: string): string {
  const trimmed = value.trim();
  const lines = trimmed.split("\n");
  let insideMetadataBlock = false;
  const filtered = lines.flatMap((line) => {
    const text = line.trim();
    if (!text) {
      return [];
    }
    if (text.startsWith("Sender (untrusted metadata):")) {
      return [];
    }
    if (text.startsWith("```json")) {
      insideMetadataBlock = true;
      return [];
    }
    if (insideMetadataBlock) {
      if (text === "```") {
        insideMetadataBlock = false;
      }
      return [];
    }
    const withoutTimestamp = text.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (!withoutTimestamp) {
      return [];
    }
    return [withoutTimestamp];
  });
  return filtered.join("\n").trim();
}

function resolveAgentIdFromSessionKey(sessionKey: string | undefined): string {
  if (!sessionKey) {
    return "main";
  }

  const match = /^agent:([^:]+):/u.exec(sessionKey);
  return match?.[1] ?? "main";
}

export const __internal = {
  sanitizeIncomingMessage,
  resolveAgentIdFromSessionKey
};
