import { ClipboardCheck, Plus, RefreshCw, Search } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { useModels } from '../api/models';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';
import { routeParam } from '../stores/route';

/* ── Shared bits ──────────────────────────────────────────────────────────── */

const TH = 'sticky top-0 z-10 border-b border-border bg-surface px-2 py-1.5 text-left text-[9px] font-medium uppercase tracking-widest text-text-tertiary';
const TD = 'px-2 py-1.5 align-top';
import { fieldClass as FIELD } from '../components/ui/form';
import { labelClass as LABEL } from '../components/ui/form';

const VERDICT_TONE: Record<string, BadgeTone> = {
  COMPLIANT: 'positive', CONDITIONAL: 'warning', NON_COMPLIANT: 'negative',
};
/** Audit verdict values stay as the API sends them; the labels never say "compliant". */
const VERDICT_LABEL: Record<string, string> = {
  COMPLIANT: 'No findings', CONDITIONAL: 'Conditional', NON_COMPLIANT: 'Critical findings',
};
const verdictLabel = (v: string) => VERDICT_LABEL[v] ?? v;

/* ── View 1 · Model audits (the AI Audit Framework) ───────────────────────── */

interface AuditRow {
  audit_id: string;
  audit_type: string;
  auditor_ref: string;
  overall_verdict: string;
  explainability_score: number;
  sutras_compliance: Record<string, boolean>;
  findings: Array<{ finding_id?: string; category: string; severity: string; description: string }>;
  next_audit_due: string | null;
  created_at: string;
}

/** Checklist groups mirror AuditChecklistDto — the three audit dimensions plus
 *  the 7-sutras verification the RBI framework expects an auditor to attest. */
const CHECK_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Input data audit',
    items: [
      ['training_data_bias_checked', 'Training data bias checked'],
      ['data_consent_verified', 'Data consent verified'],
      ['data_sources_documented', 'Data sources documented'],
      ['sensitive_attributes_excluded', 'Sensitive attributes excluded'],
    ],
  },
  {
    title: 'Model & algorithm audit',
    items: [
      ['model_architecture_reviewed', 'Architecture reviewed'],
      ['decision_logic_documented', 'Decision logic documented'],
      ['adversarial_robustness_tested', 'Adversarial robustness tested'],
      ['performance_benchmarks_met', 'Performance benchmarks met'],
    ],
  },
  {
    title: 'Output & behaviour audit',
    items: [
      ['bcp_verified', 'BCP verified'],
      ['human_override_tested', 'Human override tested'],
    ],
  },
  {
    title: '7 sutras verification',
    items: [
      ['trust_verified', 'Trust verified'],
      ['human_oversight_verified', 'Human oversight verified'],
      ['innovation_not_stifled', 'Innovation not stifled'],
      ['fairness_metrics_passed', 'Fairness metrics passed'],
      ['accountability_chain_documented', 'Accountability documented'],
      ['explainability_verified', 'Explainability verified'],
    ],
  },
];

const EMPTY_CHECKS: Record<string, boolean> = Object.fromEntries(
  CHECK_GROUPS.flatMap((g) => g.items.map(([k]) => [k, k === 'innovation_not_stifled'])),
);

const SEVERITIES = ['critical', 'major', 'minor', 'observation'];
const SEV_TONE: Record<string, BadgeTone> = {
  critical: 'negative', major: 'negative', minor: 'warning', observation: 'neutral',
};

