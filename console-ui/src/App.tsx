import { Construction } from 'lucide-react';
import { useEffect } from 'react';

import { AppShell } from './components/console/AppShell';
import { CiLedger } from './pages/CiLedger';
import { ComplianceRollup } from './pages/ComplianceRollup';
import { InventoryDashboard } from './pages/InventoryDashboard';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { isDemoMode } from './providers';
import { useConsoleUi } from './stores/consoleUi';
import { Route, useRoute } from './stores/route';
import { useSession } from './stores/session';

/** Tabs still living in the classic console — ported in the next phases. */
const PENDING: Partial<Record<Route, string>> = {
  monitoring: 'Drift Monitoring',
  audit: 'Audit Trail',
  incidents: 'Incidents',
  lineage: 'Lineage Graph',
  'ai-settings': 'AI Settings',
  users: 'Users',
  orgs: 'Organizations',
  docs: 'Docs',
};

function ComingSoon({ title }: { title: string }) {
  return (
    <AppShell title={title}>
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-sm rounded-md border border-border bg-surface px-6 py-6 text-center">
          <Construction size={20} className="mx-auto mb-2 text-warning" />
          <h2 className="mb-1 font-heading text-[13px] font-medium">{title}</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
            Being rebuilt in the new console. It's fully working in the classic console today.
          </p>
          <a href="/console" className="inline-block rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-hover">
            Open in classic console
          </a>
        </div>
      </main>
    </AppShell>
  );
}

export default function App() {
  const theme = useConsoleUi((s) => s.theme);
  const authed = useSession((s) => s.authed);
  const hydrate = useSession((s) => s.hydrate);
  const route = useRoute();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    // Re-check after an api() 401 clears the session, or on tab focus.
    window.addEventListener('sentrai:signed-out', hydrate);
    window.addEventListener('focus', hydrate);
    return () => {
      window.removeEventListener('sentrai:signed-out', hydrate);
      window.removeEventListener('focus', hydrate);
    };
  }, [hydrate]);

  if (!isDemoMode && !authed) return <Login />;
  if (route === 'inventory' || isDemoMode) return <InventoryDashboard />;
  if (route === 'projects') return <Projects />;
  if (route === 'compliance') return <ComplianceRollup />;
  if (route === 'ci-ledger') return <CiLedger />;
  return <ComingSoon title={PENDING[route] ?? 'Console'} />;
}
