/**
 * Common control library types (governance plan E1.1, design §2.1).
 *
 * A control is defined once, with its check logic, the evidence types it
 * accepts and its parameters. Framework packs map their clauses to controls,
 * so one bias test or one drill record satisfies every pack that maps to the
 * same control. Codes and clause wording live only in the packs, never here.
 */
import { FeatureFlags } from '../../common/feature-flags';
import { AIModelEntry } from '../../domain/model-inventory';
import { ResolvedParameters } from '../packs/pack.types';

/** MODEL controls are judged per AI system; ORG controls per organisation (ISO clauses 4–10). */
export type ControlScope = 'MODEL' | 'ORG';

/** Operational evidence the platform gathers for a model (same fields as the legacy ValidationContext). */
export interface ControlContext {
  ledgerEventCount?: number;
  driftReportCount?: number;
  lastDriftAt?: Date | null;
  overdueIncidentCount?: number;
  bcpConfigured?: boolean;
  euHighRiskDomains?: string[];
  bcpDrillLastConducted?: Date | null;
  /** Org-level facts for ORG controls and register-backed MODEL controls (filled in later epics). */
  org?: Record<string, any>;
  /** Register-backed facts per model (risk register, impact assessments) from later epics. */
  governance?: Record<string, any>;
}

export interface ControlInput {
  entry: AIModelEntry;
  ctx: ControlContext;
  params: ResolvedParameters;
  flags: FeatureFlags;
  /** Per-clause options from the pack mapping (e.g. which ownership rule a clause uses). */
  opts: Record<string, any>;
  now: Date;
}

export interface ControlOutcome {
  passed: boolean;
  /** Selects the clause's evidence template; 'pass' / 'fail' unless the control says otherwise. */
  key: string;
  /** Values the pack's evidence and gap templates can interpolate as {name}. */
  facts: Record<string, any>;
  /** Default evidence text, used when the clause has no template for `key`. */
  evidence: string;
  /** Gap template keys, joined with a space (for controls with several failure reasons). */
  gapKeys?: string[];
  /** SentRAI cannot assess this yet: reported NOT ASSESSED, never a pass, never blocking. */
  notAssessed?: boolean;
  /** Evidence artifacts this outcome relied on (refs), so one artifact serves every pack. */
  evidenceRefs?: string[];
}

export interface ControlDefinition {
  id: string;
  title: string;
  scope: ControlScope;
  /** Evidence artifact types that satisfy this control. */
  evidenceTypes: string[];
  /** Parameter names this control reads from the resolver. */
  parameters: string[];
  evaluate(input: ControlInput): ControlOutcome;
}