function ModelAudits() {
  const toast = useConsoleUi((s) => s.toast);
  const { models } = useModels();
  const [modelId, setModelId] = useState('');
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [auditorRef, setAuditorRef] = useState('');
  const [auditType, setAuditType] = useState('INTERNAL');
  const [explainScore, setExplainScore] = useState('0.8');
  const [checks, setChecks] = useState<Record<string, boolean>>(EMPTY_CHECKS);

  // Add-finding form state, keyed to the audit it targets.
  const [findingFor, setFindingFor] = useState<string | null>(null);
  const [finding, setFinding] = useState({ category: 'data', severity: 'minor', description: '' });

  useEffect(() => {
    if (modelId || !models.length) return;
    // Opened from Red team & audit ("Record audit") or a model page: start on that model.
    const wanted = routeParam('model');
    setModelId(wanted && models.some((m) => m.model_id === wanted) ? wanted : models[0].model_id);
  }, [models, modelId]);

  const load = useCallback(async () => {
    if (!modelId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await api<AuditRow[]>(`/audit/models/${modelId}/audits`);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit history');
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ overall_verdict: string; next_audit_due: string | null }>(
        `/audit/models/${modelId}/initiate`,
        {
          method: 'POST',
          body: JSON.stringify({
            auditor_ref: auditorRef,
            audit_type: auditType,
            explainability_score: Math.min(1, Math.max(0, parseFloat(explainScore) || 0)),
            ...checks,
          }),
        },
      );
      toast(`Audit recorded — ${verdictLabel(res.overall_verdict)}`, res.overall_verdict === 'COMPLIANT' ? 'positive' : 'negative');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Audit failed', 'negative');
    } finally {
      setBusy(false);
    }
  };

  const addFinding = async (auditId: string) => {
    try {
      const res = await api<{ verdict: string }>(`/audit/models/${modelId}/findings/${auditId}`, {
        method: 'POST',
        body: JSON.stringify({ ...finding }),
      });
      // A critical/major finding flips the verdict server-side — surface that.
      toast(`Finding recorded — verdict now ${res.verdict}`);
      setFindingFor(null);
      setFinding({ category: 'data', severity: 'minor', description: '' });
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record finding', 'negative');
    }
  };

  const selected = models.find((m) => m.model_id === modelId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Panel title="Initiate audit" className="shrink-0">
        <form onSubmit={run} className="p-3">
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <label className={LABEL}>Model</label>
              <select className={FIELD} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {models.map((m) => (
                  <option key={m.model_id} value={m.model_id}>{m.name} ({m.risk_level})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Audit type</label>
              <select className={FIELD} value={auditType} onChange={(e) => setAuditType(e.target.value)}>
                <option value="INTERNAL">Internal</option>
                <option value="THIRD_PARTY">Third party</option>
                <option value="SUPERVISORY">Supervisory</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Auditor reference</label>
              <input className={FIELD} required value={auditorRef} onChange={(e) => setAuditorRef(e.target.value)} placeholder="e.g. Internal Risk Team" />
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {CHECK_GROUPS.map((g) => (
              <fieldset key={g.title} className="rounded-md border border-border p-2.5">
                <legend className="px-1 text-[9px] font-medium uppercase tracking-widest text-accent">{g.title}</legend>
                <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
                  {g.items.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1.5 text-[10.5px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={checks[key]}
                        onChange={(e) => setChecks({ ...checks, [key]: e.target.checked })}
                        className="accent-accent"
                      />
                      {label}
                    </label>
                  ))}
                  {g.title === 'Output & behaviour audit' && (
                    <label className="col-span-full mt-1 flex items-center gap-2 text-[10.5px] text-text-secondary">
                      Explainability score (0–1)
                      <input
                        type="number" min="0" max="1" step="0.05"
                        value={explainScore}
                        onChange={(e) => setExplainScore(e.target.value)}
                        className="w-20 rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-[11px] text-text focus:border-accent"
                      />
                    </label>
                  )}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="mr-auto text-[10px] text-text-tertiary">
              The verdict is computed from the checklist — unchecked items become the audit's gaps.
            </span>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !modelId} icon={<ClipboardCheck size={13} />}>
              {busy ? 'Running…' : 'Run audit'}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel
        title={`Audit history${selected ? ` — ${selected.name}` : ''}`}
        className="min-h-0 flex-1"
        right={<Badge tone="neutral">{history.length}</Badge>}
      >
        {error ? (
          <PanelError onRetry={load} />
        ) : loading ? (
          <SkeletonRows rows={4} />
        ) : !history.length ? (
          <p className="p-3 text-[11px] text-text-secondary">
            No audits recorded for this model yet. Run the checklist above — HIGH-risk models are due every
            180 days, MEDIUM every 365, LOW every 730.
          </p>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Type</th>
                <th className={TH}>Auditor</th>
                <th className={TH}>Verdict</th>
                <th className={TH}>Explainability</th>
                <th className={TH}>Findings</th>
                <th className={TH}>Next due</th>
              </tr>
            </thead>
            <tbody>
              {history.map((a) => (
                <>
                  <tr
                    key={a.audit_id}
                    onClick={() => setExpanded(expanded === a.audit_id ? null : a.audit_id)}
                    className="cursor-pointer border-b border-border hover:bg-surface-hover"
                  >
                    <td className={`${TD} font-mono text-[9.5px] text-text-tertiary`}>{new Date(a.created_at).toLocaleDateString()}</td>
                    <td className={`${TD} font-mono text-[10px]`}>{a.audit_type}</td>
                    <td className={`${TD} text-[10.5px] text-text-secondary`}>{a.auditor_ref}</td>
                    <td className={TD}><Badge tone={VERDICT_TONE[a.overall_verdict] ?? 'neutral'}>{verdictLabel(a.overall_verdict)}</Badge></td>
                    <td className={`${TD} font-mono text-[10px]`}>{a.explainability_score.toFixed(2)}</td>
                    <td className={`${TD} font-mono text-[10px] ${a.findings?.length ? 'text-warning' : 'text-text-tertiary'}`}>{a.findings?.length ?? 0}</td>
                    <td className={`${TD} font-mono text-[9.5px] text-text-tertiary`}>{a.next_audit_due ? new Date(a.next_audit_due).toLocaleDateString() : '—'}</td>
                  </tr>
                  {expanded === a.audit_id && (
                    <tr key={`${a.audit_id}-x`} className="border-b border-border">
                      <td colSpan={7} className="bg-bg-elevated px-3 py-2">
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {Object.entries(a.sutras_compliance ?? {}).map(([sutra, ok]) => (
                            <Badge key={sutra} tone={ok ? 'positive' : 'negative'}>{sutra.replace(/_/g, ' ').toLowerCase()}</Badge>
                          ))}
                        </div>
                        {(a.findings ?? []).map((f, i) => (
                          <p key={f.finding_id ?? i} className="mb-1 text-[10.5px] text-text-secondary">
                            <Badge tone={SEV_TONE[f.severity] ?? 'neutral'}>{f.severity}</Badge>{' '}
                            <span className="font-mono text-[9.5px] text-text-tertiary">[{f.category}]</span> {f.description}
                          </p>
                        ))}
                        {findingFor === a.audit_id ? (
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            <div>
                              <label className={LABEL}>Category</label>
                              <input className={`${FIELD} w-32`} value={finding.category} onChange={(e) => setFinding({ ...finding, category: e.target.value })} />
                            </div>
                            <div>
                              <label className={LABEL}>Severity</label>
                              <select className={`${FIELD} w-32`} value={finding.severity} onChange={(e) => setFinding({ ...finding, severity: e.target.value })}>
                                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="min-w-[220px] flex-1">
                              <label className={LABEL}>Description</label>
                              <input className={FIELD} value={finding.description} onChange={(e) => setFinding({ ...finding, description: e.target.value })} placeholder="What the auditor found" />
                            </div>
                            <Button variant="primary" size="sm" onClick={() => void addFinding(a.audit_id)} disabled={!finding.description.trim()}>
                              Record finding
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setFindingFor(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => setFindingFor(a.audit_id)} className="mt-1" icon={<Plus size={10} />}>
                            Add finding
                            <span className="ml-1 font-normal text-text-tertiary">— a critical or major finding flips the verdict</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/* ── View 2 · API action log (unchanged behaviour) ────────────────────────── */

interface AuditEvent {
  event_id?: string;
  actor?: string;
  method?: string;
  path?: string;
  status_code?: number;
  occurred_at?: string;
  payload_summary?: unknown;
  content_hash?: string | null;
  prev_hash?: string | null;
}

interface ChainVerdict {
  intact: boolean;
  chained: number;
  legacy_unchained: number;
  head_hash: string | null;
  reason: string | null;
}

const METHOD_TONE: Record<string, BadgeTone> = {
  POST: 'positive', PATCH: 'warning', PUT: 'warning', DELETE: 'negative', GET: 'neutral',
};

function EventLog({ reloadKey }: { reloadKey: number }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actor, setActor] = useState('');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainVerdict | null>(null);
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    setVerifying(true);
    try {
      setChain(await api<ChainVerdict>('/audit/events/verify'));
    } catch {
      setChain(null);
    } finally {
      setVerifying(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (actor.trim()) qs.set('actor', actor.trim());
      if (path.trim()) qs.set('path', path.trim());
      const rows = await api<AuditEvent[]>(`/audit/events?${qs}`);
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  }, [actor, path]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  return (
    <Panel
      title="Mutating API actions"
      className="min-h-0 flex-1"
      right={
        <span className="flex items-center gap-2">
          {chain && (
            <Badge tone={chain.intact ? 'positive' : 'negative'} title={chain.reason ?? `head ${chain.head_hash?.slice(0, 12)}…`}>
              {chain.intact ? `⛓ chain intact · ${chain.chained} events` : `⛓ CHAIN BROKEN — ${chain.reason}`}
            </Badge>
          )}
          <button
            onClick={verify}
            disabled={verifying}
            title="Recompute every event's SHA-256 and follow the chain from GENESIS — proof the ledger hasn't been altered"
            className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
          >
            {verifying ? 'verifying…' : 'Verify chain'}
          </button>
          <Badge tone="neutral">{events.length}</Badge>
        </span>
      }
    >
      <div className="sticky top-0 z-20 flex flex-wrap gap-2 border-b border-border bg-surface p-2">
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2">
          <Search size={11} className="text-text-tertiary" />
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="filter by actor"
            className="w-40 bg-transparent py-1 text-[11px] text-text placeholder:text-text-tertiary focus:outline-none" />
        </span>
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2">
          <Search size={11} className="text-text-tertiary" />
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="filter by path"
            className="w-48 bg-transparent py-1 text-[11px] text-text placeholder:text-text-tertiary focus:outline-none" />
        </span>
        <span className="ml-auto self-center font-mono text-[9px] text-text-tertiary">PII-masked · append-only</span>
      </div>

      {error ? (
        <PanelError onRetry={load} />
      ) : loading ? (
        <SkeletonRows rows={10} />
      ) : !events.length ? (
        <p className="p-3 text-[11px] text-text-secondary">No audit events match this filter.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className={TH}>When</th>
              <th className={TH}>Actor</th>
              <th className={TH}>Action</th>
              <th className={TH}>Status</th>
              <th className={TH}>Hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => {
              const key = e.event_id ?? String(i);
              const ok = (e.status_code ?? 200) < 400;
              return (
                <>
                  <tr key={key} onClick={() => setExpanded(expanded === key ? null : key)}
                    className="cursor-pointer border-b border-border hover:bg-surface-hover">
                    <td className={`${TD} font-mono text-[9.5px] text-text-tertiary`}>
                      {e.occurred_at ? new Date(e.occurred_at).toLocaleString() : '—'}
                    </td>
                    <td className={`${TD} text-[10.5px] text-text-secondary`}>{e.actor ?? 'system'}</td>
                    <td className={TD}>
                      <span className="flex items-center gap-1.5">
                        <Badge tone={METHOD_TONE[e.method ?? 'GET'] ?? 'neutral'}>{e.method ?? '—'}</Badge>
                        <code className="font-mono text-[10px] text-text">{e.path ?? '—'}</code>
                      </span>
                    </td>
                    <td className={`${TD} font-mono text-[10px] ${ok ? 'text-positive' : 'text-negative'}`}>{e.status_code ?? '—'}</td>
                    <td className={`${TD} font-mono text-[9px] text-text-tertiary`} title={e.content_hash ?? 'pre-chain event (no hash)'}>
                      {e.content_hash ? `${e.content_hash.slice(0, 10)}…` : '—'}
                    </td>
                  </tr>
                  {expanded === key && (
                    <tr key={`${key}-x`} className="border-b border-border">
                      <td colSpan={5} className="px-2 pb-2">
                        {e.content_hash && (
                          <div className="mb-1.5 rounded border border-border bg-bg-elevated p-2 font-mono text-[9px] leading-relaxed">
                            <div><span className="text-text-tertiary">sha256    </span><span className="text-accent">{e.content_hash}</span></div>
                            <div><span className="text-text-tertiary">prev_hash </span><span className="text-text-secondary">{e.prev_hash}</span></div>
                            <div className="mt-0.5 text-text-tertiary">Each event's hash covers its content + the previous hash — altering any record breaks every link after it.</div>
                          </div>
                        )}
                        {e.payload_summary != null && (
                        <pre className="max-h-52 overflow-auto rounded border border-border bg-bg-elevated p-2 font-mono text-[9.5px] text-text-secondary">
                          {JSON.stringify(e.payload_summary, null, 2)}
                        </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* ── Page shell: the two views under one roof ─────────────────────────────── */

type View = 'audits' | 'log';

export function AuditTrail() {
  // "Model audits" is the working tool, so it leads; the API log is the
  // forensic record behind it. Both were one tab in the classic console.
  const [view, setView] = useState<View>('audits');
  const [reloadKey, setReloadKey] = useState(0);

  const TabBtn = ({ v, label }: { v: View; label: string }) => (
    <Button variant={view === v ? 'primary' : 'secondary'} size="sm" onClick={() => setView(v)}>{label}</Button>
  );

  return (
    <AppShell
      title="Audit Trail"
      actions={
        <>
          <TabBtn v="audits" label="Model audits" />
          <TabBtn v="log" label="API action log" />
          {view === 'log' && (
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)} title="Refresh" aria-label="Refresh" className="px-1.5" icon={<RefreshCw size={13} />} />
          )}
        </>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        {view === 'audits' ? <ModelAudits /> : <EventLog reloadKey={reloadKey} />}
      </main>
    </AppShell>
  );
}
