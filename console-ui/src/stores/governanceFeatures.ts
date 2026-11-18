import { create } from 'zustand';

import { api } from '../api/client';

/**
 * Which governance features the server has switched on (GOVERNANCE_V2 and the
 * per-epic flags). Pages and nav entries for governance only appear when their
 * flag is on, so the console looks exactly as before with the flags off.
 */
export interface GovernanceFeatures {
  governanceV2: boolean;
  packEngine?: boolean;
  governanceSettings?: boolean;
  accountability?: boolean;
  riskRegister?: boolean;
  impactAssessment?: boolean;
  contextProfile?: boolean;
  aims?: boolean;
  correctiveActions?: boolean;
  documentControl?: boolean;
  auPack?: boolean;
  usKit?: boolean;
  modelValidation?: boolean;
  fairLending?: boolean;
  vendors?: boolean;
  training?: boolean;
  dataRegister?: boolean;
  redTeamAuditRules?: boolean;
  [k: string]: boolean | undefined;
}

interface State {
  features: GovernanceFeatures | null;
  load(): Promise<void>;
}

export const useGovernanceFeatures = create<State>((set, get) => ({
  features: null,
  async load() {
    if (get().features) return;
    try {
      set({ features: await api<GovernanceFeatures>('/governance/features') });
    } catch {
      set({ features: { governanceV2: false } });
    }
  },
}));
