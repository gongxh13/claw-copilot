import { applyBootstrapState } from "./state";
import { normalizeDashboardPayload } from "./payload";
import type { DashboardPayload, SessionDetail, SessionListItem } from "./types";

export type DashboardState = {
  sessions: SessionListItem[];
  sessionPagination: DashboardPayload["sessionPagination"];
  selectedId: string;
  detail: SessionDetail | undefined;
};

export type DashboardSseEvent =
  | { type: "bootstrap"; payload: DashboardPayload }
  | { type: "session-list-updated"; sessions: SessionListItem[]; sessionPagination: DashboardPayload["sessionPagination"] }
  | { type: "session-detail-updated"; sessionId?: string; detail?: SessionDetail };

export function applySseEvent(state: DashboardState, event: DashboardSseEvent): DashboardState {
  if (event.type === "bootstrap") {
    return applyBootstrapState(normalizeDashboardPayload(event.payload), state.selectedId, state.detail);
  }

  if (event.type === "session-list-updated") {
    if (event.sessions.length === 0) {
      return { sessions: [], sessionPagination: event.sessionPagination, selectedId: "", detail: undefined };
    }
    const selectedId = event.sessions.some((session) => session.id === state.selectedId) ? state.selectedId : event.sessions[0]?.id ?? "";
    return {
      sessions: event.sessions,
      sessionPagination: event.sessionPagination,
      selectedId,
      detail: state.detail?.session.id === selectedId ? state.detail : undefined
    };
  }

  if (!event.sessionId || event.sessionId !== state.selectedId) {
    return state;
  }

  return {
    ...state,
    detail: event.detail
  };
}

export function decodeSseEvent(type: string, raw: string): DashboardSseEvent | undefined {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (type === "bootstrap" && parsed.payload) {
    return { type, payload: normalizeDashboardPayload(parsed.payload as Partial<DashboardPayload>) };
  }
  if (type === "session-list-updated" && parsed.sessions) {
    return {
      type,
      sessions: parsed.sessions as SessionListItem[],
      sessionPagination: normalizeDashboardPayload({ sessions: parsed.sessions as SessionListItem[], sessionPagination: parsed.sessionPagination as DashboardPayload["sessionPagination"] | undefined }).sessionPagination
    };
  }
  if (type === "session-detail-updated") {
    return {
      type,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      detail: parsed.detail as SessionDetail | undefined
    };
  }
  return undefined;
}
