import { useEffect, useMemo } from 'react';

import { ComplianceMatrix } from '../components/console/ComplianceMatrix';
import { ComponentDetail } from '../components/console/ComponentDetail';
import { EditDrawer } from '../components/console/EditDrawer';
import { GapsQueue } from '../components/console/GapsQueue';
import { GovernanceCalendar } from '../components/console/GovernanceCalendar';
import { GrievanceModal } from '../components/console/GrievanceModal';
import { HeaderBar } from '../components/console/HeaderBar';
import { IconRail } from '../components/console/IconRail';
import { KpiBand } from '../components/console/KpiBand';
import { Toasts } from '../components/ui/Toast';
import { useGovernanceData } from '../stores/governanceData';
import { useConsoleUi } from '../stores/consoleUi';

/** Composition only — data comes from the stores, all logic lives in panels. */
export function InventoryDashboard() {
  const { components, gaps, calendar, grievances, loading, error, load } = useGovernanceData();
  const env = useConsoleUi((s) => s.env);
  const selectedId = useConsoleUi((s) => s.selectedId);

  useEffect(() => {
    void load();
  }, [load]);

  const scoped = useMemo(
    () => (env === 'All' ? components : components.filter((c) => c.env === env)),
    [components, env],
  );
  const scopedIds = useMemo(() => new Set(scoped.map((c) => c.id)), [scoped]);
  const scopedGaps = useMemo(() => gaps.filter((g) => scopedIds.has(g.componentId)), [gaps, scopedIds]);
  // Detail always shows something: the selection when in scope, else first in scope.
  const selected = scoped.find((c) => c.id === selectedId) ?? scoped[0] ?? null;

  return (
    <div className="flex h-screen flex-col overflow-auto bg-bg font-ui text-text lg:overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <HeaderBar />
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
          <footer className="shrink-0 border-t border-border py-1 text-center font-mono text-[8.5px] text-text-tertiary">
            sentRAI Console · demo data · governance status illustrative only
          </footer>
        </div>
      </div>
      <EditDrawer component={selected} />
      <GrievanceModal />
      <Toasts />
    </div>
  );
}
