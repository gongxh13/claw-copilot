import type { IncomingMessage, ServerResponse } from "node:http";

import type { DashboardPayload } from "../core/types.js";
import { CopilotStore } from "../storage/repository.js";

type SseClient = {
  res: ServerResponse;
  selectedSessionId?: string;
  page: number;
  pageSize: number;
  heartbeat: ReturnType<typeof setInterval>;
};

export function encodeSseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function resolveSseSnapshot(payload: DashboardPayload, selectedSessionId?: string): DashboardPayload {
  if (!selectedSessionId) {
    return payload;
  }

  return {
    ...payload,
    selectedSession: payload.selectedSession?.session.id === selectedSessionId ? payload.selectedSession : undefined
  };
}

export class DashboardSseHub {
  private readonly clients = new Set<SseClient>();

  constructor(private readonly store: CopilotStore) {}

  connect(req: IncomingMessage, res: ServerResponse, selectedSessionId?: string, page = 1, pageSize = 20): void {
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-store, max-age=0");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();
    req.socket?.setKeepAlive?.(true);
    res.write("retry: 2000\n\n");

    const heartbeat = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    const client: SseClient = { res, selectedSessionId, page, pageSize, heartbeat };
    this.clients.add(client);
    this.sendBootstrap(client);

    const cleanup = () => {
      clearInterval(client.heartbeat);
      this.clients.delete(client);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
  }

  publish(): void {
    for (const client of this.clients) {
      const { sessions, pagination } = this.store.listSessionsPage(client.page, client.pageSize);
      client.res.write(encodeSseEvent("session-list-updated", { sessions, sessionPagination: pagination }));
      const sessionId = client.selectedSessionId ?? sessions[0]?.id;
      client.res.write(
        encodeSseEvent("session-detail-updated", {
          sessionId,
          detail: sessionId ? this.store.getSessionDetail(sessionId) : undefined
        })
      );
    }
  }

  private sendBootstrap(client: SseClient): void {
    const page = this.store.listSessionsPage(client.page, client.pageSize);
    client.res.write(
      encodeSseEvent("bootstrap", {
        payload: {
          sessions: page.sessions,
          sessionPagination: page.pagination,
          selectedSession: this.resolveSelectedSession(client.selectedSessionId, client.page, client.pageSize)
        }
      })
    );
  }

  private resolveSelectedSession(selectedSessionId?: string, page = 1, pageSize = 20) {
    if (selectedSessionId) {
      return this.store.getSessionDetail(selectedSessionId);
    }
    const sessions = this.store.listSessionsPage(page, pageSize).sessions;
    return sessions[0] ? this.store.getSessionDetail(sessions[0].id) : undefined;
  }
}
