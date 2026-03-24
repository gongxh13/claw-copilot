import { describe, expect, it } from "vitest";

import { buildSessionTooltip, clampSessionPage, getSessionPage } from "../../dashboard/src/session-list.js";
import type { SessionListItem } from "../../dashboard/src/types.js";

const sessions: SessionListItem[] = Array.from({ length: 5 }, (_, index) => ({
  id: `session-${index + 1}`,
  channelId: `agent:main:tui-${index + 1}`,
  startedAt: 100 + index,
  updatedAt: 200 + index,
  status: "completed",
  title: `Session ${index + 1}`,
  runCount: index + 1,
  runningRunCount: 0
}));

describe("session list helpers", () => {
  it("returns the requested page of sessions", () => {
    expect(getSessionPage(sessions, 2, 2).map((session) => session.id)).toEqual(["session-3", "session-4"]);
  });

  it("clamps page numbers into valid bounds", () => {
    expect(clampSessionPage(0, sessions.length, 2)).toBe(1);
    expect(clampSessionPage(99, sessions.length, 2)).toBe(3);
  });

  it("builds hover text with the full session key and metadata", () => {
    expect(buildSessionTooltip(sessions[0]!)).toContain("Session key: agent:main:tui-1");
    expect(buildSessionTooltip(sessions[0]!)).toContain("Session id: session-1");
    expect(buildSessionTooltip(sessions[0]!)).toContain("Runs: 1");
  });
});
