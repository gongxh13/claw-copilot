import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardPayload } from "../../plugin/src/core/types.js";
import { DashboardSseHub, encodeSseEvent, resolveSseSnapshot } from "../../plugin/src/server/sse.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("SSE protocol", () => {
  it("encodes named SSE events with JSON payloads", () => {
    const text = encodeSseEvent("session-list-updated", { sessions: [] });

    expect(text).toContain("event: session-list-updated\n");
    expect(text).toContain("data: {\"sessions\":[]}\n\n");
  });

  it("resolves selected detail for the requested session", () => {
    const payload: DashboardPayload = {
      sessions: [
        {
          id: "session-1",
          channelId: "feishu",
          startedAt: 1,
          updatedAt: 2,
          status: "running",
          title: "hello",
          runCount: 1,
          runningRunCount: 1
        }
      ],
      sessionPagination: {
        page: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1
      },
      selectedSession: {
        session: {
          id: "session-1",
          channelId: "feishu",
          startedAt: 1,
          updatedAt: 2,
          status: "running",
          title: "hello"
        },
        runs: [],
        runViews: []
      }
    };

    const snapshot = resolveSseSnapshot(payload, "session-1");

    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.selectedSession?.session.id).toBe("session-1");
    expect(snapshot.sessionPagination.totalCount).toBe(1);
  });

  it("sends keepalive heartbeats for connected clients", () => {
    vi.useFakeTimers();

    const store = {
      listSessionsPage: () => ({
        sessions: [],
        pagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 1 }
      }),
      getSessionDetail: () => undefined
    };
    const hub = new DashboardSseHub(store as never);
    const req = new EventEmitter();
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
      writes: string[];
      setHeader: (name: string, value: string) => void;
      write: (chunk: string) => boolean;
      flushHeaders?: () => void;
    };

    res.statusCode = 0;
    res.headers = {};
    res.writes = [];
    res.setHeader = (name: string, value: string) => {
      res.headers[name] = value;
    };
    res.write = (chunk: string) => {
      res.writes.push(chunk);
      return true;
    };

    hub.connect(req as never, res as never);
    expect(res.writes).toContain("retry: 2000\n\n");

    vi.advanceTimersByTime(15000);

    expect(res.writes.at(-1)).toBe(": keep-alive\n\n");

    req.emit("close");
    const countAfterClose = res.writes.length;
    vi.advanceTimersByTime(15000);

    expect(res.writes).toHaveLength(countAfterClose);
  });
});
