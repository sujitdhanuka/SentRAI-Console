import { ClipboardCheck, FileSignature, ListPlus, ShieldAlert, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { useConsoleUi } from '../stores/consoleUi';

/* ------------------------------------------------------------- shared */

interface ModelRow { model_id: string; name: string; risk_level: string }

export function useModels() {
  const [models, setModels] = useState<ModelRow[]>([]);
  useEffect(() => {
    api<any>('/inventory/models')
      .then((r) => setModels((Array.isArray(r) ? r : r.models ?? r.items ?? []).map((m: any) => ({ model_id: m.model_id, name: m.name, risk_level: m.risk_level }))))
      .catch(() => setModels([]));
  }, []);
  return models;
}

function ModelPicker({ models, value, onChange, allowAll }: { models: ModelRow[]; value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  return (
    <select aria-label="Model" className={`${FIELD} max-w-xs`} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll ? <option value="">All models and organisation risks</option> : <option value="">Choose a model…</option>}
      {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name} · {m.risk_level}</option>)}
    </select>
  );
}

const BAND_TONE: Record<string, BadgeTone> = { LOW: 'positive', MEDIUM: 'warning', HIGH: 'negative', CRITICAL: 'negative' };
const STATUS_TONE: Record<string, BadgeTone> = { DRAFT: 'neutral', ASSESSED: 'warning', ACCEPTED: 'positive', REVIEW_DUE: 'negative', CLOSED: 'neutral', DISMISSED: 'neutral' };

/* -------------------------------------------------------- risk register */

interface Risk {
  risk_id: string; scope_type: string; scope_id: string | null; category: string; title: string; description: string | null;
  status: string; source: string; review_reason: string | null; next_review_at: string | null; within_appetite: boolean; ceiling: number | null;
  rescore_required: boolean; required_approvers: string[];
  assessment: null | { version: number; matrix: string; inherent: { likelihood: number; impact: number; score: number; band: string }; residual: { likelihood: number; impact: number; score: number; band: string }; rationale: string | null };
  acceptance: null | { accepted_by: string; role: string; accepted_at: string; expires_at: string | null; waiver_ref: string | null };
  actions?: Array<{ action_id: string; treatment: string; action: string; status: string; due_at: string | null; overdue: boolean }>;
}
interface RiskList { scoring_matrix: '5x5' | '3x3'; risks: Risk[]; summary: { total: number; open: number; review_due: number; accepted: number; above_appetite_unaccepted: number } }
interface Heatmap { matrix: string; residual: number[][]; inherent: number[][]; counted: number; awaiting_rescore: number; bands: Array<{ name: string; min: number; max: number }> }
interface Gate { verdict: string; mode: string; tier: string | null; block: Array<{ code: string; message: string }>; warn: Array<{ code: string; message: string }> }

const CATEGORIES = ['FAIRNESS', 'TRANSPARENCY', 'PRIVACY', 'SECURITY', 'PERFORMANCE', 'THIRD_PARTY', 'RESILIENCE', 'CONDUCT', 'MODEL_RISK', 'LEGAL', 'ENVIRONMENT'];

