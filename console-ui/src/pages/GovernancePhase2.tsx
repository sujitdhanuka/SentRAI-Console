/**
 * Governance Phase 2 tabs (E2.1 to E2.8). Each tab appears only while its
 * server flag is on (see TABS in Governance.tsx), so with the flags off the
 * console looks exactly as before.
 */
import { Download, Plus, RefreshCw } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useState } from 'react';

import { api, apiBlobUrl } from '../api/client';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { useConsoleUi } from '../stores/consoleUi';
import { useModels } from './GovernanceRegister';

/* ------------------------------------------------------------- shared */

const useToastCall = () => {
  const toast = useConsoleUi((s) => s.toast);
  return async <T,>(fn: () => Promise<T>, ok: string, after?: () => void): Promise<T | null> => {
    try {
      const r = await fn();
      toast(ok, 'positive');
      after?.();
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'negative');
      return null;
    }
  };
};

const post = (path: string, body: unknown, method = 'POST') => api<any>(path, { method, body: JSON.stringify(body) });
const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '—');

/** Loads `path`, exposing data, error and a reload. */
function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return setData(null);
    setError(false);
    try {
      setData(await api<T>(path));
    } catch {
      setError(true);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

async function download(path: string, filename: string) {
  const url = await apiBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function ModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const models = useModels();
  return (
    <select aria-label="Model" className={`${FIELD} max-w-xs`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a model…</option>
      {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name} · {m.risk_level}</option>)}
    </select>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="p-3 text-[11px] text-text-secondary">{empty}</p>;
  return (
    <table className="w-full text-left text-[11px]">
      <thead>
        <tr className="border-b border-border">{head.map((h) => <th key={h} className={`${LABEL} px-2 py-1`}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/60 align-top">{r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

const RESULT_TONE: Record<string, BadgeTone> = {
  SATISFACTORY: 'positive', CONDITIONAL: 'warning', UNSATISFACTORY: 'negative', NOT_ASSESSED: 'neutral',
  APPROVED: 'positive', APPROVED_WITH_CONDITIONS: 'warning', REJECTED: 'negative',
  CURRENT: 'positive', EXPIRING: 'warning', EXPIRED: 'negative', MISSING: 'negative',
  OPEN: 'warning', DECIDED: 'positive', ORDERED: 'warning', DELETED: 'neutral', NONE: 'neutral',
};
const tone = (s: string | null | undefined): BadgeTone => RESULT_TONE[String(s ?? '')] ?? 'neutral';

/* ------------------------------------------------- E2.1 Australia (DTA) */

export function AuDtaTab() {
  const call = useToastCall();
  const reg = useLoad<any>('/governance/au/register');
  const tracker = useLoad<any>('/governance/au/in-scope');
  const subs = useLoad<any>('/governance/au/submissions');
  const [reference, setReference] = useState('');
  const reload = () => {
    void reg.reload();
    void tracker.reload();
    void subs.reload();
  };
  if (reg.error) return <Panel title="AI use case register"><PanelError onRetry={() => void reg.reload()} /></Panel>;
  if (!reg.data) return <Skeleton className="h-64 w-full" />;
  const share = reg.data.share ?? {};
  return (
    <div className="space-y-2">
      <Panel
        title="AI use case register (DTA policy v2.1)"
        right={
          <div className="flex gap-1">
            <Button size="xs" variant="secondary" onClick={() => void call(() => download('/governance/exports/dta-register?format=csv', 'ai-use-case-register.csv'), 'Downloaded')}><Download size={12} /> CSV</Button>
            <Button size="xs" variant="secondary" onClick={() => void call(() => download('/governance/exports/dta-register?format=xlsx', 'ai-use-case-register.xlsx'), 'Downloaded')}><Download size={12} /> XLSX</Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2 text-[11px]">
          <span>Last shared with the DTA: <b>{day(share.lastSharedAt ?? share.last_shared_at)}</b></span>
          <span>Next due: <b>{day(share.nextDueAt ?? share.next_due_at)}</b></span>
          {(share.overdue) && <Badge tone="negative">overdue</Badge>}
          <input className={`${FIELD} max-w-[220px]`} placeholder="DTA reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          <Button size="xs" disabled={reference.trim().length < 3} onClick={() => void call(() => post("/governance/exports/dta-register/share", { reference }), "Share recorded", reload)}>Record share with DTA</Button>
        </div>
        <Table
          head={['Use case', 'Usage / domain', 'In scope', 'Risk', 'Owner', 'Impact assessment', 'Reported']}
          empty="No use cases yet."
          rows={(reg.data.rows ?? []).map((r: any) => [
            r.name, `${r.usage_pattern ?? '—'} / ${r.domain ?? '—'}`, r.in_scope, r.risk_rating, r.accountable_owner ?? <Badge tone="warning">none</Badge>,
            r.impact_assessment ?? '—', r.reported_to_dta ?? '—',
          ])}
        />
      </Panel>
      <Panel
        title={`In-scope assessment of existing use cases (deadline ${tracker.data?.deadline ?? '30 Apr 2027'})`}
        right={<Button size="xs" variant="secondary" onClick={() => void call(() => post('/governance/au/in-scope/bulk-start', {}), 'Draft assessments started', reload)}>Start drafts for all unassessed</Button>}
      >
        {tracker.data ? (
          <Table
            head={['Use case', 'Risk', 'State', 'In scope', 'High-risk area']}
            empty="No use cases."
            rows={(tracker.data.use_cases ?? []).map((r: any) => [r.name, r.risk_level, <Badge key="s" tone={r.needs_action ? 'warning' : 'positive'}>{r.state}</Badge>, r.in_scope == null ? '—' : r.in_scope ? 'yes' : 'no', r.high_risk_area ?? '—'])}
          />
        ) : <Skeleton className="h-24 w-full" />}
      </Panel>
      <Panel title="Submissions to the DTA">
        <Table
          head={['When', 'Kind', 'By', 'Reference', 'Payload hash']}
          empty="Nothing recorded yet."
          rows={(subs.data?.submissions ?? []).map((s: any) => [day(s.submitted_at), s.kind, s.submitted_by, s.reference ?? '—', <code key="h" className="text-[9px]">{String(s.payload_hash ?? '').slice(0, 16)}</code>])}
        />
      </Panel>
    </div>
  );
}

/* ------------------------------------- E2.2 US: reason codes, notices, appeals */

export function DecisionsTab() {
  const call = useToastCall();
  const [modelId, setModelId] = useState('');
  const codes = useLoad<any>(modelId ? `/governance/models/${modelId}/reason-codes` : null);
  const notices = useLoad<any>('/governance/notices');
  const appeals = useLoad<any>('/governance/appeals');
  const [mapText, setMapText] = useState('');
  const [ref, setRef] = useState('');
  const [decision, setDecision] = useState<any>(null);
  const [deciding, setDeciding] = useState<{ id: string; outcome: string; authority: string; evidence: string; outcome_notes: string; self_review_reason: string } | null>(null);
  const [grievance, setGrievance] = useState({ id: '', decision_ref: '', request: '' });

  useEffect(() => {
    if (codes.data) setMapText(JSON.stringify(codes.data.map ?? {}, null, 2));
  }, [codes.data]);

  const reloadAll = () => {
    void notices.reload();
    void appeals.reload();
  };

  return (
    <div className="space-y-2">
      <Panel title="Reason-code map (Reg B principal reasons)" right={<ModelSelect value={modelId} onChange={setModelId} />}>
        {!modelId ? <p className="p-3 text-[11px] text-text-secondary">Choose a model to map its features to adverse-action reason codes.</p> : (
          <div className="space-y-2 p-2">
            <p className="text-[10.5px] text-text-secondary">Map each model feature to a reason code and the statement shown to the applicant, for example {'{"debt_to_income": {"code": "R01", "text": "Debt is high compared with income"}}'}.</p>
            <textarea aria-label="Reason-code map" className={`${FIELD} h-40 font-mono`} value={mapText} onChange={(e) => setMapText(e.target.value)} />
            <Button size="sm" onClick={() => void call(async () => post(`/governance/models/${modelId}/reason-codes`, { map: JSON.parse(mapText || '{}') }, 'PUT'), 'Reason codes saved', codes.reload)}>Save map</Button>
          </div>
        )}
      </Panel>
      <Panel title="Decision lookup and adverse-action notice">
        <div className="flex flex-wrap items-end gap-2 p-2">
          <input className={`${FIELD} max-w-xs`} placeholder="Decision reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Button size="xs" variant="secondary" disabled={!ref} onClick={() => void call(async () => setDecision(await api<any>(`/governance/decisions/${encodeURIComponent(ref)}`)), 'Loaded')}>Open decision</Button>
          <Button size="xs" disabled={!ref || !modelId} title={!modelId ? 'Choose the model above first' : ''} onClick={() => void call(() => post(`/governance/decisions/${encodeURIComponent(ref)}/notices`, { model_id: modelId, channel: 'MAIL' }), 'Notice issued', reloadAll)}>Issue notice</Button>
        </div>
        {decision && <pre className="max-h-64 overflow-auto border-t border-border p-2 text-[10px]">{JSON.stringify(decision, null, 2)}</pre>}
      </Panel>
      <Panel title="Notices issued">
        <Table
          head={['Issued', 'Decision', 'Reasons', 'Consistent with explanation', 'Retain until']}
          empty="No adverse-action notices yet."
          rows={(notices.data?.notices ?? []).map((n: any) => [day(n.created_at ?? n.sent_at), n.decision_ref, (n.reason_codes ?? []).map((r: any) => r.code ?? r).join(', '), n.consistent ? <Badge key="c" tone="positive">yes</Badge> : <Badge key="c" tone="negative">mismatch</Badge>, day(n.retention_until)])}
        />
      </Panel>
      <Panel title="Appeals and reconsideration requests">
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
          <input className={`${FIELD} max-w-[200px]`} placeholder="Grievance id" value={grievance.id} onChange={(e) => setGrievance({ ...grievance, id: e.target.value })} />
          <input className={`${FIELD} max-w-[200px]`} placeholder="Decision reference" value={grievance.decision_ref} onChange={(e) => setGrievance({ ...grievance, decision_ref: e.target.value })} />
          <input className={`${FIELD} max-w-xs`} placeholder="What the applicant asks" value={grievance.request} onChange={(e) => setGrievance({ ...grievance, request: e.target.value })} />
          <Button size="xs" variant="secondary" disabled={!grievance.id} onClick={() => void call(() => post(`/governance/grievances/${grievance.id}/link-decision`, { decision_ref: grievance.decision_ref }), 'Linked', reloadAll)}>Link decision</Button>
          <Button size="xs" variant="secondary" disabled={!grievance.id} onClick={() => void call(() => post(`/governance/grievances/${grievance.id}/reconsider`, { request: grievance.request }), 'Reconsideration opened', reloadAll)}>Reconsider</Button>
          <Button size="xs" variant="secondary" disabled={!grievance.id} onClick={() => void call(() => post(`/governance/grievances/${grievance.id}/appeal`, { request: grievance.request }), 'Appeal opened', reloadAll)}>Appeal</Button>
        </div>
        <Table
          head={['Opened', 'Type', 'Decision', 'Status', 'Due', 'Outcome', '']}
          empty="No appeals or reconsideration requests."
          rows={(appeals.data?.appeals ?? []).map((a: any) => [
            day(a.created_at), a.type, a.decision_ref ?? '—', <Badge key="s" tone={tone(a.status)}>{a.status}</Badge>, day(a.due_at), a.outcome ?? '—',
            a.status === 'OPEN' ? <Button key="d" size="xs" variant="ghost" onClick={() => setDeciding({ id: a.appeal_id, outcome: a.type === 'DATA_CORRECTION' ? 'CORRECTED' : 'UPHELD', authority: '', evidence: '', outcome_notes: '', self_review_reason: '' })}>Decide</Button> : null,
          ])}
        />
        {deciding && (
          <div className="grid grid-cols-2 gap-2 border-t border-border p-2">
            <Field label="Outcome">
              <select className={FIELD} value={deciding.outcome} onChange={(e) => setDeciding({ ...deciding, outcome: e.target.value })}>
                {['UPHELD', 'OVERTURNED', 'PARTIALLY_OVERTURNED', 'CORRECTED', 'NO_CHANGE'].map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Reviewer authority"><input className={FIELD} value={deciding.authority} onChange={(e) => setDeciding({ ...deciding, authority: e.target.value })} /></Field>
            <Field label="Evidence considered"><textarea className={FIELD} value={deciding.evidence} onChange={(e) => setDeciding({ ...deciding, evidence: e.target.value })} /></Field>
            <Field label="Outcome notes"><textarea className={FIELD} value={deciding.outcome_notes} onChange={(e) => setDeciding({ ...deciding, outcome_notes: e.target.value })} /></Field>
            <Field label="Self-review reason (only if you opened it)"><input className={FIELD} value={deciding.self_review_reason} onChange={(e) => setDeciding({ ...deciding, self_review_reason: e.target.value })} /></Field>
            <div className="flex items-end gap-1">
              <Button size="sm" onClick={() => void call(() => post(`/governance/appeals/${deciding.id}/decide`, { ...deciding, self_review_reason: deciding.self_review_reason || undefined }), 'Decision recorded', () => { setDeciding(null); reloadAll(); })}>Record decision</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeciding(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------- E2.3 model validation */

export function ValidationTab() {
  const call = useToastCall();
  const models = useModels();
  const list = useLoad<any>('/governance/validations');
  const agg = useLoad<any>('/governance/validations/aggregate');
  const [form, setForm] = useState({ model_id: '', validator_user_id: '', scope: '' });
  const [users, setUsers] = useState<Array<{ id: string; email: string; full_name: string }>>([]);
  const [open, setOpen] = useState<any>(null);
  const [scopeReason, setScopeReason] = useState('');
  useEffect(() => {
    api<any>('/users').then((r) => setUsers((Array.isArray(r) ? r : r.users ?? []).map((u: any) => ({ id: u.id ?? u.user_id, email: u.email, full_name: u.full_name ?? u.fullName ?? '' })))).catch(() => setUsers([]));
  }, []);
  const reload = () => {
    void list.reload();
    void agg.reload();
  };
  return (
    <div className="space-y-2">
      <Panel title="SR 26-2 scope">
        <div className="flex flex-wrap items-end gap-2 p-2">
          <ModelSelect value={form.model_id} onChange={(v) => setForm({ ...form, model_id: v })} />
          <Button size="xs" variant="secondary" disabled={!form.model_id} onClick={() => void call(() => post(`/governance/models/${form.model_id}/mrm-scope`, { in_scope: true }, 'PUT'), 'Marked in scope', reload)}>In scope</Button>
          <input className={`${FIELD} max-w-xs`} placeholder="Exclusion reason (for out of scope)" value={scopeReason} onChange={(e) => setScopeReason(e.target.value)} />
          <Button size="xs" variant="secondary" disabled={!form.model_id} onClick={() => void call(() => post(`/governance/models/${form.model_id}/mrm-scope`, { in_scope: false, exclusion_reason: scopeReason }, 'PUT'), 'Marked out of scope', reload)}>Out of scope</Button>
        </div>
      </Panel>
      <Panel title="Validations">
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
          <select aria-label="Validator" className={`${FIELD} max-w-xs`} value={form.validator_user_id} onChange={(e) => setForm({ ...form, validator_user_id: e.target.value })}>
            <option value="">Independent validator…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
          <input className={`${FIELD} max-w-xs`} placeholder="Scope of the validation" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
          <Button size="xs" disabled={!form.model_id || !form.validator_user_id} onClick={() => void call(() => post('/governance/validations', form), 'Validation planned', reload)}><Plus size={12} /> Plan validation</Button>
        </div>
        <Table
          head={['Model', 'Version', 'Validator', 'Independent', 'Status', 'Result', 'Expires', '']}
          empty="No validations yet."
          rows={(list.data?.validations ?? []).map((v: any) => [
            models.find((m) => m.model_id === v.model_id)?.name ?? v.model_id, v.version, v.validator_email,
            v.independent ? <Badge key="i" tone="positive">yes</Badge> : <Badge key="i" tone="negative" title={(v.independence_problems ?? []).join('; ')}>no</Badge>,
            v.status, v.result ? <Badge key="r" tone={tone(v.result)}>{v.result}</Badge> : '—', day(v.expires_at),
            <Button key="o" size="xs" variant="ghost" onClick={() => setOpen({ ...v })}>Open</Button>,
          ])}
        />
        {open && (
          <div className="grid grid-cols-3 gap-2 border-t border-border p-2">
            <Field label="Conceptual soundness"><textarea className={`${FIELD} h-24`} value={open.conceptual_soundness ?? ''} onChange={(e) => setOpen({ ...open, conceptual_soundness: e.target.value })} /></Field>
            <Field label="Implementation review"><textarea className={`${FIELD} h-24`} value={open.implementation_review ?? ''} onChange={(e) => setOpen({ ...open, implementation_review: e.target.value })} /></Field>
            <Field label="Outcomes analysis"><textarea className={`${FIELD} h-24`} value={open.outcomes_analysis ?? ''} onChange={(e) => setOpen({ ...open, outcomes_analysis: e.target.value })} /></Field>
            <div className="col-span-3 flex flex-wrap gap-1">
              <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/validations/${open.validation_id}`, { conceptual_soundness: open.conceptual_soundness, implementation_review: open.implementation_review, outcomes_analysis: open.outcomes_analysis }, 'PATCH'), 'Saved', reload)}>Save analysis</Button>
              {['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED'].map((r) => (
                <Button key={r} size="xs" variant={r === 'REJECTED' ? 'danger' : 'secondary'} onClick={() => void call(() => post(`/governance/validations/${open.validation_id}/complete`, { result: r }), 'Validation completed', () => { setOpen(null); reload(); })}>Complete: {r.replace(/_/g, ' ').toLowerCase()}</Button>
              ))}
              <Button size="xs" variant="ghost" onClick={() => setOpen(null)}>Close</Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Aggregate view by project">
        <Table
          head={['Project', 'Models', 'In scope', 'Validated', 'Exception', 'Missing', 'Open findings']}
          empty="No projects."
          rows={(agg.data?.projects ?? []).map((p: any) => [p.project, p.models, p.in_scope, p.validated, p.exception, p.missing ? <Badge key="m" tone="negative">{p.missing}</Badge> : 0, p.open_findings])}
        />
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------- E2.4 fair lending */

export function FairLendingTab() {
  const call = useToastCall();
  const [modelId, setModelId] = useState('');
  const st = useLoad<any>(modelId ? `/governance/fair-lending/${modelId}` : null);
  const [features, setFeatures] = useState('');
  const [just, setJust] = useState({ feature: '', justification: '' });
  const [di, setDi] = useState({ ratio: '', metric: 'adverse impact ratio' });
  const [lda, setLda] = useState({ alternatives: '', conclusion: '' });
  return (
    <div className="space-y-2">
      <Panel title="Fair lending (ECOA / Reg B)" right={<ModelSelect value={modelId} onChange={setModelId} />}>
        {!modelId ? <p className="p-3 text-[11px] text-text-secondary">Choose a model.</p> : !st.data ? <Skeleton className="h-24 w-full" /> : (
          <div className="space-y-2 p-2 text-[11px]">
            <div className="flex flex-wrap gap-3">
              <span>Last scan: <b>{day(st.data.scannedAt)}</b> over {st.data.scanned} input(s)</span>
              <span>Disparate impact: <b>{st.data.disparateImpact?.ratio ?? '—'}</b></span>
              <span>Alternatives searched: <b>{st.data.ldaSearch ? 'yes' : 'no'}</b></span>
            </div>
            <Field label="Model inputs to scan (one per line; reason-code features are added automatically)">
              <textarea className={`${FIELD} h-20 font-mono`} value={features} onChange={(e) => setFeatures(e.target.value)} />
            </Field>
            <Button size="xs" onClick={() => void call(() => post(`/governance/fair-lending/${modelId}/scan`, { features: features.split('\n').map((f) => f.trim()).filter(Boolean) }), 'Scan recorded', st.reload)}>Run proxy scan</Button>
            <Table
              head={['Feature', 'Matched', 'Basis', 'Kind', 'Justified']}
              empty="No prohibited-basis or proxy matches."
              rows={(st.data.proxyHits ?? []).map((h: any) => [h.feature, h.term, h.basis, h.kind, h.justified ? <Badge key="j" tone="positive" title={h.justification}>yes</Badge> : <Badge key="j" tone="warning">no</Badge>])}
            />
            <div className="flex flex-wrap items-end gap-2">
              <input className={`${FIELD} max-w-[200px]`} placeholder="Flagged feature" value={just.feature} onChange={(e) => setJust({ ...just, feature: e.target.value })} />
              <input className={`${FIELD} max-w-md`} placeholder="Why this feature is acceptable" value={just.justification} onChange={(e) => setJust({ ...just, justification: e.target.value })} />
              <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/fair-lending/${modelId}/justify`, just), 'Justification recorded', st.reload)}>Justify</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input className={`${FIELD} max-w-[120px]`} placeholder="Lowest ratio" value={di.ratio} onChange={(e) => setDi({ ...di, ratio: e.target.value })} />
              <input className={`${FIELD} max-w-[200px]`} placeholder="Metric" value={di.metric} onChange={(e) => setDi({ ...di, metric: e.target.value })} />
              <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/fair-lending/${modelId}/disparate-impact`, { ratio: Number(di.ratio), metric: di.metric }), 'Result recorded', st.reload)}>Record disparate impact</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input className={`${FIELD} max-w-md`} placeholder="Alternatives considered (separate with ;)" value={lda.alternatives} onChange={(e) => setLda({ ...lda, alternatives: e.target.value })} />
              <input className={`${FIELD} max-w-md`} placeholder="Conclusion" value={lda.conclusion} onChange={(e) => setLda({ ...lda, conclusion: e.target.value })} />
              <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/fair-lending/${modelId}/lda-search`, { alternatives: lda.alternatives.split(';').map((d) => ({ description: d.trim() })).filter((a) => a.description), conclusion: lda.conclusion }), 'Search recorded', st.reload)}>Record alternatives search</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------------------------- E2.5 vendors / BOM */

export function VendorsTab() {
  const call = useToastCall();
  const list = useLoad<any>('/governance/vendors');
  const meta = useLoad<any>('/governance/vendors/checklist');
  const summary = useLoad<any>('/governance/vendors/summary');
  const [name, setName] = useState('');
  const [criticality, setCriticality] = useState('MEDIUM');
  const [sel, setSel] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [modelId, setModelId] = useState('');
  const bom = useLoad<any>(modelId ? `/governance/models/${modelId}/bom` : null);
  const [item, setItem] = useState({ component: '', kind: 'LIBRARY', version: '', licence: '', vendor_id: '' });
  const reload = () => {
    void list.reload();
    void summary.reload();
  };
  const openVendor = async (id: string) => setSel(await api<any>(`/governance/vendors/${id}`));
  if (list.error) return <Panel title="Vendors"><PanelError onRetry={() => void list.reload()} /></Panel>;
  return (
    <div className="space-y-2">
      <Panel title="Vendor register" right={summary.data && <span className="text-[10px] text-text-secondary">{summary.data.vendors} vendors · {summary.data.by_result?.UNSATISFACTORY ?? 0} unsatisfactory · {summary.data.by_result?.NOT_ASSESSED ?? 0} not assessed</span>}>
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
          <input className={`${FIELD} max-w-xs`} placeholder="Vendor name" value={name} onChange={(e) => setName(e.target.value)} />
          <select aria-label="Criticality" className={`${FIELD} max-w-[120px]`} value={criticality} onChange={(e) => setCriticality(e.target.value)}>{['LOW', 'MEDIUM', 'HIGH'].map((c) => <option key={c}>{c}</option>)}</select>
          <Button size="xs" disabled={!name} onClick={() => void call(() => post('/governance/vendors', { name, criticality }), 'Vendor added', () => { setName(''); reload(); })}><Plus size={12} /> Add vendor</Button>
        </div>
        <Table
          head={['Vendor', 'Kind', 'Criticality', 'Assessment', 'Contract gaps', 'Exit plan', 'Models', '']}
          empty="No vendors yet."
          rows={(list.data?.vendors ?? []).map((v: any) => [
            v.name, v.kind, v.criticality,
            v.latest_assessment ? <Badge key="a" tone={tone(v.latest_assessment.result)}>{v.latest_assessment.result} {v.latest_assessment.score}%</Badge> : <Badge key="a" tone="warning">not assessed</Badge>,
            v.contract_gaps.length ? v.contract_gaps.join(', ') : '—', v.exit_plan_required ? (v.exit_plan && v.failover_plan ? 'yes' : <Badge key="e" tone="negative">missing</Badge>) : 'n/a',
            (v.models ?? []).map((m: any) => m.name).join(', ') || '—',
            <Button key="o" size="xs" variant="ghost" onClick={() => void openVendor(v.vendor_id)}>Open</Button>,
          ])}
        />
      </Panel>
      {sel && meta.data && (
        <Panel title={`Vendor: ${sel.name}`} right={<Button size="xs" variant="ghost" onClick={() => setSel(null)}>Close</Button>}>
          <div className="grid grid-cols-2 gap-3 p-2 text-[11px]">
            <div className="space-y-2">
              <div className={LABEL}>Contract terms</div>
              {meta.data.contract_terms.map((t: string) => (
                <label key={t} className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(sel.contract_terms?.[t])} onChange={(e) => setSel({ ...sel, contract_terms: { ...sel.contract_terms, [t]: e.target.checked } })} />
                  {t.replace(/_/g, ' ')}
                </label>
              ))}
              <Field label="Exit plan"><textarea className={FIELD} value={sel.exit_plan ?? ''} onChange={(e) => setSel({ ...sel, exit_plan: e.target.value })} /></Field>
              <Field label="Failover plan"><textarea className={FIELD} value={sel.failover_plan ?? ''} onChange={(e) => setSel({ ...sel, failover_plan: e.target.value })} /></Field>
              <Button size="xs" onClick={() => void call(() => post(`/governance/vendors/${sel.vendor_id}`, { contract_terms: sel.contract_terms, exit_plan: sel.exit_plan, failover_plan: sel.failover_plan }, 'PATCH'), 'Vendor saved', reload)}>Save vendor</Button>
            </div>
            <div className="space-y-1">
              <div className={LABEL}>Due-diligence checklist</div>
              {meta.data.checklist.map((q: any) => (
                <div key={q.id} className="flex items-center justify-between gap-2">
                  <span>{q.question}{q.critical && <span className="text-negative"> *</span>}</span>
                  <select aria-label={q.id} className={`${FIELD} max-w-[100px]`} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
                    <option value="">—</option>{['YES', 'PARTIAL', 'NO', 'NA'].map((a) => <option key={a}>{a}</option>)}
                  </select>
                </div>
              ))}
              <Button size="xs" onClick={() => void call(() => post(`/governance/vendors/${sel.vendor_id}/assessments`, { answers }), 'Assessment recorded', () => { reload(); void openVendor(sel.vendor_id); })}>Record assessment</Button>
              {(sel.assessments ?? []).slice(0, 5).map((a: any) => <div key={a.assessment_id} className="text-[10px] text-text-secondary">v{a.version} · {day(a.assessed_at)} · {a.result} {a.score}% · {a.assessed_by}</div>)}
            </div>
          </div>
        </Panel>
      )}
      <Panel title="AI bill of materials" right={<ModelSelect value={modelId} onChange={setModelId} />}>
        {!modelId ? <p className="p-3 text-[11px] text-text-secondary">Choose a model to see its components.</p> : !bom.data ? <Skeleton className="h-24 w-full" /> : (
          <div className="space-y-2 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/models/${modelId}/bom/sync`, {}), 'Components added from discovery', bom.reload)}><RefreshCw size={12} /> Add from discovery ({bom.data.suggested.length})</Button>
              <input className={`${FIELD} max-w-[180px]`} placeholder="Component" value={item.component} onChange={(e) => setItem({ ...item, component: e.target.value })} />
              <select aria-label="Kind" className={`${FIELD} max-w-[110px]`} value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}>{['MODEL', 'API', 'LIBRARY', 'DATASET', 'PLATFORM'].map((k) => <option key={k}>{k}</option>)}</select>
              <input className={`${FIELD} max-w-[100px]`} placeholder="Version" value={item.version} onChange={(e) => setItem({ ...item, version: e.target.value })} />
              <input className={`${FIELD} max-w-[120px]`} placeholder="Licence" value={item.licence} onChange={(e) => setItem({ ...item, licence: e.target.value })} />
              <select aria-label="Vendor" className={`${FIELD} max-w-[160px]`} value={item.vendor_id} onChange={(e) => setItem({ ...item, vendor_id: e.target.value })}>
                <option value="">No vendor</option>{(list.data?.vendors ?? []).map((v: any) => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
              </select>
              <Button size="xs" disabled={!item.component} onClick={() => void call(() => post(`/governance/models/${modelId}/bom`, { ...item, vendor_id: item.vendor_id || undefined }), 'Component added', () => { setItem({ component: '', kind: 'LIBRARY', version: '', licence: '', vendor_id: '' }); void bom.reload(); })}><Plus size={12} /> Add</Button>
            </div>
            <Table
              head={['Component', 'Kind', 'Vendor', 'Version', 'Licence', 'Source', '']}
              empty="No components recorded."
              rows={bom.data.components.map((c: any) => [
                c.component, c.kind, c.vendor ? `${c.vendor.name} (${c.vendor.result ?? 'not assessed'})` : '—',
                <span key="v">{c.version ?? '—'}{c.previous_version && <span className="text-text-tertiary"> (was {c.previous_version})</span>}</span>,
                <Badge key="l" tone={c.licence_class === 'PERMISSIVE' ? 'positive' : c.licence_class === 'RESTRICTED' ? 'negative' : c.licence_class === 'UNKNOWN' ? 'warning' : 'neutral'}>{c.licence ?? c.licence_class}</Badge>,
                c.source,
                <Button key="u" size="xs" variant="ghost" onClick={() => {
                  const v = window.prompt(`New version of ${c.component}`, c.version ?? '');
                  if (v !== null) void call(() => post(`/governance/bom/${c.item_id}`, { version: v }, 'PATCH'), 'Version updated; the model’s risks are due for review', bom.reload);
                }}>New version</Button>,
              ])}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------- E2.6 training */

export function TrainingTab() {
  const call = useToastCall();
  const m = useLoad<any>('/governance/training/matrix');
  const [course, setCourse] = useState({ title: '', kind: 'COURSE', topic: 'ai_literacy', validity_months: '12' });
  const [rec, setRec] = useState({ course_id: '', user_id: '', completed_at: new Date().toISOString().slice(0, 10), evidence_ref: '' });
  if (m.error) return <Panel title="Training"><PanelError onRetry={() => void m.reload()} /></Panel>;
  if (!m.data) return <Skeleton className="h-64 w-full" />;
  const f = m.data.facts;
  return (
    <div className="space-y-2">
      <Panel title="Courses and policy acknowledgements" right={<span className="text-[10px] text-text-secondary">{f.compliant}/{f.staff} staff compliant · {f.mandatoryCourses} mandatory</span>}>
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
          <input className={`${FIELD} max-w-xs`} placeholder="Course or policy title" value={course.title} onChange={(e) => setCourse({ ...course, title: e.target.value })} />
          <select aria-label="Kind" className={`${FIELD} max-w-[130px]`} value={course.kind} onChange={(e) => setCourse({ ...course, kind: e.target.value })}>{['COURSE', 'POLICY_ACK', 'BRIEFING'].map((k) => <option key={k}>{k}</option>)}</select>
          <select aria-label="Topic" className={`${FIELD} max-w-[180px]`} value={course.topic} onChange={(e) => setCourse({ ...course, topic: e.target.value })}>
            {['ai_literacy', 'responsible_ai', 'policy_ack', 'model_risk', 'fair_lending', 'privacy', 'security', 'au_ethics_principles', 'other'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input className={`${FIELD} max-w-[90px]`} placeholder="Months valid" value={course.validity_months} onChange={(e) => setCourse({ ...course, validity_months: e.target.value })} />
          <Button size="xs" disabled={!course.title} onClick={() => void call(() => post('/governance/training/courses', { ...course, validity_months: course.validity_months ? Number(course.validity_months) : null, mandatory: true }), 'Course added', m.reload)}><Plus size={12} /> Add</Button>
          <Button size="xs" variant="secondary" onClick={() => void call(() => download('/governance/training/matrix.csv', 'training-matrix.csv'), 'Downloaded')}><Download size={12} /> Matrix CSV</Button>
        </div>
        <div className="overflow-x-auto">
          <Table
            head={['Person', 'Role', ...m.data.courses.map((c: any) => c.title), 'Compliant']}
            empty="No staff in this organization."
            rows={m.data.rows.map((r: any) => [
              r.full_name || r.email, r.role,
              ...m.data.courses.map((c: any) => {
                const cell = r.cells.find((x: any) => x.course_id === c.course_id);
                if (!cell) return <span key={c.course_id} className="text-text-tertiary">n/a</span>;
                return <Badge key={c.course_id} tone={tone(cell.status)} title={cell.expires_at ? `expires ${day(cell.expires_at)}` : ''}>{cell.status}</Badge>;
              }),
              r.compliant ? <Badge key="c" tone="positive">yes</Badge> : <Badge key="c" tone="negative">{r.overdue} due</Badge>,
            ])}
          />
        </div>
      </Panel>
      <Panel title="Record a completion">
        <div className="flex flex-wrap items-end gap-2 p-2">
          <select aria-label="Course" className={`${FIELD} max-w-xs`} value={rec.course_id} onChange={(e) => setRec({ ...rec, course_id: e.target.value })}>
            <option value="">Course…</option>{m.data.courses.map((c: any) => <option key={c.course_id} value={c.course_id}>{c.title}</option>)}
          </select>
          <select aria-label="Person" className={`${FIELD} max-w-xs`} value={rec.user_id} onChange={(e) => setRec({ ...rec, user_id: e.target.value })}>
            <option value="">Person…</option>{m.data.rows.map((r: any) => <option key={r.user_id} value={r.user_id}>{r.full_name || r.email}</option>)}
          </select>
          <input type="date" className={`${FIELD} max-w-[150px]`} value={rec.completed_at} onChange={(e) => setRec({ ...rec, completed_at: e.target.value })} />
          <input className={`${FIELD} max-w-[220px]`} placeholder="Evidence (certificate, LMS ref)" value={rec.evidence_ref} onChange={(e) => setRec({ ...rec, evidence_ref: e.target.value })} />
          <Button size="xs" disabled={!rec.course_id || !rec.user_id} onClick={() => void call(() => post('/governance/training/records', rec), 'Completion recorded', m.reload)}>Record</Button>
          {m.data.courses.filter((c: any) => c.kind !== 'COURSE').map((c: any) => (
            <Button key={c.course_id} size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/training/courses/${c.course_id}/acknowledge`, {}), 'Acknowledged', m.reload)}>I acknowledge: {c.title}</Button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------- E2.7 data register */

export function DatasetsTab() {
  const call = useToastCall();
  const list = useLoad<any>('/governance/datasets');
  const retention = useLoad<any>('/governance/datasets/retention');
  const [form, setForm] = useState({ name: '', source: '', lawful_basis: '', personal_data: false, provenance: '', retention_until: '' });
  const [link, setLink] = useState({ model_id: '', dataset_id: '', purpose: 'TRAINING' });
  const [order, setOrder] = useState<{ dataset_id: string; kind: string; reason: string; reference: string } | null>(null);
  const reload = () => {
    void list.reload();
    void retention.reload();
  };
  if (list.error) return <Panel title="Data register"><PanelError onRetry={() => void list.reload()} /></Panel>;
  if (!list.data) return <Skeleton className="h-64 w-full" />;
  const opts = list.data.options;
  return (
    <div className="space-y-2">
      <Panel title="Data register">
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2">
          <input className={`${FIELD} max-w-[180px]`} placeholder="Dataset name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={`${FIELD} max-w-[180px]`} placeholder="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          <select aria-label="Lawful basis" className={`${FIELD} max-w-[170px]`} value={form.lawful_basis} onChange={(e) => setForm({ ...form, lawful_basis: e.target.value })}>
            <option value="">Lawful basis…</option>{opts.lawful_bases.map((b: string) => <option key={b}>{b}</option>)}
          </select>
          <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={form.personal_data} onChange={(e) => setForm({ ...form, personal_data: e.target.checked })} /> personal data</label>
          <input className={`${FIELD} max-w-[200px]`} placeholder="Provenance" value={form.provenance} onChange={(e) => setForm({ ...form, provenance: e.target.value })} />
          <input type="date" aria-label="Retain until" className={`${FIELD} max-w-[150px]`} value={form.retention_until} onChange={(e) => setForm({ ...form, retention_until: e.target.value })} />
          <Button size="xs" disabled={!form.name} onClick={() => void call(() => post('/governance/datasets', { ...form, lawful_basis: form.lawful_basis || undefined, retention_until: form.retention_until || undefined }), 'Dataset registered', reload)}><Plus size={12} /> Register</Button>
        </div>
        <Table
          head={['Dataset', 'Source', 'Lawful basis', 'Personal', 'Retain until', 'Deletion', 'Models', 'Gaps', '']}
          empty="No datasets registered."
          rows={list.data.datasets.map((d: any) => [
            d.name, d.source ?? '—', d.lawful_basis ?? '—', d.personal_data ? (d.sensitive_data ? 'sensitive' : 'yes') : 'no',
            <span key="r">{day(d.retention_until)}{d.retention_passed && <Badge tone="negative">passed</Badge>}</span>,
            <Badge key="d" tone={tone(d.deletion_status)}>{d.deletion_status}</Badge>,
            (d.models ?? []).map((m: any) => `${m.name} (${m.purpose.toLowerCase()})`).join(', ') || '—',
            d.gaps.length ? d.gaps.join(', ') : '—',
            d.deletion_status !== 'DELETED' ? <Button key="o" size="xs" variant="ghost" onClick={() => setOrder({ dataset_id: d.dataset_id, kind: 'ERASURE_REQUEST', reason: '', reference: '' })}>Deletion order</Button> : null,
          ])}
        />
        {order && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
            <select aria-label="Order kind" className={`${FIELD} max-w-[180px]`} value={order.kind} onChange={(e) => setOrder({ ...order, kind: e.target.value })}>{opts.order_kinds.map((k: string) => <option key={k}>{k}</option>)}</select>
            <input className={`${FIELD} max-w-[160px]`} placeholder="Reference" value={order.reference} onChange={(e) => setOrder({ ...order, reference: e.target.value })} />
            <input className={`${FIELD} max-w-md`} placeholder="Reason" value={order.reason} onChange={(e) => setOrder({ ...order, reason: e.target.value })} />
            <Button size="xs" variant="danger" onClick={() => void call(() => post(`/governance/datasets/${order.dataset_id}/deletion-orders`, order), 'Order recorded; affected models are due for review', () => { setOrder(null); reload(); })}>Record order</Button>
            <Button size="xs" variant="ghost" onClick={() => setOrder(null)}>Cancel</Button>
          </div>
        )}
      </Panel>
      <Panel title="Link a dataset to a model">
        <div className="flex flex-wrap items-end gap-2 p-2">
          <ModelSelect value={link.model_id} onChange={(v) => setLink({ ...link, model_id: v })} />
          <select aria-label="Dataset" className={`${FIELD} max-w-xs`} value={link.dataset_id} onChange={(e) => setLink({ ...link, dataset_id: e.target.value })}>
            <option value="">Dataset…</option>{list.data.datasets.map((d: any) => <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>)}
          </select>
          <select aria-label="Purpose" className={`${FIELD} max-w-[140px]`} value={link.purpose} onChange={(e) => setLink({ ...link, purpose: e.target.value })}>{opts.purposes.map((p: string) => <option key={p}>{p}</option>)}</select>
          <Button size="xs" disabled={!link.model_id || !link.dataset_id} onClick={() => void call(() => post(`/governance/models/${link.model_id}/datasets`, link), 'Linked', reload)}>Link</Button>
        </div>
      </Panel>
      <Panel title="Retention due in 90 days">
        <Table
          head={['Dataset', 'Retain until', 'Status']}
          empty="Nothing due."
          rows={(retention.data?.due ?? []).map((d: any) => [d.name, day(d.retention_until), d.passed ? <Badge key="p" tone="negative">passed</Badge> : <Badge key="p" tone="warning">due</Badge>])}
        />
      </Panel>
    </div>
  );
}

/* --------------------------------------------- E2.8 red-team and audit rules */

export function AssuranceTab() {
  const call = useToastCall();
  const o = useLoad<any>('/governance/assurance');
  const [rt, setRt] = useState<{ model_id: string; summary: string; performed_at: string } | null>(null);
  if (o.error) return <Panel title="Red team and audit"><PanelError onRetry={() => void o.reload()} /></Panel>;
  if (!o.data) return <Skeleton className="h-64 w-full" />;
  const fr = o.data.framework_review;
  return (
    <div className="space-y-2">
      <Panel title="Framework review">
        <p className="p-2 text-[11px]">
          Last approved AI policy or management review: <b>{day(fr.last_review_at)}</b>. Reviewed every {fr.interval_months} months; next due <b>{day(fr.next_due_at)}</b>{' '}
          {fr.overdue && <Badge tone="negative">overdue</Badge>}
        </p>
      </Panel>
      <Panel title={`Red teaming and audits (audit every ${o.data.audit_interval_days} days for HIGH)`}>
        <Table
          head={['Model', 'Risk', 'Red team', 'Reason', 'Last red team', 'Audit due', '']}
          empty="No model needs red teaming or an audit right now."
          rows={o.data.models.map((m: any) => [
            m.name, m.risk_level,
            m.red_team_due ? <Badge key="r" tone="negative">due</Badge> : <Badge key="r" tone="positive">done</Badge>,
            m.red_team_reason ?? '—', day(m.last_red_team),
            <span key="a">{day(m.audit_due)} {m.audit_overdue && <Badge tone="negative">overdue</Badge>}</span>,
            <Button key="b" size="xs" variant="ghost" onClick={() => setRt({ model_id: m.model_id, summary: '', performed_at: new Date().toISOString().slice(0, 10) })}>Record red team</Button>,
          ])}
        />
        {rt && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
            <input type="date" className={`${FIELD} max-w-[150px]`} value={rt.performed_at} onChange={(e) => setRt({ ...rt, performed_at: e.target.value })} />
            <input className={`${FIELD} max-w-md`} placeholder="Summary of the exercise and findings" value={rt.summary} onChange={(e) => setRt({ ...rt, summary: e.target.value })} />
            <Button size="xs" onClick={() => void call(() => post(`/governance/models/${rt.model_id}/red-team`, rt), 'Red team recorded', () => { setRt(null); void o.reload(); })}>Save</Button>
            <Button size="xs" variant="ghost" onClick={() => setRt(null)}>Cancel</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------- E2.2 decision view on the Grievances page */

/** Per-grievance decision actions (link to a decision, appeal a rejection, ask for reconsideration). Shown only while the US kit is on. */
export function GrievanceDecision({ grievanceId, status }: { grievanceId: string; status: string }) {
  const call = useToastCall();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState('');
  const [request, setRequest] = useState('');
  const [view, setView] = useState<any>(null);
  if (!open) return <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>Decision…</Button>;
  return (
    <div className="mt-1 space-y-1 rounded border border-border p-2">
      <div className="flex flex-wrap items-end gap-1">
        <input className={`${FIELD} max-w-[200px]`} placeholder="Decision reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        <Button size="xs" variant="secondary" disabled={!ref} onClick={() => void call(() => post(`/governance/grievances/${grievanceId}/link-decision`, { decision_ref: ref }), 'Linked to the decision')}>Link</Button>
        <Button size="xs" variant="secondary" disabled={!ref} onClick={() => void call(async () => setView(await api<any>(`/governance/decisions/${encodeURIComponent(ref)}`)), 'Loaded')}>View decision</Button>
        <input className={`${FIELD} max-w-sm`} placeholder="What the applicant asks for" value={request} onChange={(e) => setRequest(e.target.value)} />
        <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/grievances/${grievanceId}/reconsider`, { request, decision_ref: ref || undefined }), 'Reconsideration opened')}>Human reconsideration</Button>
        <Button size="xs" variant="secondary" disabled={status !== 'REJECTED'} title={status !== 'REJECTED' ? 'An appeal follows a rejected grievance' : ''} onClick={() => void call(() => post(`/governance/grievances/${grievanceId}/appeal`, { request, decision_ref: ref || undefined }), 'Appeal opened')}>Appeal</Button>
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
      {view && <pre className="max-h-48 overflow-auto text-[10px]">{JSON.stringify(view, null, 2)}</pre>}
    </div>
  );
}
