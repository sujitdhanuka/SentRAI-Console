/**
 * Governance feature flags (plan E0.1).
 *
 * GOVERNANCE_V2 is the master switch and defaults OFF. With no new environment
 * variables set, hosted SentRAI behaves exactly as before: only the Phase 0
 * label corrections (bug fixes) apply. When the master switch is on, every epic
 * flag defaults on and can be turned off one at a time, e.g.
 *   GOVERNANCE_V2=true GOV_E0_4_BCP_DRILLS=false
 *
 * Validators are pure functions called from many places, so they read flags
 * through getFeatureFlags() rather than through Nest DI; FeatureFlagsService is
 * the injectable wrapper for services and controllers.
 */
import { Injectable } from '@nestjs/common';

export const EPIC_FLAGS = {
  /** E0.3: one red-team interval per risk tier, used by every check. */
  redTeamIntervals: 'GOV_E0_3_REDTEAM_INTERVALS',
  /** E0.4: BCP drill records, reminders and the Sutra 7 / Rec 21 drill check. */
  bcpDrills: 'GOV_E0_4_BCP_DRILLS',
  /** E0.5: NIST MEASURE 2.10 privacy check. */
  nistPrivacy: 'GOV_E0_5_NIST_PRIVACY',
  /** E1.1: common control library + framework pack engine behind the validators. */
  packEngine: 'GOV_E1_1_PACKS',
  /** E1.2: governance settings and risk appetite (Owner/CISO window). */
  governanceSettings: 'GOV_E1_2_SETTINGS',
  /** E1.9: accountable official, governance board, named model owners. */
  accountability: 'GOV_E1_9_ACCOUNTABILITY',
  /** E1.3: risk register, starter catalogue, re-review triggers, residual-risk gate. */
  riskRegister: 'GOV_E1_3_RISKS',
  /** E1.4: impact assessments generated from the register, with sign-off and gate. */
  impactAssessment: 'GOV_E1_4_IMPACT',
  /** E1.5: structured model context profile. */
  contextProfile: 'GOV_E1_5_CONTEXT',
} as const;

export type EpicFlag = keyof typeof EPIC_FLAGS;

export interface FeatureFlags {
  governanceV2: boolean;
  redTeamIntervals: boolean;
  bcpDrills: boolean;
  nistPrivacy: boolean;
  packEngine: boolean;
  governanceSettings: boolean;
  accountability: boolean;
  riskRegister: boolean;
  impactAssessment: boolean;
  contextProfile: boolean;
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

export function getFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  const master = parseBool(env.GOVERNANCE_V2) ?? false;
  const epic = (name: string) => master && (parseBool(env[name]) ?? true);
  return {
    governanceV2: master,
    redTeamIntervals: epic(EPIC_FLAGS.redTeamIntervals),
    bcpDrills: epic(EPIC_FLAGS.bcpDrills),
    nistPrivacy: epic(EPIC_FLAGS.nistPrivacy),
    packEngine: epic(EPIC_FLAGS.packEngine),
    governanceSettings: epic(EPIC_FLAGS.governanceSettings),
    accountability: epic(EPIC_FLAGS.accountability),
    riskRegister: epic(EPIC_FLAGS.riskRegister),
    impactAssessment: epic(EPIC_FLAGS.impactAssessment),
    contextProfile: epic(EPIC_FLAGS.contextProfile),
  };
}

/** Every flag set to `value`, with overrides — for tests and fixtures that pin flags. */
export function flagSet(value: boolean, overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  const all = Object.fromEntries(['governanceV2', ...Object.keys(EPIC_FLAGS)].map((k) => [k, value])) as unknown as FeatureFlags;
  return { ...all, ...overrides };
}

@Injectable()
export class FeatureFlagsService {
  /** Read on every call so tests and operators can change env without a restart of the module graph. */
  get flags(): FeatureFlags {
    return getFeatureFlags();
  }

  isEnabled(flag: EpicFlag | 'governanceV2'): boolean {
    return this.flags[flag];
  }
}
