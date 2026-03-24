import { describe, expect, it } from "vitest";

import { getAgentDisplayName, getSessionKindLabel, getSessionPrimaryText, getSessionSecondaryText, isSessionRunning } from "../../dashboard/src/session-presenter.js";
import type { SessionListItem } from "../../dashboard/src/types.js";

describe("session presenter", () => {
  it("shows title as primary text and concise session metadata as secondary text", () => {
    const session: SessionListItem = {
      id: "session-123",
      channelId: "agent:main:tui-123",
      startedAt: 1,
      updatedAt: 2,
      status: "completed",
      title: "hello",
      runCount: 1,
      runningRunCount: 0
    };

    expect(getSessionPrimaryText(session)).toBe("hello");
    expect(getSessionSecondaryText(session)).toBe("Interactive terminal session");
    expect(isSessionRunning(session)).toBe(false);
  });

  it("formats session key and agent names with clearer labels", () => {
    const session: SessionListItem = {
      id: "session-123",
      channelId: "agent:writer:cron:abc",
      startedAt: 1,
      updatedAt: 2,
      status: "completed",
      title: "hello",
      runCount: 1,
      runningRunCount: 0
    };

    expect(getSessionKindLabel(session)).toBe("Writer / cron");
    expect(getAgentDisplayName({ name: "main" } as never)).toBe("Main");
  });

  it("recognizes channel and subagent session keys", () => {
    const channelSession: SessionListItem = {
      id: "session-1",
      channelId: "agent:main:feishu:direct:ou_123",
      startedAt: 1,
      updatedAt: 2,
      status: "completed",
      title: "",
      runCount: 1,
      runningRunCount: 0
    };
    const subagentSession: SessionListItem = {
      id: "session-2",
      channelId: "agent:writer:subagent:abc",
      startedAt: 1,
      updatedAt: 2,
      status: "completed",
      title: "delegate draft",
      runCount: 1,
      runningRunCount: 0
    };

    expect(getSessionKindLabel(channelSession)).toBe("Main / feishu dm");
    expect(getSessionSecondaryText(channelSession)).toBe("Direct conversation");
    expect(getSessionKindLabel(subagentSession)).toBe("Writer / subagent");
    expect(getSessionSecondaryText(subagentSession)).toBe("Delegated work session");
  });

  it("uses session-key-like labels for main sessions", () => {
    const session: SessionListItem = {
      id: "session-123",
      channelId: "agent:develop:main",
      startedAt: 1,
      updatedAt: 2,
      status: "completed",
      title: "Investigate UI",
      runCount: 2,
      runningRunCount: 0
    };

    expect(getSessionKindLabel(session)).toBe("Develop / main");
    expect(getSessionSecondaryText(session)).toBe("Main agent session");
  });
});
