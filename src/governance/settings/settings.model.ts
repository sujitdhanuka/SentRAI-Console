/**
 * Governance settings and risk appetite (E1.2, design §4.1). Pure model:
 * defaults, validation, pack floors and effective-date resolution, so the
 * rules are unit-testable without a database.
 */
import { RiskLevel } from '../../common/enums';
import { BASELINE_PACK_IDS, packRegistry } from '../packs/pack-loader';
import { atLeastAsStrict, packFloors, parameterSpec } from '../packs/parameter-resolver';

export type ScoringMatrix = '5x5' | '3x3';
export type GateMode = 'OFF' | 'WARN' | 'BLOCK';
export type GateTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PeopleItemMode = 'LIGHT_RECORD' | 'CUSTOMER';

export interface Band {
  name: string;
  min: number;
  max: number;
}

export interface PeopleItemSetting {
  mode: PeopleItemMode;
  /** Named owner when the item is the customer's responsibility. */
  owner?: string | null;
  note?: string | null;
}

export interface RiskAppetite {
  /** Highest acceptable residual score per risk category (above it, acceptance needs the band approver). */
  ceilings: Record<string, number>;
  /** Who may accept residual risk in each band: roles, or ACCOUNTABLE_OFFICIAL (E1.9). */
  approvers: Record<string, string[]>;
  /** Parameters that join the strictest-wins vote (intervals, thresholds). */
  parameters: Record<string, number | boolean | string[]>;
  /** Required audit type per tier (INTERNAL or THIRD_PARTY). */
  requiredAuditType: Record<GateTier, 'INTERNAL' | 'THIRD_PARTY'>;
  boardApprovedAt?: string | null;
  reviewCycleMonths?: number | null;
}

export interface GovernanceSettingsDoc {
  scoringMatrix: ScoringMatrix;
  bands: Band[];
  /** Deploy gate for unaccepted residual risk / missing impact assessment, per model tier. */
  gateMode: Record<GateTier, GateMode>;
  primaryJurisdiction: string;
  /** Region packs switched on (the NIST + ISO baseline is always on). */
  enabledPacks: string[];
  peopleItems: Record<string, PeopleItemSetting>;
  appetite: RiskAppetite;
  /** E2.4: extra proxy terms for the fair-lending scan (optional; absent means the built-in dictionary only). */
  fairLending?: { proxyTerms: Array<{ term: string; basis: string }> };
  /** E3.5: grid emission factor (kg CO2e per kWh) for energy readings; absent means the jurisdiction default. */
  energy?: { gridFactorKgPerKwh: number };
  /** E3.8: whether data may go to external AI providers (absent means ALLOWED, as before). */
  externalAi?: { mode: 'ALLOWED' | 'ATTESTED_ONLY' | 'BLOCKED' };
  /** E4.2 model card v2 (optional; absent means the defaults in cardV2Settings). */
  modelCardV2?: Partial<CardV2Settings>;
}

/** Model card v2 settings: framework adoption, risk thresholds, evidence freshness, approver roles, review cycle. */
export interface CardV2Settings {
  /** Registry ids of standards and guidance the organisation adopted; null means "follow the enabled packs" (NIST and ISO baseline). */
  adoptedFrameworks: string[] | null;
  /** Lowest risk-engine score of each tier above LOW (the maximum score is 23). */
  riskThresholds: { MEDIUM: number; HIGH: number; CRITICAL: number };
  /** Days an evidence item of each type stays current; DEFAULT applies to any type not listed. */
  evidenceFreshnessDays: Record<string, number>;
  /** Roles that may give the risk approval step of the card workflow. */
  riskApproverRoles: string[];
  /** Months between card reviews. */
  reviewCycleMonths: number;
}

export const CARD_V2_DEFAULTS: CardV2Settings = {
  adoptedFrameworks: null,
  riskThresholds: { MEDIUM: 6, HIGH: 11, CRITICAL: 16 },
  evidenceFreshnessDays: { DEFAULT: 365, TEST_REPORT: 180, MONITORING_RECORD: 90 },
  riskApproverRoles: ['CISO', 'OWNER'],
  reviewCycleMonths: 12,
};

