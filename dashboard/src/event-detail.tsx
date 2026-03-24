import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ToolDetailSections } from "./tool-result";

type EventDetailProps = {
  kind: string;
  text: string;
  toolDetail?: ToolDetailSections;
};

export function EventDetail({ kind, text, toolDetail }: EventDetailProps) {
  if (toolDetail) {
    return (
      <div className="se-split">
        {toolDetail.input ? <DetailBlock title="Input"><MarkdownText text={toolDetail.input} /></DetailBlock> : null}
        {toolDetail.outputTexts.length > 0 ? (
          <DetailBlock title="Output">
            <ul className="se-list">
              {toolDetail.outputTexts.map((item, index) => (
                <li key={`${index}-${item.slice(0, 16)}`}><MarkdownText text={item} /></li>
              ))}
            </ul>
          </DetailBlock>
        ) : null}
        {toolDetail.error ? <DetailBlock title="Output"><MarkdownText text={toolDetail.error} /></DetailBlock> : null}
        {toolDetail.meta.length > 0 ? (
          <DetailBlock title="Meta">
            <div className="se-meta">
              {toolDetail.meta.map((item) => (
                <div className="se-meta-row" key={`${item.label}-${item.value}`}>
                  <span className="se-meta-label">{item.label}</span>
                  <span className="se-meta-value">{item.value}</span>
                </div>
              ))}
            </div>
          </DetailBlock>
        ) : null}
      </div>
    );
  }

  if (kind === "prompt" || kind === "out") {
    return <MarkdownText text={text} />;
  }

  return <div className="se-tx">{text}</div>;
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="se-block">
      <div className="se-block-title">{title}</div>
      {children}
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="se-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
