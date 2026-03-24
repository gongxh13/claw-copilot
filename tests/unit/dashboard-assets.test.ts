import { describe, expect, it } from "vitest";

import { injectDashboardShell } from "../../plugin/src/server/dashboard-assets.js";

describe("injectDashboardShell", () => {
  it("injects title, base path, and bootstrap payload into the dashboard shell", () => {
    const html = injectDashboardShell(
      "<html><head><title>__CREW_TITLE__</title></head><body data-base='__CREW_BASE_PATH__'><script>window.__CLAW_COPILOT__ = __CREW_BOOTSTRAP__;</script></body></html>",
      {
        title: "Claw Copilot",
        basePath: "/claw-copilot",
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

    expect(html).toContain("Claw Copilot");
    expect(html).toContain("/claw-copilot");
    expect(html).toContain('<base href="/claw-copilot/">');
    expect(html.indexOf('<base href="/claw-copilot/">')).toBeLessThan(html.indexOf("<script"));
    expect(html).toContain("session-1");
    expect(html).not.toContain("__CREW_BOOTSTRAP__");
  });
});
