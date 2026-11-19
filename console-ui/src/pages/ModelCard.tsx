/**
 * Model card tab on the model page (governance E4.1). The live card is
 * generated from the model record; the readiness meter shows what is still
 * missing. A DRAFT can be saved any time; a FINAL needs every required field
 * and no blocking gate finding, and an officer. A frozen version turns stale
 * when the model changes, naming the sections that changed. Every version
 * (and the live draft) exports as PDF, Markdown or JSON.
 */
import { AlertTriangle, CheckCircle2, Download, FileText, Lock } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../components/ui/Badge';
import { Markdown } from '../components/ui/Markdown';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { fieldClass as FIELD } from '../components/ui/form';
import { useSession } from '../stores/session';
import { day, download, post, useLoad, useToastCall } from './GovernancePhase2';

interface CardField { key: string; label: string; value: any; required: boolean; filled: boolean; fix?: string }
interface CardSection { id: string; title: string; frameworks: Array<{ pack_id: string; pack_name: string; clauses: string[] }>; fields: CardField[] }
interface CardVersion {
  version: number; status: 'DRAFT' | 'FINAL'; note: string | null; created_by: string; created_at: string;
  content_hash: string; stale: boolean; changed_sections: string[]; current_final: boolean;
}
interface CardView {
  card: { model_name: string; packs_in_scope: Array<{ pack_id: string; name: string; version: string }>; sections: CardSection[] };
  content_hash: string;
  readiness: {
    percent: number; required_met: number; required_total: number; recommended_met: number; recommended_total: number;
    missing_required: Array<{ section: string; label: string; fix?: string }>;
    missing_recommended: Array<{ section: string; label: string; fix?: string }>;
    gate_blockers: Array<{ code: string; message: string }>; gate_warnings: Array<{ code: string; message: string }>;
    final_allowed: boolean; final_blockers: string[];
  };
  versions: CardVersion[];
  current_final: CardVersion | null;
  status: 'NONE' | 'DRAFT_ONLY' | 'FINAL_CURRENT' | 'FINAL_STALE';
}

const OFFICERS = ['OWNER', 'CISO', 'ADMIN'];
const MAINTAINERS = ['OWNER', 'CISO', 'ADMIN', 'APPROVER', 'REVIEWER'];

const show = (v: any) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join('; ') : '—') : String(v));

