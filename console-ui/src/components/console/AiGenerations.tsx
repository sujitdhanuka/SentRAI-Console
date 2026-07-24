import { FileStack, PenLine } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { AIComponent } from '../../providers';
import { useConsoleUi } from '../../stores/consoleUi';
import { Badge, BadgeTone } from '../ui/Badge';

/** Provenance is the point of this panel: an unreviewed draft must look different
 *  from something a human signed off on. */
const SOURCE_TONE: Record<string, BadgeTone> = {
  ai: 'accent', heuristic: 'warning', human: 'positive', static: 'neutral',
};
const SOURCE_LABEL: Record<string, string> = {
  ai: 'AI draft', heuristic: 'auto draft', human: 'human-reviewed', static: 'from source',
};

type Kind = 'summary' | 'risk_rationale' | 'gap_remediation';

const ENDPOINT: Record<Kind, string> = {
  summary: 'summarize',
  risk_rationale: 'risk-rationale',
  gap_remediation: 'draft-remediation',
};

function Provenance({ source }: { source?: string | null }) {
  if (!source) return <Badge tone="neutral">not generated</Badge>;
  return <Badge tone={SOURCE_TONE[source] ?? 'neutral'}>{SOURCE_LABEL[source] ?? source}</Badge>;
}

/**
 * The three per-model generations, each with its provenance and a re-draft
 * button. Scans populate these automatically; this panel is how a reviewer
 * reads them, regenerates one, and sees which files the record came from.
 */
export function AiGenerations({ component, onChanged }: { component: AIComponent; onChanged: () => void }) {
  const toast = useConsoleUi((s) => s.toast);
  const [busy, setBusy] = useState<Kind | 'all' | null>(null);

  const run = async (kind: Kind) => {
    setBusy(kind);
    try {
      const res = await api<{ ai_enabled?: boolean; provider?: string; message?: string }>(
        `/inventory/models/${component.id}/${ENDPOINT[kind]}`,
        { method: 'POST' },
      );
      // A model with no open gaps has nothing to remediate — say so rather than
      // showing an empty block.
      if (res.message) toast(res.message);
      else toast(res.ai_enabled ? `Drafted by ${res.provider ?? 'AI'}` : 'Drafted locally (no AI provider configured)', 'positive');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Generation failed', 'negative');
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    setBusy('all');
    try {
      await api('/inventory/generate', {
        method: 'POST',
        body: JSON.stringify({ model_ids: [component.id], force: true }),
      });
      toast('Regenerating all three — this runs in the background', 'positive');
      // The queue drains asynchronously; give it a moment before refetching.
      setTimeout(onChanged, 1500);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not queue generation', 'negative');
    } finally {
      setBusy(null);
    }
  };

  const Block = ({ kind, title, body, source }: { kind: Kind; title: string; body?: string | null; source?: string | null }) => (
    <div className="border-t border-border px-3 py-2 first:border-t-0">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{title}</span>
        <Provenance source={source} />
        <button
          onClick={() => run(kind)}
          disabled={busy !== null}
          className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          <PenLine size={9} /> {busy === kind ? '…' : body ? 'Re-draft' : 'Draft'}
        </button>
      </div>
      {body ? (
        <p className="whitespace-pre-wrap text-[10.5px] leading-relaxed text-text-secondary">{body}</p>
      ) : (
        <p className="text-[10.5px] italic text-text-tertiary">Not generated yet.</p>
      )}
    </div>
  );

  const merged = (component.sourceRefs?.length ?? 0) > 1;

  return (
    <div className="border-t border-border">
      <div className="flex items-center gap-1.5 bg-bg-elevated px-3 py-1.5">
        <PenLine size={11} className="text-accent" />
        <span className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">AI generations</span>
        <button
          onClick={runAll}
          disabled={busy !== null}
          className="ml-auto rounded border border-border px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          {busy === 'all' ? 'Queued…' : 'Regenerate all'}
        </button>
      </div>

      {merged && (
        <div className="flex flex-wrap items-start gap-1.5 border-t border-border bg-surface px-3 py-1.5">
          <FileStack size={11} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">
              Merged from {component.sourceRefs!.length} files
            </div>
            <ul className="mt-0.5">
              {component.sourceRefs!.map((f) => (
                <li key={f} className="break-all font-mono text-[9.5px] text-text-secondary">{f}</li>
              ))}
            </ul>
            <p className="mt-0.5 text-[9px] text-text-tertiary">
              The scan found this model in several places; they are governed as one record.
            </p>
          </div>
        </div>
      )}

      <Block kind="summary" title="Use-case summary" body={component.description} source={component.descriptionSource} />
      <Block kind="risk_rationale" title="Risk rationale" body={component.riskRationale} source={component.riskRationaleSource} />
      <Block kind="gap_remediation" title="Gap remediation" body={component.gapRemediation} source={component.gapRemediationSource} />
    </div>
  );
}
