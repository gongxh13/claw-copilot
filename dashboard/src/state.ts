import type { DashboardPayload, SessionDetail } from "./types";

export function applyBootstrapState(payload: DashboardPayload, selectedId: string, detail: SessionDetail | undefined): {
  sessions: DashboardPayload["sessions"];
  sessionPagination: DashboardPayload["sessionPagination"];
  selectedId: string;
  detail: SessionDetail | undefined;
} {
  if (payload.sessions.length === 0) {
    return {
      sessions: payload.sessions,
      sessionPagination: payload.sessionPagination,
      selectedId: "",
      detail: undefined
    };
  }

  const nextSelectedId = selectedId || payload.sessions[0]?.id || "";
  const nextDetail = payload.selectedSession && (!nextSelectedId || payload.selectedSession.session.id === nextSelectedId)
    ? payload.selectedSession
    : detail;

  return {
    sessions: payload.sessions,
    sessionPagination: payload.sessionPagination,
    selectedId: nextSelectedId,
    detail: nextDetail
  };
}
