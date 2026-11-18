import { Wrench } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';
import { useGovernanceFeatures } from '../../stores/governanceFeatures';
import { Button } from '../ui/Button';
import { fieldClass as FIELD } from '../ui/form';

/**
 * "Raise action" (governance E1.7): opens a corrective action in the shared
 * register from an incident, grievance or audit. Hidden while the register is off.
 */
export function RaiseAction({ source, sourceId, defaultNonconformity }: { source: 'INCIDENT' | 'GRIEVANCE' | 'AUDIT'; sourceId: string; defaultNonconformity: string }) {
  const enabled = useGovernanceFeatures((s) => s.features?.correctiveActions);
  const toast = useConsoleUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('');
  const [due, setDue] = useState('');
  if (!enabled) return null;
  const submit = async () => {
    try {
      await api('/governance/actions', {
        method: 'POST',
        body: JSON.stringify({ source, source_id: sourceId, nonconformity: defaultNonconformity.slice(0, 2000), action, due_at: due || undefined }),
      });
      toast('Corrective action raised', 'positive');
      setOpen(false);
      setAction('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not raise the action', 'negative');
    }
  };
  if (!open) return <Button size="xs" variant="ghost" onClick={() => setOpen(true)}><Wrench size={10} /> Raise action</Button>;
  return (
    <div className="mt-1 flex w-full flex-wrap gap-1">
      <input aria-label="Corrective action" className={`${FIELD} flex-1`} placeholder="Corrective action" value={action} onChange={(e) => setAction(e.target.value)} />
      <input aria-label="Action due date" type="date" className={`${FIELD} w-36`} value={due} onChange={(e) => setDue(e.target.value)} />
      <Button size="xs" variant="primary" disabled={action.trim().length < 3} onClick={submit}>Raise</Button>
      <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
