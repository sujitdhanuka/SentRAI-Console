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
  /** E1.6: organisation-level AIMS records (scope, policy, reviews, audit programme) and ORG controls. */
  aims: 'GOV_E1_6_AIMS',
  /** E1.7: shared nonconformity and corrective-action register. */
  correctiveActions: 'GOV_E1_7_ACTIONS',
  /** E1.8: document control for policies and evidence. */
  documentControl: 'GOV_E1_8_DOCUMENTS',
  /** E2.1: Australia pack (DTA policy v2.1), DTA register export, in-scope tracking. */
  auPack: 'GOV_E2_1_AU_PACK',
  /** E2.2: US pack, reason codes, adverse-action notices, appeals and reconsideration. */
  usKit: 'GOV_E2_2_US_KIT',
  /** E2.3: SR 26-2 model validation with independence and temporary-use exceptions. */
  modelValidation: 'GOV_E2_3_VALIDATION',
  /** E2.4: fair-lending proxy scan, disparate-impact and less-discriminatory-alternative evidence. */
  fairLending: 'GOV_E2_4_FAIR_LENDING',
  /** E2.5: vendor register, assessments, AI bill of materials and change alerts. */
  vendors: 'GOV_E2_5_VENDORS',
  /** E2.6: training courses, completion records and policy acknowledgements. */
  training: 'GOV_E2_6_TRAINING',
  /** E2.7: dataset register, model links, retention and deletion orders. */
  dataRegister: 'GOV_E2_7_DATASETS',
  /** E2.8: pre-deploy red-team gate, red-team-required flag, audit interval, biennial framework review. */
  redTeamAuditRules: 'GOV_E2_8_REDTEAM_AUDIT',
  /** E3.1: ISO 42001 Statement of Applicability (Annex A), approval and PDF / XLSX export. */
  soa: 'GOV_E3_1_SOA',
  /** E3.2: transparency statement, RBI inspection, OMB inventory and Colorado developer disclosures. */
  disclosures: 'GOV_E3_2_DISCLOSURES',
  /** E3.3: incident sign-off, affected-party notice, ITSM / SIEM webhooks, CISA playbook, DTA notification. */
  incidentExtensions: 'GOV_E3_3_INCIDENTS',
  /** E3.4: test-set register with acceptance criteria, metric reviews, retirement workflow. */
  tevv: 'GOV_E3_4_TEVV',
  /** E3.5: energy (kWh) and CO2e per model from GPU power samples. */
  energy: 'GOV_E3_5_ENERGY',
  /** E3.6: AI threat models and attack-category security evaluations. */
  aiSecurity: 'GOV_E3_6_AI_SECURITY',
  /** E3.7: light organisational records (consultation, expert input, team composition, consent, alternatives). */
  orgRecords: 'GOV_E3_7_ORG_RECORDS',
  /** E3.8: federal-vendor readiness: external-AI policy, provider no-training attestations, full data export. */
  federalVendor: 'GOV_E3_8_FEDERAL_VENDOR',
} as const;

export type EpicFlag = keyof typeof EPIC_FLAGS;

/** The Phase 2 epics (E2.1 to E2.8). */
export const PHASE2_FLAGS: readonly EpicFlag[] = ['auPack', 'usKit', 'modelValidation', 'fairLending', 'vendors', 'training', 'dataRegister', 'redTeamAuditRules'];

/** The Phase 3 epics (E3.1 to E3.8). */
export const PHASE3_FLAGS: readonly EpicFlag[] = ['soa', 'disclosures', 'incidentExtensions', 'tevv', 'energy', 'aiSecurity', 'orgRecords', 'federalVendor'];

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
  aims: boolean;
  correctiveActions: boolean;
  documentControl: boolean;
  auPack: boolean;
  usKit: boolean;
  modelValidation: boolean;
  fairLending: boolean;
  vendors: boolean;
  training: boolean;
  dataRegister: boolean;
  redTeamAuditRules: boolean;
  soa: boolean;
  disclosures: boolean;
  incidentExtensions: boolean;
  tevv: boolean;
  energy: boolean;
  aiSecurity: boolean;
  orgRecords: boolean;
  federalVendor: boolean;
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
    aims: epic(EPIC_FLAGS.aims),
    correctiveActions: epic(EPIC_FLAGS.correctiveActions),
    documentControl: epic(EPIC_FLAGS.documentControl),
    auPack: epic(EPIC_FLAGS.auPack),
    usKit: epic(EPIC_FLAGS.usKit),
    modelValidation: epic(EPIC_FLAGS.modelValidation),
    fairLending: epic(EPIC_FLAGS.fairLending),
    vendors: epic(EPIC_FLAGS.vendors),
    training: epic(EPIC_FLAGS.training),
    dataRegister: epic(EPIC_FLAGS.dataRegister),
    redTeamAuditRules: epic(EPIC_FLAGS.redTeamAuditRules),
    soa: epic(EPIC_FLAGS.soa),
    disclosures: epic(EPIC_FLAGS.disclosures),
    incidentExtensions: epic(EPIC_FLAGS.incidentExtensions),
    tevv: epic(EPIC_FLAGS.tevv),
    energy: epic(EPIC_FLAGS.energy),
    aiSecurity: epic(EPIC_FLAGS.aiSecurity),
    orgRecords: epic(EPIC_FLAGS.orgRecords),
    federalVendor: epic(EPIC_FLAGS.federalVendor),
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
