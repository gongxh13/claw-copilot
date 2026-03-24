export type SessionStatus = "active" | "completed" | "abandoned" | "running" | "done" | "aborted";
export type RunStatus = "running" | "completed" | "aborted" | "error" | "done" | "paused" | "redirected";
export type TaskStatus = "running" | "completed" | "aborted" | "error" | "pending";
export type AgentStatus = "active" | "done" | "idle" | "error" | "killed";
export type ToolCallStatus = "running" | "done" | "error" | "blocked";
export type ArtifactLifecycle = "permanent" | "referenced" | "temporary";
export type ControlActionKind = "stop" | "pause" | "redirect";
export type ControlActionStatus = "requested" | "accepted" | "rejected" | "completed";

export type SessionRecord = {
  id: string;
  channelId: string;
  startedAt: number;
  status: SessionStatus;
  title: string;
  updatedAt?: number;
};

export type SessionListItem = SessionRecord & {
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
  status: RunStatus;
};

export type TaskRecord = {
  id: string;
  sessionId: string;
  runId: string;
  parentTaskId?: string;
  label: string;
  status: TaskStatus;
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
  status: AgentStatus;
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
  status: ToolCallStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
  resultText?: string;
};

export type ArtifactRecord = {
  id: string;
  sessionId: string;
  runId: string;
  toolCallId?: string;
  agentName?: string;
  path: string;
  lifecycle: ArtifactLifecycle;
  purpose?: string;
  sizeBytes: number;
  createdAt: number;
  referencedBy?: string[];
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

export type ControlActionRecord = {
  id: string;
  sessionId: string;
  runId?: string;
  kind: ControlActionKind;
  status: ControlActionStatus;
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
  session: SessionRecord;
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

export type TailscaleLoginState = "not-installed" | "needs-login" | "logged-in" | "error";

export type TailscaleStatus = {
  status: "not-installed" | "needs-login" | "connected" | "error";
  loginState: TailscaleLoginState;
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
