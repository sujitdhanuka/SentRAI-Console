/**
 * Renders a free-text field's Markdown (paragraphs, headings, lists, bold,
 * italic, code) as React elements. It never sets innerHTML, so text in a
 * field, including LLM-written text, cannot inject markup.
 */
import type { ReactNode } from 'react';

import { mdBlocks, type MdRun } from '../../lib/markdownLite';

function Runs({ runs }: { runs: MdRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let el: ReactNode = r.text;
        if (r.code) el = <code className="rounded bg-bg-elevated px-0.5 font-mono text-[0.92em]">{el}</code>;
        if (r.italic) el = <em>{el}</em>;
        if (r.bold) el = <strong className="font-semibold">{el}</strong>;
        return <span key={i}>{el}</span>;
      })}
    </>
  );
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = mdBlocks(text);
  return (
    <div className={`space-y-1.5 ${className}`}>
      {blocks.map((b, i) =>
        b.kind === 'h' ? (
          <div key={i} className="font-semibold"><Runs runs={b.runs} /></div>
        ) : b.kind === 'li' ? (
          <div key={i} className="flex gap-1.5" style={{ paddingLeft: (b.level ?? 1) > 1 ? 12 : 0, marginTop: i && blocks[i - 1].kind === 'li' ? 2 : undefined }}>
            <span className="shrink-0 text-text-tertiary">{b.marker}</span>
            <span><Runs runs={b.runs} /></span>
          </div>
        ) : (
          <p key={i}><Runs runs={b.runs} /></p>
        ),
      )}
    </div>
  );
}