/** The organisation's model card v2 settings merged over the defaults. */
export function cardV2Settings(doc: Pick<GovernanceSettingsDoc, 'modelCardV2'> | null | undefined): CardV2Settings {
  const m = doc?.modelCardV2 ?? {};
  return {
    adoptedFrameworks: m.adoptedFrameworks === undefined ? CARD_V2_DEFAULTS.adoptedFrameworks : m.adoptedFrameworks,
    riskThresholds: { ...CARD_V2_DEFAULTS.riskThresholds, ...(m.riskThresholds ?? {}) },
    evidenceFreshnessDays: { ...CARD_V2_DEFAULTS.evidenceFreshnessDays, ...(m.evidenceFreshnessDays ?? {}) },
    riskApproverRoles: m.riskApproverRoles ?? CARD_V2_DEFAULTS.riskApproverRoles,
    reviewCycleMonths: m.reviewCycleMonths ?? CARD_V2_DEFAULTS.reviewCycleMonths,
  };
}

/** Optional top-level settings fields (not in the defaults, so existing documents and diffs are unchanged). */
export const OPTIONAL_SETTINGS_KEYS = ['fairLending', 'energy', 'externalAi', 'modelCardV2'] as const;

export const RISK_CATEGORIES = [
  'FAIRNESS', 'TRANSPARENCY', 'PRIVACY', 'SECURITY', 'PERFORMANCE', 'THIRD_PARTY',
  'RESILIENCE', 'CONDUCT', 'MODEL_RISK', 'LEGAL', 'ENVIRONMENT',
] as const;

export const JURISDICTIONS = ['INTL', 'IN', 'EU', 'AU', 'US'] as const;

/** People-side items (design §4.1): ISO 7.2 / 7.3 need retained evidence, so they default to light records. */
export const PEOPLE_ITEMS: Record<string, { label: string; isoClause?: string }> = {
  competence: { label: 'Competence of people doing AI work', isoClause: '7.2' },
  awareness: { label: 'Awareness of the AI policy and their contribution', isoClause: '7.3' },
  training: { label: 'Role-based AI training programme' },
  team_diversity: { label: 'Diversity of teams building and reviewing AI' },
  stakeholder_panels: { label: 'Stakeholder and affected-community panels' },
  expert_input: { label: 'Independent domain-expert input' },
};

export const BANDS_5X5: Band[] = [
  { name: 'LOW', min: 1, max: 4 },
  { name: 'MEDIUM', min: 5, max: 9 },
  { name: 'HIGH', min: 10, max: 16 },
  { name: 'CRITICAL', min: 17, max: 25 },
];

export const BANDS_3X3: Band[] = [
  { name: 'LOW', min: 1, max: 2 },
  { name: 'MEDIUM', min: 3, max: 4 },
  { name: 'HIGH', min: 5, max: 9 },
];

export function matrixSize(m: ScoringMatrix): number {
  return m === '3x3' ? 3 : 5;
}

export function defaultSettings(): GovernanceSettingsDoc {
  return {
    scoringMatrix: '5x5',
    bands: BANDS_5X5.map((b) => ({ ...b })),
    gateMode: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'WARN', CRITICAL: 'BLOCK' },
    primaryJurisdiction: 'INTL',
    enabledPacks: [],
    peopleItems: {
      competence: { mode: 'LIGHT_RECORD' },
      awareness: { mode: 'LIGHT_RECORD' },
      training: { mode: 'CUSTOMER', owner: null, note: null },
      team_diversity: { mode: 'CUSTOMER', owner: null, note: null },
      stakeholder_panels: { mode: 'CUSTOMER', owner: null, note: null },
      expert_input: { mode: 'CUSTOMER', owner: null, note: null },
    },
    appetite: {
      ceilings: Object.fromEntries(RISK_CATEGORIES.map((c) => [c, 9])),
      approvers: {
        LOW: ['OWNER', 'CISO'],
        MEDIUM: ['OWNER', 'CISO'],
        HIGH: ['CISO', 'ACCOUNTABLE_OFFICIAL'],
        CRITICAL: ['ACCOUNTABLE_OFFICIAL'],
      },
      parameters: {},
      requiredAuditType: { LOW: 'INTERNAL', MEDIUM: 'INTERNAL', HIGH: 'INTERNAL', CRITICAL: 'INTERNAL' },
      boardApprovedAt: null,
      reviewCycleMonths: 12,
    },
  };
}