function Meter({ percent }: { percent: number }) {
  const tone = percent >= 90 ? 'bg-positive' : percent >= 60 ? 'bg-warning' : 'bg-negative';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-bg-elevated" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Model card readiness">
      <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function ExportButtons({ modelId, version, name }: { modelId: string; version?: number; name: string }) {
  const call = useToastCall();
  const q = version ? `&version=${version}` : '';
  const base = `model-card-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${version ? `-v${version}` : '-draft'}`;
  const get = (fmt: 'pdf' | 'md' | 'json') => call(() => download(`/governance/models/${modelId}/model-card/export?format=${fmt}${q}`, `${base}.${fmt}`), 'Downloaded');
  return (
    <span className="inline-flex gap-1">
      <Button size="xs" variant="secondary" onClick={() => void get('pdf')}><Download size={11} /> PDF</Button>
      <Button size="xs" variant="secondary" onClick={() => void get('md')}>MD</Button>
      <Button size="xs" variant="secondary" onClick={() => void get('json')}>JSON</Button>
    </span>
  );
}

export function ModelCardTab({ modelId }: { modelId: string }) {
  const { data, error, reload } = useLoad<CardView>(`/governance/models/${modelId}/model-card`);
  const role = useSession((s) => s.user?.role ?? 'VIEWER');
  const call = useToastCall();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (error) return <Panel title="Model card"><PanelError onRetry={reload} /></Panel>;
  if (!data) return <Panel title="Model card"><SkeletonRows rows={8} /></Panel>;
  const r = data.readiness;
  const canDraft = MAINTAINERS.includes(role);
  const canFinal = OFFICERS.includes(role);

  const freeze = async (status: 'DRAFT' | 'FINAL') => {
    setBusy(true);
    await call(() => post(`/governance/models/${modelId}/model-card/versions`, { status, note: note.trim() || undefined }), status === 'FINAL' ? 'Final model card issued' : 'Draft saved', () => { setNote(''); void reload(); });
    setBusy(false);
  };

  const statusBadge = data.status === 'FINAL_CURRENT'
    ? <Badge tone="positive">final v{data.current_final!.version} · current</Badge>
    : data.status === 'FINAL_STALE'
      ? <Badge tone="warning">final v{data.current_final!.version} · stale</Badge>
      : data.status === 'DRAFT_ONLY' ? <Badge tone="neutral">draft only</Badge> : <Badge tone="neutral">no version yet</Badge>;

  return (
    <div className="grid gap-2 lg:grid-cols-3">
      <div className="space-y-2 lg:col-span-1">
        <Panel title="Readiness" right={statusBadge}>
          <div className="space-y-2 p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-heading text-[22px] font-medium text-text">{r.percent}%</span>
              <span className="text-[10.5px] text-text-secondary">{r.required_met}/{r.required_total} required · {r.recommended_met}/{r.recommended_total} recommended</span>
            </div>
            <Meter percent={r.percent} />
            {data.current_final?.stale && (
              <p role="status" className="rounded border border-warning bg-warning-soft px-2 py-1 text-[10.5px] leading-snug text-warning">
                <AlertTriangle size={11} className="mr-1 inline" />
                The final card v{data.current_final.version} is stale: {data.current_final.changed_sections.join(', ')} changed since it was issued. Issue a new version.
              </p>
            )}
            {r.missing_required.length > 0 && (
              <div>
                <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Required for a final card</div>
                <ul className="mt-1 space-y-0.5">
                  {r.missing_required.map((m) => (
                    <li key={`${m.section}-${m.label}`} className="text-[10.5px] text-negative">
                      • {m.label} <span className="text-text-tertiary">({m.section})</span>{m.fix && <> · <a className="text-accent hover:underline" href={m.fix}>complete</a></>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.gate_blockers.length > 0 && (
              <div>
                <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Gates blocking a final card</div>
                <ul className="mt-1 space-y-0.5">{r.gate_blockers.map((b) => <li key={b.code} className="text-[10.5px] text-negative">• {b.message}</li>)}</ul>
              </div>
            )}
            {r.missing_recommended.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[10px] text-text-secondary">{r.missing_recommended.length} recommended field{r.missing_recommended.length === 1 ? '' : 's'} empty</summary>
                <ul className="mt-1 space-y-0.5">
                  {r.missing_recommended.map((m) => <li key={`${m.section}-${m.label}`} className="text-[10px] text-text-secondary">• {m.label} <span className="text-text-tertiary">({m.section})</span></li>)}
                </ul>
              </details>
            )}
            <div className="space-y-1.5 border-t border-border pt-2">
              <input className={`${FIELD} text-[11px]`} placeholder="Note for this version (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} disabled={!canDraft} />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" disabled={!canDraft || busy} onClick={() => void freeze('DRAFT')}><FileText size={12} /> Save draft</Button>
                <Button size="sm" variant="primary" disabled={!canFinal || busy || !r.final_allowed} onClick={() => void freeze('FINAL')}
                  title={!canFinal ? 'Only an Owner, CISO or Admin can issue a final card' : r.final_allowed ? 'Freeze this card as the final version' : r.final_blockers.join('\n')}>
                  <Lock size={12} /> Issue final
                </Button>
              </div>
              <p className="text-[9.5px] text-text-tertiary">A draft can be saved any time. A final card needs every required field, clear gates and an Owner, CISO or Admin.</p>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-[10px] text-text-secondary">Live draft</span>
              <ExportButtons modelId={modelId} name={data.card.model_name} />
            </div>
          </div>
        </Panel>

        <Panel title="Versions">
          {!data.versions.length ? <p className="p-3 text-[11px] text-text-secondary">No version saved yet.</p> : (
            <ul className="divide-y divide-border">
              {data.versions.map((v) => (
                <li key={v.version} className="space-y-1 px-3 py-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-text">v{v.version}</span>
                    <Badge tone={v.status === 'FINAL' ? 'positive' : 'neutral'}>{v.status.toLowerCase()}</Badge>
                    {v.current_final && <Badge tone="accent">current final</Badge>}
                    {v.stale ? <Badge tone="warning">stale</Badge> : <span className="flex items-center gap-0.5 text-[10px] text-positive"><CheckCircle2 size={10} /> matches the model</span>}
                    <span className="ml-auto font-mono text-[9px] text-text-tertiary">{day(v.created_at)} · {v.created_by}</span>
                  </div>
                  {v.note && <p className="text-[10.5px] text-text-secondary">{v.note}</p>}
                  {v.stale && v.changed_sections.length > 0 && <p className="text-[10px] text-warning">Changed since: {v.changed_sections.join(', ')}</p>}
                  <ExportButtons modelId={modelId} version={v.version} name={data.card.model_name} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-2 lg:col-span-2">
        <Panel title={`Model card: ${data.card.model_name}`} right={<span className="font-mono text-[9px] text-text-tertiary">{data.card.packs_in_scope.map((p) => p.name.split(' (')[0]).join(' · ')}</span>}>
          <div className="divide-y divide-border">
            {data.card.sections.map((s) => (
              <section key={s.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="font-heading text-[12.5px] font-medium text-text">{s.title}</h3>
                  {s.frameworks.map((f) => (
                    <span key={f.pack_id} className="font-mono text-[9px] text-accent" title={f.pack_name}>
                      {f.pack_name.split(' (')[0].split(' ').slice(0, 3).join(' ')}: {f.clauses.join(', ')}
                    </span>
                  ))}
                </div>
                <dl className="mt-1.5 grid gap-x-3 gap-y-1 sm:grid-cols-[180px_1fr]">
                  {s.fields.map((f) => (
                    <div key={f.key} className="contents">
                      <dt className={`text-[10.5px] ${f.required && !f.filled ? 'text-negative' : 'text-text-secondary'}`}>
                        {f.label}{f.required && <span title="Required for a final card"> *</span>}
                      </dt>
                      <dd className={`text-[11px] ${f.filled ? 'text-text' : 'text-text-tertiary'}`}>
                        {f.filled && typeof f.value === 'string' ? <Markdown text={f.value} /> : show(f.value)}
                        {!f.filled && f.fix && <> · <a className="text-accent hover:underline" href={f.fix}>add</a></>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <p className="border-t border-border px-3 py-2 text-[9.5px] text-text-tertiary">
            Framework references come from the packs enabled for this organisation in Governance › Setup. * required for a final card.
          </p>
        </Panel>
      </div>
    </div>
  );
}
