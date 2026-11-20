/**
 * Model card v2 tab (spec §5–§12). The card is an evidence-backed record:
 * every value shows who or what produced it, AI or code-scan suggestions are
 * visibly marked and count only once a person accepts them, the four scores
 * are shown separately with their denominators, and the blockers list says
 * what stops a final card. Only applicable sections show unless the N/A
 * toggle is on. The server enforces every rule; this page only offers the
 * actions and shows the result.
 */
import { AlertTriangle, CheckCircle2, Download, Info, Lock, Sparkles } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { fieldClass as FIELD } from '../components/ui/form';
import { useSession } from '../stores/session';
import { day, download, post, useLoad, useToastCall } from './GovernancePhase2';

// ---- shapes returned by /governance/models/:id/card-v2 ----

interface FieldValue {
  value: any; status: string; provenance: string | null; source_ref: string | null; entered_by: string | null; accepted_by: string | null;
  suggestion: { value: any; provenance: string; source_ref: string | null; removed: string[] } | null;
  na_justification: string | null; na_decided_by: string | null;
  evidence_refs: Array<{ ref: string; type: string; added_by: string; added_at: string }>; verified_by: string | null;
}
interface CardField {
  field_id: string; label: string; help_text: string; data_type: string; allowed_values: string[] | null; applicable: boolean; not_applicable_reason: string | null;
  default_requirement: string; effective: 'MANDATORY' | 'RECOMMENDED' | 'NOT_REQUIRED'; rule: { id: string; result: string; why: string } | null;
  evidence_required: { required: boolean; type?: string }; framework_control_refs: string[]; sensitive: boolean; triggers_reassessment: boolean; value: FieldValue;
}
interface CardSection { section_id: string; number: number; title: string; applicable: boolean; reason: string | null; completion: { numerator: number; denominator: number }; fields: CardField[] }
interface Control { control_id: string; title: string; status: string; label: string; in_force: string; effective_from: string | null; stale_revision: boolean; linked_fields_filled: number; assessment: { justification?: string | null; evidence_refs?: Array<{ ref: string; type: string }>; assessed_by?: string } | null }
interface Framework { framework_id: string; revision: number; short_title: string; title: string; heading: string; applies: string; label: string; noun: string; verification_status: string; controls: Control[] }
interface Score { id: string; title: string; numerator: number; denominator: number; percent: number | null; how: string }
interface Issue { code: string; message: string; field_id?: string }
interface Approval { step: string; decision: string; conditions: Array<{ text: string; owner: string; due: string }>; comment: string | null; decided_by: string; decided_role: string; decided_at: string; superseded: boolean }
interface CardV2 {
  model_name: string; disclaimer: string; can_edit: boolean;
  record: { exists: boolean; workflow_state: string; author: string | null; reviewer: string | null; next_review_at: string | null; review_status: string; last_approved_version: number | null; migrated_from_v1: boolean; migration_note: string | null };
  summary: { record_type: string | null; record_type_accepted: boolean; states: Record<string, string | null>; inherent_risk_tier: string | null; residual_risk_tier: string | null; risk_status: string; regulatory_classification: { eu: string | null; kr_high_impact: string | null } };
  scores: Score[];
  gate: { can_finalise: boolean; blockers: Issue[]; warnings: Issue[] };
  risk: { score: number; max_score: number; score_tier: string; computed_inherent_tier: string; status: string; contributions: Array<{ label: string; value: any; points: number; max_points: number; note?: string | null }>; floors: Array<{ tier: string; reason: string }>; findings: Array<{ code: string; message: string; blocking: boolean; hard_rule?: number | null }> };
  sections: CardSection[];
  frameworks: Framework[];
  approvals: Approval[];
}
interface Version { version: number; kind: 'APPROVED' | 'SNAPSHOT'; workflow_state: string; content_hash: string; reason: string | null; created_by: string; created_at: string }
interface Change { kind: string; key: string; label: string; section?: string; before: any; after: any }

const OFFICERS = ['OWNER', 'CISO', 'ADMIN'];
const CONTROL_STATUSES = ['NOT_ASSESSED', 'APPLICABLE', 'NOT_APPLICABLE', 'GAP_IDENTIFIED', 'PARTIALLY_IMPLEMENTED', 'IMPLEMENTED', 'EVIDENCE_VERIFIED', 'EFFECTIVENESS_TESTED'];
const COUNT_STATES = ['ZERO_RECORDED', 'RECORDED', 'NO_DATA', 'NOT_MONITORED'];
const LABEL = 'text-[9px] font-medium uppercase tracking-widest text-text-tertiary';

const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase() : '—');
const show = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map((x) => (x && typeof x === 'object' ? Object.values(x).filter((y) => y !== null && y !== '').join(' / ') : String(x))).join('; ') : '—';
  if (typeof v === 'object') return v.state ? `${human(v.state)}${v.count ? ` (${v.count})` : ''}` : JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};
