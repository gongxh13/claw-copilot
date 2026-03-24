import type { DashboardPayload } from "./types";

const defaultPageSize = 20;

export function normalizeDashboardPayload(payload: Partial<DashboardPayload>): DashboardPayload {
  const sessions = payload.sessions ?? [];
  const sessionPagination = payload.sessionPagination ?? {
    page: 1,
    pageSize: defaultPageSize,
    totalCount: sessions.length,
    totalPages: Math.max(1, Math.ceil(sessions.length / defaultPageSize))
  };

  return {
    sessions,
    sessionPagination,
    selectedSession: payload.selectedSession,
    tailscale: payload.tailscale
  };
}
