import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DashboardPayload } from "../core/types.js";

type ShellOptions = {
  title: string;
  basePath: string;
  payload: DashboardPayload;
};

export function loadDashboardShell(moduleUrl: string): string {
  const here = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.resolve(here, "dashboard/index.html"),
    path.resolve(here, "../../dashboard/dist/index.html")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }

  throw new Error(`Claw Copilot dashboard assets not found. Tried: ${candidates.join(", ")}`);
}

export function resolveDashboardAssetPath(moduleUrl: string, relativePath: string): string | null {
  const here = path.dirname(fileURLToPath(moduleUrl));
  const normalized = relativePath.replace(/^\/+/, "");
  const candidates = [
    path.resolve(here, "dashboard", normalized),
    path.resolve(here, "../../dashboard/dist", normalized)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function injectDashboardShell(template: string, options: ShellOptions): string {
  const payload = JSON.stringify(options.payload).replaceAll("<", "\\u003c");
  const baseTag = `<base href="${escapeForTemplate(withTrailingSlash(options.basePath))}">`;
  const basePath = options.basePath;
  return template
    .replace("<head>", `<head>${baseTag}`)
    .replaceAll("./assets/", `${basePath}/assets/`)
    .replaceAll('="./assets/', `="${basePath}/assets/`)
    .replaceAll("__CREW_TITLE__", escapeForTemplate(options.title))
    .replaceAll("__CREW_BASE_PATH__", escapeForTemplate(options.basePath))
    .replace("__CREW_BOOTSTRAP__", payload);
}

function escapeForTemplate(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
