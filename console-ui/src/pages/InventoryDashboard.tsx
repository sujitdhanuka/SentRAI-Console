import { useEffect, useMemo } from 'react';

import { ComplianceMatrix } from '../components/console/ComplianceMatrix';
import { ComponentDetail } from '../components/console/ComponentDetail';
import { EditDrawer } from '../components/console/EditDrawer';
import { GapsQueue } from '../components/console/GapsQueue';
import { GovernanceCalendar } from '../components/console/GovernanceCalendar';
import { GrievanceModal } from '../components/console/GrievanceModal';
import { InventoryActions } from '../components/console/InventoryActions';
import { KpiBand } from '../components/console/KpiBand';
import { AppShell } from '../components/console/AppShell';
import { useGovernanceData } from '../stores/governanceData';
import { useConsoleUi } from '../stores/consoleUi';
import { useSession } from '../stores/session';

/** Composition only — data comes from the stores, all logic lives in panels. */
export function InventoryDashboard() {
  const { components, gaps, calendar, grievances, loading, error, load } = useGovernanceData();
  const env = useConsoleUi((s) => s.env);
  const selectedId = useConsoleUi((s) => s.selectedId);

  const activeProjectId = useSession((s) => s.activeProjectId);
  useEffect(() => {
    void load();
  }, [load, activeProjectId]); // re-scope when the active project changes

  const scoped = useMemo(
    () => (env === 'All' ? components : components.filter((c) => c.env === env)),
    [components, env],
  );
  const scopedIds = useMemo(() => new Set(scoped.map((c) => c.id)), [scoped]);
  const scopedGaps = useMemo(() => gaps.filter((g) => scopedIds.has(g.componentId)), [gaps, scopedIds]);
  // Detail always shows something: the selection when in scope, else first in scope.
  const selected = scoped.find((c) => c.id === selectedId) ?? scoped[0] ?? null;

  return (
    <AppShell title="Model Inventory" actions={<InventoryActions />}>
      <KpiBand components={scoped} gaps={scopedGaps} grievances={grievances} loading={loading} />
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2 lg:flex-row">
        <ComplianceMatrix
          components={scoped}
          gaps={gaps}
          env={env}
          selectedId={selected?.id ?? null}
          loading={loading}
          error={error}
          onRetry={load}
        />
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-[316px]">
          <ComponentDetail component={selected} loading={loading} error={error} onRetry={load} />
          <GapsQueue gaps={scopedGaps} components={components} loading={loading} error={error} onRetry={load} />
          <GovernanceCalendar events={calendar} loading={loading} error={error} onRetry={load} />
        </div>
      </main>
      <EditDrawer component={selected} />
      <GrievanceModal />
    </AppShell>
  );
}
