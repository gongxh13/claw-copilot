import type { AgentRecord, EventRecord, RunRecord, SessionListItem, TaskRecord } from "./types";

export function getSessionPrimaryText(session: SessionListItem): string {
  const title = session.title.trim();
  if (title) {
    return title;
  }

  const parsed = parseSessionKey(session.channelId);
  if (parsed.subject) {
    return parsed.subject;
  }

  return shortId(session.id);
}

export function getSessionSecondaryText(session: SessionListItem): string {
  return parseSessionKey(session.channelId).description;
}

export function getSessionKindLabel(session: SessionListItem): string {
  const parsed = parseSessionKey(session.channelId);
  return `${parsed.agentLabel} / ${parsed.kindLabel}`;
}

export function getAgentDisplayName(agent: Pick<AgentRecord, "name">): string {
  return humanizeToken(agent.name);
}

export function getSessionAgentName(session: Pick<SessionListItem, "channelId">): string | undefined {
  return parseSessionKey(session.channelId).agentId;
}

export function isSessionRunning(session: SessionListItem): boolean {
  return session.runningRunCount > 0 || session.status === "running" || session.status === "active";
}

export function isRunRunning(run: RunRecord): boolean {
  return run.status === "running";
}

export function isTaskRunning(task: TaskRecord): boolean {
  return task.status === "running";
}

export function isAgentRunning(agent: AgentRecord): boolean {
  return agent.status === "active";
}

export function isEventRunning(status: string | undefined, _kind: EventRecord["kind"]): boolean {
  return status === "running";
}

function parseSessionKey(sessionKey: string): {
  agentId?: string;
  agentLabel: string;
  kindLabel: string;
  description: string;
  subject?: string;
} {
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts[1]) {
    const agentId = parts[1];
    const scope = parts[2] ?? "main";
    const agentLabel = humanizeToken(agentId);

    if (scope === "cron") {
      return {
        agentId,
        agentLabel,
        kindLabel: "cron",
        description: "Scheduled automation"
      };
    }

    if (scope === "subagent") {
      return {
        agentId,
        agentLabel,
        kindLabel: "subagent",
        description: "Delegated work session"
      };
    }

    if (scope.startsWith("tui-")) {
      return {
        agentId,
        agentLabel,
        kindLabel: "tui",
        description: "Interactive terminal session"
      };
    }

    if (scope === "feishu" && parts[3] === "direct") {
      return {
        agentId,
        agentLabel,
        kindLabel: "feishu dm",
        description: "Direct conversation"
      };
    }

      return {
        agentId,
        agentLabel,
        kindLabel: "main",
        description: "Main agent session"
      };
  }

  return {
    agentLabel: "Unknown",
    kindLabel: "Session",
    description: "Unclassified session"
  };
}

function humanizeToken(value: string): string {
  if (!value) {
    return "Unknown";
  }

  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}
