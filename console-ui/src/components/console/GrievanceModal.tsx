import { FormEvent, useEffect, useState } from 'react';

import { provider } from '../../providers';
import { useGovernanceData } from '../../stores/governanceData';
import { useConsoleUi } from '../../stores/consoleUi';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

import { fieldClass as FIELD } from '../ui/form';

/** Minimal consumer-grievance intake — files through the provider, which
 *  appends to the audit ledger, then toasts the generated grievance id. */
export function GrievanceModal() {
  const open = useConsoleUi((s) => s.grievanceOpen);
  const setGrievance = useConsoleUi((s) => s.setGrievance);
  const toast = useConsoleUi((s) => s.toast);
  const load = useGovernanceData((s) => s.load);
  const components = useGovernanceData((s) => s.components);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [componentId, setComponentId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSubject('');
      setDescription('');
      setComponentId(components[0]?.id ?? '');
    }
  }, [open, components]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await provider.fileGrievance({ subject, description, componentId: componentId || undefined });
      await load();
      toast(`Grievance ${id} filed`, 'positive');
      setGrievance(false);
    } catch {
      toast('Could not file grievance', 'negative');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => setGrievance(false)} title="File a Grievance" size="sm">
      <form onSubmit={submit} className="space-y-3">
        <select className={FIELD} required value={componentId} onChange={(e) => setComponentId(e.target.value)} aria-label="AI component concerned">
          <option value="" disabled>— which AI component? —</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className={FIELD} required placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className={FIELD} required rows={4} placeholder="What happened, and which AI decision does it concern?" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button type="submit" variant="primary" size="md" disabled={busy} className="w-full">
          {busy ? 'Filing…' : 'Submit Grievance'}
        </Button>
      </form>
    </Modal>
  );
}
