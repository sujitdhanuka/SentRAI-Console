import { useEffect } from 'react';

import { AiSettings } from './pages/AiSettings';
import { AuditTrail } from './pages/AuditTrail';
import { CiLedger } from './pages/CiLedger';
import { ComplianceRollup } from './pages/ComplianceRollup';
import { Docs } from './pages/Docs';
import { Incidents } from './pages/Incidents';
import { InventoryDashboard } from './pages/InventoryDashboard';
import { Lineage } from './pages/Lineage';
import { Login } from './pages/Login';
import { Monitoring } from './pages/Monitoring';
import { Organizations } from './pages/Organizations';
import { Projects } from './pages/Projects';
import { Users } from './pages/Users';
import { isDemoMode } from './providers';
import { useConsoleUi } from './stores/consoleUi';
import { Route, useRoute } from './stores/route';
import { useSession } from './stores/session';

/** Every console route now has a React page — the classic UI is fully covered. */
const PAGES: Record<Route, () => JSX.Element> = {
  projects: Projects,
  inventory: InventoryDashboard,
  compliance: ComplianceRollup,
  'ci-ledger': CiLedger,
  monitoring: Monitoring,
  audit: AuditTrail,
  incidents: Incidents,
  lineage: Lineage,
  'ai-settings': AiSettings,
  users: Users,
  orgs: Organizations,
  docs: Docs,
};

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
  if (isDemoMode) return <InventoryDashboard />;
  const Page = PAGES[route] ?? Projects;
  return <Page />;
}
