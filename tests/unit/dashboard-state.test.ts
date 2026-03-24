import { describe, expect, it } from "vitest";

import type { DashboardPayload, SessionDetail } from "../../dashboard/src/types.js";
import { applyBootstrapState } from "../../dashboard/src/state.js";

describe("applyBootstrapState", () => {
  it("clears stale selected detail when bootstrap payload is empty", () => {
    const staleDetail: SessionDetail = {
      session: {
        id: "session-1",
        channelId: "channel-1",
        startedAt: 1,
        updatedAt: 2,
        status: "completed",
        title: "Old session",
        runCount: 1,
        runningRunCount: 0
      },
      runs: [],
      runViews: []
    };

    const next = applyBootstrapState({ sessions: [], sessionPagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 1 } } satisfies DashboardPayload, "session-1", staleDetail);

    expect(next.selectedId).toBe("");
    expect(next.detail).toBeUndefined();
    expect(next.sessionPagination.totalCount).toBe(0);
  });
});
