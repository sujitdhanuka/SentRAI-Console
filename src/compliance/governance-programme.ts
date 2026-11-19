/**
 * The governance programme as the readiness PDF and the board report show it:
 * which framework packs apply (and which are switched off), which governance
 * capabilities are switched on in this deployment, the reviewed coverage of
 * each framework in scope, and the governance registers' headline counts.
 */
import { APP_VERSION } from '../common/build';
import { EpicFlag, FeatureFlags } from '../common/feature-flags';
import { packRegistry } from '../governance/packs/pack-loader';
import { coverageSummary } from './coverage.data';
import { implementationSummary } from './implementation-status.data';

export interface GovernanceProgramme {
  version: string;
  governance_on: boolean;
  packs_in_scope: Array<{ pack_id: string; name: string; version: string; region: string | null; baseline: boolean }>;
  packs_off: Array<{ pack_id: string; name: string; region: string | null }>;
  capabilities: Array<{ group: string; on: string[]; off: string[] }>;
  coverage: Array<{
    framework: string;
    controls_evaluated: number;
    universe_total: number;
    universe_unit: string;
    implemented: number | null;
    partial: number | null;
    gap: number | null;
    applicable: number | null;
  }>;
  registers: Record<string, number | string | null> | null;
  model_cards: { models: number; final_current: number; final_stale: number; draft_only: number; none: number } | null;
}

/** Capabilities in plain words, grouped as the governance plan delivered them. */
export const CAPABILITY_GROUPS: Array<{ group: string; items: Array<[EpicFlag, string]> }> = [
  {
    group: 'Foundations (Phases 0 and 1)',
    items: [
      ['redTeamIntervals', 'Red-team interval per risk tier'], ['bcpDrills', 'BCP drill records'], ['nistPrivacy', 'NIST privacy check'],
      ['packEngine', 'Framework pack engine'], ['governanceSettings', 'Settings and risk appetite'], ['accountability', 'Accountable official and named owners'],
      ['riskRegister', 'Risk register and residual-risk gate'], ['impactAssessment', 'Impact assessments with sign-off'], ['contextProfile', 'Model context profiles'],
      ['aims', 'ISO 42001 management system records'], ['correctiveActions', 'Corrective actions'], ['documentControl', 'Document control'],
    ],
  },
  {
    group: 'Regional packs and assurance (Phase 2)',
    items: [
      ['auPack', 'Australia DTA pack and register'], ['usKit', 'US pack, notices and appeals'], ['modelValidation', 'Independent model validation'],
      ['fairLending', 'Fair-lending testing'], ['vendors', 'Vendor register and AI bill of materials'], ['training', 'Training and acknowledgements'],
      ['dataRegister', 'Dataset register'], ['redTeamAuditRules', 'Pre-deploy red team and audit rules'],
    ],
  },
  {
    group: 'Disclosure and operations (Phase 3)',
    items: [
      ['soa', 'ISO 42001 Statement of Applicability'], ['disclosures', 'Transparency statements and regulator exports'], ['incidentExtensions', 'Incident sign-off and notifications'],
      ['tevv', 'Test sets, metric reviews and retirement'], ['energy', 'Energy and emissions'], ['aiSecurity', 'AI threat models and security evaluations'],
      ['orgRecords', 'Engagement and people-side records'], ['federalVendor', 'External-AI policy and provider attestations'],
    ],
  },
  { group: 'Documentation (1.8)', items: [['modelCards', 'Model cards with draft and final versions']] },
];

export function capabilities(flags: FeatureFlags): GovernanceProgramme['capabilities'] {
  return CAPABILITY_GROUPS.map((g) => ({
    group: g.group,
    on: g.items.filter(([k]) => flags.governanceV2 && flags[k]).map(([, label]) => label),
    off: g.items.filter(([k]) => !(flags.governanceV2 && flags[k])).map(([, label]) => label),
  }));
}

/** Packs in force split into those that apply (packIds) and those switched off. */
export function packSplit(packIds: string[] | null): Pick<GovernanceProgramme, 'packs_in_scope' | 'packs_off'> {
  const all = packRegistry().activeAt();
  const on = packIds ?? packRegistry().defaultPackIds();
  return {
    packs_in_scope: all.filter((p) => on.includes(p.definition.id)).map((p) => ({ pack_id: p.definition.id, name: p.definition.name, version: p.definition.version, region: p.definition.region, baseline: p.definition.baseline })),
    packs_off: all.filter((p) => !on.includes(p.definition.id)).map((p) => ({ pack_id: p.definition.id, name: p.definition.name, region: p.definition.region })),
  };
}

/** Reviewed coverage for the frameworks whose packs apply. */
export function coverageFor(packIds: string[] | null, flags: FeatureFlags): GovernanceProgramme['coverage'] {
  const on = packIds ?? packRegistry().defaultPackIds();
  const legacy = new Set(packRegistry().activeAt().filter((p) => on.includes(p.definition.id)).map((p) => p.definition.legacyId));
  return coverageSummary(flags).frameworks.filter((f) => legacy.has(f.id)).map((f) => {
    const impl = implementationSummary(f.id, flags);
    return {
      framework: f.name,
      controls_evaluated: f.controls_evaluated,
      universe_total: f.universe_total,
      universe_unit: f.universe_unit,
      implemented: impl?.implemented ?? null,
      partial: impl?.partial ?? null,
      gap: impl?.gap ?? null,
      applicable: impl?.applicable ?? null,
    };
  });
}

export const PROGRAMME_VERSION = APP_VERSION;
