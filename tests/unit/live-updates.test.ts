import { describe, expect, it } from "vitest";

import { applySseEvent } from "../../dashboard/src/live-updates.js";
import type { DashboardPayload, SessionDetail, SessionListItem } from "../../dashboard/src/types.js";

describe("applySseEvent", () => {
  it("updates session list and selected detail from SSE payloads", () => {
    const session: SessionListItem = {
      id: "session-1",
      channelId: "feishu",
      startedAt: 1,
      updatedAt: 2,
      status: "running",
      title: "hello",
      runCount: 1,
      runningRunCount: 1
    };
    const detail: SessionDetail = {
      session,
      runs: [],
      runViews: []
    };

    const next = applySseEvent(
      { sessions: [], sessionPagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 1 }, selectedId: "", detail: undefined },
      {
        type: "bootstrap",
        payload: {
          sessions: [session],
          sessionPagination: { page: 1, pageSize: 20, totalCount: 1, totalPages: 1 },
          selectedSession: detail
        } satisfies DashboardPayload
      }
    );

    expect(next.sessions).toHaveLength(1);
    expect(next.selectedId).toBe("session-1");
    expect(next.detail?.session.id).toBe("session-1");
    expect(next.sessionPagination.totalCount).toBe(1);
  });
});
