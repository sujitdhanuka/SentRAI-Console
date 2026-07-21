import { create } from 'zustand';

import {
  AIComponent,
  CalendarEvent,
  GovernanceGap,
  Grievance,
  provider,
} from '../providers/governance';

/** Fetch-state for everything the dashboard shows; `load()` doubles as retry
 *  and as the post-save refetch. */
interface GovernanceDataState {
  components: AIComponent[];
  gaps: GovernanceGap[];
  calendar: CalendarEvent[];
  grievances: Grievance[];
  loading: boolean;
  error: string | null;
  load(): Promise<void>;
}

export const useGovernanceData = create<GovernanceDataState>((set) => ({
  components: [],
  gaps: [],
  calendar: [],
  grievances: [],
  loading: true,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const [components, gaps, calendar, grievances] = await Promise.all([
        provider.getComponents(),
        provider.getGaps(),
        provider.getCalendar(),
        provider.getGrievances(),
      ]);
      set({ components, gaps, calendar, grievances, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
