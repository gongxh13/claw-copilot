import { describe, expect, it } from "vitest";

import { injectDashboardShell } from "../../plugin/src/server/dashboard-assets.js";

describe("injectDashboardShell", () => {
  it("injects title, base path, and bootstrap payload into the dashboard shell", () => {
    const html = injectDashboardShell(
      "<html><head><title>__CREW_TITLE__</title></head><body data-base='__CREW_BASE_PATH__'><script>window.__CREW_COPILOT__ = __CREW_BOOTSTRAP__;</script></body></html>",
      {
        title: "ClawCopilot",
        basePath: "/crew-copilot",
        payload: {
          sessions: [
            {
              id: "session-1",
              channelId: "telegram",
              startedAt: 100,
              status: "running",
              title: "Investigate compaction",
              runCount: 2,
              runningRunCount: 1
            }
          ],
          sessionPagination: { page: 1, pageSize: 20, totalCount: 1, totalPages: 1 }
        }
      }
    );

    expect(html).toContain("ClawCopilot");
    expect(html).toContain("/crew-copilot");
    expect(html).toContain('<base href="/crew-copilot/">');
    expect(html.indexOf('<base href="/crew-copilot/">')).toBeLessThan(html.indexOf("<script"));
    expect(html).toContain("session-1");
    expect(html).not.toContain("__CREW_BOOTSTRAP__");
  });
});
