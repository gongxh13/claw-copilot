import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

import type {
  AgentRecord,
  ArtifactRecord,
  ControlActionRecord,
  SessionPagination,
  EventRecord,
  RunRecord,
  RunView,
  SessionDetail,
  SessionListItem,
  SessionRecord,
  TaskRecord,
  ToolCallRecord
} from "../core/types.js";
import { openDatabase } from "./database.js";

export class CopilotStore {
  private readonly db: Database.Database;
  private readonly filePath: string;

  constructor(private readonly rootDir: string) {
    this.filePath = path.join(rootDir, "crew-copilot.db");
    this.db = openDatabase(rootDir);
  }

  reset(): void {
    this.db.close();
    rmSync(this.filePath, { force: true });
  }

  upsertSession(session: SessionRecord): SessionRecord {
    this.db.prepare(
      `INSERT INTO sessions (id, channel_id, started_at, updated_at, status, title)
       VALUES (@id, @channelId, @startedAt, @updatedAt, @status, @title)
       ON CONFLICT(id) DO UPDATE SET
         channel_id = excluded.channel_id,
         started_at = MIN(sessions.started_at, excluded.started_at),
         updated_at = excluded.updated_at,
         status = excluded.status,
         title = excluded.title`
    ).run({
      ...session,
      updatedAt: session.updatedAt ?? Date.now()
    });
    return this.getSession(session.id)!;
  }

  upsertRun(run: RunRecord): RunRecord {
    const existing = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(run.id) as SqlRun | undefined;
    const runNumber = existing?.run_number ?? this.nextRunNumber(run.sessionId);
    this.db.prepare(
      `INSERT INTO runs (id, session_id, run_number, user_input, started_at, ended_at, status)
       VALUES (@id, @sessionId, @runNumber, @userInput, @startedAt, @endedAt, @status)
       ON CONFLICT(id) DO UPDATE SET
         session_id = excluded.session_id,
         user_input = excluded.user_input,
         started_at = MIN(runs.started_at, excluded.started_at),
         ended_at = COALESCE(excluded.ended_at, runs.ended_at),
         status = excluded.status`
    ).run({
      ...run,
      runNumber,
      endedAt: run.endedAt ?? null
    });
    return this.getRun(run.id)!;
  }

  markStaleRunsAsInterrupted(thresholdMs: number): number {
    const now = Date.now();
    const result = this.db.prepare(
      `UPDATE runs SET status = 'interrupted', ended_at = ended_at
       WHERE status = 'running' AND started_at < ?`
    ).run(now - thresholdMs);
    return result.changes;
  }

  upsertTask(task: TaskRecord): TaskRecord {
    this.db.prepare(
      `INSERT INTO tasks (id, session_id, run_id, parent_task_id, label, status, started_at, ended_at, duration_ms, sort_order)
       VALUES (@id, @sessionId, @runId, @parentTaskId, @label, @status, @startedAt, @endedAt, @durationMs, @sortOrder)
       ON CONFLICT(id) DO UPDATE SET
         parent_task_id = excluded.parent_task_id,
         label = excluded.label,
         status = excluded.status,
         ended_at = COALESCE(excluded.ended_at, tasks.ended_at),
         duration_ms = COALESCE(excluded.duration_ms, tasks.duration_ms),
         sort_order = excluded.sort_order`
    ).run({
      ...task,
      parentTaskId: task.parentTaskId ?? null,
      endedAt: task.endedAt ?? null,
      durationMs: task.durationMs ?? null
    });
    return this.getTask(task.id)!;
  }

