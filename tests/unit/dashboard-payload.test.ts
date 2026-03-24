import { describe, expect, it } from "vitest";

import { normalizeDashboardPayload } from "../../dashboard/src/payload.js";

describe("normalizeDashboardPayload", () => {
  it("fills in missing sessionPagination for legacy payloads", () => {
    const payload = normalizeDashboardPayload({
      sessions: [
        {
          id: "session-1",
          channelId: "agent:main:main",
          startedAt: 1,
          updatedAt: 2,
          status: "completed",
          title: "hello",
          runCount: 1,
          runningRunCount: 0
        }
      ]
    });

    expect(payload.sessionPagination).toEqual({
      page: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1
    });
  });
});