const tierTone = (t: string | null): BadgeTone => (t === 'CRITICAL' || t === 'HIGH' ? 'negative' : t === 'MEDIUM' ? 'warning' : t === 'LOW' ? 'positive' : 'neutral');
const statusTone = (s: string): BadgeTone => (s === 'VERIFIED' ? 'positive' : s === 'POPULATED' || s === 'EVIDENCE_PENDING' ? 'accent' : s === 'UNKNOWN' ? 'warning' : 'neutral');
const controlTone = (s: string): BadgeTone => (s === 'EFFECTIVENESS_TESTED' || s === 'EVIDENCE_VERIFIED' ? 'positive' : s === 'IMPLEMENTED' || s === 'PARTIALLY_IMPLEMENTED' ? 'accent' : s === 'GAP_IDENTIFIED' ? 'negative' : 'neutral');
const PROVENANCE: Record<string, { label: string; tone: BadgeTone; title: string }> = {
  HUMAN_ENTERED: { label: 'person', tone: 'neutral', title: 'Entered by a person' },
  AI_SUGGESTED: { label: 'AI suggestion', tone: 'warning', title: 'Drafted by AI. It counts only after a person accepts or edits it.' },
  CODE_SCAN: { label: 'code scan', tone: 'warning', title: 'Found by a code scan. It counts only after a person accepts or edits it.' },
  INTEGRATION: { label: 'integration', tone: 'neutral', title: 'Supplied by an integration' },
  IMPORTED_V1: { label: 'imported v1', tone: 'warning', title: 'Imported from the v1 card. A person must accept or edit it.' },
};

const whyRequired = (f: CardField) => {
  if (!f.applicable) return f.not_applicable_reason ?? 'Not applicable to this record';
  if (f.rule) return `${f.effective === 'MANDATORY' ? 'Required' : 'Would be required'} because ${f.rule.why}`;
  if (f.effective === 'MANDATORY') return 'Required for every record of this type';
  if (f.effective === 'RECOMMENDED') return 'Recommended, not required for a final card';
  return 'Not required for this record';
};

// ---- value editor ----