function HeatGrid({ h, kind }: { h: Heatmap; kind: 'residual' | 'inherent' }) {
  const n = h.matrix === '3x3' ? 3 : 5;
  const bandOf = (s: number) => h.bands.find((b) => s >= b.min && s <= b.max)?.name ?? 'LOW';
  const tone: Record<string, string> = { LOW: 'bg-positive-soft', MEDIUM: 'bg-warning-soft', HIGH: 'bg-negative-soft', CRITICAL: 'bg-negative' };
  return (
    <div>
      <div className={LABEL}>{kind} (likelihood ↓ × impact →)</div>
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${n}, 28px)` }} role="table" aria-label={`${kind} heatmap`}>
        {Array.from({ length: n }, (_, r) => n - 1 - r).map((l) =>
          Array.from({ length: n }, (_, i) => (
            <div key={`${l}-${i}`} role="cell" title={`L${l + 1} × I${i + 1}`} className={`flex h-7 items-center justify-center font-mono text-[10px] ${tone[bandOf((l + 1) * (i + 1))]} ${bandOf((l + 1) * (i + 1)) === 'CRITICAL' ? 'text-white' : 'text-text'}`}>
              {h[kind][l][i] || ''}
            </div>
          )),
        )}
      </div>
    </div>
  );
}

function RiskDetail({ risk, matrix, onChanged }: { risk: Risk; matrix: '5x5' | '3x3'; onChanged: () => void }) {
  const toast = useConsoleUi((s) => s.toast);
  const n = matrix === '3x3' ? 3 : 5;
  const a = risk.assessment;
  const [form, setForm] = useState({ il: a?.inherent.likelihood ?? 3, ii: a?.inherent.impact ?? 3, rl: a?.residual.likelihood ?? 2, ri: a?.residual.impact ?? 3, rationale: '' });
  const [note, setNote] = useState('');
  const [waiver, setWaiver] = useState('');
  const [reason, setReason] = useState('');
  const [action, setAction] = useState({ treatment: 'MITIGATE', action: '', due_at: '' });
  const call = async (path: string, body: any, ok: string, method = 'POST') => {
    try {
      await api(path, { method, body: JSON.stringify(body) });
      toast(ok, 'positive');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'negative');
    }
  };
  const opts = Array.from({ length: n }, (_, i) => i + 1);
  const sel = (k: 'il' | 'ii' | 'rl' | 'ri', label: string) => (
    <label className="text-[10px] text-text-secondary">{label}
      <select className={FIELD} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
    </label>
  );
  return (
    <div className="space-y-3 p-3">
      <div>
        <div className="text-[12px] font-medium text-text">{risk.title}</div>
        <p className="text-[11px] text-text-secondary">{risk.description}</p>
        {risk.review_reason && <p className="mt-1 text-[10.5px] text-negative">Review due: {risk.review_reason}</p>}
        {risk.rescore_required && <p className="mt-1 text-[10.5px] text-warning">The scoring matrix changed since this rating: re-score it.</p>}
      </div>
      {!['DISMISSED', 'CLOSED'].includes(risk.status) && (
        <div className="rounded border border-border p-2">
          <div className={LABEL}>Assess (inherent before controls, residual after)</div>
          <div className="grid grid-cols-4 gap-1">
            {sel('il', 'Inherent L')}{sel('ii', 'Inherent I')}{sel('rl', 'Residual L')}{sel('ri', 'Residual I')}
          </div>
          <textarea aria-label="Rationale" className={`${FIELD} mt-1`} rows={2} placeholder="Rationale and the evidence for the controls relied on" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} />
          <Button className="mt-1" size="xs" variant="secondary" disabled={form.rationale.trim().length < 10}
            onClick={() => call(`/governance/risks/${risk.risk_id}/assess`, { inherent_likelihood: form.il, inherent_impact: form.ii, residual_likelihood: form.rl, residual_impact: form.ri, rationale: form.rationale }, 'Assessment saved')}>
            Save assessment
          </Button>
        </div>
      )}
      {a && risk.status === 'ASSESSED' && (
        <div className="rounded border border-border p-2">
          <div className={LABEL}>Accept residual {a.residual.band} risk · needs {risk.required_approvers.map((r) => (r === 'ACCOUNTABLE_OFFICIAL' ? 'accountable official' : r)).join(' or ')}</div>
          <input aria-label="Acceptance note" className={FIELD} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <input aria-label="Waiver reference" className={`${FIELD} mt-1`} placeholder="Waiver / exception reference (optional)" value={waiver} onChange={(e) => setWaiver(e.target.value)} />
          <Button className="mt-1" size="xs" variant="primary" onClick={() => call(`/governance/risks/${risk.risk_id}/accept`, { note, waiver_ref: waiver || undefined }, 'Risk accepted')}>
            <FileSignature size={11} /> Accept residual risk
          </Button>
        </div>
      )}
      {risk.status === 'DRAFT' && (
        <div className="flex gap-1">
          <input aria-label="Dismiss reason" className={FIELD} placeholder="Reason to dismiss this suggestion" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="xs" variant="danger" disabled={reason.trim().length < 5} onClick={() => call(`/governance/risks/${risk.risk_id}/dismiss`, { reason }, 'Dismissed')}>Dismiss</Button>
        </div>
      )}
      <div>
        <div className={LABEL}>Treatment actions</div>
        {(risk.actions ?? []).map((x) => (
          <div key={x.action_id} className="flex items-center gap-2 text-[10.5px]">
            <Badge tone="neutral">{x.treatment}</Badge><span className="text-text">{x.action}</span>
            {x.overdue && <Badge tone="negative">overdue</Badge>}
            <span className="ml-auto text-text-tertiary">{x.status}</span>
            {x.status === 'OPEN' && <Button size="xs" variant="ghost" onClick={() => call(`/governance/risks/${risk.risk_id}/actions/${x.action_id}`, { status: 'DONE' }, 'Action done', 'PATCH')}>Done</Button>}
          </div>
        ))}
        <div className="mt-1 flex gap-1">
          <select aria-label="Treatment" className={`${FIELD} w-28`} value={action.treatment} onChange={(e) => setAction({ ...action, treatment: e.target.value })}>
            {['MITIGATE', 'TRANSFER', 'AVOID', 'ACCEPT'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input aria-label="Action" className={FIELD} placeholder="Action" value={action.action} onChange={(e) => setAction({ ...action, action: e.target.value })} />
          <input aria-label="Due date" type="date" className={`${FIELD} w-36`} value={action.due_at} onChange={(e) => setAction({ ...action, due_at: e.target.value })} />
          <Button size="xs" variant="secondary" disabled={!action.action.trim()} onClick={() => call(`/governance/risks/${risk.risk_id}/actions`, { ...action, due_at: action.due_at || undefined }, 'Action added')}>Add</Button>
        </div>
      </div>
    </div>
  );
}

export function RiskRegisterTab() {
  const toast = useConsoleUi((s) => s.toast);
  const models = useModels();
  const [modelId, setModelId] = useState('');
  const [list, setList] = useState<RiskList | null>(null);
  const [heat, setHeat] = useState<Heatmap | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [selected, setSelectedState] = useState<Risk | null>(null);
  // The open risk is re-read after every change, so keep its id outside the load closure.
  const selectedId = useRef<string | null>(null);
  const setSelected = (r: Risk | null) => {
    selectedId.current = r?.risk_id ?? null;
    setSelectedState(r);
  };
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState({ category: 'FAIRNESS', title: '', description: '' });

  const load = useCallback(async () => {
    setError(false);
    try {
      const q = modelId ? `?model_id=${modelId}` : '';
      const [l, h] = await Promise.all([api<RiskList>(`/governance/risks${q}`), api<Heatmap>(`/governance/risks/heatmap${q}`)]);
      setList(l);
      setHeat(h);
      setGate(modelId ? await api<Gate>(`/governance/models/${modelId}/gate`) : null);
      if (selectedId.current) setSelected(await api<Risk>(`/governance/risks/${selectedId.current}`));
    } catch {
      setError(true);
    }
  }, [modelId]);
  useEffect(() => { void load(); }, [load]);

  const open = async (r: Risk) => setSelected(await api<Risk>(`/governance/risks/${r.risk_id}`));
  const suggest = async () => {
    try {
      const r = await api<{ created: number }>(`/governance/models/${modelId}/risks/suggest`, { method: 'POST' });
      toast(r.created ? `${r.created} suggested risk(s) added as drafts` : 'No new suggestions', 'positive');
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'negative'); }
  };
  const create = async () => {
    try {
      await api('/governance/risks', { method: 'POST', body: JSON.stringify({ ...draft, scope_type: modelId ? 'MODEL' : 'ORG', scope_id: modelId || undefined }) });
      setDraft({ ...draft, title: '', description: '' });
      toast('Risk added', 'positive');
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'negative'); }
  };

  if (error) return <Panel title="Risk register"><PanelError onRetry={load} /></Panel>;
  if (!list || !heat) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <ModelPicker models={models} value={modelId} onChange={(v) => { setModelId(v); setSelected(null); }} allowAll />
        {modelId && <Button size="sm" variant="secondary" onClick={suggest}><Wand2 size={12} /> Suggest risks</Button>}
        <span className="ml-auto flex gap-1">
          <Badge tone="neutral">{list.summary.total} risks</Badge>
          <Badge tone={list.summary.review_due ? 'negative' : 'neutral'}>{list.summary.review_due} due for review</Badge>
          <Badge tone={list.summary.above_appetite_unaccepted ? 'negative' : 'positive'}>{list.summary.above_appetite_unaccepted} above appetite, not accepted</Badge>
        </span>
      </div>
      {gate && (
        <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] ${gate.verdict === 'BLOCK' ? 'border-negative' : gate.verdict === 'WARN' ? 'border-warning' : 'border-border'}`} role="status">
          <ShieldAlert size={13} className={gate.verdict === 'PASS' ? 'text-positive' : 'text-warning'} />
          <div>
            <div className="text-text">Deploy gate for this {gate.tier} model: <strong>{gate.verdict}</strong> (mode {gate.mode})</div>
            {[...gate.block, ...gate.warn].map((f) => <div key={f.code} className="text-text-secondary">{f.message}</div>)}
          </div>
        </div>
      )}
      <div className="grid gap-2 lg:grid-cols-[1fr_340px]">
        <Panel title="Risks">
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-[9px] uppercase tracking-wider text-text-tertiary"><th className="px-3 py-1">Risk</th><th>Status</th><th>Inherent</th><th>Residual</th><th className="pr-3">Appetite</th></tr></thead>
            <tbody className="divide-y divide-border">
              {list.risks.map((r) => (
                <tr key={r.risk_id} className={`cursor-pointer hover:bg-surface-hover ${selected?.risk_id === r.risk_id ? 'bg-surface-hover' : ''}`} onClick={() => void open(r)}>
                  <td className="px-3 py-1"><div className="text-text">{r.title}</div><div className="font-mono text-[9px] text-text-tertiary">{r.category} · {r.source.toLowerCase()}</div></td>
                  <td><Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge></td>
                  <td>{r.assessment ? <Badge tone={BAND_TONE[r.assessment.inherent.band] ?? 'neutral'}>{r.assessment.inherent.score}</Badge> : '—'}</td>
                  <td>{r.assessment ? <Badge tone={BAND_TONE[r.assessment.residual.band] ?? 'neutral'}>{r.assessment.residual.band} {r.assessment.residual.score}</Badge> : '—'}</td>
                  <td className="pr-3 text-[10px]">{r.acceptance ? `accepted (${r.acceptance.role.toLowerCase()})` : r.assessment ? (r.within_appetite ? 'within' : `above ${r.ceiling}`) : '—'}</td>
                </tr>
              ))}
              {!list.risks.length && <tr><td colSpan={5} className="px-3 py-3 text-text-secondary">No risks yet{modelId ? ': use Suggest risks to start from the catalogue.' : '.'}</td></tr>}
            </tbody>
          </table>
          <div className="flex gap-1 border-t border-border p-2">
            <select aria-label="Category" className={`${FIELD} w-36`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input aria-label="New risk title" className={FIELD} placeholder={modelId ? 'New risk for this model' : 'New organisation-level risk'} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Button size="xs" variant="secondary" disabled={draft.title.trim().length < 3} onClick={create}><ListPlus size={11} /> Add</Button>
          </div>
        </Panel>
        <div className="flex flex-col gap-2">
          <Panel title="Heatmap">
            <div className="flex gap-4 p-3">
              <HeatGrid h={heat} kind="inherent" />
              <HeatGrid h={heat} kind="residual" />
            </div>
            {heat.awaiting_rescore > 0 && <p className="px-3 pb-2 text-[10px] text-warning">{heat.awaiting_rescore} risk(s) scored on another matrix await re-scoring.</p>}
          </Panel>
          {selected && (
            <Panel title="Selected risk" right={<Badge tone={STATUS_TONE[selected.status] ?? 'neutral'}>{selected.status}</Badge>}>
              <RiskDetail key={selected.risk_id + (selected.assessment?.version ?? 0) + selected.status} risk={selected} matrix={list.scoring_matrix} onChanged={load} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- impact assessments */

interface Question { id: string; text: string; type: 'yes_no' | 'text' | 'select'; options?: string[]; required: boolean; ref?: string }
interface Templates { questionnaires: Array<{ id: string; title: string; questions: Question[] }>; layouts: Array<{ id: string; title: string }> }
interface IA {
  assessment_id: string; version: number; status: string; questionnaires: string[]; answers: Record<string, Record<string, any>>;
  in_scope: boolean | null; high_impact: boolean | null; materiality: string | null; signed_by: string | null; signed_at: string | null;
  revalidation_reason: string | null; content_hash: string | null;
}

export function ImpactTab() {
  const toast = useConsoleUi((s) => s.toast);
  const models = useModels();
  const [modelId, setModelId] = useState('');
  const [tpl, setTpl] = useState<Templates | null>(null);
  const [rows, setRows] = useState<IA[]>([]);
  const [current, setCurrent] = useState<IA | null>(null);
  const [answers, setAnswers] = useState<Record<string, Record<string, any>>>({});
  const [report, setReport] = useState<string | null>(null);
  const [layout, setLayout] = useState('iso');

  useEffect(() => { api<Templates>('/governance/impact-assessments/templates').then(setTpl).catch(() => setTpl(null)); }, []);
  const load = useCallback(async () => {
    if (!modelId) { setRows([]); setCurrent(null); return; }
    const r = await api<{ assessments: IA[] }>(`/governance/impact-assessments?model_id=${modelId}`);
    const sorted = r.assessments.sort((a, b) => b.version - a.version);
    setRows(sorted);
    setCurrent(sorted[0] ?? null);
    setAnswers(sorted[0]?.answers ?? {});
    setReport(null);
  }, [modelId]);
  useEffect(() => { void load().catch(() => toast('Could not load assessments', 'negative')); }, [load, toast]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); toast(ok, 'positive'); await load(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'negative'); }
  };
  const set = (q: string, k: string, v: any) => setAnswers({ ...answers, [q]: { ...(answers[q] ?? {}), [k]: v } });
  const draft = current?.status === 'DRAFT';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <ModelPicker models={models} value={modelId} onChange={setModelId} />
        {modelId && !rows.some((r) => r.status === 'DRAFT') && (
          <Button size="sm" variant="secondary" onClick={() => run(() => (current ? api(`/governance/impact-assessments/${current.assessment_id}/new-version`, { method: 'POST' }) : api('/governance/impact-assessments', { method: 'POST', body: JSON.stringify({ model_id: modelId }) })), 'Draft started')}>
            <ClipboardCheck size={12} /> {current ? 'Start new version' : 'Start assessment'}
          </Button>
        )}
        <span className="ml-auto flex gap-1">
          {rows.map((r) => <Badge key={r.assessment_id} tone={r.status === 'FINAL' ? 'positive' : r.status === 'REVALIDATION_REQUIRED' ? 'negative' : 'neutral'}>v{r.version} {r.status.replace('_', ' ')}</Badge>)}
        </span>
      </div>
      {current && tpl && (
        <div className="grid gap-2 lg:grid-cols-[1fr_360px]">
          <Panel title={`Assessment v${current.version}`} right={<Badge tone={current.status === 'FINAL' ? 'positive' : 'warning'}>{current.status}</Badge>}>
            <div className="space-y-3 p-3">
              {current.revalidation_reason && current.status === 'REVALIDATION_REQUIRED' && <p className="text-[11px] text-negative">Revalidation required: {current.revalidation_reason}</p>}
              {current.questionnaires.map((qid) => {
                const q = tpl.questionnaires.find((x) => x.id === qid);
                if (!q) return null;
                return (
                  <fieldset key={qid} className="rounded border border-border p-2">
                    <legend className="px-1 text-[11px] font-medium text-text">{q.title}</legend>
                    {q.questions.map((question) => {
                      const v = answers[qid]?.[question.id];
                      const id = `${qid}-${question.id}`;
                      return (
                        <div key={question.id} className="mb-1.5">
                          <label htmlFor={id} className="block text-[10.5px] text-text-secondary">{question.text}{question.required && ' *'} {question.ref && <span className="font-mono text-[9px] text-text-tertiary">{question.ref}</span>}</label>
                          {question.type === 'text' ? (
                            <textarea id={id} rows={2} className={FIELD} disabled={!draft} value={v ?? ''} onChange={(e) => set(qid, question.id, e.target.value)} />
                          ) : question.type === 'select' ? (
                            <select id={id} className={FIELD} disabled={!draft} value={v ?? ''} onChange={(e) => set(qid, question.id, e.target.value || undefined)}>
                              <option value="">—</option>{question.options!.map((o) => <option key={o}>{o}</option>)}
                            </select>
                          ) : (
                            <select id={id} className={FIELD} disabled={!draft} value={v === undefined ? '' : v ? 'yes' : 'no'} onChange={(e) => set(qid, question.id, e.target.value === '' ? undefined : e.target.value === 'yes')}>
                              <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </fieldset>
                );
              })}
              {draft && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => run(() => api(`/governance/impact-assessments/${current.assessment_id}`, { method: 'PATCH', body: JSON.stringify({ answers }) }), 'Draft saved')}>Save draft</Button>
                  <Button size="sm" variant="primary" onClick={() => run(async () => {
                    await api(`/governance/impact-assessments/${current.assessment_id}`, { method: 'PATCH', body: JSON.stringify({ answers }) });
                    await api(`/governance/impact-assessments/${current.assessment_id}/finalise`, { method: 'POST' });
                  }, 'Signed and finalised')}><FileSignature size={12} /> Sign and finalise</Button>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Record and reports">
            <div className="space-y-2 p-3 text-[11px]">
              <div className="grid grid-cols-2 gap-1 text-text-secondary">
                <span>In scope</span><span className="text-text">{current.in_scope === null ? 'n/a' : current.in_scope ? 'Yes' : 'No'}</span>
                <span>High impact</span><span className="text-text">{current.high_impact === null ? 'n/a' : current.high_impact ? 'Yes' : 'No'}</span>
                <span>Materiality</span><span className="text-text">{current.materiality ?? 'n/a'}</span>
                <span>Signed</span><span className="text-text">{current.signed_by ? `${current.signed_by}, ${new Date(current.signed_at!).toLocaleDateString()}` : 'not yet'}</span>
              </div>
              {current.content_hash && <div className="break-all font-mono text-[9px] text-text-tertiary">sha256 {current.content_hash}</div>}
              <div className="flex gap-1">
                <select aria-label="Report layout" className={FIELD} value={layout} onChange={(e) => setLayout(e.target.value)}>
                  {tpl.layouts.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
                <Button size="xs" variant="secondary" onClick={async () => {
                  try { setReport((await api<{ markdown: string }>(`/governance/impact-assessments/${current.assessment_id}/report?layout=${layout}&format=md`)).markdown); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'negative'); }
                }}>View</Button>
              </div>
              {report && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-elevated p-2 text-[10px] text-text">{report}</pre>}
            </div>
          </Panel>
        </div>
      )}
      {modelId && !current && <Panel title="Impact assessment"><p className="p-3 text-[11px] text-text-secondary">No assessment yet for this model.</p></Panel>}
    </div>
  );
}

/* ------------------------------------------------------- context profile */

interface ContextView {
  profile: Record<string, any>;
  missing: string[];
  options: { oversight_patterns: string[]; dta_usage_patterns: string[] };
  suggestion: { profile: Record<string, any> };
}
const LISTS = [
  ['intended_users', 'Intended users'], ['deployment_settings', 'Deployment settings'], ['known_limitations', 'Known limitations'],
  ['out_of_scope_uses', 'Out-of-scope uses'], ['assumptions', 'Assumptions'], ['system_requirements', 'System requirements'],
] as const;
const TEXTS = [['benefits', 'Benefits'], ['cost_of_errors', 'Cost of errors'], ['business_value', 'Business value'], ['named_operator', 'Named operator'], ['dta_domain', 'DTA domain']] as const;

export function ContextTab() {
  const toast = useConsoleUi((s) => s.toast);
  const models = useModels();
  const [modelId, setModelId] = useState('');
  const [view, setView] = useState<ContextView | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!modelId) { setView(null); return; }
    api<ContextView>(`/inventory/models/${modelId}/context`).then((v) => { setView(v); setForm(v.profile); }).catch(() => toast('Could not load the context profile', 'negative'));
  }, [modelId, toast]);
  const save = async () => {
    try {
      const v = await api<ContextView>(`/inventory/models/${modelId}/context`, { method: 'PATCH', body: JSON.stringify(form) });
      setView(v);
      setForm(v.profile);
      toast('Context profile saved', 'positive');
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'negative'); }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <ModelPicker models={models} value={modelId} onChange={setModelId} />
        {view && <Badge tone={view.missing.length ? 'warning' : 'positive'}>{view.missing.length ? `missing ${view.missing.length}` : 'complete'}</Badge>}
        {view && <Button size="sm" variant="ghost" onClick={() => setForm({ ...view.suggestion.profile, ...Object.fromEntries(Object.entries(form).filter(([, v]) => (Array.isArray(v) ? v.length : v))) })}><Wand2 size={12} /> Fill gaps from model record</Button>}
      </div>
      {view && (
        <Panel title="Context profile">
          <div className="grid gap-2 p-3 lg:grid-cols-2">
            {LISTS.map(([k, label]) => (
              <label key={k} className="text-[10.5px] text-text-secondary">{label} <span className="text-text-tertiary">(one per line)</span>
                <textarea rows={3} className={FIELD} value={(form[k] ?? []).join('\n')} onChange={(e) => setForm({ ...form, [k]: e.target.value.split('\n') })} />
              </label>
            ))}
            {TEXTS.map(([k, label]) => (
              <label key={k} className="text-[10.5px] text-text-secondary">{label}
                <input className={FIELD} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
            <label className="text-[10.5px] text-text-secondary">Oversight pattern
              <select className={FIELD} value={form.oversight_pattern ?? ''} onChange={(e) => setForm({ ...form, oversight_pattern: e.target.value || null })}>
                <option value="">—</option>{view.options.oversight_patterns.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ').toLowerCase()}</option>)}
              </select>
            </label>
            <label className="text-[10.5px] text-text-secondary">DTA usage pattern
              <select className={FIELD} value={form.dta_usage_pattern ?? ''} onChange={(e) => setForm({ ...form, dta_usage_pattern: e.target.value || null })}>
                <option value="">—</option>{view.options.dta_usage_patterns.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ').toLowerCase()}</option>)}
              </select>
            </label>
          </div>
          <div className="border-t border-border p-2"><Button size="sm" variant="primary" onClick={save}>Save context profile</Button></div>
        </Panel>
      )}
    </div>
  );
}
