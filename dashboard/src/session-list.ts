import type { SessionListItem } from "./types";

export function getSessionPage(sessions: SessionListItem[], page: number, pageSize: number): SessionListItem[] {
  const safePage = clampSessionPage(page, sessions.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return sessions.slice(start, start + pageSize);
}

export function clampSessionPage(page: number, totalItems: number, pageSize: number): number {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}

export function findSessionPage(sessions: SessionListItem[], sessionId: string, pageSize: number): number {
  const index = sessions.findIndex((session) => session.id === sessionId);
  return index === -1 ? 1 : Math.floor(index / pageSize) + 1;
}

export function buildSessionTooltip(session: SessionListItem): string {
  return [
    `Session key: ${session.channelId}`,
    `Session id: ${session.id}`,
    `Status: ${session.status}`,
    `Runs: ${session.runCount}`
  ].join("\n");
}
