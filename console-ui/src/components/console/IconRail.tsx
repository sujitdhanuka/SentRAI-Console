import {
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
  Sparkles,
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
  { route: 'ai-settings', icon: Sparkles, label: 'AI Settings', roles: ['ADMIN', 'CISO', 'OWNER'] },
  { route: 'users', icon: Users, label: 'Users', roles: ['ADMIN', 'OWNER'] },
  { route: 'orgs', icon: MessageSquareWarning, label: 'Organizations', globalAdminOnly: true },
  { route: 'docs', icon: Settings, label: 'Docs' },
];

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
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-bg-elevated py-2">
      <div
        className="mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent font-heading text-sm font-bold text-white"
        title="sentRAI Console"
      >
        S
      </div>
      {visible.map(({ icon: Icon, label, route }) => (
        <button
          key={route}
          title={label}
          aria-label={label}
          aria-current={active === route ? 'page' : undefined}
          onClick={() => navigate(route)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
            active === route
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
