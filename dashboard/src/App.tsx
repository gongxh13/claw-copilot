import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { EventDetail } from "./event-detail";
import { buildEventRows } from "./event-stream";
import { applySseEvent, decodeSseEvent } from "./live-updates";
import { normalizeDashboardPayload } from "./payload";
import { resolveSelectedRunId, summarizeRunView } from "./run-detail";
import { buildSessionTooltip } from "./session-list";
import { getAgentDisplayName, getSessionAgentName, getSessionKindLabel, getSessionPrimaryText, getSessionSecondaryText, isAgentRunning, isEventRunning, isSessionRunning, isTaskRunning } from "./session-presenter";
import { buildAgentSteps } from "./task-tree";
import type { ArtifactRecord, DashboardPayload, RunView, SessionDetail, SessionListItem } from "./types";

const emptyPayload = normalizeDashboardPayload({ sessions: [] });
const minSidebarWidth = 240;
const maxSidebarWidth = 520;

type MobileView = "sessions" | "runs" | "detail";
const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

export function App() {
  const initialPayload = normalizeDashboardPayload(window.__CLAW_COPILOT__ ?? emptyPayload);
  const basePath = window.__CLAW_COPILOT_BASE_PATH__ ?? "/claw-copilot";
  const title = window.__CLAW_COPILOT_TITLE__ ?? "Claw Copilot";
  const initialRoute = parseDashboardRoute(window.location.pathname, basePath);
  const [dashboardState, setDashboardState] = useState({
    sessions: initialPayload.sessions,
    sessionPagination: initialPayload.sessionPagination,
    selectedId: initialRoute.sessionId ?? initialPayload.selectedSession?.session.id ?? initialPayload.sessions[0]?.id ?? "",
    detail: initialPayload.selectedSession
  });
  const [mobileView, setMobileView] = useState<MobileView>(deriveMobileView(initialRoute.sessionId, initialRoute.runId));
  const [detailTab, setDetailTab] = useState<"timeline" | "artifacts">("timeline");
  const [overlay, setOverlay] = useState<null | "stop" | "pause" | "redirect">(null);
  const [redirectInput, setRedirectInput] = useState("");
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sessionPopover, setSessionPopover] = useState<{ session: SessionListItem; top: number } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(initialRoute.runId ?? "");
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const sessionPopoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { sessions, sessionPagination, selectedId, detail } = dashboardState;

  const isMobileMode = typeof window !== "undefined" && window.innerWidth <= 768;
  const currentMobileView = isMobileMode ? mobileView : "detail";

  useEffect(() => {
    if (!isResizingSidebar) {
      return;
    }

    const onMove = (event: MouseEvent) => {
      const nextWidth = Math.min(Math.max(event.clientX, minSidebarWidth), maxSidebarWidth);
      setSidebarWidth(nextWidth);
    };
    const onUp = () => setIsResizingSidebar(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const onPopState = () => {
      const route = parseDashboardRoute(window.location.pathname, basePath);
      setDashboardState((current) => ({
        ...current,
        selectedId: route.sessionId ?? current.sessions[0]?.id ?? "",
        detail: route.sessionId && current.detail?.session.id === route.sessionId ? current.detail : undefined
      }));
      setSelectedRunId(route.runId ?? "");
      setMobileView(deriveMobileView(route.sessionId, route.runId));
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [basePath]);

  useEffect(() => {
    let retryCount = 0;
    let source: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }
      source?.close();

      const url = new URL(`${basePath}/api/events`, window.location.origin);
      if (selectedId) {
        url.searchParams.set("sessionId", selectedId);
      }
      url.searchParams.set("page", String(sessionPagination.page));
      url.searchParams.set("pageSize", String(sessionPagination.pageSize));
      source = new EventSource(url.toString());

      source.onopen = () => {
        retryCount = 0;
      };

      source.onerror = () => {
        source?.close();
        if (disposed) {
          return;
        }
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        retryCount = Math.min(retryCount + 1, 5);
        reconnectTimeout = setTimeout(connect, delay);
      };

      const handle = (type: string) => (event: MessageEvent<string>) => {
        retryCount = 0;
        const decoded = decodeSseEvent(type, event.data);
        if (!decoded) {
          return;
        }
        setDashboardState((current) => applySseEvent(current, decoded));
      };

      source.addEventListener("bootstrap", handle("bootstrap") as EventListener);
      source.addEventListener("session-list-updated", handle("session-list-updated") as EventListener);
      source.addEventListener("session-detail-updated", handle("session-detail-updated") as EventListener);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      source?.close();
    };
  }, [basePath, selectedId, sessionPagination.page, sessionPagination.pageSize]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (detail?.session.id === selectedId) {
      return;
    }
    let cancelled = false;
    fetch(`${basePath}/api/sessions/${encodeURIComponent(selectedId)}`)
      .then((response) => response.json())
      .then((data: SessionDetail | { error: string }) => {
        if (!cancelled && !("error" in data)) {
          setDashboardState((current) => ({ ...current, detail: data }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDashboardState((current) => ({ ...current, detail: undefined }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, detail?.session.id, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const url = new URL(`${basePath}/api/sessions`, window.location.origin);
    if (selectedId) {
      url.searchParams.set("sessionId", selectedId);
    }
    url.searchParams.set("page", String(sessionPagination.page));
    url.searchParams.set("pageSize", String(sessionPagination.pageSize));

    fetch(url.toString())
      .then((response) => response.json())
      .then((data: DashboardPayload) => {
        const normalized = normalizeDashboardPayload(data);
        if (!cancelled) {
          setDashboardState((current) => ({
            ...current,
            sessions: normalized.sessions,
            sessionPagination: normalized.sessionPagination
          }));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [basePath, selectedId, sessionPagination.page, sessionPagination.pageSize]);

  useEffect(() => {
    if (!detail) {
      setSelectedRunId("");
      return;
    }
    setSelectedRunId((current: string) => {
      const resolved = resolveSelectedRunId(detail.runViews, current);
      if (resolved !== current) {
        const route = parseDashboardRoute(window.location.pathname, basePath);
        if (route.sessionId === detail.session.id && route.runId) {
          const nextPath = buildDashboardPath(basePath, detail.session.id, resolved || undefined);
          const nextUrl = new URL(window.location.href);
          nextUrl.pathname = nextPath;
          nextUrl.search = "";
          nextUrl.hash = "";
          window.history.replaceState(null, "", nextUrl);
        }
      }
      return resolved;
    });
    setExpandedTasks((current) => {
      const next = { ...current };
      for (const runView of detail.runViews) {
        for (const task of runView.tasks) {
          if (!(task.task.id in next)) {
            next[task.task.id] = true;
          }
        }
      }
      return next;
    });
  }, [detail]);

  const selectedSession = useMemo(() => {
    return detail?.session.id === selectedId ? detail : undefined;
  }, [detail, selectedId]);
  const selectedRunView = useMemo(() => {
    return selectedSession?.runViews.find((runView) => runView.run.id === selectedRunId) ?? selectedSession?.runViews.at(-1);
  }, [selectedRunId, selectedSession]);
  const selectedRunSummary = selectedRunView ? summarizeRunView(selectedRunView) : undefined;
  const runningCount = sessions.filter((session) => session.runningRunCount > 0 || session.status === "running").length;
  const visibleDetail = Boolean(selectedSession) || (isMobileMode && mobileView !== "sessions");
  const hasSessions = sessions.length > 0;

  function navigateToSelection(sessionId: string, runId?: string, historyMode: "push" | "replace" = "push") {
    const nextPath = buildDashboardPath(basePath, sessionId, runId);
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = nextPath;
    nextUrl.search = "";
    nextUrl.hash = "";
    if (historyMode === "replace") {
      window.history.replaceState(null, "", nextUrl);
    } else {
      window.history.pushState(null, "", nextUrl);
    }
    setDashboardState((current) => ({
      ...current,
      selectedId: sessionId,
      detail: current.detail?.session.id === sessionId ? current.detail : undefined
    }));
    setSelectedRunId(runId ?? "");
  }

  function goToMobileRuns(sessionId: string) {
    navigateToSelection(sessionId);
    setMobileView("runs");
  }

  function goToMobileDetail(runId: string) {
    if (selectedSession) {
      navigateToSelection(selectedSession.session.id, runId);
    } else {
      setSelectedRunId(runId);
    }
    setMobileView("detail");
  }

  function goBackMobile() {
    if (mobileView === "detail") {
      if (selectedSession) {
        navigateToSelection(selectedSession.session.id);
      } else {
        setSelectedRunId("");
      }
      setMobileView("runs");
    } else if (mobileView === "runs") {
      const nextUrl = new URL(window.location.href);
      nextUrl.pathname = basePath;
      nextUrl.search = "";
      nextUrl.hash = "";
      window.history.pushState(null, "", nextUrl);
      setMobileView("sessions");
      setDashboardState((current) => ({ ...current, selectedId: "", detail: undefined }));
    }
  }

  function setSessionPage(page: number) {
    setDashboardState((current) => ({
      ...current,
      sessionPagination: {
        ...current.sessionPagination,
        page
      }
    }));
  }

  function showSessionPopover(session: SessionListItem, target: HTMLElement) {
    if (sessionPopoverTimerRef.current) {
      clearTimeout(sessionPopoverTimerRef.current);
      sessionPopoverTimerRef.current = null;
    }
    const sidebarBox = sidebarRef.current?.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const top = sidebarBox ? Math.max(10, targetBox.top - sidebarBox.top) : 10;
    setSessionPopover({ session, top });
  }

  function scheduleSessionPopover(session: SessionListItem, target: HTMLElement) {
    if (sessionPopoverTimerRef.current) {
      clearTimeout(sessionPopoverTimerRef.current);
    }
    sessionPopoverTimerRef.current = setTimeout(() => {
      showSessionPopover(session, target);
      sessionPopoverTimerRef.current = null;
    }, 350);
  }

  function hideSessionPopover(sessionId?: string) {
    if (sessionPopoverTimerRef.current) {
      clearTimeout(sessionPopoverTimerRef.current);
      sessionPopoverTimerRef.current = null;
    }
    setSessionPopover((current) => {
      if (!current) {
        return current;
      }
      if (!sessionId || current.session.id === sessionId) {
        return null;
      }
      return current;
    });
  }

  async function requestControl(kind: "stop" | "pause" | "redirect") {
    if (!selectedSession) {
      return;
    }
    const runId = selectedRunView?.run.id ?? selectedSession.runs.at(-1)?.id;
    const query = new URLSearchParams({ sessionId: selectedSession.session.id });
    if (runId) {
      query.set("runId", runId);
    }
    if (kind === "redirect" && redirectInput.trim()) {
      query.set("value", redirectInput.trim());
    }
    await fetch(`${basePath}/api/control/${kind}?${query.toString()}`, { method: "POST" });
    setOverlay(null);
  }

  function sessionTimeLabel(session: SessionListItem): string {
    const diff = Date.now() - (session.updatedAt ?? session.startedAt);
    if (diff < 60_000) return "now";
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
    return `${Math.max(1, Math.floor(diff / 3_600_000))}h`;
  }

  return (
    <>
      <nav className="topnav">
        <button className={`mob-back ${visibleDetail ? "show" : ""}`} onClick={goBackMobile} type="button">
          ← Back
        </button>
        <div className="logo">
          <div className="logo-mark">🦞</div>
          <span>{title}</span>
        </div>
        <div className="live-pill">
          <div className="live-dot" />
          <span>{runningCount} running</span>
        </div>
        <div className="ts-badge">
          <div className="ts-dot" />
          <span>{initialPayload.tailscale?.dnsName ?? "local"}</span>
        </div>
      </nav>

      <div className="app">
        <div className={`sess-sidebar ${isMobileMode ? (mobileView === "sessions" ? "mob-active" : "mob-hidden") : (visibleDetail ? "mob-hidden" : "")}`} ref={sidebarRef} style={{ width: `${sidebarWidth}px` }}>
          <div className="panel-head">Sessions<span className="ph-badge on">{sessionPagination.totalCount}</span><span className="ph-sub">Page {sessionPagination.page}/{sessionPagination.totalPages}</span></div>
          <div className="sess-scroll">
            {hasSessions ? sessions.map((session) => (
              <button
                 className={`sess-item ${session.id === selectedId ? "active" : ""} ${isSessionRunning(session) ? "is-running" : ""}`}
                 key={session.id}
                 onBlur={() => hideSessionPopover(session.id)}
                 onClick={() => {
                   hideSessionPopover(session.id);
                   if (isMobileMode) {
                     goToMobileRuns(session.id);
                   } else {
                     navigateToSelection(session.id);
                   }
                 }}
                 onFocus={(event) => showSessionPopover(session, event.currentTarget)}
                 onMouseEnter={(event) => scheduleSessionPopover(session, event.currentTarget)}
                 onMouseLeave={() => hideSessionPopover(session.id)}
                 type="button"
               >
                <div className="si-row">
                  <span className="si-ch">{getSessionKindLabel(session)}</span>
                  <span className={`si-st ${sessionStatusClass(session.status)}`}>{session.status}</span>
                  <span className="si-time">{sessionTimeLabel(session)}</span>
                  {isSessionRunning(session) ? <span className="live-mini" aria-hidden="true" /> : null}
                </div>
                <div className="si-id">{getSessionPrimaryText(session)}</div>
                <div className="si-inp">{getSessionSecondaryText(session)}</div>
                <div className="si-foot">
                  <span className="si-runs">{session.runCount} runs</span>
                  <span className="si-key">{session.channelId}</span>
                </div>
              </button>
            )) : <div className="empty-note">No real sessions captured yet. Run a task in OpenClaw and this dashboard will populate automatically.</div>}
          </div>
          <div className="sess-pager">
            <button className="pager-btn" disabled={sessionPagination.page <= 1} onClick={() => setSessionPage(Math.max(1, sessionPagination.page - 1))} type="button">← Prev</button>
            <span className="pager-label">{sessions.length ? `${(sessionPagination.page - 1) * sessionPagination.pageSize + 1}-${(sessionPagination.page - 1) * sessionPagination.pageSize + sessions.length}` : "0"} / {sessionPagination.totalCount}</span>
            <button className="pager-btn" disabled={sessionPagination.page >= sessionPagination.totalPages} onClick={() => setSessionPage(Math.min(sessionPagination.totalPages, sessionPagination.page + 1))} type="button">Next →</button>
          </div>
          {sessionPopover ? (
            <div className="session-popover" role="tooltip" style={{ top: `${sessionPopover.top}px` }}>
              <div className="session-popover-arrow" />
              <div className="si-hover-title">Session details</div>
              <div className="si-hover-row"><span>Kind</span><strong>{getSessionKindLabel(sessionPopover.session)}</strong></div>
              <div className="si-hover-row"><span>Key</span><strong>{sessionPopover.session.channelId}</strong></div>
              <div className="si-hover-row"><span>ID</span><strong>{sessionPopover.session.id}</strong></div>
              <div className="si-hover-row"><span>Status</span><strong>{sessionPopover.session.status}</strong></div>
              <div className="si-hover-row"><span>Runs</span><strong>{sessionPopover.session.runCount}</strong></div>
              <div className="si-hover-row"><span>Info</span><strong>{buildSessionTooltip(sessionPopover.session).replace(/\n/g, " · ")}</strong></div>
            </div>
          ) : null}
        </div>
        <div className={`sidebar-resizer ${isResizingSidebar ? "dragging" : ""}`} onMouseDown={() => setIsResizingSidebar(true)} role="separator" aria-orientation="vertical" />

        <div className={`main-detail ${isMobileMode ? (mobileView !== "sessions" ? "mob-active" : "") : (visibleDetail || !hasSessions ? "mob-active" : "")}`}>
          <div className="detail-cols">
            <div className={`col run-col ${isMobileMode && mobileView === "runs" ? "mob-active" : ""}`}>
              <div className="panel-head">Runs<span className="ph-badge on">{selectedSession?.runViews.length ?? 0}</span></div>
              <div className="run-col-scroll">
                {selectedSession?.runViews.length
                  ? selectedSession.runViews.map((runView) => renderRunRailItem(runView, runView.run.id === selectedRunView?.run.id, summarizeRunView(runView), () => isMobileMode ? goToMobileDetail(runView.run.id) : navigateToSelection(selectedSession.session.id, runView.run.id)))
                  : <div className="empty-pane">Waiting for real runs...</div>}
              </div>
            </div>

            <div className={`col detail-pane ${isMobileMode && mobileView === "detail" ? "mob-active" : ""}`}>
              <div className="panel-head detail-head">
                <div className="detail-head-main">
                  <span>{selectedRunView ? `Run ${selectedRunView.run.runNumber ?? "-"}` : "Run detail"}</span>
                  {selectedRunView ? <span className={`detail-status ${statusClass(selectedRunView.run.status)}`}>{selectedRunView.run.status}</span> : null}
                </div>
                <div className="ctrl-inline">
                  <button className="cbtn cb-pause" onClick={() => setOverlay("pause")} type="button">⏸</button>
                  <button className="cbtn cb-redir" onClick={() => setOverlay("redirect")} type="button">↩</button>
                  <button className="cbtn cb-stop" onClick={() => setOverlay("stop")} type="button">◼</button>
                </div>
              </div>
              {selectedRunView ? (
                <>
                  <div className="run-meta-compact">
                    <span>{timeLabel(selectedRunView.run.startedAt)}</span>
                    <span className={`run-status-dot ${statusClass(selectedRunView.run.status)}`} />
                    <span>{selectedRunView.run.status}</span>
                    <span>·</span>
                    <span>{selectedRunSummary?.taskCount ?? 0} tasks</span>
                    <span>·</span>
                    <span>{selectedRunSummary?.toolCount ?? 0} tools</span>
                    <span>·</span>
                    <span>{selectedRunSummary?.artifactCount ?? 0} artifacts</span>
                  </div>
                  <div className="detail-tabs">
                    <button className={`detail-tab ${detailTab === "timeline" ? "on" : ""}`} onClick={() => setDetailTab("timeline")} type="button">Timeline <span>{buildEventRows(selectedRunView).length}</span></button>
                    <button className={`detail-tab ${detailTab === "artifacts" ? "on" : ""}`} onClick={() => setDetailTab("artifacts")} type="button">Artifacts <span>{selectedRunSummary?.artifactCount ?? 0}</span></button>
                  </div>
                  <div className="detail-body">
                    {detailTab === "timeline" ? renderCombinedPane(selectedRunView, expandedEvents, setExpandedEvents, (sessionId, runId) => navigateToSelection(sessionId, runId)) : null}
                    {detailTab === "artifacts" ? renderArtifactPane(selectedRunView) : null}
                  </div>
                </>
              ) : <div className="empty-pane">Select a run to inspect its details.</div>}
            </div>

            <div className="input-area">
              <div className="ctrl-row">
                <button className="cbtn cb-pause" onClick={() => setOverlay("pause")} type="button">⏸ Pause</button>
                <button className="cbtn cb-redir" onClick={() => setOverlay("redirect")} type="button">↩ Redirect</button>
                <button className="cbtn cb-stop" onClick={() => setOverlay("stop")} type="button">◼ Stop</button>
              </div>
              <div className="input-row">
                <textarea className="ibox" onChange={(event) => setRedirectInput(event.target.value)} placeholder="Continue the conversation..." rows={2} value={redirectInput} />
                <button className="send-btn" onClick={() => setOverlay("redirect")} type="button">↑</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`overlay ${overlay ? "show" : ""}`}>
        <div className="ocard">
          <h3>{overlay === "stop" ? "Stop current run" : overlay === "pause" ? "Pause current run" : "Redirect task"}</h3>
          <p>
            {overlay === "redirect"
              ? "Write a new instruction into the control queue so the plugin can pick it up on the next step."
              : "This sends a real control request to the plugin and records it in SQLite."}
          </p>
          {overlay === "redirect" ? <textarea className="ibox overlay-box" onChange={(event) => setRedirectInput(event.target.value)} rows={4} value={redirectInput} /> : null}
          <div className="oactions">
            {overlay ? (
              <button className={`oact ${overlay === "stop" ? "oa-stop" : overlay === "pause" ? "oa-pause" : "oa-redir"}`} onClick={() => requestControl(overlay)} type="button">
                <div className="ol">Confirm {overlay === "stop" ? "stop" : overlay === "pause" ? "pause" : "redirect"}</div>
                <div className="od">Write this request to control actions</div>
              </button>
            ) : null}
            <button className="oact oa-cancel" onClick={() => setOverlay(null)} type="button">Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}

function renderRunRailItem(runView: RunView, selected: boolean, summary: ReturnType<typeof summarizeRunView>, onSelect: () => void) {
  return (
    <button className={`run-rail-item ${selected ? "active" : ""} ${statusClass(runView.run.status)}`} key={runView.run.id} onClick={onSelect} type="button">
      <div className="run-rail-top">
        <span className={`rb-num ${runView.run.status === "running" ? "running" : ""}`}>Run {runView.run.runNumber ?? "-"}</span>
        <span className="rb-time">{timeLabel(runView.run.startedAt)}</span>
      </div>
      <div className="run-rail-input">{runView.run.userInput}</div>
      <div className="run-rail-meta">
        <span>{summary.taskCount} tasks</span>
        <span>{summary.toolCount} tools</span>
        <span>{summary.artifactCount} files</span>
      </div>
    </button>
  );
}

function renderExecutionPane(
  runView: RunView,
  expandedTasks: Record<string, boolean>,
  expandedSteps: Record<string, boolean>,
  setExpandedTasks: Dispatch<SetStateAction<Record<string, boolean>>>,
  setExpandedSteps: Dispatch<SetStateAction<Record<string, boolean>>>,
  sessionAgentName: string | undefined,
  jumpToSession: (sessionId: string) => void
) {
  return (
    <div className="detail-scroll execution-pane">
      {runView.tasks.length ? runView.tasks.map((node) => {
        const taskOpen = expandedTasks[node.task.id] ?? true;
        return (
          <div className="task-card" key={node.task.id}>
            <button className={`mt-row ${taskOpen ? "active" : ""} ${taskStatusClass(node.task.status)} ${isTaskRunning(node.task) ? "mt-row-running" : ""}`} onClick={() => setExpandedTasks((current) => ({ ...current, [node.task.id]: !taskOpen }))} type="button">
              <span className={`mt-chevron ${taskOpen ? "open" : ""}`}>▶</span>
              <span className="mt-icon">◈</span>
              <span className="mt-label">{node.task.label}</span>
              <span className="mt-meta">{node.agents.length > 1 ? `${node.agents.length} agents` : node.agents[0] ? getAgentDisplayName(node.agents[0].agent) : "No agent"}</span>
              <span className="mt-dur">{durationLabel(node.task.durationMs)}</span>
              {isTaskRunning(node.task) ? <span className="live-mini" aria-hidden="true" /> : null}
            </button>
            {taskOpen ? node.agents.map((agentBundle) => (
              <div className="sa-block" key={agentBundle.agent.id}>
                {shouldShowAgentRow(node.agents.length, agentBundle.agent.name, sessionAgentName, Boolean(agentBundle.agent.linkedSessionId)) ? (
                  <div className={`sa-row ${isAgentRunning(agentBundle.agent) ? "sa-row-running" : ""}`}>
                    <span className={`sa-dot ${agentStatusClass(agentBundle.agent.status)}`} />
                    <span className="sa-name">{getAgentDisplayName(agentBundle.agent)}</span>
                    <span className={`sa-badge ${agentStatusClass(agentBundle.agent.status)}`}>{agentBundle.agent.status}</span>
                    {agentBundle.agent.linkedSessionId ? (
                      <button className="sa-link" onClick={(event) => {
                        event.stopPropagation();
                        jumpToSession(agentBundle.agent.linkedSessionId!);
                      }} type="button">
                        Open session
                      </button>
                    ) : null}
                    {isAgentRunning(agentBundle.agent) ? <span className="live-mini" aria-hidden="true" /> : null}
                  </div>
                ) : null}
                <div className="tc-list">
                  {buildAgentSteps(agentBundle.toolCalls, new Set(node.agents.filter(a => a.agent.linkedSessionId).map(a => a.agent.name))).map((step) => {
                    const isExpanded = expandedSteps[step.id] ?? false;
                    const preview = summarizeEventDetail(step.detail);
                    const canExpand = step.detail.length > preview.length || step.detail.includes("\n") || Boolean(step.toolDetail);
                    return (
                      <button className={`tt-step tt-${step.kind} tt-${toolStatusClass(step.status)}`} key={step.id} onClick={() => canExpand && setExpandedSteps((current) => ({ ...current, [step.id]: !isExpanded }))} type="button">
                        <span className="tt-step-ico">{step.kind === "tool" ? "🔧" : step.kind === "prompt" ? "◉" : "✦"}</span>
                        <span className="tt-step-name">{step.label}</span>
                        <span className="tt-step-arg">{preview}</span>
                        <span className={`tt-step-dot ${toolStatusClass(step.status)}`} />
                        {canExpand ? <span className={`tt-step-chevron ${isExpanded ? "open" : ""}`}>▶</span> : null}
                        {isExpanded ? <div className="tt-step-detail"><EventDetail kind={step.kind} text={step.detail} toolDetail={step.toolDetail} /></div> : null}
                      </button>
                    );
                  })}
                  {agentBundle.toolCalls.length === 0 ? <div className="tc-empty">No tool activity</div> : null}
                </div>
              </div>
            )) : null}
          </div>
        );
      }) : <div className="empty-pane">No execution steps recorded for this run.</div>}
    </div>
  );
}

function renderEventPane(
  runView: RunView,
  expandedEvents: Record<string, boolean>,
  setExpandedEvents: Dispatch<SetStateAction<Record<string, boolean>>>
) {
  return (
    <div className="detail-scroll stream-col">
      {buildEventRows(runView).map((event) => {
        const isExpanded = expandedEvents[event.id] ?? false;
        const detail = event.detail ?? "";
        const preview = summarizeEventDetail(detail);
        const canExpand = event.expandable || detail.length > preview.length || detail.includes("\n") || detail.startsWith("{") || detail.startsWith("[");
        return (
          <button className={`se t-${eventClass(event.kind)} ${isExpanded ? "is-open" : ""} ${event.rowStatus ? `row-${event.rowStatus}` : ""} ${isEventRunning(event.rowStatus, event.kind) ? "se-running" : ""}`} key={event.id} onClick={() => canExpand && setExpandedEvents((current) => ({ ...current, [event.id]: !isExpanded }))} type="button">
            <div className="se-ts">{shortTime(event.createdAt)}</div>
            <div className="se-b">
              <div className="se-headline">
                <div className="se-ic">{eventIcon(event.kind)}</div>
                <div className="se-lb">{event.label}</div>
                {isEventRunning(event.rowStatus, event.kind) ? <span className="live-mini" aria-hidden="true" /> : null}
                {canExpand ? <div className={`se-chevron ${isExpanded ? "open" : ""}`}>▶</div> : null}
              </div>
              {isExpanded ? <EventDetail kind={event.kind} text={detail} toolDetail={event.toolDetail} /> : <div className="se-tx">{preview}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function renderCombinedPane(
  runView: RunView,
  expandedEvents: Record<string, boolean>,
  setExpandedEvents: Dispatch<SetStateAction<Record<string, boolean>>>,
  openTarget: (sessionId: string, runId?: string) => void
) {
  return (
    <div className="detail-scroll combined-col">
      {buildEventRows(runView).map((event) => {
        const isExpanded = expandedEvents[event.id] ?? false;
        const detail = event.detail ?? "";
        const preview = summarizeEventDetail(detail);
        const canExpand = event.expandable || detail.length > preview.length || detail.includes("\n") || detail.startsWith("{") || detail.startsWith("[");
        return (
          <button className={`se t-${eventClass(event.kind)} ${isExpanded ? "is-open" : ""} ${event.rowStatus ? `row-${event.rowStatus}` : ""} ${isEventRunning(event.rowStatus, event.kind) ? "se-running" : ""}`} key={event.id} onClick={() => canExpand && setExpandedEvents((current) => ({ ...current, [event.id]: !isExpanded }))} type="button">
            <div className="se-ts">{shortTime(event.createdAt)}</div>
            <div className="se-b">
              <div className="se-headline">
                <div className="se-ic">{eventIcon(event.kind)}</div>
                <div className="se-lb">{event.label}</div>
                {event.targetSessionId ? (
                  <button
                    className="sa-link"
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      openTarget(event.targetSessionId!, event.targetRunId);
                    }}
                    type="button"
                  >
                    {event.targetRunId ? "Open run" : "Open session"}
                  </button>
                ) : null}
                {isEventRunning(event.rowStatus, event.kind) ? <span className="live-mini" aria-hidden="true" /> : null}
                {canExpand ? <div className={`se-chevron ${isExpanded ? "open" : ""}`}>▶</div> : null}
              </div>
              {isExpanded ? <EventDetail kind={event.kind} text={detail} toolDetail={event.toolDetail} /> : <div className="se-tx">{preview}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function renderArtifactPane(runView: RunView) {
  return (
    <div className="detail-scroll art-col">
      {runView.artifacts.length ? runView.artifacts.map((artifact) => (
        <div className={`art-item ${artifact.purpose === "final-reply" ? "art-item-reply" : ""}`} key={artifact.id}>
          <div className="art-ico">{artifact.purpose === "final-reply" ? "💬" : "◧"}</div>
          <div className="art-info">
            <div className="art-name">{artifactTitle(artifact)}</div>
            <div className="art-desc">{artifactDescription(artifact)}</div>
            <div className="art-ft">
              <span className={`art-lc ${artifact.lifecycle === "permanent" ? "lc-keep" : artifact.lifecycle === "referenced" ? "lc-ref" : "lc-tmp"}`}>{artifact.lifecycle}</span>
              <span className="art-sz">{sizeLabel(artifact.sizeBytes)}</span>
            </div>
          </div>
        </div>
      )) : <div className="empty-pane">No artifacts captured for this run.</div>}
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "running" || status === "active") return "running";
  if (status === "aborted" || status === "error" || status === "interrupted") return "aborted";
  return "done";
}

function sessionStatusClass(status: string): string {
  if (status === "running" || status === "active") return "running";
  if (status === "aborted" || status === "error" || status === "abandoned" || status === "interrupted") return "aborted";
  return "done";
}

function taskStatusClass(status: string): string {
  return `task-${statusClass(status)}`;
}

function agentStatusClass(status: string): string {
  if (status === "active") return "active";
  if (status === "done") return "done";
  if (status === "error" || status === "killed") return "error";
  return "idle";
}

function toolStatusClass(status: string): string {
  if (status === "error" || status === "blocked") return "error";
  if (status === "done") return "done";
  return "running";
}

function shortTime(value: number): string {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function timeLabel(value: number): string {
  return shortTime(value);
}

function durationLabel(value?: number): string {
  if (!value) return "-";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function sizeLabel(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function eventClass(kind: string): string {
  if (kind.includes("write")) return "write";
  if (kind.includes("prompt")) return "out";
  if (kind.includes("out")) return "out";
  if (kind.includes("warn") || kind.includes("error")) return "warn";
  if (kind.includes("compaction")) return "warn";
  if (kind.includes("done")) return "done";
  return "tool";
}

function eventIcon(kind: string): string {
  if (kind.includes("write")) return "✎";
  if (kind.includes("out")) return "✦";
  if (kind.includes("prompt")) return "◉";
  if (kind.includes("warn") || kind.includes("error")) return "⚠";
  if (kind.includes("compaction")) return "◌";
  if (kind.includes("done")) return "✓";
  return "•";
}

function artifactTitle(artifact: ArtifactRecord): string {
  return artifact.purpose === "final-reply" ? "Final reply" : artifact.path;
}

function artifactDescription(artifact: ArtifactRecord): string {
  if (artifact.purpose === "final-reply") {
    return artifact.path.replace("reply://", "Model output · ");
  }
  return artifact.agentName ?? "main";
}

function summarizeEventDetail(detail: string): string {
  if (!detail) {
    return "No details";
  }
  const compact = detail.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function shouldShowAgentRow(agentCount: number, agentName: string, sessionAgentName: string | undefined, hasLinkedSession: boolean): boolean {
  if (hasLinkedSession || agentCount > 1) {
    return true;
  }

  return agentName !== sessionAgentName;
}

function parseDashboardRoute(pathname: string, basePath: string): { sessionId?: string; runId?: string } {
  if (!pathname.startsWith(basePath)) {
    return {};
  }

  const suffix = pathname.slice(basePath.length).replace(/^\/+|\/+$/g, "");
  if (!suffix) {
    return {};
  }

  const segments = suffix.split("/").map((segment) => decodeURIComponent(segment));
  if (segments[0] !== "session") {
    return {};
  }

  const sessionId = segments[1];
  if (!sessionId) {
    return {};
  }
  if (segments.length >= 4 && segments[2] === "run" && segments[3]) {
    return { sessionId, runId: segments[3] };
  }
  return { sessionId };
}

function buildDashboardPath(basePath: string, sessionId?: string, runId?: string): string {
  if (!sessionId) {
    return basePath;
  }

  const sessionPath = `${basePath}/session/${encodeURIComponent(sessionId)}`;
  if (!runId) {
    return sessionPath;
  }
  return `${sessionPath}/run/${encodeURIComponent(runId)}`;
}

function deriveMobileView(sessionId?: string, runId?: string): MobileView {
  if (runId) {
    return "detail";
  }
  if (sessionId) {
    return "runs";
  }
  return "sessions";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
