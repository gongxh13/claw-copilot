import { describe, expect, it } from "vitest";

import { __internal } from "../../plugin/src/runtime/recorder.js";

describe("sanitizeIncomingMessage", () => {
  it("removes sender metadata wrapper and keeps actual user text", () => {
    const text = __internal.sanitizeIncomingMessage(
      [
        "Sender (untrusted metadata):",
        "```json",
        "{",
        '  "label": "openclaw-tui (gateway-client)",',
        '  "id": "gateway-client",',
        '  "name": "openclaw-tui",',
        '  "username": "openclaw-tui"',
        "}",
        "```",
        "",
        "[Tue 2026-03-24 10:04 GMT+8] 你好"
      ].join("\n")
    );

    expect(text).toBe("你好");
  });
});
