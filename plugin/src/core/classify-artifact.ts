import path from "node:path";

import type { ArtifactLifecycle } from "./types.js";

type Options = {
  referencedBy?: string[];
};

const PERMANENT_DIRS = ["src/", "docs/", "pwa/", "app/"];
const PERMANENT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".py", ".html", ".css"]);
const TEMP_MARKERS = [".tmp", "_temp", "_cache", "/tmp/", "tmp/"];

export function classifyArtifactLifecycle(filePath: string, options: Options = {}): ArtifactLifecycle {
  if ((options.referencedBy?.length ?? 0) > 0) {
    return "referenced";
  }

  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (TEMP_MARKERS.some((marker) => normalized.includes(marker))) {
    return "temporary";
  }

  if (PERMANENT_DIRS.some((dir) => normalized.startsWith(dir) || normalized.includes(`/${dir}`))) {
    return "permanent";
  }

  if (PERMANENT_EXTENSIONS.has(path.extname(normalized))) {
    return "permanent";
  }

  return "temporary";
}
