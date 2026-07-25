import { KeyRound, Loader2, Radar, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../../api/client';
import { useConsoleUi } from '../../stores/consoleUi';
import { Badge } from '../ui/Badge';

export interface ScanCandidate {
  suggested_name: string;
  file_path: string;
  model_type_guess: string;
  risk_hint: string;
  confidence: string;
  secrets?: unknown[];
  signals?: unknown[];
}

export interface ScanReview {
  project: { project_id: string; name: string };
  candidates: ScanCandidate[];
  astCoverage?: string;
}

const RISK_TONE = (r: string): 'negative' | 'warning' | 'neutral' =>
  r === 'HIGH' ? 'negative' : r === 'MEDIUM' ? 'warning' : 'neutral';
const CONF_TONE = (c: string): 'positive' | 'warning' | 'neutral' =>
  c === 'HIGH' ? 'positive' : c === 'MEDIUM' ? 'warning' : 'neutral';

import { fieldClass as FIELD } from '../ui/form';
import { labelClass as LABEL } from '../ui/form';

/**
 * The review step between a scan and the inventory (parity with the classic
 * console): every discovered component is listed with a checkbox, and only the
 * selected ones are imported. Files already governed merge into their existing
 * model record, so re-importing never duplicates.
 */
export function ScanResultsModal({
  review,
  onClose,
  onImported,
}: {
  review: ScanReview | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useConsoleUi((s) => s.toast);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [ownerTeam, setOwnerTeam] = useState('');
  const [boardRef, setBoardRef] = useState('');
  const [busy, setBusy] = useState(false);

  // Everything is pre-selected — the common case is "govern all of it".
  useEffect(() => {
    if (review) {
      setChecked(new Set(review.candidates.map((c) => c.file_path)));
      setOwnerTeam('');
      setBoardRef('');
    }
  }, [review]);

  useEffect(() => {
    if (!review) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [review, onClose]);

  const allChecked = useMemo(
    () => (review ? checked.size === review.candidates.length : false),
    [review, checked],
  );

  if (!review) return null;

  const toggle = (path: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(review.candidates.map((c) => c.file_path)));
  };

  const importSelected = async () => {
    if (!checked.size) return;
    setBusy(true);
    try {
      const imported = await api<Array<{ merged?: boolean }>>('/discovery/import', {
        method: 'POST',
        body: JSON.stringify({
          project_id: review.project.project_id,
          file_paths: [...checked],
          ...(ownerTeam.trim() && { owner_team: ownerTeam.trim() }),
          ...(boardRef.trim() && { board_policy_ref: boardRef.trim() }),
        }),
      });
      const merged = imported.filter((m) => m.merged).length;
      toast(
        `${imported.length - merged} new model(s) in inventory` +
          (merged ? ` · ${merged} merged into existing models` : ''),
        'positive',
      );
      onImported();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed', 'negative');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Scan results for ${review.project.name}`}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-border-strong bg-surface">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Radar size={15} className="text-accent" />
          <div>
            <h2 className="font-heading text-[13px] font-medium">
              {review.candidates.length} AI component(s) discovered
            </h2>
            <div className="font-mono text-[9px] text-text-tertiary">
              {review.project.name}
              {review.astCoverage ? ` · ${review.astCoverage === 'full' ? 'full AST analysis' : 'regex-only scan'}` : ''}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-text-tertiary hover:bg-surface-hover">
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-left text-[10.5px]">
            <thead className="sticky top-0 z-10 bg-bg-elevated text-[9px] uppercase tracking-widest text-text-tertiary">
              <tr>
                <th className="w-8 px-2.5 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = !allChecked && checked.size > 0; }}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 py-2 font-medium">Component</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Risk</th>
                <th className="px-2 py-2 font-medium">Confidence</th>
                <th className="px-2 py-2 font-medium">Found in</th>
              </tr>
            </thead>
            <tbody>
              {review.candidates.map((c) => (
                <tr
                  key={c.file_path}
                  onClick={() => toggle(c.file_path)}
                  className="cursor-pointer border-t border-border hover:bg-surface-hover"
                >
                  <td className="px-2.5 py-1.5">
                    <input type="checkbox" checked={checked.has(c.file_path)} onChange={() => toggle(c.file_path)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${c.suggested_name}`} />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-1.5 font-medium text-text">
                      {c.suggested_name}
                      {(c.secrets?.length ?? 0) > 0 && (
                        <span title="Hardcoded secret found in this file — imports at HIGH risk">
                          <KeyRound size={10} className="text-negative" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[9.5px] text-text-secondary">{c.model_type_guess?.toLowerCase()}</td>
                  <td className="px-2 py-1.5"><Badge tone={RISK_TONE(c.risk_hint)}>{c.risk_hint?.toLowerCase()}</Badge></td>
                  <td className="px-2 py-1.5"><Badge tone={CONF_TONE(c.confidence)}>{c.confidence?.toLowerCase()}</Badge></td>
                  <td className="max-w-[220px] truncate px-2 py-1.5 font-mono text-[9.5px] text-text-tertiary" title={c.file_path}>
                    {c.file_path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Governance defaults applied to every model imported in this batch. */}
        <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Owner team</label>
            <input
              className={FIELD}
              value={ownerTeam}
              onChange={(e) => setOwnerTeam(e.target.value)}
              placeholder="e.g. Credit Risk Engineering (default: UNASSIGNED — pending review)"
              autoComplete="off"
            />
          </div>
          <div>
            <label className={LABEL}>Board policy reference</label>
            <input
              className={FIELD}
              value={boardRef}
              onChange={(e) => setBoardRef(e.target.value)}
              placeholder="e.g. BP-AI-2026-04"
              autoComplete="off"
            />
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-border px-4 py-3">
          <span className="text-[10px] text-text-secondary">
            {checked.size} of {review.candidates.length} selected
          </span>
          <span className="hidden text-[9.5px] text-text-tertiary sm:block">
            Already-governed files merge into their existing model — importing never duplicates.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-hover">
              Skip for now
            </button>
            <button
              onClick={importSelected}
              disabled={busy || checked.size === 0}
              title={checked.size === 0 ? 'Select at least one component' : undefined}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Import {checked.size} into inventory
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
