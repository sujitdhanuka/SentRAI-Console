import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';
import { useGovernanceFeatures } from '../../stores/governanceFeatures';
import { Button } from '../ui/Button';
import { fieldClass as FIELD } from '../ui/form';

const today = () => new Date().toISOString().slice(0, 10);
const HIGH = ['HIGH', 'CRITICAL'];

/**
 * The one way to record a red team, used on the model popup and on
 * Governance › Red team & audit. A manual exercise needs a date, a summary and
 * (for HIGH and CRITICAL models) a report reference; a tool run (garak, PyRIT,
 * promptfoo) adds its probe and breach counts to the same record.
 *
 * With the red-team rules on, it goes through the governance endpoint, which
 * enforces the report reference. With them off it falls back to the inventory
 * endpoints (adversarial evidence for a tool run, typed red_team evidence
 * plus the model's date for a manual exercise).
 */
export function RecordRedTeam({
  modelId,
  riskLevel,
  onRecorded,
  onCancel,
  compact,
}: {
  modelId: string;
  /** HIGH / CRITICAL (any case) makes the report reference required. */
  riskLevel?: string | null;
  onRecorded?: () => void | Promise<void>;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const toast = useConsoleUi((s) => s.toast);
  const rules = useGovernanceFeatures((s) => s.features?.redTeamAuditRules);
  const [f, setF] = useState({ performed_at: today(), summary: '', ref: '', suite: '', probes: '', breaches: '' });
  const [busy, setBusy] = useState(false);
  const high = HIGH.includes(String(riskLevel ?? '').toUpperCase());
  const hasResults = f.probes !== '' || f.breaches !== '';
  const problem =
    f.summary.trim().length < 10 ? 'Summarise the exercise and findings (at least 10 characters).'
      : high && f.ref.trim().length < 5 ? 'A HIGH or CRITICAL model needs the report or evidence reference.'
        : hasResults && (!(Number(f.probes) > 0) || f.breaches === '') ? 'Give both the probe count and the breaches, or neither.'
          : null;

  const submit = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const results = hasResults ? { suite: f.suite.trim() || 'manual', total_probes: Number(f.probes), failures: Number(f.breaches) } : {};
      if (rules) {
        await api(`/governance/models/${modelId}/red-team`, {
          method: 'POST',
          body: JSON.stringify({ performed_at: f.performed_at, summary: f.summary.trim(), ref: f.ref.trim() || undefined, ...results }),
        });
      } else if (hasResults) {
        await api(`/inventory/models/${modelId}/adversarial-evidence`, {
          method: 'POST',
          body: JSON.stringify({ ...results, report_ref: f.ref.trim() || undefined, actor: 'dashboard_user' }),
        });
      } else {
        await api(`/inventory/models/${modelId}/evidence`, {
          method: 'POST',
          body: JSON.stringify({ type: 'red_team', ref: f.ref.trim() || `red-team:${f.performed_at}`, description: f.summary.trim(), actor: 'dashboard_user' }),
        });
        await api(`/inventory/models/${modelId}/governance`, {
          method: 'PATCH',
          body: JSON.stringify({ last_red_team_date: new Date(f.performed_at).toISOString(), actor: 'dashboard_user' }),
        });
      }
      const breached = hasResults && Number(f.breaches) > 0;
      toast(hasResults ? `Red team recorded: ${f.breaches}/${f.probes} probes breached` : 'Red team recorded', breached ? 'negative' : 'positive');
      setF({ performed_at: today(), summary: '', ref: '', suite: '', probes: '', breaches: '' });
      await onRecorded?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Red team not recorded', 'negative');
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string) => v.replace(/[^0-9]/g, '');
  const small = compact ? 'text-[10px]' : 'text-[11px]';
  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-text">
          <ShieldAlert size={12} className="text-accent" /> Record a red team
        </div>
      )}
      <div className="flex flex-wrap items-end gap-1.5">
        <input aria-label="Performed on" type="date" max={today()} className={`${FIELD} ${small} w-[140px] font-mono`} value={f.performed_at} onChange={(e) => setF({ ...f, performed_at: e.target.value })} />
        <input aria-label="Report or evidence reference" className={`${FIELD} ${small} min-w-[160px] flex-1`} placeholder={high ? 'Report or evidence ref (required)' : 'Report or evidence ref'} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
      </div>
      <textarea aria-label="Summary" rows={2} className={`${FIELD} ${small}`} placeholder="Summary of the exercise and findings" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      <div className="flex flex-wrap items-end gap-1.5">
        <input aria-label="Tool or suite" className={`${FIELD} ${small} min-w-[120px] flex-1`} placeholder="Tool (garak, PyRIT…) optional" value={f.suite} onChange={(e) => setF({ ...f, suite: e.target.value })} />
        <input aria-label="Probes" inputMode="numeric" className={`${FIELD} ${small} w-20 font-mono`} placeholder="Probes" value={f.probes} onChange={(e) => setF({ ...f, probes: num(e.target.value) })} />
        <input aria-label="Breaches" inputMode="numeric" className={`${FIELD} ${small} w-20 font-mono`} placeholder="Breaches" value={f.breaches} onChange={(e) => setF({ ...f, breaches: num(e.target.value) })} />
        <Button size="xs" variant="primary" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => void submit()}>
          {busy ? 'Recording…' : 'Record red team'}
        </Button>
        {onCancel && <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
      {problem && (f.summary || f.ref || hasResults) && <p className="text-[9.5px] text-text-tertiary">{problem}</p>}
    </div>
  );
}
