/**
 * Governance Phase 3 tabs (E3.1 to E3.8). Each tab appears only while its
 * server flag is on (see TABS in Governance.tsx), so with the flags off the
 * console looks exactly as before.
 */
import { Download, Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';
import { day, download, Field, ModelSelect, post, Table, useLoad, useToastCall, Writable } from './GovernancePhase2';
import { governanceHref, governanceModelFromHash, useFixedModel, useGovernanceModel } from './governanceTabs';

const STATUS_TONE: Record<string, BadgeTone> = {
  IMPLEMENTED: 'positive', PARTIAL: 'warning', NOT_IMPLEMENTED: 'negative', NOT_ASSESSED: 'neutral', NOT_APPLICABLE: 'neutral', PLANNED: 'warning',
  DRAFT: 'warning', PUBLISHED: 'positive', SUPERSEDED: 'neutral', APPROVED: 'positive', REQUESTED: 'warning', REJECTED: 'negative', COMPLETED: 'neutral', CANCELLED: 'neutral',
  RECORDED: 'positive', MISSING: 'negative', CUSTOMER_OWNED: 'neutral', NO_OWNER: 'negative', CURRENT: 'positive', EXPIRED: 'negative', REVOKED: 'neutral',
  NOT_NO_TRAINING: 'warning', PROVIDER_CHANGED: 'negative', PASS: 'positive', PARTIAL_RESULT: 'warning', FAIL: 'negative', NONE: 'negative', ok: 'positive', failed: 'negative',
};
const st = (s: string | null | undefined) => <Badge tone={STATUS_TONE[String(s ?? '')] ?? 'neutral'}>{String(s ?? '—').replace(/_/g, ' ').toLowerCase()}</Badge>;
const loadingOr = (title: string, l: { data: unknown; error: boolean; reload: () => Promise<void> }) =>
  l.error ? <Panel title={title}><PanelError onRetry={() => void l.reload()} /></Panel> : !l.data ? <Skeleton className="h-64 w-full" /> : null;

/* ------------------------------------------------ E3.1 Statement of Applicability */

export function SoaTab() {
  const call = useToastCall();
  const soa = useLoad<any>('/governance/soa');
  const [edit, setEdit] = useState<{ ref: string; included: boolean; justification: string; manual_status: string; manual_note: string } | null>(null);
  const [note, setNote] = useState('');
  const wait = loadingOr('Statement of Applicability', soa);
  if (wait) return wait;
  const d = soa.data;
  return (
    <div className="space-y-2">
      <Panel
        title={`Statement of Applicability (${d.standard})`}
        right={
          <div className="flex gap-1">
            <Button size="xs" variant="secondary" onClick={() => void call(() => download('/governance/soa/export?format=pdf', 'statement-of-applicability.pdf'), 'Downloaded')}><Download size={12} /> PDF</Button>
            <Button size="xs" variant="secondary" onClick={() => void call(() => download('/governance/soa/export?format=xlsx', 'statement-of-applicability.xlsx'), 'Downloaded')}><Download size={12} /> XLSX</Button>
          </div>
        }
      >
        <p className="p-2 text-[11px]">
          {d.summary.included} of {d.summary.controls} controls included · {d.summary.implemented} implemented · {d.summary.partial} partial · {d.summary.not_implemented} not implemented · {d.summary.not_assessed} not assessed.{' '}
          {d.approved ? <>Approved version {d.approved.version} on {day(d.approved.approved_at)} by {d.approved.approved_by}{d.approved.changed_since && <> <Badge tone="warning">changed since approval</Badge></>}</> : <Badge tone="warning">not yet approved</Badge>}
        </p>
        <Table
          head={['Control', 'Title', 'Included', 'Status', 'Evidence', 'Justification', '']}
          empty="No controls."
          rows={d.rows.map((r: any) => [
            r.ref, r.title, r.included ? 'Yes' : 'No', <span key="s">{st(r.status)}{r.status_source === 'MANUAL' && <span className="text-text-secondary"> (recorded)</span>}</span>,
            r.evidence.controls.length ? `${r.evidence.pass} pass, ${r.evidence.fail} fail${r.evidence.not_assessed ? `, ${r.evidence.not_assessed} not assessed` : ''}` : 'manual',
            <span key="j" className={r.justification_source === 'DEFAULT' ? 'text-text-secondary' : ''}>{r.justification}</span>,
            <Button key="e" size="xs" variant="ghost" onClick={() => setEdit({ ref: r.ref, included: r.included, justification: r.justification_source === 'ORGANISATION' ? r.justification : '', manual_status: r.status_source === 'MANUAL' ? r.status : '', manual_note: r.manual_note ?? '' })}>Edit</Button>,
          ])}
        />
        {edit && (
          <Writable>
            <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
              <b className="text-[11px]">{edit.ref}</b>
              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={edit.included} onChange={(e) => setEdit({ ...edit, included: e.target.checked })} /> Included</label>
              <input className={`${FIELD} max-w-md`} placeholder={edit.included ? 'Justification (optional)' : 'Why the control is excluded (required)'} value={edit.justification} onChange={(e) => setEdit({ ...edit, justification: e.target.value })} />
              <select aria-label="Recorded status" className={`${FIELD} max-w-[170px]`} value={edit.manual_status} onChange={(e) => setEdit({ ...edit, manual_status: e.target.value })}>
                <option value="">No recorded status</option>{d.manual_statuses.map((m: string) => <option key={m}>{m}</option>)}
              </select>
              <input className={`${FIELD} max-w-xs`} placeholder="Note on the recorded status" value={edit.manual_note} onChange={(e) => setEdit({ ...edit, manual_note: e.target.value })} />
              <Button size="xs" onClick={() => void call(() => post(`/governance/soa/${edit.ref}`, { included: edit.included, justification: edit.justification || null, manual_status: edit.manual_status || null, manual_note: edit.manual_note || null }, 'PUT'), 'Saved', () => { setEdit(null); void soa.reload(); })}>Save</Button>
              <Button size="xs" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </Writable>
        )}
      </Panel>
      <Panel title="Approve this version">
        <Writable>
          <div className="flex flex-wrap items-end gap-2 p-2">
            {d.approval_problems.length > 0 && <p className="w-full text-[11px] text-negative">{d.approval_problems.join('; ')}</p>}
            <input className={`${FIELD} max-w-md`} placeholder="Approval note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="xs" disabled={d.approval_problems.length > 0} title="Owner, CISO or Admin" onClick={() => void call(() => post('/governance/soa/approve', { note: note || undefined }), 'Approved', () => { setNote(''); void soa.reload(); })}>Approve</Button>
          </div>
        </Writable>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------- E3.2 Disclosures */

export function DisclosuresTab() {
  const call = useToastCall();
  const list = useLoad<any>('/governance/disclosures');
  const [modelId, setModelId] = useGovernanceModel();
  const deps = useLoad<any>(modelId ? `/governance/models/${modelId}/deployers` : null);
  const [open, setOpen] = useState<any>(null);
  const [narr, setNarr] = useState<Record<string, string>>({});
  const [dep, setDep] = useState({ name: '', contact: '' });
  const [publicUrl, setPublicUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [sent, setSent] = useState({ recipient: '', channel: 'EMAIL', reference: '' });
  const wait = loadingOr('Disclosures', list);
  if (wait) return wait;
  const reload = () => { void list.reload(); void deps.reload(); };
  const openOne = (id: string) => void call(async () => { const r = await post(`/governance/disclosures/${id}`, undefined, 'GET'); setOpen(r); setNarr(r.content?.narrative ?? {}); setSummary(r.content?.summary ?? ''); }, 'Loaded');
  return (
    <div className="space-y-2">
      <Panel
        title="Disclosures"
        right={
          <div className="flex gap-1">
            <Button size="xs" variant="secondary" onClick={() => void call(() => download('/governance/exports/rbi-inspection?format=xlsx', 'rbi-inspection.xlsx'), 'Downloaded')}><Download size={12} /> RBI inspection</Button>
            <Button size="xs" variant="secondary" onClick={() => void call(() => download('/governance/exports/omb-inventory?format=csv', 'omb-ai-inventory.csv'), 'Downloaded')}><Download size={12} /> OMB inventory</Button>
            <Writable><Button size="xs" onClick={() => void call(() => post('/governance/disclosures', { kind: 'TRANSPARENCY_STATEMENT' }), 'Draft created', reload)}><Plus size={12} /> Transparency statement</Button></Writable>
          </div>
        }
      >
        <Table
          head={['Kind', 'Version', 'Title', 'Status', 'Published', 'Review due', 'Gaps', '']}
          empty="No disclosures yet."
          rows={list.data.disclosures.map((x: any) => [
            x.kind.replace(/_/g, ' ').toLowerCase(), x.version, x.title, st(x.status), day(x.published_at), day(x.review_due_at), x.gaps.length ? x.gaps.join(', ') : '—',
            <span key="b" className="flex gap-1">
              <Button size="xs" variant="ghost" onClick={() => openOne(x.disclosure_id)}>Open</Button>
              <Button size="xs" variant="ghost" onClick={() => void call(() => download(`/governance/disclosures/${x.disclosure_id}/export?format=pdf`, `${x.kind.toLowerCase()}-v${x.version}.pdf`), 'Downloaded')}><Download size={12} /></Button>
            </span>,
          ])}
        />
      </Panel>
      {open && (
        <Panel title={`${open.title} (v${open.version}, ${open.status.toLowerCase()})`} right={<Button size="xs" variant="ghost" onClick={() => setOpen(null)}>Close</Button>}>
          <Writable>
            <div className="space-y-2 p-2 text-[11px]">
              {open.kind === 'TRANSPARENCY_STATEMENT' && ['intentions', 'monitoring', 'compliance', 'contact'].map((k) => (
                <Field key={k} label={k}>
                  <textarea className={FIELD} rows={2} disabled={open.status !== 'DRAFT'} value={narr[k] ?? ''} onChange={(e) => setNarr({ ...narr, [k]: e.target.value })} />
                </Field>
              ))}
              {open.kind === 'CO_UPDATE_NOTICE' && (
                <Field label="What changed, for the deployers (required before sending)">
                  <textarea className={FIELD} rows={3} disabled={open.status !== 'DRAFT'} value={summary} onChange={(e) => setSummary(e.target.value)} />
                </Field>
              )}
              {open.gaps?.length > 0 && <p className="text-text-secondary">Still missing: {open.gaps.join(', ')}{open.kind === 'CO_DEVELOPER' ? ' (fill the model\'s context profile, data register and validation, then refresh)' : ''}</p>}
              {open.status === 'DRAFT' && (
                <div className="flex flex-wrap items-end gap-2">
                  {open.kind === 'CO_UPDATE_NOTICE' && <Button size="xs" variant="secondary" disabled={summary.trim().length < 10} onClick={() => void call(() => post(`/governance/disclosures/${open.disclosure_id}`, { summary }, 'PATCH'), 'Saved', () => openOne(open.disclosure_id))}>Save summary</Button>}
                  {open.kind === 'TRANSPARENCY_STATEMENT' && <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/disclosures/${open.disclosure_id}`, { narrative: narr }, 'PATCH'), 'Saved', () => openOne(open.disclosure_id))}>Save text</Button>}
                  <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/disclosures/${open.disclosure_id}`, { regenerate: true }, 'PATCH'), 'Refreshed from the registers', () => openOne(open.disclosure_id))}>Refresh figures</Button>
                  <input className={`${FIELD} max-w-xs`} placeholder="Public URL (https, optional)" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
                  <Button size="xs" title="Owner, CISO or Admin" onClick={() => void call(() => post(`/governance/disclosures/${open.disclosure_id}/publish`, { public_url: publicUrl || undefined }), 'Published', () => { setOpen(null); reload(); })}>Publish</Button>
                </div>
              )}
              {open.status === 'PUBLISHED' && (
                <div className="space-y-1">
                  <span className={LABEL}>Sent to</span>
                  <Table head={['Recipient', 'Channel', 'Reference', 'When', 'By']} empty="Not sent to anyone yet." rows={(open.notifications ?? []).map((n: any) => [n.recipient, n.channel, n.reference ?? '—', day(n.at), n.by ?? '—'])} />
                  <div className="flex flex-wrap items-end gap-2">
                    <input className={`${FIELD} max-w-xs`} placeholder="Recipient (deployer, regulator, website)" value={sent.recipient} onChange={(e) => setSent({ ...sent, recipient: e.target.value })} />
                    <select aria-label="Channel" className={`${FIELD} max-w-[130px]`} value={sent.channel} onChange={(e) => setSent({ ...sent, channel: e.target.value })}>{['WEBSITE', 'EMAIL', 'PORTAL', 'REGULATOR', 'LETTER', 'OTHER'].map((c) => <option key={c}>{c}</option>)}</select>
                    <input className={`${FIELD} max-w-[200px]`} placeholder="Reference" value={sent.reference} onChange={(e) => setSent({ ...sent, reference: e.target.value })} />
                    <Button size="xs" variant="secondary" disabled={sent.recipient.trim().length < 2} onClick={() => void call(() => post(`/governance/disclosures/${open.disclosure_id}/notifications`, { ...sent, reference: sent.reference || undefined }), 'Logged', () => { setSent({ recipient: '', channel: 'EMAIL', reference: '' }); openOne(open.disclosure_id); })}>Log sending</Button>
                  </div>
                </div>
              )}
              <pre className="max-h-72 overflow-auto rounded bg-surface-hover p-2 text-[10px]">{JSON.stringify(open.content, null, 2)}</pre>
            </div>
          </Writable>
        </Panel>
      )}
      <Panel title="Developer disclosure and deployers (Colorado AI Act)">
        <div className="flex flex-wrap items-end gap-2 p-2">
          <ModelSelect value={modelId} onChange={setModelId} />
          {modelId && <Writable><Button size="xs" onClick={() => void call(() => post('/governance/disclosures', { kind: 'CO_DEVELOPER', model_id: modelId }), 'Draft created', reload)}>Generate disclosure</Button></Writable>}
        </div>
        {modelId && deps.data && (
          <>
            <Table
              head={['Deployer', 'Contact', 'Active', '']}
              empty="No deployers recorded for this model."
              rows={deps.data.deployers.map((x: any) => [x.name, x.contact ?? '—', x.active ? 'Yes' : 'No',
                <Writable key="w"><Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/deployers/${x.deployer_id}`, { active: !x.active }, 'PATCH'), 'Updated', reload)}>{x.active ? 'Deactivate' : 'Activate'}</Button></Writable>])}
            />
            <Writable>
              <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
                <input className={`${FIELD} max-w-xs`} placeholder="Deployer name" value={dep.name} onChange={(e) => setDep({ ...dep, name: e.target.value })} />
                <input className={`${FIELD} max-w-xs`} placeholder="Contact" value={dep.contact} onChange={(e) => setDep({ ...dep, contact: e.target.value })} />
                <Button size="xs" disabled={dep.name.trim().length < 2} onClick={() => void call(() => post(`/governance/models/${modelId}/deployers`, dep), 'Deployer added', () => { setDep({ name: '', contact: '' }); reload(); })}>Add deployer</Button>
              </div>
            </Writable>
          </>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------------------- E3.3 Incident extensions */

/**
 * Governance actions for one incident: senior sign-off, notice to affected
 * people, DTA notification, CISA playbook, external ticket and ITSM push.
 * Shown inside the incident on the Incidents page, so the whole incident
 * lifecycle lives in one place (it used to be a separate Governance tab).
 */
export function IncidentGovernance({ incidentId, onChanged }: { incidentId: string; onChanged?: () => void }) {
  const call = useToastCall();
  const q = useLoad<any>(`/governance/incidents/${incidentId}/extensions`);
  const [act, setAct] = useState<{ kind: string; text: string } | null>(null);
  const [showPlaybook, setShowPlaybook] = useState(false);
  if (q.error) return <p className="text-[10.5px] text-negative">Could not load the incident's governance record. <button className="underline" onClick={() => void q.reload()}>Retry</button></p>;
  if (!q.data) return <Skeleton className="h-16 w-full" />;
  const i = q.data;
  const reload = () => { void q.reload(); onChanged?.(); };
  const submit = () => {
    if (!act) return;
    const body = act.kind === 'sign-off' ? { note: act.text } : act.kind === 'affected-notice' ? { summary: act.text, channel: 'EMAIL' } : act.kind === 'notice-not-required' ? { not_required_reason: act.text }
      : act.kind === 'external-ticket' ? { ref: act.text } : { reference: act.text };
    void call(() => post(`/governance/incidents/${incidentId}/${act.kind === 'notice-not-required' ? 'affected-notice' : act.kind}`, body), 'Recorded', () => { setAct(null); reload(); });
  };
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-bg-elevated p-2 text-[10.5px]">
      {i.close_blocker && <p className="rounded border border-warning bg-warning-soft px-2 py-1 text-warning">Can't be resolved or closed yet: {i.close_blocker}</p>}
      <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        <span><span className="text-text-tertiary">Senior sign-off: </span>{i.senior_sign_off ? `${i.senior_sign_off.by}, ${day(i.senior_sign_off.at)}` : i.serious ? <Badge tone="negative">needed</Badge> : 'not needed'}</span>
        <span><span className="text-text-tertiary">Affected people: </span>{i.affected.count ? `${i.affected.count}${i.affected.notified_at ? `, told ${day(i.affected.notified_at)}` : i.affected.notice?.notRequiredReason ? ', notice not required' : ', not yet told'}` : 'none recorded'}</span>
        <span><span className="text-text-tertiary">Ticket: </span>{i.external_ticket_ref ?? '—'}</span>
        <span><span className="text-text-tertiary">DTA: </span>{i.dta_notification ? `notified ${day(i.dta_notification.notifiedAt)} (${i.dta_notification.reference})` : '—'}</span>
      </div>
      <Writable>
        <span className="flex flex-wrap gap-1">
          {i.serious && !i.senior_sign_off && <Button size="xs" variant="secondary" onClick={() => setAct({ kind: 'sign-off', text: '' })}>Sign off</Button>}
          {i.affected.count > 0 && !i.affected.notified_at && !i.affected.notice?.notRequiredReason && (
            <>
              <Button size="xs" variant="ghost" onClick={() => setAct({ kind: 'affected-notice', text: '' })}>Notice to affected</Button>
              <Button size="xs" variant="ghost" onClick={() => setAct({ kind: 'notice-not-required', text: '' })}>No notice needed</Button>
            </>
          )}
          <Button size="xs" variant="ghost" onClick={() => setAct({ kind: 'dta-notification', text: '' })}>DTA notified</Button>
          <Button size="xs" variant="ghost" onClick={() => setShowPlaybook(!showPlaybook)}>Playbook</Button>
          <Button size="xs" variant="ghost" onClick={() => setAct({ kind: 'external-ticket', text: '' })}>Ticket</Button>
          <Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/incidents/${incidentId}/push`, {}), 'Pushed', reload)}>Push to ITSM</Button>
        </span>
      </Writable>
      {act && (
        <div className="flex flex-wrap items-end gap-2">
          <span>{act.kind.replace(/-/g, ' ')}</span>
          <input className={`${FIELD} max-w-md`} placeholder={({ 'sign-off': 'Sign-off note (what was reviewed)', 'affected-notice': 'What the affected people were told', 'notice-not-required': 'Why no notice is needed', 'external-ticket': 'Ticket reference', 'dta-notification': 'DTA notification reference' } as Record<string, string>)[act.kind]} value={act.text} onChange={(e) => setAct({ ...act, text: e.target.value })} />
          <Button size="xs" onClick={submit}>Save</Button>
          <Button size="xs" variant="ghost" onClick={() => setAct(null)}>Cancel</Button>
        </div>
      )}
      {showPlaybook && (
        <Writable>
          <div className="space-y-1">
            <span className={LABEL}>CISA incident response playbook</span>
            <p className="text-text-secondary">{i.cisa.threat_vector} · {i.cisa.functional_impact} · {i.cisa.information_impact}{i.cisa.cisa_report_hours ? ` · report to CISA within ${i.cisa.cisa_report_hours}h` : ''}</p>
            {i.cisa.phases.map((ph: any) => (
              <label key={ph.phase} className="flex items-center gap-2">
                <input type="checkbox" checked={ph.done} onChange={(e) => void call(() => post(`/governance/incidents/${incidentId}/playbook`, { phase: ph.phase, done: e.target.checked }), 'Updated', reload)} />
                {ph.phase.replace(/_/g, ' ').toLowerCase()} <span className="text-text-secondary">{ph.source}{ph.note ? `: ${ph.note}` : ''}</span>
              </label>
            ))}
          </div>
        </Writable>
      )}
      {i.deliveries?.length > 0 && (
        <p className="text-text-tertiary">Deliveries: {i.deliveries.slice(0, 5).map((d: any) => `${d.event} ${d.status}${d.http_status ? ` (${d.http_status})` : ''} ${day(d.created_at)}`).join(' · ')}</p>
      )}
    </div>
  );
}

/** ITSM and SIEM integrations (Jira, ServiceNow, SIEM, webhooks). Organisation setup, so it lives on Settings. */
export function IntegrationsPanel() {
  const call = useToastCall();
  const ints = useLoad<any>('/governance/integrations');
  const [hook, setHook] = useState({ kind: 'WEBHOOK', label: '', url: '', secret: '' });
  if (ints.error) return <Panel title="Integrations (Jira, ServiceNow, SIEM, webhooks)"><PanelError onRetry={() => void ints.reload()} /></Panel>;
  if (!ints.data) return null;
  const reload = () => void ints.reload();
  return (
    <Panel title="Integrations (Jira, ServiceNow, SIEM, webhooks)">
      <Table
        head={['Kind', 'Label', 'URL', 'Events', 'Signed', 'Last delivery', '']}
        empty="No integrations."
        rows={ints.data.integrations.map((x: any) => [x.kind, x.label, x.url, x.events.join(', '), x.has_secret ? 'Yes' : 'No', x.last_status ? `${x.last_status} ${day(x.last_delivery_at)}` : '—',
          <span key="b" className="flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/integrations/${x.integration_id}/test`, {}), 'Test sent', reload)}>Test</Button>
            <Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/integrations/${x.integration_id}`, { enabled: !x.enabled }, 'PATCH'), 'Updated', reload)}>{x.enabled ? 'Disable' : 'Enable'}</Button>
          </span>])}
      />
      <Writable>
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
          <select aria-label="Kind" className={`${FIELD} max-w-[130px]`} value={hook.kind} onChange={(e) => setHook({ ...hook, kind: e.target.value })}>{ints.data.kinds.map((k: string) => <option key={k}>{k}</option>)}</select>
          <input className={`${FIELD} max-w-[160px]`} placeholder="Label" value={hook.label} onChange={(e) => setHook({ ...hook, label: e.target.value })} />
          <input className={`${FIELD} max-w-sm`} placeholder="https://…" value={hook.url} onChange={(e) => setHook({ ...hook, url: e.target.value })} />
          <input type="password" className={`${FIELD} max-w-[200px]`} placeholder="Secret or token" value={hook.secret} onChange={(e) => setHook({ ...hook, secret: e.target.value })} />
          <Button size="xs" onClick={() => void call(() => post('/governance/integrations', { ...hook, label: hook.label || undefined, secret: hook.secret || undefined }), 'Integration added', () => { setHook({ kind: 'WEBHOOK', label: '', url: '', secret: '' }); reload(); })}>Add</Button>
        </div>
      </Writable>
    </Panel>
  );
}

/* ---------------------------------------------------- E3.4 TEVV and retirement */

export function TevvTab() {
  const fixed = useFixedModel();
  const call = useToastCall();
  const ov = useLoad<any>('/governance/tevv');
  const [modelId, setModelId] = useGovernanceModel();
  const sets = useLoad<any>(modelId ? `/governance/models/${modelId}/test-sets` : null);
  const ret = useLoad<any>(modelId ? `/governance/models/${modelId}/retirement` : null);
  const [ns, setNs] = useState({ name: '', criteria: '[{"metric":"auc","operator":">=","threshold":0.8}]' });
  const [runFor, setRunFor] = useState<{ id: string; results: string; report_ref: string } | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const wait = loadingOr('TEVV', ov);
  if (wait) return wait;
  const reload = () => { void ov.reload(); void sets.reload(); void ret.reload(); };
  const json = (s: string) => { try { return JSON.parse(s); } catch { throw new Error('Not valid JSON'); } };
  const open = ret.data?.retirements.find((r: any) => ['REQUESTED', 'APPROVED'].includes(r.status));
  return (
    <div className="space-y-2">
      {!fixed && (
      <Panel title="Test, evaluation, verification and validation">
        <Table
          head={['Model', 'Risk', 'Test sets', 'Never run', 'Latest failing', 'Review overdue']}
          empty="No models."
          rows={ov.data.models.map((m: any) => [m.name, m.risk_level, m.testSets ?? 0, m.neverRun ?? 0, m.latestFailing ? <Badge key="f" tone="negative">{m.latestFailing}</Badge> : 0, m.reviewOverdue ?? 0])}
        />
      </Panel>
      )}
      <Panel title={fixed ? 'Test sets and retirement' : 'Test sets and retirement for one model'}>
        <div className="p-2"><ModelSelect value={modelId} onChange={setModelId} /></div>
        {modelId && sets.data && (
          <Writable>
            <Table
              head={['Name', 'Purpose', 'Criteria', 'Latest run', 'Review due', '']}
              empty="No test sets."
              rows={sets.data.test_sets.map((s: any) => [s.name, s.purpose, s.criteria.map((c: any) => `${c.metric}${c.segment ? `[${c.segment}]` : ''} ${c.operator} ${c.threshold}`).join('; '),
                s.latest_run ? (s.latest_run.passed ? st('PASS') : <span key="f">{st('FAIL')} {s.latest_run.failures.map((f: any) => `${f.metric}${f.segment ? `[${f.segment}]` : ''} ${f.reason}`).join(', ')}</span>) : 'never run',
                <span key="d">{day(s.review_due_at)} {s.review_overdue && <Badge tone="negative">overdue</Badge>}</span>,
                <span key="b" className="flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setRunFor({ id: s.test_set_id, results: '[{"metric":"auc","value":0.85}]', report_ref: '' })}>Record run</Button>
                  <Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/test-sets/${s.test_set_id}/review`, { effective: true, note: 'Metrics reviewed and still effective' }), 'Review recorded', reload)}>Reviewed</Button>
                </span>])}
            />
            {runFor && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
                <Field label="Results (JSON list of metric, value, segment)"><textarea className={`${FIELD} w-[420px]`} rows={2} value={runFor.results} onChange={(e) => setRunFor({ ...runFor, results: e.target.value })} /></Field>
                <input className={`${FIELD} max-w-[200px]`} placeholder="Validation report ref" value={runFor.report_ref} onChange={(e) => setRunFor({ ...runFor, report_ref: e.target.value })} />
                <Button size="xs" onClick={() => void call(() => post(`/governance/test-sets/${runFor.id}/runs`, { results: json(runFor.results), report_ref: runFor.report_ref || undefined }), 'Run recorded', () => { setRunFor(null); reload(); })}>Save</Button>
                <Button size="xs" variant="ghost" onClick={() => setRunFor(null)}>Cancel</Button>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
              <input className={`${FIELD} max-w-[200px]`} placeholder="Test set name" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} />
              <Field label="Acceptance criteria (JSON)"><textarea className={`${FIELD} w-[420px]`} rows={2} value={ns.criteria} onChange={(e) => setNs({ ...ns, criteria: e.target.value })} /></Field>
              <Button size="xs" onClick={() => void call(() => post(`/governance/models/${modelId}/test-sets`, { name: ns.name, criteria: json(ns.criteria) }), 'Test set added', () => { setNs({ ...ns, name: '' }); reload(); })}>Add test set</Button>
            </div>
          </Writable>
        )}
        {modelId && ret.data && (
          <Writable>
            <div className="space-y-1 border-t border-border p-2 text-[11px]">
              <span className={LABEL}>Retirement</span>
              {!open && (
                <div className="flex flex-wrap items-end gap-2">
                  <input className={`${FIELD} max-w-md`} placeholder="Why the model is being retired" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="xs" variant="secondary" disabled={reason.trim().length < 10} onClick={() => void call(() => post(`/governance/models/${modelId}/retirement`, { reason }), 'Retirement requested', () => { setReason(''); reload(); })}>Request retirement</Button>
                </div>
              )}
              {open && (
                <>
                  <div>{st(open.status)} requested by {open.requested_by} on {day(open.requested_at)}: {open.reason}</div>
                  {open.status === 'REQUESTED' && (
                    <div className="flex gap-1">
                      <Button size="xs" title="An officer other than the requester" onClick={() => void call(() => post(`/governance/retirements/${open.retirement_id}/decide`, { decision: 'APPROVED', note: 'Approved' }), 'Approved', reload)}>Approve</Button>
                      <Button size="xs" variant="secondary" onClick={() => void call(() => post(`/governance/retirements/${open.retirement_id}/decide`, { decision: 'REJECTED', note: 'Rejected' }), 'Rejected', reload)}>Reject</Button>
                    </div>
                  )}
                  {open.status === 'APPROVED' && open.checklist.map((i: any) => (
                    <div key={i.key} className="flex flex-wrap items-end gap-2">
                      <span className="min-w-[280px]">{i.done ? '✓' : '○'} {i.label}<br /><span className="text-text-secondary">{i.detail}</span></span>
                      {i.done ? <span className="text-text-secondary">{i.note}</span> : (
                        <>
                          <input className={`${FIELD} max-w-sm`} placeholder="How it was done" value={notes[i.key] ?? ''} onChange={(e) => setNotes({ ...notes, [i.key]: e.target.value })} />
                          <Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/retirements/${open.retirement_id}/checklist`, { key: i.key, done: true, note: notes[i.key] }), 'Done', reload)}>Done</Button>
                        </>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-1">
                    {open.status === 'APPROVED' && <Button size="xs" disabled={open.open_items.length > 0} onClick={() => void call(() => post(`/governance/retirements/${open.retirement_id}/complete`, {}), 'Model retired', reload)}>Complete retirement</Button>}
                    <Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/retirements/${open.retirement_id}/cancel`, {}), 'Cancelled', reload)}>Cancel</Button>
                  </div>
                </>
              )}
            </div>
          </Writable>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------ E3.5 Energy */

export function EnergyTab() {
  const call = useToastCall();
  const ov = useLoad<any>('/governance/energy');
  const [m, setM] = useState({ model_id: governanceModelFromHash(), kwh: '', period_start: '', period_end: '', csv: '' });
  const wait = loadingOr('Energy', ov);
  if (wait) return wait;
  const d = ov.data;
  return (
    <div className="space-y-2">
      <Panel title="Energy and emissions">
        <p className="p-2 text-[11px]">
          {d.totals.kwh} kWh, {d.totals.co2e_kg} kg CO2e across {d.totals.systems_measured} of {d.totals.systems} systems. Grid factor {d.grid_factor.value} kg CO2e per kWh ({d.grid_factor.source}).
        </p>
        <Table head={['Model', 'kWh', 'kg CO2e']} empty="No models." rows={d.models.map((x: any) => [x.name, x.kwh ?? '—', x.co2e_kg ?? '—'])} />
      </Panel>
      <Panel title="Record a reading">
        <Writable>
          <div className="flex flex-wrap items-end gap-2 p-2">
            <ModelSelect value={m.model_id} onChange={(v) => setM({ ...m, model_id: v })} />
            <input className={`${FIELD} max-w-[100px]`} placeholder="kWh" value={m.kwh} onChange={(e) => setM({ ...m, kwh: e.target.value })} />
            <input type="datetime-local" className={`${FIELD} max-w-[190px]`} value={m.period_start} onChange={(e) => setM({ ...m, period_start: e.target.value })} />
            <input type="datetime-local" className={`${FIELD} max-w-[190px]`} value={m.period_end} onChange={(e) => setM({ ...m, period_end: e.target.value })} />
            <Button size="xs" disabled={!m.model_id || !m.kwh} onClick={() => void call(() => post(`/governance/models/${m.model_id}/energy`, { source: 'METERED', kwh: Number(m.kwh), period_start: new Date(m.period_start).toISOString(), period_end: new Date(m.period_end).toISOString() }), 'Reading recorded', () => void ov.reload())}>Save metered</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
            <Field label="nvidia-smi CSV (timestamp, index, power.draw)"><textarea className={`${FIELD} w-[520px]`} rows={3} value={m.csv} onChange={(e) => setM({ ...m, csv: e.target.value })} /></Field>
            <Button size="xs" disabled={!m.model_id || !m.csv.trim()} onClick={() => void call(() => post(`/governance/models/${m.model_id}/energy`, { source: 'NVIDIA_SMI', csv: m.csv }), 'Reading recorded', () => { setM({ ...m, csv: '' }); void ov.reload(); })}>Upload log</Button>
          </div>
        </Writable>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------- E3.6 AI security */

export function SecurityTab() {
  const fixed = useFixedModel();
  const call = useToastCall();
  const ov = useLoad<any>('/governance/security');
  const [modelId, setModelId] = useGovernanceModel();
  const one = useLoad<any>(modelId ? `/governance/models/${modelId}/security` : null);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [evalRef, setEvalRef] = useState('');
  const [results, setResults] = useState<Record<string, { result: string; findings: string }>>({});
  const wait = loadingOr('AI security', ov);
  if (wait) return wait;
  const reload = () => { void ov.reload(); void one.reload(); };
  const tm = one.data?.threat_model;
  const merged = (t: any) => ({ ...t, ...(edits[t.category] ?? {}) });
  const set = (cat: string, k: string, v: any) => setEdits({ ...edits, [cat]: { ...(edits[cat] ?? {}), [k]: v } });
  return (
    <div className="space-y-2">
      {!fixed && (
      <Panel title="AI threat models and security evaluations">
        <Table
          head={['Model', 'Type', 'Threat model', 'Applicable', 'Untested', 'Failing, unmitigated']}
          empty="No models."
          rows={ov.data.models.map((m: any) => [m.name, m.model_type, st(m.threatModel), m.applicable, m.untested.length ? m.untested.join(', ') : '—', m.failingUnmitigated.length ? m.failingUnmitigated.join(', ') : '—'])}
        />
      </Panel>
      )}
      <Panel title={fixed ? 'Threat model' : 'Threat model for one model'}>
        <div className="flex flex-wrap items-end gap-2 p-2">
          <ModelSelect value={modelId} onChange={(v) => { setModelId(v); setEdits({}); }} />
          {modelId && one.data && (!tm || tm.status !== 'DRAFT') && <Writable><Button size="xs" onClick={() => void call(() => post(`/governance/models/${modelId}/threat-model`, {}), 'Draft created', reload)}>{tm ? 'New version' : 'Start from the template'}</Button></Writable>}
        </div>
        {tm && (
          <Writable>
            <p className="px-2 text-[11px]">Version {tm.version} · {st(tm.status)} {tm.approved_by && `approved by ${tm.approved_by} on ${day(tm.approved_at)}`}</p>
            <Table
              head={['Attack category', 'References', 'Applies', 'Likelihood', 'Impact', 'Mitigations or why not applicable', 'Risk']}
              empty="No threats."
              rows={tm.threats.map((raw: any) => {
                const t = merged(raw);
                const draft = tm.status === 'DRAFT';
                return [
                  t.label, [...t.atlas, ...t.owasp].join(', '),
                  <input key="a" type="checkbox" disabled={!draft} checked={t.applicable} onChange={(e) => set(t.category, 'applicable', e.target.checked)} />,
                  <input key="l" className={`${FIELD} w-12`} disabled={!draft || !t.applicable} value={t.likelihood ?? ''} onChange={(e) => set(t.category, 'likelihood', e.target.value ? Number(e.target.value) : null)} />,
                  <input key="i" className={`${FIELD} w-12`} disabled={!draft || !t.applicable} value={t.impact ?? ''} onChange={(e) => set(t.category, 'impact', e.target.value ? Number(e.target.value) : null)} />,
                  <input key="m" className={`${FIELD} min-w-[220px]`} disabled={!draft} value={(t.applicable ? t.mitigations : t.rationale) ?? ''} onChange={(e) => set(t.category, t.applicable ? 'mitigations' : 'rationale', e.target.value)} />,
                  t.risk_id ? 'raised' : '—',
                ];
              })}
            />
            {tm.status === 'DRAFT' && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
                {tm.problems.length > 0 && <p className="w-full text-[11px] text-text-secondary">To approve: {tm.problems.slice(0, 4).join('; ')}{tm.problems.length > 4 ? ` and ${tm.problems.length - 4} more` : ''}</p>}
                <Button size="xs" variant="secondary" disabled={!Object.keys(edits).length} onClick={() => void call(() => post(`/governance/threat-models/${tm.threat_model_id}`, { threats: Object.entries(edits).map(([category, v]) => ({ category, ...v })) }, 'PUT'), 'Saved', () => { setEdits({}); reload(); })}>Save</Button>
                <Button size="xs" title="An officer other than the author" onClick={() => void call(() => post(`/governance/threat-models/${tm.threat_model_id}/approve`, {}), 'Approved; risks raised', reload)}>Approve</Button>
              </div>
            )}
          </Writable>
        )}
        {tm && (
          <Writable>
            <div className="space-y-1 border-t border-border p-2 text-[11px]">
              <span className={LABEL}>Record a security evaluation</span>
              {tm.threats.filter((t: any) => t.applicable).map((t: any) => (
                <div key={t.category} className="flex flex-wrap items-end gap-2">
                  <span className="min-w-[260px]">{t.label}</span>
                  <select aria-label="Result" className={`${FIELD} max-w-[110px]`} value={results[t.category]?.result ?? ''} onChange={(e) => setResults({ ...results, [t.category]: { findings: results[t.category]?.findings ?? '', result: e.target.value } })}>
                    <option value="">not tested</option><option>PASS</option><option>PARTIAL</option><option>FAIL</option>
                  </select>
                  {results[t.category]?.result && results[t.category].result !== 'PASS' && <input className={`${FIELD} max-w-sm`} placeholder="Findings" value={results[t.category].findings} onChange={(e) => setResults({ ...results, [t.category]: { ...results[t.category], findings: e.target.value } })} />}
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-2">
                <input className={`${FIELD} max-w-[220px]`} placeholder="Report reference" value={evalRef} onChange={(e) => setEvalRef(e.target.value)} />
                <Button size="xs" disabled={!evalRef || !Object.values(results).some((r) => r.result)} onClick={() => void call(() => post(`/governance/models/${modelId}/security-evals`, { ref: evalRef, categories: Object.entries(results).filter(([, r]) => r.result).map(([category, r]) => ({ category, result: r.result, findings: r.findings || undefined })) }), 'Evaluation recorded', () => { setResults({}); setEvalRef(''); reload(); })}>Save evaluation</Button>
              </div>
              {one.data.evaluations.length > 0 && (
                <Table head={['Evaluated', 'Reference', 'Evaluator', 'Results']} empty="" rows={one.data.evaluations.map((e: any) => [day(e.evaluated_at), e.ref, e.evaluator ?? '—', e.categories.map((c: any) => `${c.category}: ${c.result}`).join(', ')])} />
              )}
            </div>
          </Writable>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------- E3.7 Engagement records */

export function EngagementTab() {
  const call = useToastCall();
  const list = useLoad<any>('/governance/engagement');
  const [f, setF] = useState({ type: 'CONSULTATION', title: '', participants: '', summary: '', outcome: '', consent_ref: '', model_id: '', occurred_at: '' });
  const wait = loadingOr('Engagement records', list);
  if (wait) return wait;
  const d = list.data;
  return (
    <div className="space-y-2">
      <Panel title="Records held per people-side item">
        <Table
          head={['Item', 'Mode', 'Owner', 'Records (24 months)', 'Last', 'Status']}
          empty=""
          rows={Object.entries<any>(d.items).map(([k, v]) => [k.replace(/_/g, ' '), v.mode === 'CUSTOMER' ? 'Customer responsibility' : 'Light record here', v.owner ?? '—', v.records, day(v.last), st(v.status)])}
        />
        <p className="px-2 pb-2 text-[10.5px] text-text-secondary">Who keeps each item is set once, in <a className="text-accent hover:underline" href={governanceHref('settings')}>Settings &amp; risk appetite</a>. Competence and awareness are recorded in <a className="text-accent hover:underline" href={governanceHref('training')}>Training</a>.</p>
      </Panel>
      <Panel title="Records">
        <Table
          head={['Date', 'Type', 'Title', 'Participants', 'Outcome']}
          empty="No records yet."
          rows={d.records.map((r: any) => [day(r.occurred_at), r.label, r.title, r.participants.map((p: any) => `${p.role}${p.count ? ` (${p.count})` : ''}`).join(', '), r.outcome ?? '—'])}
        />
        <Writable>
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
            <select aria-label="Type" className={`${FIELD} max-w-[200px]`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{d.types.map((t: any) => <option key={t.type} value={t.type}>{t.label}</option>)}</select>
            <input className={`${FIELD} max-w-xs`} placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <input className={`${FIELD} max-w-sm`} placeholder="Participants as roles or groups, comma separated" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} />
            <input type="date" className={`${FIELD} max-w-[150px]`} value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} />
            {f.type === 'NON_AI_ALTERNATIVE' && <ModelSelect value={f.model_id} onChange={(v) => setF({ ...f, model_id: v })} />}
            {f.type === 'HUMAN_SUBJECT' && <input className={`${FIELD} max-w-[200px]`} placeholder="Consent or ethics approval ref" value={f.consent_ref} onChange={(e) => setF({ ...f, consent_ref: e.target.value })} />}
            <textarea className={`${FIELD} w-full`} rows={2} placeholder="Summary" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
            <input className={`${FIELD} max-w-md`} placeholder="Outcome (what changed)" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} />
            <Button size="xs" onClick={() => void call(() => post('/governance/engagement', {
              type: f.type, title: f.title, summary: f.summary, outcome: f.outcome || undefined, consent_ref: f.consent_ref || undefined, model_id: f.model_id || undefined,
              occurred_at: f.occurred_at || undefined, participants: f.participants.split(',').map((x) => x.trim()).filter(Boolean),
            }), 'Recorded', () => { setF({ ...f, title: '', participants: '', summary: '', outcome: '', consent_ref: '' }); void list.reload(); })}>Add record</Button>
          </div>
        </Writable>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------- E3.8 Federal vendor */

export function FederalTab() {
  const call = useToastCall();
  const pol = useLoad<any>('/governance/external-ai');
  const atts = useLoad<any>('/governance/ai-attestations');
  const [a, setA] = useState({ provider_id: '', reference: '', retention_days: '', expires_at: '' });
  const wait = loadingOr('External AI', pol);
  if (wait) return wait;
  const reload = () => { void pol.reload(); void atts.reload(); };
  return (
    <div className="space-y-2">
      <Panel
        title={`External AI policy: ${pol.data.mode.replace(/_/g, ' ').toLowerCase()}`}
        right={<Writable><Button size="xs" variant="secondary" title="Owner, CISO or Admin; the export is recorded in the audit ledger" onClick={() => void call(() => download('/governance/org-export', 'sentrai-org-export.zip', 'POST'), 'Export downloaded')}><Download size={12} /> Export all organisation data</Button></Writable>}
      >
        <p className="p-2 text-[11px] text-text-secondary">Set the mode in Settings &amp; risk appetite (externalAi.mode). Local endpoints are always allowed; with attested only, a provider needs a current no-training attestation.</p>
        <Table
          head={['Provider', 'Host', 'Local', 'Attested', 'Calls allowed']}
          empty="No AI providers registered."
          rows={pol.data.providers.map((p: any) => [p.label, p.base_url_host ?? '—', p.local ? 'Yes' : 'No', p.attested ? 'Yes' : 'No', p.allowed ? st('PASS') : st('FAIL')])}
        />
      </Panel>
      <Panel title="No-training attestations">
        <Table
          head={['Provider', 'No training', 'Retention (days)', 'Reference', 'Attested', 'Expires', 'Status', '']}
          empty="No attestations."
          rows={(atts.data?.attestations ?? []).map((x: any) => [pol.data.providers.find((p: any) => p.provider_id === x.provider_id)?.label ?? x.provider_id, x.no_training ? 'Yes' : 'No', x.retention_days ?? '—', x.reference, `${day(x.attested_at)} by ${x.attested_by}`, day(x.expires_at), st(x.status),
            x.status === 'CURRENT' ? <Writable key="w"><Button size="xs" variant="ghost" onClick={() => void call(() => post(`/governance/ai-attestations/${x.attestation_id}/revoke`, {}), 'Revoked', reload)}>Revoke</Button></Writable> : null])}
        />
        <Writable>
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-2">
            <select aria-label="Provider" className={`${FIELD} max-w-xs`} value={a.provider_id} onChange={(e) => setA({ ...a, provider_id: e.target.value })}>
              <option value="">Provider…</option>{pol.data.providers.filter((p: any) => !p.local).map((p: any) => <option key={p.provider_id} value={p.provider_id}>{p.label}</option>)}
            </select>
            <input className={`${FIELD} max-w-sm`} placeholder="Contract clause or provider statement" value={a.reference} onChange={(e) => setA({ ...a, reference: e.target.value })} />
            <input className={`${FIELD} max-w-[120px]`} placeholder="Retention days" value={a.retention_days} onChange={(e) => setA({ ...a, retention_days: e.target.value })} />
            <input type="date" className={`${FIELD} max-w-[150px]`} value={a.expires_at} onChange={(e) => setA({ ...a, expires_at: e.target.value })} />
            <Button size="xs" disabled={!a.provider_id || a.reference.trim().length < 3} title="Owner, CISO or Admin" onClick={() => void call(() => post('/governance/ai-attestations', {
              provider_id: a.provider_id, no_training: true, reference: a.reference, retention_days: a.retention_days === '' ? undefined : Number(a.retention_days), expires_at: a.expires_at || undefined,
            }), 'Attestation recorded', () => { setA({ provider_id: '', reference: '', retention_days: '', expires_at: '' }); reload(); })}>Record no-training attestation</Button>
          </div>
        </Writable>
      </Panel>
    </div>
  );
}