function ValueEditor({ field, users, onSave, onCancel }: { field: CardField; users: Array<{ id: string; email: string; full_name: string }>; onSave: (v: any) => void; onCancel: () => void }) {
  const cur = field.value.value ?? field.value.suggestion?.value ?? null;
  const [v, setV] = useState<any>(() => {
    if (field.data_type === 'list') return Array.isArray(cur) ? cur.join('\n') : '';
    if (['table', 'records'].includes(field.data_type)) return JSON.stringify(cur ?? [], null, 2);
    if (field.data_type === 'count') return cur ?? { state: 'NO_DATA' };
    if (field.data_type === 'multi') return Array.isArray(cur) ? cur : [];
    return cur ?? '';
  });
  const [err, setErr] = useState('');
  const save = () => {
    try {
      const t = field.data_type;
      if (t === 'list') return onSave(String(v).split('\n').map((x) => x.trim()).filter(Boolean));
      if (t === 'table' || t === 'records') return onSave(JSON.parse(v));
      if (t === 'number') return onSave(Number(v));
      if (t === 'boolean') return onSave(v === 'true' || v === true);
      if (t === 'count') return onSave(v.state === 'RECORDED' ? { state: 'RECORDED', count: Number(v.count) } : v.state === 'ZERO_RECORDED' ? { state: 'ZERO_RECORDED', count: 0 } : { state: v.state });
      return onSave(v);
    } catch {
      setErr('That is not valid JSON.');
    }
  };
  const t = field.data_type;
  let input: ReactNode;
  if (t === 'longtext' || t === 'list') input = <textarea className={`${FIELD} min-h-[70px]`} value={v} onChange={(e) => setV(e.target.value)} placeholder={t === 'list' ? 'One item per line' : ''} />;
  else if (t === 'table' || t === 'records') input = <textarea className={`${FIELD} min-h-[90px] font-mono`} value={v} onChange={(e) => setV(e.target.value)} />;
  else if (t === 'enum' || t === 'tristate') input = (
    <select className={FIELD} value={v} onChange={(e) => setV(e.target.value)}>
      <option value="">Choose…</option>
      {(field.allowed_values ?? []).map((o) => <option key={o} value={o}>{human(o)}</option>)}
    </select>
  );
  else if (t === 'multi') input = (
    <div className="flex flex-wrap gap-2">
      {(field.allowed_values ?? []).map((o) => (
        <label key={o} className="flex items-center gap-1 text-[10.5px] text-text">
          <input type="checkbox" checked={v.includes(o)} onChange={(e) => setV(e.target.checked ? [...v, o] : v.filter((x: string) => x !== o))} /> {human(o)}
        </label>
      ))}
    </div>
  );
  else if (t === 'boolean') input = (
    <select className={FIELD} value={String(v)} onChange={(e) => setV(e.target.value)}>
      <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
    </select>
  );
  else if (t === 'user') input = (
    <select className={FIELD} value={v} onChange={(e) => setV(e.target.value)}>
      <option value="">Choose a person…</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email} · {u.email}</option>)}
    </select>
  );
  else if (t === 'count') input = (
    <span className="flex gap-1.5">
      <select className={FIELD} value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })}>
        {COUNT_STATES.map((o) => <option key={o} value={o}>{human(o)}</option>)}
      </select>
      {v.state === 'RECORDED' && <input type="number" min={1} className={`${FIELD} w-24`} value={v.count ?? ''} onChange={(e) => setV({ ...v, count: e.target.value })} aria-label="Count" />}
    </span>
  );
  else input = <input type={t === 'date' ? 'date' : t === 'number' ? 'number' : 'text'} className={FIELD} value={v} onChange={(e) => setV(e.target.value)} />;
  return (
    <div className="mt-1 space-y-1 rounded border border-border bg-bg-elevated p-2">
      {input}
      {err && <p className="text-[10px] text-negative">{err}</p>}
      <div className="flex gap-1">
        <Button size="xs" variant="primary" onClick={save}>Save</Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ---- one field ----

function FieldRow({ field, canEdit, users, act }: { field: CardField; canEdit: boolean; users: Array<{ id: string; email: string; full_name: string }>; act: (fieldId: string, body: Record<string, any>, ok: string) => Promise<void> }) {
  const [mode, setMode] = useState<'' | 'edit' | 'na' | 'evidence'>('');
  const [text, setText] = useState('');
  const [evType, setEvType] = useState(field.evidence_required.type ?? 'DOCUMENT');
  const v = field.value;
  const prov = v.provenance ? PROVENANCE[v.provenance] : null;
  const awaiting = Boolean(v.provenance && v.provenance !== 'HUMAN_ENTERED' && !v.accepted_by && v.value !== null);
  const missing = field.effective === 'MANDATORY' && !(v.accepted_by && ['POPULATED', 'EVIDENCE_PENDING', 'VERIFIED'].includes(v.status)) && v.status !== 'NOT_APPLICABLE';
  const ownerName = field.data_type === 'user' && v.value ? users.find((u) => u.id === v.value) : null;
  const done = () => { setMode(''); setText(''); };

  return (
    <div id={`field-${field.field_id}`} className="grid gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[200px_1fr]">
      <div className="space-y-0.5">
        <div className={`flex items-center gap-1 text-[10.5px] ${missing ? 'text-negative' : 'text-text-secondary'}`}>
          <span>{field.label}</span>
          <span title={field.help_text} aria-label={`About ${field.label}: ${field.help_text}`}><Info size={10} className="text-text-tertiary" /></span>
        </div>
        <div className="flex flex-wrap gap-1">
          <span title={whyRequired(field)}>
            <Badge tone={field.effective === 'MANDATORY' ? 'negative' : field.effective === 'RECOMMENDED' ? 'accent' : 'neutral'}>
              {field.effective === 'MANDATORY' ? 'required' : field.effective === 'RECOMMENDED' ? 'recommended' : 'optional'}
            </Badge>
          </span>
          {field.triggers_reassessment && <span title="Changing this after approval sends the card back for reassessment"><Badge tone="neutral">reassess</Badge></span>}
        </div>
        <p className="text-[9.5px] leading-snug text-text-tertiary">{whyRequired(field)}</p>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={statusTone(v.status)}>{human(v.status)}</Badge>
          {prov && <Badge tone={prov.tone} title={prov.title}>{prov.label}</Badge>}
          {awaiting && <Badge tone="warning" title="Waiting for a person to accept or edit it">not accepted</Badge>}
          {v.accepted_by && <span className="text-[9.5px] text-text-tertiary">accepted by {v.accepted_by}</span>}
          {v.verified_by && <span className="flex items-center gap-0.5 text-[9.5px] text-positive"><CheckCircle2 size={10} /> verified by {v.verified_by}</span>}
        </div>
        <div className={`whitespace-pre-wrap break-words text-[11px] ${v.value === null ? 'text-text-tertiary' : 'text-text'}`}>
          {v.status === 'NOT_APPLICABLE'
            ? <>Not applicable: {v.na_justification ?? '(no justification)'} <span className="text-text-tertiary">({v.na_decided_by})</span></>
            : field.sensitive && v.value ? '(sensitive value hidden)' : ownerName ? `${ownerName.full_name || ownerName.email} · ${ownerName.email}` : show(v.value)}
        </div>
        {v.suggestion && (
          <div className="rounded border border-warning bg-warning-soft px-2 py-1 text-[10.5px] text-warning">
            <div className="flex items-center gap-1 font-medium"><Sparkles size={11} /> {v.suggestion.provenance === 'CODE_SCAN' ? 'Code-scan suggestion' : 'AI suggestion'}, not accepted</div>
            <div className="mt-0.5 whitespace-pre-wrap text-text">{show(v.suggestion.value)}</div>
            {v.suggestion.removed.length > 0 && <div className="mt-0.5 text-[9.5px] text-text-tertiary">Removed by clean-up: {v.suggestion.removed.join(' · ')}</div>}
            {canEdit && <Button size="xs" variant="secondary" className="mt-1" onClick={() => void act(field.field_id, { action: 'ACCEPT_SUGGESTION' }, 'Suggestion accepted')}>Accept suggestion</Button>}
          </div>
        )}
        {v.evidence_refs.length > 0 && (
          <ul className="text-[10px] text-text-secondary">
            {v.evidence_refs.map((e, i) => <li key={i}>Evidence: <span className="font-mono">{e.type}</span> {e.ref} <span className="text-text-tertiary">({e.added_by}, {day(e.added_at)})</span></li>)}
          </ul>
        )}
        {field.evidence_required.required && !v.evidence_refs.length && <p className="text-[10px] text-text-tertiary">Evidence needed: {human(field.evidence_required.type ?? 'DOCUMENT')}</p>}
        {field.framework_control_refs.length > 0 && <p className="font-mono text-[9px] text-accent">{field.framework_control_refs.join(' · ')}</p>}
        {canEdit && !mode && (
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="ghost" onClick={() => setMode('edit')}>{v.value === null ? 'Enter' : 'Edit'}</Button>
            {awaiting && <Button size="xs" variant="ghost" onClick={() => void act(field.field_id, { action: 'ACCEPT' }, 'Value accepted')}>Accept</Button>}
            <Button size="xs" variant="ghost" onClick={() => void act(field.field_id, { action: 'UNKNOWN' }, 'Marked unknown')}>Unknown</Button>
            <Button size="xs" variant="ghost" onClick={() => setMode('na')}>Not applicable</Button>
            <Button size="xs" variant="ghost" onClick={() => setMode('evidence')}>Attach evidence</Button>
            {v.evidence_refs.length > 0 && v.status !== 'VERIFIED' && <Button size="xs" variant="ghost" onClick={() => void act(field.field_id, { action: 'VERIFY' }, 'Verified')}>Verify</Button>}
          </div>
        )}
        {mode === 'edit' && <ValueEditor field={field} users={users} onCancel={done} onSave={(value) => void act(field.field_id, { action: 'SET', value }, 'Saved').then(done)} />}
        {mode === 'na' && (
          <div className="mt-1 space-y-1 rounded border border-border bg-bg-elevated p-2">
            <textarea className={`${FIELD} min-h-[50px]`} placeholder="Why this does not apply (required)" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-1">
              <Button size="xs" variant="primary" disabled={text.trim().length < 5} onClick={() => void act(field.field_id, { action: 'NOT_APPLICABLE', justification: text.trim() }, 'Marked not applicable').then(done)}>Save</Button>
              <Button size="xs" variant="ghost" onClick={done}>Cancel</Button>
            </div>
          </div>
        )}
        {mode === 'evidence' && (
          <div className="mt-1 flex flex-wrap gap-1 rounded border border-border bg-bg-elevated p-2">
            <select className={`${FIELD} w-40`} value={evType} onChange={(e) => setEvType(e.target.value)} aria-label="Evidence type">
              {['DOCUMENT', 'TEST_REPORT', 'MONITORING_RECORD', 'APPROVAL_RECORD', 'TICKET', 'URL'].map((o) => <option key={o} value={o}>{human(o)}</option>)}
            </select>
            <input className={`${FIELD} min-w-[180px] flex-1`} placeholder="Reference (document id, link, ticket)" value={text} onChange={(e) => setText(e.target.value)} />
            <Button size="xs" variant="primary" disabled={!text.trim()} onClick={() => void act(field.field_id, { action: 'ATTACH_EVIDENCE', ref: text.trim(), type: evType }, 'Evidence attached').then(done)}>Attach</Button>
            <Button size="xs" variant="ghost" onClick={done}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- a control assessment ----

function ControlRow({ fw, c, canEdit, onSave }: { fw: Framework; c: Control; canEdit: boolean; onSave: (body: Record<string, any>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(c.status);
  const [justification, setJustification] = useState('');
  const [ref, setRef] = useState('');
  const [type, setType] = useState('DOCUMENT');
  return (
    <li className="px-3 py-1.5 text-[10.5px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9.5px] text-text-secondary">{c.control_id}</span>
        <span className="text-text">{c.title}</span>
        <Badge tone={controlTone(c.status)}>{human(c.status)}</Badge>
        {c.in_force === 'NOT_YET_IN_FORCE' && <Badge tone="neutral" title={`Applies from ${c.effective_from}`}>from {c.effective_from}</Badge>}
        {c.in_force === 'DATE_UNKNOWN' && <Badge tone="warning">date to be confirmed</Badge>}
        {c.stale_revision && <Badge tone="warning" title="Assessed against an older registry revision">reassess</Badge>}
        {canEdit && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Assess'}</Button>}
      </div>
      {c.assessment?.justification && <p className="text-[10px] text-text-secondary">{c.assessment.justification}</p>}
      {open && (
        <div className="mt-1 flex flex-wrap gap-1 rounded border border-border bg-bg-elevated p-2">
          <select className={`${FIELD} w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Control status">
            {CONTROL_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
          </select>
          <input className={`${FIELD} min-w-[160px] flex-1`} placeholder="Justification (needed for not applicable or a gap)" value={justification} onChange={(e) => setJustification(e.target.value)} />
          <select className={`${FIELD} w-36`} value={type} onChange={(e) => setType(e.target.value)} aria-label="Evidence type">
            {['DOCUMENT', 'TEST', 'MONITORING_RECORD', 'APPROVAL_RECORD'].map((o) => <option key={o} value={o}>{human(o)}</option>)}
          </select>
          <input className={`${FIELD} min-w-[160px] flex-1`} placeholder="Evidence reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Button size="xs" variant="primary" onClick={() => void onSave({
            status, justification: justification.trim() || undefined, evidence_refs: ref.trim() ? [{ ref: ref.trim(), type }] : undefined,
          }).then(() => setOpen(false))}>Save</Button>
          <p className="w-full text-[9.5px] text-text-tertiary">Partially implemented and above need evidence. A different person verifies. Effectiveness tested needs test evidence. {fw.short_title} {fw.noun}s are mapped, not certified.</p>
        </div>
      )}
    </li>
  );
}

// ---- workflow ----

function WorkflowPanel({ data, modelId, reload }: { data: CardV2; modelId: string; reload: () => void }) {
  const role = useSession((s) => s.user?.role ?? 'VIEWER');
  const call = useToastCall();
  const [comment, setComment] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [cond, setCond] = useState({ text: '', owner: '', due: '' });
  const st = data.record.workflow_state;
  const run = (action: string, extra: Record<string, any> = {}) =>
    call(() => post(`/governance/models/${modelId}/card-v2/workflow`, { action, comment: comment.trim() || undefined, ...extra }), `${human(action)}: done`, () => { setComment(''); reload(); });
  const inReview = ['GOVERNANCE_REVIEW', 'RISK_APPROVAL', 'FINAL_APPROVAL'].includes(st);
  const next: Record<string, string> = { DRAFT: 'START_ASSESSMENT', ASSESSMENT: 'COLLECT_EVIDENCE', REASSESSMENT: 'COLLECT_EVIDENCE', EVIDENCE_COLLECTION: 'SUBMIT_FOR_REVIEW' };
  return (
    <Panel title="Workflow" right={<Badge tone={st === 'ACTIVE_MONITORING' ? 'positive' : st === 'RETIRED' ? 'neutral' : 'accent'}>{human(st)}</Badge>}>
      <div className="space-y-2 p-3 text-[10.5px]">
        <div className="text-text-secondary">Author {data.record.author ?? '—'} · reviewer {data.record.reviewer ?? 'not assigned'}</div>
        {data.can_edit && st !== 'RETIRED' && (
          <>
            <input className={FIELD} placeholder="Comment (a reason is needed to reject, reassess or retire)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex flex-wrap gap-1">
              {next[st] && <Button size="xs" variant="primary" onClick={() => void run(next[st])}>{human(next[st])}</Button>}
              {inReview && (
                <>
                  <Button size="xs" variant="primary" title={st === 'FINAL_APPROVAL' && !data.gate.can_finalise ? 'The gate has blockers' : ''} onClick={() => void run('APPROVE')}><Lock size={11} /> Approve</Button>
                  <Button size="xs" variant="danger" onClick={() => void run('REJECT')}>Reject</Button>
                  <Button size="xs" variant="secondary" onClick={() => void run('REQUEST_EVIDENCE')}>Request evidence</Button>
                </>
              )}
              {st === 'ACTIVE_MONITORING' && <Button size="xs" variant="secondary" onClick={() => void run('REASSESS')}>Reassess</Button>}
              <Button size="xs" variant="ghost" disabled={!comment.trim()} onClick={() => void run('COMMENT')}>Comment</Button>
              {OFFICERS.includes(role) && <Button size="xs" variant="ghost" onClick={() => void run('RETIRE')}>Retire</Button>}
            </div>
            {inReview && (
              <details>
                <summary className="cursor-pointer text-[10px] text-text-secondary">Approve with conditions</summary>
                <div className="mt-1 grid gap-1 sm:grid-cols-3">
                  <input className={`${FIELD} sm:col-span-3`} placeholder="Condition" value={cond.text} onChange={(e) => setCond({ ...cond, text: e.target.value })} />
                  <input className={FIELD} placeholder="Owner (email)" value={cond.owner} onChange={(e) => setCond({ ...cond, owner: e.target.value })} />
                  <input type="date" className={FIELD} value={cond.due} onChange={(e) => setCond({ ...cond, due: e.target.value })} aria-label="Due date" />
                  <Button size="xs" variant="primary" disabled={!cond.text || !cond.owner || !cond.due} onClick={() => void run('APPROVE_WITH_CONDITIONS', { conditions: [cond] }).then(() => setCond({ text: '', owner: '', due: '' }))}>Approve with condition</Button>
                </div>
              </details>
            )}
            {OFFICERS.includes(role) && (
              <div className="flex gap-1">
                <input className={FIELD} placeholder="Reviewer email" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
                <Button size="xs" variant="secondary" disabled={!reviewer.trim()} onClick={() => void run('ASSIGN_REVIEWER', { reviewer: reviewer.trim() }).then(() => setReviewer(''))}>Assign</Button>
              </div>
            )}
            <p className="text-[9.5px] text-text-tertiary">The author cannot approve. The assigned reviewer gives governance approval, a configured risk role gives risk approval, and final approval needs a clear gate.</p>
          </>
        )}
        <div>
          <div className={LABEL}>Approvals</div>
          {!data.approvals.length ? <p className="text-text-tertiary">None yet.</p> : (
            <ul className="mt-1 space-y-1">
              {data.approvals.map((a, i) => (
                <li key={i} className={a.superseded ? 'text-text-tertiary line-through' : 'text-text'}>
                  {human(a.step)} · {human(a.decision)} by {a.decided_by} ({human(a.decided_role)}) · {day(a.decided_at)}
                  {a.comment && <span className="text-text-secondary">: {a.comment}</span>}
                  {a.conditions.map((c, j) => <div key={j} className="pl-3 text-[10px] text-warning">Condition: {c.text} (owner {c.owner}, due {c.due})</div>)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ---- versions and diff ----

function Exports({ modelId, version, name, kind }: { modelId: string; version?: number; name: string; kind: string }) {
  const call = useToastCall();
  const base = `model-card-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${version ? `v${version}${kind === 'APPROVED' ? '' : '-draft'}` : 'draft'}`;
  const get = (fmt: 'pdf' | 'json') => call(() => download(`/governance/models/${modelId}/card-v2/export?format=${fmt}${version ? `&version=${version}` : ''}`, `${base}.${fmt}`), 'Downloaded');
  return (
    <span className="inline-flex gap-1">
      <Button size="xs" variant="secondary" onClick={() => void get('pdf')}><Download size={11} /> PDF</Button>
      <Button size="xs" variant="secondary" onClick={() => void get('json')}>JSON</Button>
    </span>
  );
}

function VersionsPanel({ modelId, name, canEdit, stamp }: { modelId: string; name: string; canEdit: boolean; stamp: number }) {
  const { data, reload } = useLoad<Version[]>(`/governance/models/${modelId}/card-v2/versions?t=${stamp}`);
  const call = useToastCall();
  const [reason, setReason] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('live');
  const [diff, setDiff] = useState<{ changes: Change[]; counts: Record<string, number> } | null>(null);
  useEffect(() => { if (data?.length && !a) setA(String(data[0].version)); }, [data, a]);
  const compare = async () => {
    const r = await call(() => api<any>(`/governance/models/${modelId}/card-v2/versions/${a}/diff/${b}`), 'Compared');
    if (r) setDiff(r);
  };
  const opts = [...(data ?? []).map((v) => ({ id: String(v.version), label: `v${v.version} ${v.kind === 'APPROVED' ? 'approved' : 'snapshot'}` })), { id: 'live', label: 'live card' }];
  return (
    <Panel title="Versions">
      <div className="space-y-2 p-3 text-[10.5px]">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Live card (always a draft)</span>
          <Exports modelId={modelId} name={name} kind="LIVE" />
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <input className={FIELD} placeholder="Reason for the snapshot" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/models/${modelId}/card-v2/versions`, { reason: reason.trim() || undefined }), 'Snapshot saved', () => { setReason(''); void reload(); })}>Snapshot</Button>
          </div>
        )}
        {!data ? <SkeletonRows rows={2} /> : !data.length ? <p className="text-text-tertiary">No version yet. Final approval freezes an approved version.</p> : (
          <ul className="divide-y divide-border">
            {data.map((v) => (
              <li key={v.version} className="space-y-1 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-text">v{v.version}</span>
                  <Badge tone={v.kind === 'APPROVED' ? 'positive' : 'neutral'}>{v.kind === 'APPROVED' ? 'approved' : 'draft snapshot'}</Badge>
                  <span className="ml-auto font-mono text-[9px] text-text-tertiary">{day(v.created_at)} · {v.created_by}</span>
                </div>
                {v.reason && <p className="text-text-secondary">{v.reason}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[9px] text-text-tertiary" title={v.content_hash}>{v.content_hash.slice(0, 12)}…</span>
                  <Exports modelId={modelId} version={v.version} name={name} kind={v.kind} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {!!data?.length && (
          <div className="space-y-1 border-t border-border pt-2">
            <div className={LABEL}>Compare</div>
            <div className="flex flex-wrap gap-1">
              <select className={`${FIELD} w-36`} value={a} onChange={(e) => setA(e.target.value)} aria-label="From">{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              <select className={`${FIELD} w-36`} value={b} onChange={(e) => setB(e.target.value)} aria-label="To">{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              <Button size="xs" variant="secondary" disabled={!a || a === b} onClick={() => void compare()}>Compare</Button>
            </div>
            {diff && (
              !diff.changes.length ? <p className="text-text-tertiary">No differences.</p> : (
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {diff.changes.map((c) => (
                    <li key={`${c.kind}-${c.key}`} className="rounded border border-border px-2 py-1">
                      <div className="flex items-center gap-1"><Badge tone="neutral">{c.kind}</Badge> <span className="text-text">{c.label}</span>{c.section && <span className="text-text-tertiary">({c.section})</span>}</div>
                      <div className="mt-0.5 text-[10px]"><span className="text-negative line-through">{show(c.before && typeof c.before === 'object' && 'value' in c.before ? (c.before as any).value : c.before)}</span> → <span className="text-positive">{show(c.after && typeof c.after === 'object' && 'value' in c.after ? (c.after as any).value : c.after)}</span></div>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---- the tab ----

export function ModelCardV2Tab({ modelId }: { modelId: string }) {
  const { data, error, reload } = useLoad<CardV2>(`/governance/models/${modelId}/card-v2`);
  const call = useToastCall();
  const [showNa, setShowNa] = useState(false);
  const [stamp, setStamp] = useState(0);
  const [users, setUsers] = useState<Array<{ id: string; email: string; full_name: string }>>([]);
  useEffect(() => {
    api<any>('/users').then((r) => setUsers((Array.isArray(r) ? r : r.users ?? []).map((u: any) => ({ id: u.id ?? u.user_id, email: u.email, full_name: u.full_name ?? u.fullName ?? '' })))).catch(() => setUsers([]));
  }, []);
  const refresh = () => { void reload(); setStamp((n) => n + 1); };
  const act = async (fieldId: string, body: Record<string, any>, ok: string) => {
    await call(() => post(`/governance/models/${modelId}/card-v2/fields/${fieldId}`, body, 'PATCH'), ok, refresh);
  };
  const sections = useMemo(() => (data ? data.sections.filter((s) => showNa || s.applicable) : []), [data, showNa]);

  if (error) return <Panel title="Model card"><PanelError onRetry={reload} /></Panel>;
  if (!data) return <Panel title="Model card"><SkeletonRows rows={8} /></Panel>;
  const s = data.summary;
  const naCount = data.sections.filter((x) => !x.applicable).length;
  const applicableFrameworks = data.frameworks.filter((f) => f.applies !== 'DOES_NOT_APPLY');

  return (
    <div className="space-y-2">
      <Panel title={`Model card: ${data.model_name}`} right={<Badge tone={data.gate.can_finalise ? 'positive' : 'negative'}>{data.gate.can_finalise ? 'gate clear' : `${data.gate.blockers.length} blocking`}</Badge>}>
        <div className="space-y-3 p-3">
          <p className="flex items-start gap-1 text-[10.5px] text-warning"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {data.disclaimer}</p>
          <dl className="grid gap-x-4 gap-y-2 text-[10.5px] sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className={LABEL}>Record type</dt><dd className="mt-0.5 flex items-center gap-1 text-text">{human(s.record_type)} {!s.record_type_accepted && <Badge tone="warning">not accepted</Badge>}</dd></div>
            {Object.entries(s.states).map(([k, v]) => <div key={k}><dt className={LABEL}>{human(k)}</dt><dd className="mt-0.5 text-text">{human(v)}</dd></div>)}
            <div><dt className={LABEL}>Internal risk tier</dt><dd className="mt-0.5 flex flex-wrap items-center gap-1"><Badge tone={tierTone(s.inherent_risk_tier)}>inherent {s.inherent_risk_tier ?? 'not set'}</Badge><Badge tone={tierTone(s.residual_risk_tier)}>residual {s.residual_risk_tier ?? 'not set'}</Badge></dd></div>
            <div><dt className={LABEL}>Regulatory classification</dt><dd className="mt-0.5 text-text" title="Set separately from the internal risk tier">EU AI Act: {human(s.regulatory_classification.eu)} · Korea high-impact: {human(s.regulatory_classification.kr_high_impact)}</dd></div>
            <div><dt className={LABEL}>Next review</dt><dd className={`mt-0.5 ${data.record.review_status === 'OVERDUE' ? 'text-negative' : 'text-text'}`}>{day(data.record.next_review_at)} · {human(data.record.review_status)}</dd></div>
          </dl>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.scores.map((x) => (
              <div key={x.id} className="rounded border border-border bg-bg-elevated p-2" title={x.how}>
                <div className={LABEL}>{x.title}</div>
                <div className="mt-0.5 font-heading text-[18px] font-medium text-text">{x.numerator}<span className="text-[12px] text-text-tertiary"> / {x.denominator}</span></div>
                <div className="text-[9.5px] leading-snug text-text-tertiary">{x.how}</div>
              </div>
            ))}
          </div>
          <p className="text-[9.5px] text-text-tertiary">The four scores are separate measures and are never combined into one number.</p>
          {data.record.migration_note && <p className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary">Migrated from v1: {data.record.migration_note}</p>}
          {data.gate.blockers.length > 0 && (
            <details open={data.gate.blockers.length <= 8}>
              <summary className="cursor-pointer text-[10.5px] font-medium text-negative">{data.gate.blockers.length} item{data.gate.blockers.length === 1 ? '' : 's'} block a final card</summary>
              <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
                {data.gate.blockers.map((b, i) => (
                  <li key={i} className="text-[10.5px] text-negative">• {b.field_id ? <a className="hover:underline" href={`#field-${b.field_id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`field-${b.field_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>{b.message}</a> : b.message}</li>
                ))}
              </ul>
            </details>
          )}
          {data.gate.warnings.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[10px] text-text-secondary">{data.gate.warnings.length} warning{data.gate.warnings.length === 1 ? '' : 's'}</summary>
              <ul className="mt-1 space-y-0.5">{data.gate.warnings.map((w, i) => <li key={i} className="text-[10px] text-text-secondary">• {w.message}</li>)}</ul>
            </details>
          )}
        </div>
      </Panel>

      <div className="grid gap-2 lg:grid-cols-3">
        <div className="min-w-0 space-y-2 lg:col-span-2">
          <Panel title="Sections" right={naCount > 0 ? (
            <label className="flex items-center gap-1 text-[10px] text-text-secondary">
              <input type="checkbox" checked={showNa} onChange={(e) => setShowNa(e.target.checked)} /> Show {naCount} not-applicable section{naCount === 1 ? '' : 's'}
            </label>
          ) : undefined}>
            <div className="divide-y divide-border">
              {sections.map((sec) => (
                <details key={sec.section_id} className="px-3 py-2" open={sec.applicable && sec.completion.numerator < sec.completion.denominator}>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-2">
                    <h3 className="font-heading text-[12.5px] font-medium text-text">{sec.number}. {sec.title}</h3>
                    {sec.applicable
                      ? <span className={`text-[10px] ${sec.completion.numerator === sec.completion.denominator ? 'text-positive' : 'text-text-secondary'}`}>{sec.completion.numerator}/{sec.completion.denominator} required complete</span>
                      : <Badge tone="neutral" title={sec.reason ?? ''}>not applicable</Badge>}
                  </summary>
                  {!sec.applicable && sec.reason && <p className="mt-1 text-[10px] text-text-tertiary">{sec.reason}</p>}
                  <div className="mt-1 divide-y divide-border">
                    {sec.fields.filter((f) => showNa || f.applicable).map((f) => <FieldRow key={f.field_id} field={f} canEdit={data.can_edit && data.record.workflow_state !== 'RETIRED'} users={users} act={act} />)}
                  </div>
                </details>
              ))}
            </div>
          </Panel>

          <Panel title="Framework mapping">
            <p className="px-3 pt-2 text-[10px] text-text-tertiary">A mapping shows where this record supports a framework. It is not evidence of compliance or certification. Registry entries are unverified until legal review.</p>
            <div className="divide-y divide-border">
              {applicableFrameworks.map((fw) => (
                <details key={fw.framework_id} className="py-1.5">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 px-3">
                    <span className="text-[11px] font-medium text-text">{fw.short_title}</span>
                    <Badge tone={fw.applies === 'APPLIES' ? 'accent' : 'neutral'}>{fw.label}</Badge>
                    {fw.verification_status !== 'LEGAL_REVIEWED' && <Badge tone="warning" title="Seeded identifiers and paraphrases, awaiting legal review">unverified</Badge>}
                    <span className="font-mono text-[9px] text-text-tertiary">rev {fw.revision}</span>
                  </summary>
                  <p className="px-3 pt-1 text-[10px] text-text-secondary">{fw.heading}</p>
                  <ul className="divide-y divide-border">
                    {fw.controls.map((c) => (
                      <ControlRow key={c.control_id} fw={fw} c={c} canEdit={data.can_edit}
                        onSave={async (body) => { await call(() => post(`/governance/models/${modelId}/card-v2/controls/${fw.framework_id}/${encodeURIComponent(c.control_id)}`, body, 'PUT'), 'Control updated', refresh); }} />
                    ))}
                  </ul>
                </details>
              ))}
              {!applicableFrameworks.length && <p className="p-3 text-[11px] text-text-secondary">No framework applies yet.</p>}
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-2">
          <WorkflowPanel data={data} modelId={modelId} reload={refresh} />
          <Panel title="Risk engine" right={<Badge tone={tierTone(data.risk.computed_inherent_tier)}>{data.risk.computed_inherent_tier}</Badge>}>
            <div className="space-y-1.5 p-3 text-[10.5px]">
              <div className="text-text">Score {data.risk.score} of {data.risk.max_score} · score tier {human(data.risk.score_tier)} · with floors {human(data.risk.computed_inherent_tier)}</div>
              <p className="text-[9.5px] text-text-tertiary">The engine explains and checks. A person sets the inherent and residual tiers in the risk section; regulatory classification never feeds the score.</p>
              <ul className="space-y-0.5">{data.risk.contributions.map((c, i) => <li key={i} className="text-text-secondary">• {c.label}: {show(c.value)} → {c.points}/{c.max_points}{c.note ? <span className="text-text-tertiary"> ({c.note})</span> : null}</li>)}</ul>
              {data.risk.floors.map((f, i) => <p key={i} className="text-warning">Floor {f.tier}: {f.reason}</p>)}
              {data.risk.findings.map((f, i) => <p key={i} className={f.blocking ? 'text-negative' : 'text-text-secondary'}>{f.blocking ? 'Blocking' : 'Note'}{f.hard_rule ? ` (rule ${f.hard_rule})` : ''}: {f.message}</p>)}
            </div>
          </Panel>
          <VersionsPanel modelId={modelId} name={data.model_name} canEdit={data.can_edit} stamp={stamp} />
        </div>
      </div>
    </div>
  );
}