  upsertAgent(agent: AgentRecord): AgentRecord {
    this.db.prepare(
      `INSERT INTO agents (id, session_id, run_id, task_id, source_agent_id, linked_session_id, triggered_run_id, name, status, started_at, ended_at, depth)
       VALUES (@id, @sessionId, @runId, @taskId, @sourceAgentId, @linkedSessionId, @triggeredRunId, @name, @status, @startedAt, @endedAt, @depth)
       ON CONFLICT(id) DO UPDATE SET
          task_id = excluded.task_id,
          source_agent_id = excluded.source_agent_id,
          linked_session_id = COALESCE(excluded.linked_session_id, agents.linked_session_id),
          triggered_run_id = COALESCE(excluded.triggered_run_id, agents.triggered_run_id),
          name = excluded.name,
          status = excluded.status,
          ended_at = COALESCE(excluded.ended_at, agents.ended_at),
          depth = excluded.depth`
    ).run({
      ...agent,
      sourceAgentId: agent.sourceAgentId ?? null,
      linkedSessionId: agent.linkedSessionId ?? null,
      triggeredRunId: agent.triggeredRunId ?? null,
      endedAt: agent.endedAt ?? null
    });
    return this.getAgent(agent.id)!;
  }

  upsertToolCall(toolCall: ToolCallRecord): ToolCallRecord {
    this.db.prepare(
      `INSERT INTO tool_calls (id, session_id, run_id, task_id, agent_id, tool_call_id, tool_name, args_text, status, started_at, ended_at, duration_ms, error, result_text)
       VALUES (@id, @sessionId, @runId, @taskId, @agentId, @toolCallId, @toolName, @argsText, @status, @startedAt, @endedAt, @durationMs, @error, @resultText)
       ON CONFLICT(id) DO UPDATE SET
         task_id = excluded.task_id,
         agent_id = excluded.agent_id,
         tool_call_id = excluded.tool_call_id,
         tool_name = excluded.tool_name,
         args_text = excluded.args_text,
         status = excluded.status,
         ended_at = COALESCE(excluded.ended_at, tool_calls.ended_at),
         duration_ms = COALESCE(excluded.duration_ms, tool_calls.duration_ms),
         error = COALESCE(excluded.error, tool_calls.error),
         result_text = COALESCE(excluded.result_text, tool_calls.result_text)`
    ).run({
      ...toolCall,
      taskId: toolCall.taskId ?? null,
      agentId: toolCall.agentId ?? null,
      toolCallId: toolCall.toolCallId ?? null,
      endedAt: toolCall.endedAt ?? null,
      durationMs: toolCall.durationMs ?? null,
      error: toolCall.error ?? null,
      resultText: toolCall.resultText ?? null
    });
    return this.getToolCall(toolCall.id)!;
  }

  appendArtifact(artifact: ArtifactRecord): ArtifactRecord {
    this.db.prepare(
      `INSERT OR REPLACE INTO artifacts (id, session_id, run_id, tool_call_id, agent_name, path, lifecycle, purpose, size_bytes, created_at, referenced_by_json)
       VALUES (@id, @sessionId, @runId, @toolCallId, @agentName, @path, @lifecycle, @purpose, @sizeBytes, @createdAt, @referencedByJson)`
    ).run({
      ...artifact,
      toolCallId: artifact.toolCallId ?? null,
      agentName: artifact.agentName ?? null,
      purpose: artifact.purpose ?? null,
      referencedByJson: JSON.stringify(artifact.referencedBy ?? [])
    });
    return artifact;
  }

  appendEvent(event: EventRecord): EventRecord {
    this.db.prepare(
      `INSERT INTO events (id, session_id, run_id, task_id, agent_id, tool_call_id, kind, label, detail, created_at)
       VALUES (@id, @sessionId, @runId, @taskId, @agentId, @toolCallId, @kind, @label, @detail, @createdAt)`
    ).run({
      ...event,
      sessionId: event.sessionId ?? null,
      runId: event.runId ?? null,
      taskId: event.taskId ?? null,
      agentId: event.agentId ?? null,
      toolCallId: event.toolCallId ?? null
    });
    return event;
  }

  appendControlAction(control: ControlActionRecord): ControlActionRecord {
    this.db.prepare(
      `INSERT INTO control_actions (id, session_id, run_id, kind, status, payload, created_at)
       VALUES (@id, @sessionId, @runId, @kind, @status, @payload, @createdAt)`
    ).run({
      ...control,
      runId: control.runId ?? null,
      payload: control.payload ?? null
    });
    return control;
  }

