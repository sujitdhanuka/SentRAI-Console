import {
  Boxes,
  FileText,
  LayoutDashboard,
  MessageSquareWarning,
  Scale,
  ScrollText,
  Settings,
  Siren,
  Swords,
  Wrench,
} from 'lucide-react';

const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: Boxes, label: 'Inventory' },
  { icon: Scale, label: 'Frameworks' },
  { icon: Wrench, label: 'Gaps & Remediation' },
  { icon: Swords, label: 'Red-team' },
  { icon: Siren, label: 'Incidents' },
  { icon: MessageSquareWarning, label: 'Grievances' },
  { icon: ScrollText, label: 'Audit Ledger' },
  { icon: FileText, label: 'Reports' },
  { icon: Settings, label: 'Settings' },
];

export function IconRail() {
  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-elevated py-2">
      <div
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-heading text-sm font-bold text-white"
        title="sentRAI Console"
      >
        S
      </div>
      {NAV.map(({ icon: Icon, label, active }) => (
        <button
          key={label}
          title={label}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
            active
              ? 'bg-accent-soft text-accent'
              : 'text-text-tertiary hover:bg-surface-hover hover:text-text-secondary'
          }`}
        >
          <Icon size={17} strokeWidth={1.75} />
        </button>
      ))}
    </nav>
  );
}