/** Score → band under the given bands. */
export function bandFor(score: number, bands: Band[]): string {
  return bands.find((b) => score >= b.min && score <= b.max)?.name ?? bands[bands.length - 1].name;
}

/** Floors from enabled region packs plus the baseline (design §4.1 "Pack floors"). */
export function floorsFor(enabledPacks: string[], at: Date = new Date()) {
  const ids = new Set([...BASELINE_PACK_IDS, ...enabledPacks]);
  const packs = packRegistry().activeAt(at).filter((p) => ids.has(p.definition.id)).map((p) => p.definition);
  return packFloors(packs);
}

export interface SettingsProblem {
  field: string;
  message: string;
  /** Pack that sets the floor, when the problem is a floor breach. */
  pack?: string;
}

/** Validate a full settings document. Returns every problem, each naming the field (and the pack for floors). */
/** `at`: the date the settings take effect; pack floors and available packs are those in force then. */
export function validateSettings(doc: GovernanceSettingsDoc, at: Date = new Date()): SettingsProblem[] {
  const p: SettingsProblem[] = [];
  if (!['5x5', '3x3'].includes(doc.scoringMatrix)) p.push({ field: 'scoringMatrix', message: 'must be 5x5 or 3x3' });
  const max = matrixSize(doc.scoringMatrix) ** 2;
  const bands = doc.bands ?? [];
  if (!bands.length) p.push({ field: 'bands', message: 'at least one band is required' });
  let expected = 1;
  for (const [i, b] of bands.entries()) {
    if (!b.name || typeof b.min !== 'number' || typeof b.max !== 'number' || b.min > b.max) {
      p.push({ field: `bands[${i}]`, message: 'each band needs a name and min ≤ max' });
      continue;
    }
    // Bands must tile 1..max with no gaps. On 3x3 the products 5, 7, 8 cannot occur, so a gap that covers only
    // impossible scores is fine.
    const possible = new Set<number>();
    const n = matrixSize(doc.scoringMatrix);
    for (let l = 1; l <= n; l++) for (let im = 1; im <= n; im++) possible.add(l * im);
    for (let s = expected; s < b.min; s++) if (possible.has(s)) p.push({ field: `bands[${i}]`, message: `score ${s} is not in any band` });
    if (b.min < expected) p.push({ field: `bands[${i}]`, message: 'bands overlap or are out of order' });
    expected = b.max + 1;
  }
  if (bands.length && bands[bands.length - 1].max !== max) p.push({ field: 'bands', message: `the top band must end at ${max} for a ${doc.scoringMatrix} matrix` });

  for (const tier of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as GateTier[]) {
    if (!['OFF', 'WARN', 'BLOCK'].includes(doc.gateMode?.[tier])) p.push({ field: `gateMode.${tier}`, message: 'must be OFF, WARN or BLOCK' });
  }
  if (!(JURISDICTIONS as readonly string[]).includes(doc.primaryJurisdiction)) {
    p.push({ field: 'primaryJurisdiction', message: `must be one of ${JURISDICTIONS.join(', ')}` });
  }
  const regionPacks = new Set(packRegistry().activeAt(at).filter((x) => !x.definition.baseline).map((x) => x.definition.id));
  for (const id of doc.enabledPacks ?? []) {
    if (!regionPacks.has(id)) p.push({ field: 'enabledPacks', message: `${id} is not an available region pack` });
  }
  for (const [k, v] of Object.entries(doc.peopleItems ?? {})) {
    if (!PEOPLE_ITEMS[k]) p.push({ field: `peopleItems.${k}`, message: 'unknown people-side item' });
    else if (!['LIGHT_RECORD', 'CUSTOMER'].includes(v?.mode)) p.push({ field: `peopleItems.${k}`, message: 'mode must be LIGHT_RECORD or CUSTOMER' });
  }
  for (const [cat, ceiling] of Object.entries(doc.appetite?.ceilings ?? {})) {
    if (!(RISK_CATEGORIES as readonly string[]).includes(cat)) p.push({ field: `appetite.ceilings.${cat}`, message: 'unknown risk category' });
    else if (typeof ceiling !== 'number' || ceiling < 1 || ceiling > max) p.push({ field: `appetite.ceilings.${cat}`, message: `must be between 1 and ${max}` });
  }
  const bandNames = new Set(bands.map((b) => b.name));
  for (const name of bandNames) {
    const who = doc.appetite?.approvers?.[name];
    if (!Array.isArray(who) || !who.length) p.push({ field: `appetite.approvers.${name}`, message: 'name at least one approver for every band' });
  }
  for (const [name, value] of Object.entries(doc.appetite?.parameters ?? {})) {
    const spec = parameterSpec(name);
    if (!spec) p.push({ field: `appetite.parameters.${name}`, message: 'unknown parameter' });
    else if ((spec.rule === 'min' || spec.rule === 'max') && (typeof value !== 'number' || !(value > 0))) {
      p.push({ field: `appetite.parameters.${name}`, message: 'must be a positive number' });
    }
  }

  if (doc.fairLending !== undefined) {
    const terms = doc.fairLending?.proxyTerms;
    if (!Array.isArray(terms) || terms.length > 200) p.push({ field: 'fairLending.proxyTerms', message: 'must be a list of at most 200 { term, basis }' });
    else terms.forEach((t, i) => {
      if (!t || typeof t.term !== 'string' || !/^[a-z0-9_ -]{2,40}$/i.test(t.term)) p.push({ field: `fairLending.proxyTerms[${i}]`, message: 'term must be 2-40 letters, digits, space, dash or underscore' });
      if (!t || typeof t.basis !== 'string' || !t.basis.trim() || t.basis.length > 60) p.push({ field: `fairLending.proxyTerms[${i}]`, message: 'basis must name the prohibited basis it may stand in for' });
    });
  }

  if (doc.energy !== undefined) {
    const f = doc.energy?.gridFactorKgPerKwh;
    if (typeof f !== 'number' || !(f >= 0) || f > 2) p.push({ field: 'energy.gridFactorKgPerKwh', message: 'must be a number of kg CO2e per kWh from 0 to 2' });
  }
  if (doc.modelCardV2 !== undefined) {
    const c = cardV2Settings(doc);
    const t = c.riskThresholds;
    for (const k of ['MEDIUM', 'HIGH', 'CRITICAL'] as const) {
      if (!Number.isInteger(t[k]) || t[k] < 1 || t[k] > 23) p.push({ field: `modelCardV2.riskThresholds.${k}`, message: 'must be a whole number from 1 to 23' });
    }
    if (!(t.MEDIUM < t.HIGH && t.HIGH < t.CRITICAL)) p.push({ field: 'modelCardV2.riskThresholds', message: 'must increase: MEDIUM < HIGH < CRITICAL' });
    if (c.adoptedFrameworks !== null && (!Array.isArray(c.adoptedFrameworks) || c.adoptedFrameworks.some((x) => typeof x !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,60}$/.test(x)))) {
      p.push({ field: 'modelCardV2.adoptedFrameworks', message: 'must be a list of framework registry ids, or null to follow the enabled packs' });
    }
    for (const [k, d] of Object.entries(c.evidenceFreshnessDays)) {
      if (!Number.isInteger(d) || d < 1 || d > 3650) p.push({ field: `modelCardV2.evidenceFreshnessDays.${k}`, message: 'must be a whole number of days from 1 to 3650' });
    }
    if (!Array.isArray(c.riskApproverRoles) || !c.riskApproverRoles.length || c.riskApproverRoles.some((r) => !['OWNER', 'CISO', 'APPROVER', 'ADMIN'].includes(r))) {
      p.push({ field: 'modelCardV2.riskApproverRoles', message: 'name at least one of OWNER, CISO, APPROVER, ADMIN' });
    }
    if (!Number.isInteger(c.reviewCycleMonths) || c.reviewCycleMonths < 1 || c.reviewCycleMonths > 36) {
      p.push({ field: 'modelCardV2.reviewCycleMonths', message: 'must be a whole number of months from 1 to 36' });
    }
  }
  if (doc.externalAi !== undefined && !['ALLOWED', 'ATTESTED_ONLY', 'BLOCKED'].includes(doc.externalAi?.mode as string)) {
    p.push({ field: 'externalAi.mode', message: 'must be ALLOWED, ATTESTED_ONLY or BLOCKED' });
  }

  // Pack floors: a setting may be stricter than an enabled pack requires, never looser.
  const floors = floorsFor(doc.enabledPacks ?? [], at);
  for (const [name, floor] of Object.entries(floors)) {
    const spec = parameterSpec(name);
    const value = doc.appetite?.parameters?.[name];
    if (value === undefined || !spec) continue;
    if (!atLeastAsStrict(spec.rule, value, floor.value)) {
      p.push({
        field: `appetite.parameters.${name}`,
        message: `cannot be looser than ${JSON.stringify(floor.value)} (the minimum set by ${floor.packs.join(' and ')})`,
        pack: floor.packs[0],
      });
    }
  }
  // The RBI floor "third-party audit for HIGH" also binds the required audit type for HIGH and CRITICAL.
  if (floors['thirdPartyAuditRequired.HIGH']?.value === true) {
    for (const tier of ['HIGH', 'CRITICAL'] as GateTier[]) {
      if (doc.appetite?.requiredAuditType?.[tier] !== 'THIRD_PARTY') {
        p.push({
          field: `appetite.requiredAuditType.${tier}`,
          message: `must be THIRD_PARTY while ${floors['thirdPartyAuditRequired.HIGH'].packs.join(', ')} is enabled`,
          pack: floors['thirdPartyAuditRequired.HIGH'].packs[0],
        });
      }
    }
  }
  return p;
}

