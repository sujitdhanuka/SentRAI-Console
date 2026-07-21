import { CheckCircle2, Link2, MinusCircle, XCircle } from 'lucide-react';

import { FrameworkCheck } from '../../providers';

/**
 * One framework check: status icon + evidence affordance. Compliance must be
 * traceable to an artifact — an "ok" with no evidenceUrl gets the amber dot
 * (compliant-but-unevidenced), never a clean green.
 */
export function StatusCell({ check, framework }: { check: FrameworkCheck; framework: string }) {
  const icon =
    check.status === 'ok' ? (
      <CheckCircle2 size={14} className="text-positive" aria-label={`${framework}: compliant`} />
    ) : check.status === 'gap' ? (
      <XCircle size={14} className="text-negative" aria-label={`${framework}: gap`} />
    ) : (
      <MinusCircle size={14} className="text-text-tertiary" aria-label={`${framework}: not applicable`} />
    );

  return (
    <span className="relative inline-flex items-center gap-1">
      <span className="relative inline-flex">
        {icon}
        {check.status === 'ok' && !check.evidenceUrl && (
          <span
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-warning"
            title="Compliant but unevidenced — attach an artifact"
          />
        )}
      </span>
      {check.evidenceUrl && (
        <a
          href={check.evidenceUrl}
          target="_blank"
          rel="noreferrer"
          title="View evidence"
          onClick={(e) => e.stopPropagation()}
          className="text-text-tertiary hover:text-accent"
        >
          <Link2 size={10} />
        </a>
      )}
    </span>
  );
}
