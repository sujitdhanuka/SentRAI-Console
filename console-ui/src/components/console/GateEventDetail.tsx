import { CheckCircle2, FileCode2, FileJson2, ShieldCheck, PenLine } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import type { GateEvent } from '../../pages/CiLedger';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className="break-all font-mono text-[10px] text-text">{value}</div>
    </div>
  );
}

/**
 * Auditor view of one gate decision: the immutable verdict, the governance
 * omissions that caused it, and the AST-flagged lines as evidence. Override is
 * ADDITIVE — the panel always keeps showing the original FAIL alongside the
 * sign-off, because rewriting a verdict would destroy the audit trail.
 */
export function GateEventDetail({
  event,
  canOverride,
  onOverride,
}: {
  event: GateEvent | null;
  canOverride: boolean;
  onOverride: (ev: GateEvent, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sarif, setSarif] = useState<{ forId: string; body: string } | null>(null);
  const [sarifBusy, setSarifBusy] = useState(false);

  // The exact artifact the pipeline uploaded to the Security tab, rebuilt
  // from the ledger — viewable and downloadable without leaving the console.
  const toggleSarif = async (ev: GateEvent) => {
    if (sarif?.forId === ev.gate_event_id) { setSarif(null); return; }
    setSarifBusy(true);
    try {
      const doc = await api<unknown>(`/ci/events/${ev.gate_event_id}/sarif`);
      setSarif({ forId: ev.gate_event_id, body: JSON.stringify(doc, null, 2) });
    } finally {
      setSarifBusy(false);
    }
  };

  const downloadSarif = (ev: GateEvent) => {
    if (!sarif) return;
    const url = URL.createObjectURL(new Blob([sarif.body], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentrai-${ev.commit_sha ?? ev.gate_event_id}.sarif`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!event) {
    return (
      <Panel title="Gate decision" className="flex-1">
        <p className="p-3 text-[11px] text-text-secondary">Select a gate event to inspect its evidence.</p>
      </Panel>
    );
  }

  const submit = async () => {
    if (reason.trim().length < 10) return;
    setBusy(true);
    try {
      await onOverride(event, reason.trim());
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Gate decision"
      className="flex-1"
      right={<Badge tone={event.verdict === 'pass' ? 'positive' : 'negative'}>original: {event.verdict}</Badge>}
    >
      <div className="p-3">
        <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2">
          <Kv label="Commit" value={event.commit_sha ?? '—'} />
          <Kv label="Pipeline run" value={event.pipeline_run_id ?? '—'} />
          <Kv label="Project" value={event.project_name ?? event.project_id.slice(0, 8)} />
          <Kv label="Triggered by" value={event.triggered_by} />
          <Kv label="Models detected" value={String(event.models_detected)} />
          <Kv label="Recorded" value={new Date(event.occurred_at).toLocaleString()} />
        </div>

        {event.overridden && (
          <div className="mb-3 rounded-md border border-accent bg-accent-soft px-2.5 py-2">
            <div className="mb-1 flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-accent" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-accent">Auditor override</span>
            </div>
            <p className="text-[10.5px] text-text">{event.override_reason}</p>
            <p className="mt-1 font-mono text-[9px] text-text-tertiary">
              {event.overridden_by} · {event.overridden_at ? new Date(event.overridden_at).toLocaleString() : ''}
            </p>
            <p className="mt-1 text-[9.5px] italic text-text-tertiary">
              The original <b>FAIL</b> verdict above is preserved — this sign-off is recorded alongside it, never in place of it.
            </p>
          </div>
        )}

        <h3 className="mb-1.5 font-heading text-[10px] font-medium uppercase tracking-wider text-text-secondary">
          Blocking violations ({event.blocking_violations.length})
        </h3>

        {!event.blocking_violations.length ? (
          <p className="flex items-center gap-1.5 text-[11px] text-positive">
            <CheckCircle2 size={13} /> No governance omissions — this scan passed cleanly.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {event.blocking_violations.map((g, i) => (
              <li key={i} className="rounded-md border border-border border-l-2 border-l-negative bg-bg-elevated px-2.5 py-2">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {g.shadow && <Badge tone="negative" title="No governed model backs this asset">shadow AI</Badge>}
                  <span className="text-[11px] font-medium text-text">{g.model_name}</span>
                  <Badge tone="warning">{g.severity}</Badge>
                </div>
                <p className="mb-1 text-[10.5px] text-text-secondary">{g.reason}</p>
                {g.missing?.length > 0 && (
                  <p className="mb-1 font-mono text-[9px] text-text-tertiary">missing: {g.missing.join(', ')}</p>
                )}
                <p className="flex items-center gap-1 font-mono text-[9px] text-text-tertiary">
                  <FileCode2 size={10} /> {g.file_location}
                </p>
                {g.evidence?.length ? (
                  <div className="mt-1.5 overflow-x-auto rounded border border-border bg-surface">
                    {g.evidence.map((e, j) => (
                      <div key={j} className="flex gap-2 whitespace-pre px-2 py-0.5 font-mono text-[9.5px]">
                        <span className="select-none text-text-tertiary">{String(e.line).padStart(4)}</span>
                        <span className="text-text">{e.snippet}</span>
                        <span className="ml-auto pl-2 text-accent">{e.category}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* The SARIF artifact — what the pipeline uploads to the Security tab. */}
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => toggleSarif(event)} disabled={sarifBusy}
              title="The SARIF report for this gate decision, rebuilt from the ledger — identical to what the pipeline uploaded to the GitHub/GitLab Security tab"
              icon={<FileJson2 size={11} />}>
              {sarifBusy ? 'Loading…' : sarif?.forId === event.gate_event_id ? 'Hide SARIF' : 'View SARIF'}
            </Button>
            {sarif?.forId === event.gate_event_id && (
              <Button variant="secondary" size="sm" onClick={() => downloadSarif(event)}>Download .sarif</Button>
            )}
          </div>
          {sarif?.forId === event.gate_event_id && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-bg-elevated p-2.5 font-mono text-[9.5px] leading-relaxed text-text-secondary">
              {sarif.body}
            </pre>
          )}
        </div>

        {canOverride && event.verdict === 'fail' && !event.overridden && (
          <div className="mt-3 rounded-md border border-border p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <PenLine size={12} className="text-accent" />
              <span className="font-heading text-[10px] font-medium uppercase tracking-wider text-text-secondary">
                Sign off with justification
              </span>
            </div>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is deploying acceptable despite the blocking violations? (recorded permanently, min 10 chars)"
              className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[11px] text-text placeholder:text-text-tertiary focus:border-accent"
            />
            <Button variant="primary" size="md" onClick={submit} disabled={busy || reason.trim().length < 10} className="mt-2 w-full">
              {busy ? 'Recording…' : 'Record override'}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
