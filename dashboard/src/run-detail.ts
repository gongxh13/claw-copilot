import type { RunView } from "./types";

export function resolveSelectedRunId(runViews: RunView[], selectedRunId?: string): string {
  if (selectedRunId && runViews.some((runView) => runView.run.id === selectedRunId)) {
    return selectedRunId;
  }

  return runViews.at(-1)?.run.id ?? "";
}

export function summarizeRunView(runView: RunView): {
  taskCount: number;
  agentCount: number;
  toolCount: number;
  artifactCount: number;
} {
  const taskCount = runView.tasks.length;
  const agentCount = runView.tasks.reduce((count, taskNode) => count + taskNode.agents.length, 0);
  const toolCount = runView.tasks.reduce(
    (count, taskNode) => count + taskNode.agents.reduce((agentCountValue, agentNode) => agentCountValue + agentNode.toolCalls.length, 0),
    0
  );

  return {
    taskCount,
    agentCount,
    toolCount,
    artifactCount: runView.artifacts.length
  };
}
