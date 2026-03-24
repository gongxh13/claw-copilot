import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EventDetail } from "../../dashboard/src/event-detail.js";
import { buildToolDetailSections } from "../../dashboard/src/tool-result.js";

describe("EventDetail", () => {
  it("renders model prompt and reply content as markdown", () => {
    const html = renderToStaticMarkup(
      createElement(EventDetail, { kind: "out", text: "# Title\n\n- one\n- two\n\n`code`" })
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders tool sections as input output and meta blocks", () => {
    const html = renderToStaticMarkup(
      createElement(EventDetail, {
        kind: "tool",
        text: "",
        toolDetail: buildToolDetailSections("ls -la", JSON.stringify({ content: [{ type: "text", text: "total 80" }], details: { status: "completed", exitCode: 0 } }))
      })
    );

    expect(html).toContain("Input");
    expect(html).toContain("Output");
    expect(html).toContain("Meta");
    expect(html).toContain("ls -la");
    expect(html).toContain("total 80");
    expect(html).toContain("completed");
  });
});
