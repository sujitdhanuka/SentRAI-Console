/**
 * Framework pack format (E1.1, design §2.1–2.3). A pack maps each clause of a
 * framework to a control from the common library, sets parameter values and
 * carries its own wording. Packs are data: a correction is a new pack version,
 * not a code change. Each version carries an effective date and a content hash
 * (signing is deferred with the air-gapped edition; the hash makes it a
 * drop-in later).
 */
import { RiskLevel } from '../../common/enums';
import { FeatureFlags } from '../../common/feature-flags';

export type ParameterRule =
  /** Intervals and reporting deadlines: the shortest wins. */
  | 'min'
  /** Thresholds where a higher number is stricter (e.g. minimum fairness ratio). */
  | 'max'
  /** Lists of required evidence, rights or in-scope domains: union of all. */
  | 'union'
  /** Booleans meaning "required": true wins. */
  | 'any';

export interface ParameterSpec {
  name: string;
  rule: ParameterRule;
  unit?: string;
  description: string;
}

/** Mandatory rule for a clause: always, never, or only for these risk tiers. */
export type MandatoryRule = boolean | { riskIn: RiskLevel[] };

export interface PackClause {
  /** Code printed in reports (e.g. "GOVERN-2.1", "Art-9", SutraAlignment value). */
  code: string;
  /** Official clause reference (e.g. "GOVERN 2.1", "Rec 21"), for exports and the coverage page. */
  clause?: string;
  name: string;
  control: string;
  opts?: Record<string, any>;
  mandatory: MandatoryRule;
  /** Only evaluated when the pack's tier classifier returns one of these tiers. */
  appliesWhenTier?: string[];
  /** Only evaluated while this governance flag is on. */
  flag?: keyof FeatureFlags;
  /** Evidence templates keyed by the control outcome key ({fact} placeholders). */
  evidence?: Record<string, string>;
  /** Gap text: one string, or templates keyed by the control's gap keys. */
  gap: string | Record<string, string>;
  /** Other clauses of the framework this control also evidences (reported, not separately checked). */
  alsoEvidences?: string[];
  /**
   * EU AI Act operator roles the clause falls on (PROVIDER, DEPLOYER, IMPORTER, DISTRIBUTOR,
   * AUTHORISED_REP). While GOV_E5_1_EU_ACT is on and the system's roles are recorded, a clause
   * none of whose roles the organisation holds for the system is not evaluated.
   */
  roles?: string[];
  /** Evaluated only when ctx.governance (or ctx.org) carries this fact: e.g. "euAct" while the EU workspace is in force for the organisation. */
  requiresFact?: string;
  /** ISO date the clause's obligation applies from (EU AI Act Art. 113); honoured while GOV_E5_1_EU_ACT is on. */
  effectiveFrom?: string;
}

export interface PackDefinition {
  id: string;
  version: string;
  /** ISO date the version takes effect. */
  effectiveFrom: string;
  name: string;
  jurisdiction: string;
  /** NIST and ISO apply to every organisation; region packs are opt-in. */
  baseline: boolean;
  /** Region a region pack covers (IN, EU, AU, US); null for baseline packs. */
  region: string | null;
  /** Report shape: "framework" (control_code checks) or "sutras" (RBI Sutra checks). */
  reportFormat: 'framework' | 'sutras';
  /** frameworkName printed on the report. */
  reportName: string;
  /** Key the legacy compliance-check response uses for this framework. */
  responseKey: string;
  /** Legacy framework id used by the portfolio rollup (rbi_free_ai, nist_ai_rmf, ...). */
  legacyId: string;
  /** Named tier classifier the engine applies (nist, eu, iso, au, us, none). */
  tierClassifier: 'nist' | 'eu' | 'iso' | 'au' | 'us' | 'none';
  /**
   * Phase 2 region packs are opt-in: they apply only to organisations that
   * enable them in governance settings, never by default, so adding a pack
   * cannot move any existing organisation's results.
   */
  optIn?: boolean;
  /** The pack is loaded only while this governance flag is on. */
  flag?: keyof FeatureFlags;
  source: string;
  changelog: string[];
  parameters: Record<string, any>;
  /** Parameters served only while a governance flag is on (left out of the hash and the strictest-wins vote while it is off). */
  parameterFlags?: Record<string, keyof FeatureFlags>;
  clauses: PackClause[];
}

export type PackStatus = 'UPCOMING' | 'ACTIVE' | 'RETIRED';

export interface LoadedPackVersion {
  definition: PackDefinition;
  contentHash: string;
  status: PackStatus;
}

export interface ParameterSource {
  source: string; // pack id, 'settings' or 'environment'
  version?: string;
  value: any;
}

export interface ResolvedParameters {
  values: Record<string, any>;
  /** For each parameter: every contributing source and which one set the applied value. */
  sources: Record<string, { applied: any; setBy: string[]; candidates: ParameterSource[] }>;
}
