import type { RunView, ToolCallRecord } from "./types";
import { buildToolDetailSections, type ToolDetailSections } from "./tool-result";

export type EventRow = {
  id: string;
  createdAt: number;
  kind: string;
  label: string;
  detail: string;
  expandable?: boolean;
  rowStatus?: string;
  toolDetail?: ToolDetailSections;
  targetSessionId?: string;
  targetRunId?: string;
};

export function buildEventRows(runView: RunView): EventRow[] {
  const toolMap = new Map<string, ToolCallRecord>();
  for (const task of runView.tasks) {
    for (const agent of task.agents) {
      for (const toolCall of agent.toolCalls) {
        toolMap.set(toolCall.id, toolCall);
      }
    }
  }

  const rows: EventRow[] = [];
  const hasPromptEvent = runView.events.some((event) => event.kind === "prompt");

  if (!hasPromptEvent && runView.run.userInput) {
    rows.push({
      id: `fallback-prompt-${runView.run.id}`,
      createdAt: runView.run.startedAt,
      kind: "prompt",
      label: "User input",
      detail: runView.run.userInput,
      rowStatus: "done"
    });
  }

  const seenToolIds = new Set<string>();
  for (const event of runView.events) {
    if (event.toolCallId) {
      const tool = toolMap.get(event.toolCallId);
      if (tool && !seenToolIds.has(tool.id)) {
        seenToolIds.add(tool.id);
        const fullDetail = [tool.argsText, tool.error ?? tool.resultText].filter(Boolean).join("\n\n");
        rows.push({
          id: `tool-${tool.id}`,
          createdAt: tool.endedAt ?? tool.startedAt,
          kind: tool.status === "error" ? "warn" : "tool",
          label: `${tool.toolName} · ${tool.status === "error" ? "failed" : tool.status === "done" ? "completed" : "running"}`,
          detail: fullDetail,
          expandable: Boolean(fullDetail),
          rowStatus: toolStatusClass(tool.status),
          toolDetail: buildToolDetailSections(tool.argsText, tool.resultText, tool.error)
        });
        continue;
      }
    }
    if ((event.kind === "done" || event.kind === "warn") && event.toolCallId) {
      continue;
    }
    rows.push({
      id: event.id,
      createdAt: event.createdAt,
      kind: event.kind,
      label: modelEventLabel(event.kind, event.label),
      detail: event.detail,
      rowStatus: eventRowStatus(event.kind),
      targetSessionId: event.targetSessionId,
      targetRunId: event.targetRunId
    });
  }
  return rows.sort((left, right) => left.createdAt - right.createdAt);
}

function modelEventLabel(kind: string, label: string): string {
  if (kind === "prompt") {
    return label.replace(/^Prompt\s*·\s*/u, "Model prompt · ");
  }
  if (kind === "out") {
    return label === "Final response" ? "Model reply" : label;
  }
  return label;
}

function eventRowStatus(kind: string): string | undefined {
  if (kind === "prompt") return "done";
  if (kind === "out") return "model-output";
  if (kind.includes("warn")) return "error";
  if (kind.includes("done")) return "done";
  return undefined;
}

function toolStatusClass(status: string): string {
  if (status === "error" || status === "blocked") return "error";
  if (status === "done") return "done";
  return "running";
}