/** Apply the pack floors a newly enabled pack brings (used when a pack is switched on without other edits). */
export function applyFloors(doc: GovernanceSettingsDoc): GovernanceSettingsDoc {
  const out: GovernanceSettingsDoc = JSON.parse(JSON.stringify(doc));
  const floors = floorsFor(out.enabledPacks);
  if (floors['thirdPartyAuditRequired.HIGH']?.value === true) {
    out.appetite.requiredAuditType.HIGH = 'THIRD_PARTY';
    out.appetite.requiredAuditType.CRITICAL = 'THIRD_PARTY';
  }
  return out;
}

/** Field-level changes between two documents (for the audit record). */
export function diffSettings(a: any, b: any, prefix = ''): Array<{ field: string; from: any; to: any }> {
  const out: Array<{ field: string; from: any; to: any }> = [];
  const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diffSettings(a[k], b[k], prefix ? `${prefix}.${k}` : k));
    return out;
  }
  if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ field: prefix, from: a ?? null, to: b ?? null });
  return out;
}

/** The tier key a model risk level maps to for gate modes and audit types. */
export function gateTierOf(risk: RiskLevel | string): GateTier {
  if (risk === RiskLevel.CRITICAL || risk === RiskLevel.PROHIBITED) return 'CRITICAL';
  if (risk === RiskLevel.HIGH) return 'HIGH';
  if (risk === RiskLevel.MEDIUM || risk === RiskLevel.LIMITED) return 'MEDIUM';
  return 'LOW';
}

/** Apply field-level changes (as produced by diffSettings) to a document; a null `to` removes the field. */
export function applyChanges(doc: GovernanceSettingsDoc, changes: Array<{ field: string; to: any }>): GovernanceSettingsDoc {
  const out: any = JSON.parse(JSON.stringify(doc));
  for (const c of changes) {
    const path = c.field.split('.');
    let o = out;
    for (const k of path.slice(0, -1)) {
      if (!o[k] || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    }
    const last = path[path.length - 1];
    if (c.to === null || c.to === undefined) delete o[last];
    else o[last] = JSON.parse(JSON.stringify(c.to));
  }
  return out;
}

/** Merge a partial update over a full document (objects merge, arrays and scalars replace). */
export function mergeSettings(base: GovernanceSettingsDoc, patch: Partial<GovernanceSettingsDoc>): GovernanceSettingsDoc {
  const merge = (a: any, b: any): any => {
    if (b === undefined) return a;
    if (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b)) {
      const o: any = { ...a };
      for (const k of Object.keys(b)) o[k] = merge(a[k], b[k]);
      return o;
    }
    return b;
  };
  return merge(JSON.parse(JSON.stringify(base)), patch);
}
