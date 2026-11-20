import {
  Activity,
  BookOpen,
  Boxes,
  BrainCircuit,
  Building2,
  ClipboardCheck,
  FolderGit2,
  Gauge,
  GitPullRequestArrow,
  Inbox,
  History,
  Landmark,
  MessageSquareWarning,
  Network,
  ScanEye,
  Siren,
  Signature,
  Users,
  Workflow,
} from 'lucide-react';

import { navigate, Route, useRoute } from '../../stores/route';
import { useSession } from '../../stores/session';
import { useGovernanceFeatures } from '../../stores/governanceFeatures';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { LEADS_CHANGED } from '../../pages/Leads';

interface NavItem {
  route: Route;
  icon: typeof Boxes;
  label: string;
  /** Roles allowed to see it; omitted = everyone. */
  roles?: string[];
  globalAdminOnly?: boolean;
  /** Shown only while this governance feature flag is on. */
  flag?: string;
}

/**
 * The rail in the order people work: what AI exists, whether it is compliant,
 * how it behaves in production, then administration and help pinned to the
 * bottom. Each icon names what its page is about, not a generic glyph.
 */
const GROUPS: NavItem[][] = [
  // Inventory: what AI we have and where it came from.
  [
    { route: 'projects', icon: FolderGit2, label: 'Projects' },
    { route: 'inventory', icon: Boxes, label: 'Model Inventory' },
    { route: 'lineage', icon: Network, label: 'Lineage Graph' },
  ],
  // Compliance and governance: is it compliant, approved and on record.
  [
    { route: 'workflows', icon: Workflow, label: 'Workflows' },
    { route: 'compliance', icon: ClipboardCheck, label: 'Compliance Rollup' },
    { route: 'governance', icon: Landmark, label: 'Governance', flag: 'governanceSettings' },
    { route: 'alignment', icon: Signature, label: 'Alignment · Board Sign-off' },
    { route: 'ci-ledger', icon: GitPullRequestArrow, label: 'CI Gate Ledger', roles: ['ADMIN', 'OWNER', 'CISO', 'APPROVER', 'REVIEWER'] },
    { route: 'audit', icon: History, label: 'Audit Trail' },
  ],
  // Monitoring and incidents: how it behaves in production.
  [
    { route: 'monitoring', icon: Activity, label: 'Drift Monitoring' },
    { route: 'visibility', icon: ScanEye, label: 'Runtime Visibility' },
    { route: 'incidents', icon: Siren, label: 'Incidents' },
    { route: 'grievances', icon: MessageSquareWarning, label: 'Consumer Grievances' },
  ],
];

/** Administration and help, pinned to the bottom of the rail. */
const FOOTER: NavItem[][] = [
  [
    { route: 'ai-usage', icon: Gauge, label: 'LLM Usage', roles: ['ADMIN', 'CISO', 'OWNER'] },
    { route: 'ai-settings', icon: BrainCircuit, label: 'AI Settings', roles: ['ADMIN', 'CISO', 'OWNER'] },
    { route: 'users', icon: Users, label: 'Users', roles: ['ADMIN', 'OWNER'] },
    { route: 'orgs', icon: Building2, label: 'Organizations', globalAdminOnly: true },
    { route: 'leads', icon: Inbox, label: 'Leads · demos and messages', globalAdminOnly: true },
  ],
  [
    { route: 'docs', icon: BookOpen, label: 'Docs' },
  ],
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
  const features = useGovernanceFeatures((s) => s.features);
  const loadFeatures = useGovernanceFeatures((s) => s.load);
  useEffect(() => {
    void loadFeatures();
  }, [loadFeatures]);

  // Platform admin: count of new landing-page leads (demo bookings + messages),
  // shown on the Leads icon and refreshed every minute.
  const [newLeads, setNewLeads] = useState(0);
  useEffect(() => {
    if (!isGlobalAdmin) return;
    let alive = true;
    const poll = () => api<{ new_total: number }>('/leads/summary').then((s) => alive && setNewLeads(s?.new_total ?? 0)).catch(() => {});
    poll();
    const t = window.setInterval(poll, 60_000);
    window.addEventListener(LEADS_CHANGED, poll);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener(LEADS_CHANGED, poll); };
  }, [isGlobalAdmin]);

  const allowed = (n: NavItem) => {
    if (n.flag && !features?.[n.flag]) return false;
    if (n.globalAdminOnly) return isGlobalAdmin;
    if (n.roles) return n.roles.includes(role);
    return true;
  };
  const visibleGroups = (groups: NavItem[][]) =>
    groups.map((g) => g.filter(allowed)).filter((g) => g.length > 0);

  const item = ({ icon: Icon, label, route }: NavItem) => (
    <button
      key={route}
      aria-label={label}
      aria-current={active === route || (route === 'inventory' && active === 'model') ? 'page' : undefined}
      onClick={() => {
        // Leaving through the rail ends a trip from a workflow step.
        try { sessionStorage.removeItem('sentrai_workflow_back'); } catch { /* ignore */ }
        navigate(route);
      }}
      className={`group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
        active === route || (route === 'inventory' && active === 'model')
          ? "bg-accent-soft text-accent before:absolute before:left-[-6px] before:top-1/2 before:h-6 before:w-[2.5px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent before:content-['']"
          : 'text-text-tertiary hover:bg-surface-hover hover:text-text-secondary'
      }`}
    >
      <Icon size={17} strokeWidth={1.75} />
      {route === 'leads' && newLeads > 0 && (
        <span aria-label={`${newLeads} new`} className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 font-mono text-[9px] font-semibold leading-none text-white">
          {newLeads > 99 ? '99+' : newLeads}
        </span>
      )}
      <RailTooltip label={newLeads > 0 && route === 'leads' ? `${label} · ${newLeads} new` : label} />
    </button>
  );
  const divider = (key: string) => <div key={key} role="separator" className="my-1 h-px w-6 shrink-0 bg-border" />;
  const render = (groups: NavItem[][], prefix: string) =>
    groups.flatMap((g, i) => [...(i > 0 ? [divider(`${prefix}-${i}`)] : []), ...g.map(item)]);

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
      {render(visibleGroups(GROUPS), 'main')}
      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
        {divider('footer')}
        {render(visibleGroups(FOOTER), 'footer')}
      </div>
    </nav>
  );
}
