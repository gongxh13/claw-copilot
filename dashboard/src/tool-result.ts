export type ToolDetailSections = {
  input?: string;
  outputTexts: string[];
  error?: string;
  meta: Array<{ label: string; value: string }>;
};

export function buildToolDetailSections(argsText: string, resultText?: string, error?: string): ToolDetailSections {
  const sections: ToolDetailSections = {
    input: argsText || undefined,
    outputTexts: [],
    error,
    meta: []
  };

  if (error) {
    return sections;
  }

  if (!resultText) {
    return sections;
  }

  const parsed = tryParseJson(resultText);
  if (!parsed || typeof parsed !== "object") {
    sections.outputTexts = [resultText];
    return sections;
  }

  const content = Array.isArray((parsed as Record<string, unknown>).content) ? (parsed as Record<string, unknown>).content as unknown[] : undefined;
  if (content) {
    sections.outputTexts = content.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const record = item as Record<string, unknown>;
      const text = record.type === "text" && typeof record.text === "string" ? record.text : undefined;
      if (text) {
        const innerParsed = tryParseJson(text);
        if (innerParsed && typeof innerParsed === "object") {
          const inner = innerParsed as Record<string, unknown>;
          const reply = inner.reply;
          if (typeof reply === "string") {
            return [reply];
          }
          const runId = inner.runId;
          if (runId) {
            sections.meta.push({ label: "Run ID", value: String(runId) });
          }
          const status = inner.status;
          if (status) {
            sections.meta.push({ label: "Status", value: String(status) });
          }
          return [];
        }
        return [text];
      }
      return [];
    });
  }

  const details = (parsed as Record<string, unknown>).details;
  if (details && typeof details === "object") {
    const record = details as Record<string, unknown>;
    pushMeta(sections.meta, "Status", record.status);
    pushMeta(sections.meta, "Exit code", record.exitCode);
    pushMeta(sections.meta, "Duration", formatDuration(record.durationMs));
    pushMeta(sections.meta, "Cwd", record.cwd);
  }

  if (sections.outputTexts.length === 0 && typeof (parsed as Record<string, unknown>).details === "object") {
    const aggregated = (parsed as Record<string, unknown>).details as Record<string, unknown>;
    if (typeof aggregated.aggregated === "string" && aggregated.aggregated.trim()) {
      sections.outputTexts = [aggregated.aggregated];
    }
  }

  if (sections.outputTexts.length === 0) {
    sections.outputTexts = [resultText];
  }

  return sections;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function pushMeta(meta: ToolDetailSections["meta"], label: string, value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    meta.push({ label, value });
  } else if (typeof value === "number") {
    meta.push({ label, value: String(value) });
  }
}

function formatDuration(value: unknown): string | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}
