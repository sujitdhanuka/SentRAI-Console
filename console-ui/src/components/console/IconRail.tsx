import {
  Activity,
  Boxes,
  FileText,
  FolderGit2,
  GitBranch,
  LayoutDashboard,
  MessageSquareWarning,
  Scale,
  ScrollText,
  Settings,
  Siren,
  Cpu,
  Users,
} from 'lucide-react';

import { navigate, Route, useRoute } from '../../stores/route';
import { useSession } from '../../stores/session';

interface NavItem {
  route: Route;
  icon: typeof Boxes;
  label: string;
  /** Roles allowed to see it; omitted = everyone. */
  roles?: string[];
  globalAdminOnly?: boolean;
}

const NAV: NavItem[] = [
  { route: 'projects', icon: FolderGit2, label: 'Projects' },
  { route: 'inventory', icon: Boxes, label: 'Model Inventory' },
  { route: 'compliance', icon: Scale, label: 'Compliance Rollup' },
  { route: 'ci-ledger', icon: ScrollText, label: 'CI Gate Ledger', roles: ['ADMIN', 'CISO', 'APPROVER', 'AUDITOR', 'OWNER'] },
  { route: 'monitoring', icon: LayoutDashboard, label: 'Drift Monitoring' },
  { route: 'audit', icon: FileText, label: 'Audit Trail' },
  { route: 'incidents', icon: Siren, label: 'Incidents' },
  { route: 'lineage', icon: GitBranch, label: 'Lineage Graph' },
  { route: 'ai-settings', icon: Cpu, label: 'AI Settings', roles: ['ADMIN', 'CISO', 'OWNER'] },
  { route: 'ai-usage', icon: Activity, label: 'LLM Usage', roles: ['ADMIN', 'CISO', 'OWNER'] },
  { route: 'users', icon: Users, label: 'Users', roles: ['ADMIN', 'OWNER'] },
  { route: 'orgs', icon: MessageSquareWarning, label: 'Organizations', globalAdminOnly: true },
  { route: 'docs', icon: Settings, label: 'Docs' },
];

/** Instant flyout label — the native `title` tooltip is too slow for a rail
 *  you scan quickly, and it can't be styled to match the console. */
function RailTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-text opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

export function IconRail() {
  const active = useRoute();
  const user = useSession((s) => s.user);
  const role = user?.role ?? 'VIEWER';
  const isGlobalAdmin = role === 'ADMIN' && !user?.tenant_id;

  const visible = NAV.filter((n) => {
    if (n.globalAdminOnly) return isGlobalAdmin;
    if (n.roles) return n.roles.includes(role);
    return true;
  });

  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 overflow-visible border-r border-border bg-bg-elevated py-2">
      <a href="#/projects" className="group relative mb-2 shrink-0" aria-label="sentRAI Console">
        <img
          src="/static/logo.png"
          alt="sentRAI Console"
          className="h-9 w-9 rounded-lg object-contain"
        />
        <RailTooltip label="sentRAI Console" />
      </a>
      {visible.map(({ icon: Icon, label, route }) => (
        <button
          key={route}
          aria-label={label}
          aria-current={active === route ? 'page' : undefined}
          onClick={() => navigate(route)}
          className={`group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
            active === route
              ? 'bg-accent-soft text-accent'
              : 'text-text-tertiary hover:bg-surface-hover hover:text-text-secondary'
          }`}
        >
          <Icon size={17} strokeWidth={1.75} />
          <RailTooltip label={label} />
        </button>
      ))}
    </nav>
  );
}
