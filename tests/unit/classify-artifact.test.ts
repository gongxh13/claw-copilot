import { describe, expect, it } from "vitest";

import { classifyArtifactLifecycle } from "../../plugin/src/core/classify-artifact.js";

describe("classifyArtifactLifecycle", () => {
  it("marks temporary files as temporary", () => {
    expect(classifyArtifactLifecycle("/tmp/parse_api.tmp.js")).toBe("temporary");
  });

  it("marks workspace outputs as permanent", () => {
    expect(classifyArtifactLifecycle("src/types/feishu.d.ts")).toBe("permanent");
    expect(classifyArtifactLifecycle("docs/project_map.md")).toBe("permanent");
  });

  it("promotes files to referenced when later read", () => {
    expect(
      classifyArtifactLifecycle("tmp/working.json", {
        referencedBy: ["tool-2"]
      })
    ).toBe("referenced");
  });
});