  listSessions(): SessionListItem[] {
    const rows = this.db.prepare(
      `SELECT s.id, s.channel_id, s.started_at, s.updated_at, s.status, s.title,
              COUNT(r.id) AS run_count,
              SUM(CASE WHEN r.status = 'running' THEN 1 ELSE 0 END) AS running_run_count
       FROM sessions s
       LEFT JOIN runs r ON r.session_id = s.id
       GROUP BY s.id
       ORDER BY s.updated_at DESC`
    ).all() as Array<SqlSession & { run_count: number; running_run_count: number | null }>;
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      status: row.status,
      title: row.title,
      runCount: Number(row.run_count ?? 0),
      runningRunCount: Number(row.running_run_count ?? 0)
    }));
  }

  listSessionsPage(page: number, pageSize: number): { sessions: SessionListItem[]; pagination: SessionPagination } {
    const totalCountRow = this.db.prepare(`SELECT COUNT(*) AS count FROM sessions`).get() as { count: number };
    const totalCount = Number(totalCountRow.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const offset = (safePage - 1) * pageSize;
    const rows = this.db.prepare(
      `SELECT s.id, s.channel_id, s.started_at, s.updated_at, s.status, s.title,
              COUNT(r.id) AS run_count,
              SUM(CASE WHEN r.status = 'running' THEN 1 ELSE 0 END) AS running_run_count
       FROM sessions s
       LEFT JOIN runs r ON r.session_id = s.id
       GROUP BY s.id
       ORDER BY s.updated_at DESC
       LIMIT ? OFFSET ?`
    ).all(pageSize, offset) as Array<SqlSession & { run_count: number; running_run_count: number | null }>;

    return {
      sessions: rows.map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        status: row.status,
        title: row.title,
        runCount: Number(row.run_count ?? 0),
        runningRunCount: Number(row.running_run_count ?? 0)
      })),
      pagination: {
        page: safePage,
        pageSize,
        totalCount,
        totalPages
      }
    };
  }

  findSessionPage(sessionId: string, pageSize: number): number {
    const ids = this.db.prepare(`SELECT id FROM sessions ORDER BY updated_at DESC`).all() as Array<{ id: string }>;
    const index = ids.findIndex((row) => row.id === sessionId);
    return index === -1 ? 1 : Math.floor(index / pageSize) + 1;
  }

  getSessionDetail(sessionId: string): SessionDetail | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    const runs = this.db.prepare(`SELECT * FROM runs WHERE session_id = ? ORDER BY run_number ASC`).all(sessionId) as SqlRun[];
    const filteredRuns = runs.filter((run) => run.user_input !== "Agent-to-agent announce step.");
    const allSessions = this.db.prepare(`SELECT id, channel_id FROM sessions`).all() as Array<{ id: string; channel_id: string }>;
    const sessionIdByRouteKey = new Map<string, string>();
    for (const row of allSessions) {
      sessionIdByRouteKey.set(row.id, row.id);
      sessionIdByRouteKey.set(row.channel_id, row.id);
    }
    const tasks = this.db.prepare(`SELECT * FROM tasks WHERE session_id = ? ORDER BY run_id ASC, sort_order ASC, started_at ASC`).all(sessionId) as SqlTask[];
    const agents = this.db.prepare(`SELECT * FROM agents WHERE session_id = ? ORDER BY run_id ASC, started_at ASC`).all(sessionId) as SqlAgent[];
    const toolCalls = this.db.prepare(`SELECT * FROM tool_calls WHERE session_id = ? ORDER BY run_id ASC, started_at ASC`).all(sessionId) as SqlToolCall[];
    const events = this.db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId) as SqlEvent[];
    const artifacts = this.db.prepare(`SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId) as SqlArtifact[];
    const controls = this.db.prepare(`SELECT * FROM control_actions WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId) as SqlControl[];

    const runViews: RunView[] = filteredRuns.map((runRow) => {
      const run = this.mapRun(runRow);
      const runTasks = tasks.filter((task) => task.run_id === run.id).map((task) => this.mapTask(task));
      const runAgents = agents.filter((agent) => agent.run_id === run.id).map((agent) => this.mapAgent(agent));
      const runToolCalls = toolCalls.filter((call) => call.run_id === run.id).map((call) => this.mapToolCall(call));
      const runEvents = events.filter((event) => event.run_id === run.id);
      const subagentKeys = new Set(
        runEvents
          .filter((event) => event.kind === "subagent")
          .map((event) => event.detail)
          .filter(Boolean)
      );
      const hiddenToolEventIds = new Set(
        runEvents
          .filter((event) => {
            if (event.label !== "Tool · sessions_send" && event.label !== "Tool done · sessions_send") {
              return false;
            }
            const tool = event.tool_call_id ? runToolCalls.find((call) => call.id === event.tool_call_id) : undefined;
            const sessionKey = extractJsonField(event.detail, "sessionKey")
              ?? extractJsonField(tool?.resultText, "sessionKey")
              ?? extractJsonField(tool?.argsText, "sessionKey");
            return Boolean(sessionKey && subagentKeys.has(sessionKey));
          })
          .map((event) => event.id)
      );
      const tree = runTasks.map((task) => ({
        task,
        agents: runAgents
          .filter((agent) => agent.taskId === task.id)
          .map((agent) => ({
            agent,
            toolCalls: runToolCalls.filter((call) => call.agentId === agent.id || (!call.agentId && call.taskId === task.id))
          }))
      }));

      return {
        run,
        tasks: tree,
        events: runEvents
          .filter((event) => !hiddenToolEventIds.has(event.id))
          .map((event) => this.mapEvent(event, buildEventTarget(event, runAgents, sessionIdByRouteKey))),
        artifacts: artifacts.filter((artifact) => artifact.run_id === run.id).map((artifact) => this.mapArtifact(artifact)),
        controls: controls.filter((control) => control.run_id === run.id || (!control.run_id && run.id === filteredRuns[filteredRuns.length - 1]?.id)).map((control) => this.mapControl(control))
      };
    });

    return {
      session,
      runs: runViews.map((item) => item.run),
      runViews
    };
  }

  createTaskForRun(runId: string, sessionId: string, label: string): TaskRecord {
    const count = this.db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE run_id = ?`).get(runId) as { count: number };
    return this.upsertTask({
      id: randomUUID(),
      sessionId,
      runId,
      label,
      status: "running",
      startedAt: Date.now(),
      sortOrder: Number(count.count) + 1
    });
  }

  private nextRunNumber(sessionId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(run_number), 0) AS max_run FROM runs WHERE session_id = ?`).get(sessionId) as { max_run: number };
    return Number(row.max_run) + 1;
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SqlSession | undefined;
    return row ? this.mapSession(row) : undefined;
  }

  private getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as SqlRun | undefined;
    return row ? this.mapRun(row) : undefined;
  }

  private getTask(id: string): TaskRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as SqlTask | undefined;
    return row ? this.mapTask(row) : undefined;
  }

  private getAgent(id: string): AgentRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as SqlAgent | undefined;
    return row ? this.mapAgent(row) : undefined;
  }

  private getToolCall(id: string): ToolCallRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM tool_calls WHERE id = ?`).get(id) as SqlToolCall | undefined;
    return row ? this.mapToolCall(row) : undefined;
  }

  private mapSession(row: SqlSession): SessionRecord {
    return {
      id: row.id,
      channelId: row.channel_id,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      status: row.status,
      title: row.title
    };
  }

  private mapRun(row: SqlRun): RunRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      runNumber: row.run_number,
      userInput: row.user_input,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      status: row.status
    };
  }

  private mapTask(row: SqlTask): TaskRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      runId: row.run_id,
      parentTaskId: row.parent_task_id ?? undefined,
      label: row.label,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      sortOrder: row.sort_order
    };
  }

  private mapAgent(row: SqlAgent): AgentRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      runId: row.run_id,
      taskId: row.task_id,
      sourceAgentId: row.source_agent_id ?? undefined,
      linkedSessionId: row.linked_session_id ?? undefined,
      triggeredRunId: row.triggered_run_id ?? undefined,
      name: row.name,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      depth: row.depth
    };
  }

  private mapToolCall(row: SqlToolCall): ToolCallRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      runId: row.run_id,
      taskId: row.task_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      toolName: row.tool_name,
      argsText: row.args_text,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      error: row.error ?? undefined,
      resultText: row.result_text ?? undefined
    };
  }

  private mapEvent(row: SqlEvent, overrides?: Partial<EventRecord>): EventRecord {
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      runId: row.run_id ?? undefined,
      taskId: row.task_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      kind: row.kind,
      label: row.label,
      detail: row.detail,
      createdAt: row.created_at,
      ...overrides
    };
  }

  private mapArtifact(row: SqlArtifact): ArtifactRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      runId: row.run_id,
      toolCallId: row.tool_call_id ?? undefined,
      agentName: row.agent_name ?? undefined,
      path: row.path,
      lifecycle: row.lifecycle,
      purpose: row.purpose ?? undefined,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      referencedBy: row.referenced_by_json ? JSON.parse(row.referenced_by_json) : []
    };
  }

  private mapControl(row: SqlControl): ControlActionRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      runId: row.run_id ?? undefined,
      kind: row.kind,
      status: row.status,
      payload: row.payload ?? undefined,
      createdAt: row.created_at
    };
  }
}

type SqlSession = {
  id: string;
  channel_id: string;
  started_at: number;
  updated_at: number;
  status: SessionRecord["status"];
  title: string;
};

type SqlRun = {
  id: string;
  session_id: string;
  run_number: number;
  user_input: string;
  started_at: number;
  ended_at: number | null;
  status: RunRecord["status"];
};

type SqlTask = {
  id: string;
  session_id: string;
  run_id: string;
  parent_task_id: string | null;
  label: string;
  status: TaskRecord["status"];
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  sort_order: number;
};

type SqlAgent = {
  id: string;
  session_id: string;
  run_id: string;
  task_id: string;
  source_agent_id: string | null;
  linked_session_id: string | null;
  triggered_run_id: string | null;
  name: string;
  status: AgentRecord["status"];
  started_at: number;
  ended_at: number | null;
  depth: number;
};

type SqlToolCall = {
  id: string;
  session_id: string;
  run_id: string;
  task_id: string | null;
  agent_id: string | null;
  tool_call_id: string | null;
  tool_name: string;
  args_text: string;
  status: ToolCallRecord["status"];
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  error: string | null;
  result_text: string | null;
};

type SqlEvent = {
  id: string;
  session_id: string | null;
  run_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  tool_call_id: string | null;
  kind: string;
  label: string;
  detail: string;
  created_at: number;
};

type SqlArtifact = {
  id: string;
  session_id: string;
  run_id: string;
  tool_call_id: string | null;
  agent_name: string | null;
  path: string;
  lifecycle: ArtifactRecord["lifecycle"];
  purpose: string | null;
  size_bytes: number;
  created_at: number;
  referenced_by_json: string | null;
};

type SqlControl = {
  id: string;
  session_id: string;
  run_id: string | null;
  kind: ControlActionRecord["kind"];
  status: ControlActionRecord["status"];
  payload: string | null;
  created_at: number;
};

function extractJsonField(text: string | undefined, field: string): string | undefined {
  if (!text) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const direct = parsed[field];
    if (typeof direct === "string") {
      return direct;
    }
    const details = parsed.details;
    if (details && typeof details === "object") {
      const nested = (details as Record<string, unknown>)[field];
      if (typeof nested === "string") {
        return nested;
      }
    }
    const content = parsed.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const innerText = (item as Record<string, unknown>).text;
        if (typeof innerText !== "string") {
          continue;
        }
        const nested = extractJsonField(innerText, field);
        if (nested) {
          return nested;
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function buildEventTarget(
  event: SqlEvent,
  runAgents: AgentRecord[],
  sessionIdByRouteKey: Map<string, string>
): Partial<EventRecord> | undefined {
  if (event.kind !== "subagent" || !event.agent_id) {
    return undefined;
  }

  const agent = runAgents.find((item) => item.id === event.agent_id);
  if (!agent) {
    return undefined;
  }

  const targetSessionId = agent.linkedSessionId ? sessionIdByRouteKey.get(agent.linkedSessionId) ?? agent.linkedSessionId : undefined;
  return {
    targetSessionId,
    targetRunId: agent.triggeredRunId
  };
}
