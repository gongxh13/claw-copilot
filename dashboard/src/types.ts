export type SessionListItem = {
  id: string;
  channelId: string;
  startedAt: number;
  updatedAt?: number;
  status: string;
  title: string;
  runCount: number;
  runningRunCount: number;
};

export type RunRecord = {
  id: string;
  sessionId: string;
  runNumber?: number;
  userInput: string;
  startedAt: number;
  endedAt?: number;
  status: string;
};

export type TaskRecord = {
  id: string;
  sessionId: string;
  runId: string;
  parentTaskId?: string;
  label: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  sortOrder: number;
};

export type AgentRecord = {
  id: string;
  sessionId: string;
  runId: string;
  taskId: string;
  sourceAgentId?: string;
  linkedSessionId?: string;
  triggeredRunId?: string;
  name: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  depth: number;
};

export type ToolCallRecord = {
  id: string;
  sessionId: string;
  runId: string;
  taskId?: string;
  agentId?: string;
  toolCallId?: string;
  toolName: string;
  argsText: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
  resultText?: string;
};

export type EventRecord = {
  id: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  agentId?: string;
  toolCallId?: string;
  targetSessionId?: string;
  targetRunId?: string;
  kind: string;
  label: string;
  detail: string;
  createdAt: number;
};

export type ArtifactRecord = {
  id: string;
  sessionId: string;
  runId: string;
  toolCallId?: string;
  agentName?: string;
  path: string;
  lifecycle: string;
  purpose?: string;
  sizeBytes: number;
  createdAt: number;
};

export type ControlActionRecord = {
  id: string;
  sessionId: string;
  runId?: string;
  kind: "stop" | "pause" | "redirect";
  status: string;
  payload?: string;
  createdAt: number;
};

export type TaskTreeNode = {
  task: TaskRecord;
  agents: Array<{
    agent: AgentRecord;
    toolCalls: ToolCallRecord[];
  }>;
};

export type RunView = {
  run: RunRecord;
  tasks: TaskTreeNode[];
  events: EventRecord[];
  artifacts: ArtifactRecord[];
  controls: ControlActionRecord[];
};

export type SessionDetail = {
  session: SessionListItem & { updatedAt?: number };
  runs: RunRecord[];
  runViews: RunView[];
};

export type SessionPagination = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type DashboardPayload = {
  sessions: SessionListItem[];
  sessionPagination: SessionPagination;
  selectedSession?: SessionDetail;
  tailscale?: TailscaleStatus;
};

export type TailscaleStatus = {
  status: "not-installed" | "needs-login" | "connected" | "error";
  loginState: "not-installed" | "needs-login" | "logged-in" | "error";
  installed: boolean;
  canAutoInstall?: boolean;
  hostname?: string;
  dnsName?: string;
  tailnetUrl?: string;
  installUrl?: string;
  installCommand?: string;
  loginUrl?: string;
  serveCommand?: string;
  message: string;
  detail?: string;
};

declare global {
  interface Window {
    __CLAW_COPILOT__?: DashboardPayload;
    __CLAW_COPILOT_BASE_PATH__?: string;
    __CLAW_COPILOT_TITLE__?: string;
  }
}
