import type { ToolCallRecord } from "./types";
import { buildToolDetailSections, type ToolDetailSections } from "./tool-result";

export type AgentStep = {
  id: string;
  kind: "prompt" | "tool" | "out";
  label: string;
  detail: string;
  createdAt: number;
  status: string;
  toolDetail?: ToolDetailSections;
};

export function buildAgentSteps(toolCalls: ToolCallRecord[], linkedAgentNames: Set<string>): AgentStep[] {
  const filteredCalls = toolCalls.filter(tc => {
    if (tc.toolName !== "sessions_send") return true;
    const match = tc.argsText?.match(/"sessionKey"\s*:\s*"agent:(\w+):/);
    const agentName = match?.[1];
    return !agentName || !linkedAgentNames.has(agentName);
  });
  const toolSteps = filteredCalls.map((toolCall) => ({
    id: toolCall.id,
    kind: "tool" as const,
    label: toolCall.toolName,
    detail: [toolCall.argsText, toolCall.error ?? toolCall.resultText].filter(Boolean).join("\n\n"),
    createdAt: toolCall.startedAt,
    status: toolCall.status,
    toolDetail: buildToolDetailSections(toolCall.argsText, toolCall.resultText, toolCall.error)
  }));

  return toolSteps.sort((left, right) => left.createdAt - right.createdAt);
}
