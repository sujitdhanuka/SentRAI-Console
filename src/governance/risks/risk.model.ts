/**
 * Risk register rules (E1.3, design §3): scoring on the organisation's matrix,
 * bands, review intervals, the starter catalogue and who may accept a band.
 */
import { BANDS_3X3, BANDS_5X5, bandFor, Band, GovernanceSettingsDoc, matrixSize } from '../settings/settings.model';

export const RISK_SCOPES = ['MODEL', 'USE_CASE', 'VENDOR', 'ORG'] as const;
export const RISK_SOURCES = ['MANUAL', 'CATALOGUE', 'SCAN_FINDING', 'INCIDENT', 'DRIFT_ALERT', 'RED_TEAM', 'VENDOR_CHANGE'] as const;
export const TREATMENTS = ['MITIGATE', 'TRANSFER', 'AVOID', 'ACCEPT'] as const;
/** Statuses that still need attention (count against the gate). */
export const OPEN_STATUSES = ['DRAFT', 'ASSESSED', 'REVIEW_DUE'];

export interface CatalogueEntry {
  id: string;
  category: string;
  title: string;
  description: string;
  typicalControls: string[];
  frameworks: string[];
  /** Applies only to these model types / functional areas; empty = every model. */
  appliesTo?: { functionalAreas?: string[]; modelTypes?: string[]; generativeOnly?: boolean };
  /** Suggested only when one of these packs is enabled; empty = always. */
  packs?: string[];
}

/** Starter risk catalogue (design §3.3). Each new model gets these, filtered by its use and enabled packs. */
export const STARTER_CATALOGUE: CatalogueEntry[] = [
  {
    id: 'CAT-FAIR-01', category: 'FAIRNESS', title: 'Unfair outcomes for a protected group',
    description: 'The model produces systematically worse outcomes (for example credit decisions) for a protected group.',
    typicalControls: ['CTL-FAIR-01', 'CTL-DATA-01'], frameworks: ['NIST MEASURE 2.11', 'FREE-AI Sutra 4', 'ECOA / Reg B'],
    appliesTo: { functionalAreas: ['credit_underwriting', 'loan_decisioning', 'credit_scoring', 'insurance_pricing', 'insurance_decisioning', 'employment', 'recruitment', 'fraud_detection', 'kyc'] },
  },
  {
    id: 'CAT-TRAN-01', category: 'TRANSPARENCY', title: 'Customer cannot understand or contest a decision',
    description: 'People affected by the system cannot get an understandable reason or a route to human reconsideration.',
    typicalControls: ['CTL-EXPL-01', 'CTL-INFO-01'], frameworks: ['FREE-AI Sutra 6, Rec 18', 'Colorado SB 26-189', 'DTA transparency'],
  },
  {
    id: 'CAT-PRIV-01', category: 'PRIVACY', title: 'Data used beyond its lawful basis or retained too long',
    description: 'Training or inference data is used beyond the purpose it was collected for, or kept after it should be deleted.',
    typicalControls: ['CTL-PRIV-01', 'CTL-PROV-01'], frameworks: ['FREE-AI Rec 15', 'NIST MEASURE 2.10', 'DPDP', 'GDPR'],
  },
  {
    id: 'CAT-SEC-01', category: 'SECURITY', title: 'Prompt injection, data poisoning or model extraction',
    description: 'An attacker manipulates inputs, training data or the model itself to cause harm or steal it.',
    typicalControls: ['CTL-SEC-01'], frameworks: ['FREE-AI Rec 19, Rec 20', 'NIST MEASURE 2.7'],
  },
  {
    id: 'CAT-PERF-01', category: 'PERFORMANCE', title: 'Accuracy degrades after deployment (drift)',
    description: 'Live data moves away from training data and accuracy falls without anyone noticing.',
    typicalControls: ['CTL-MON-01', 'CTL-PERF-01'], frameworks: ['NIST MEASURE 2.4', 'SR 11-7 ongoing monitoring'],
  },
  {
    id: 'CAT-3P-01', category: 'THIRD_PARTY', title: 'Vendor changes or withdraws an upstream model',
    description: 'A third-party model or API changes behaviour, version or terms, or is withdrawn.',
    typicalControls: ['CTL-PROV-01', 'CTL-PROV-02'], frameworks: ['NIST GOVERN 6, MANAGE 3', 'OMB M-25-22', 'SR 26-2'],
    appliesTo: { generativeOnly: true },
  },
  {
    id: 'CAT-RES-01', category: 'RESILIENCE', title: 'AI service outage stops a critical process',
    description: 'The AI system becomes unavailable and the business process it supports stops.',
    typicalControls: ['CTL-BCP-01', 'CTL-RES-01'], frameworks: ['FREE-AI Rec 21', 'NIST GOVERN 6.2'],
  },
  {
    id: 'CAT-COND-01', category: 'CONDUCT', title: 'Mis-selling or misleading AI claims to customers',
    description: 'Customers are misled about what the AI does, or are sold unsuitable products by it.',
    typicalControls: ['CTL-INFO-01'], frameworks: ['FREE-AI Rec 18', 'FTC Act s.5'],
  },
  {
    id: 'CAT-MRM-01', category: 'MODEL_RISK', title: 'Model used before or outside independent validation',
    description: 'The model is used for decisions before it was independently validated, or outside its validated scope.',
    typicalControls: ['CTL-AUD-01'], frameworks: ['SR 26-2', 'NIST MEASURE 2.5'],
    appliesTo: { functionalAreas: ['credit_underwriting', 'loan_decisioning', 'credit_scoring', 'fund_movement', 'autonomous_trading', 'insurance_pricing'] },
  },
  {
    id: 'CAT-LEGAL-01', category: 'LEGAL', title: 'A new rule makes current use non-compliant',
    description: 'A new or changed regulation applies to the use case before the organisation adapts.',
    typicalControls: ['CTL-POL-01'], frameworks: ['NIST GOVERN 1.1', 'DTA IA-7'],
  },
  {
    id: 'CAT-ENV-01', category: 'ENVIRONMENT', title: 'High energy use not measured or disclosed',
    description: 'Training or inference energy use is significant but not estimated or reported.',
    typicalControls: [], frameworks: ['FREE-AI Sutra 7', 'NIST MEASURE 2.12'],
    appliesTo: { generativeOnly: true },
  },
];

/** Catalogue entries that fit a model's use (functional area, type) and the enabled packs. */
export function catalogueFor(model: { functionalArea: string; modelType: string }, enabledPacks: string[]): CatalogueEntry[] {
  const fa = (model.functionalArea || '').toLowerCase();
  const genai = ['GENERATIVE_AI', 'AGENT', 'NLP', 'HYBRID'].includes(model.modelType);
  return STARTER_CATALOGUE.filter((c) => {
    if (c.packs?.length && !c.packs.some((p) => enabledPacks.includes(p))) return false;
    const a = c.appliesTo;
    if (!a) return true;
    if (a.functionalAreas && !a.functionalAreas.includes(fa)) return false;
    if (a.modelTypes && !a.modelTypes.includes(model.modelType)) return false;
    if (a.generativeOnly && !genai) return false;
    return true;
  });
}

export interface Rating {
  l: number;
  i: number;
}

export function validateRating(r: Rating, matrix: GovernanceSettingsDoc['scoringMatrix']): string | null {
  const n = matrixSize(matrix);
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v) || v < 1 || v > n) return `${k === 'l' ? 'likelihood' : 'impact'} must be a whole number from 1 to ${n} on a ${matrix} matrix`;
  }
  return null;
}

export function score(r: Rating): number {
  return r.l * r.i;
}

export function bandsOf(settings: GovernanceSettingsDoc): Band[] {
  return settings.bands?.length ? settings.bands : settings.scoringMatrix === '3x3' ? BANDS_3X3 : BANDS_5X5;
}

export function band(r: Rating, settings: GovernanceSettingsDoc): string {
  return bandFor(score(r), bandsOf(settings));
}

/** Next review date by residual band: CRITICAL 90 days, HIGH 180, otherwise a year. */
export function reviewIntervalDays(residualBand: string): number {
  return residualBand === 'CRITICAL' ? 90 : residualBand === 'HIGH' ? 180 : 365;
}

/** Residual within the category ceiling set by the risk appetite. */
export function withinAppetite(category: string, residual: Rating, settings: GovernanceSettingsDoc): boolean {
  const ceiling = settings.appetite?.ceilings?.[category];
  return typeof ceiling === 'number' ? score(residual) <= ceiling : false;
}

/**
 * Can this user accept a residual band? The appetite names roles and/or
 * ACCOUNTABLE_OFFICIAL per band; returns the qualifying role or null.
 */
export function acceptanceRole(
  bandName: string,
  settings: GovernanceSettingsDoc,
  user: { role: string },
  isAccountableOfficial: boolean,
): string | null {
  const allowed = settings.appetite?.approvers?.[bandName] ?? [];
  if (allowed.includes('ACCOUNTABLE_OFFICIAL') && isAccountableOfficial) return 'ACCOUNTABLE_OFFICIAL';
  if (allowed.includes(user.role)) return user.role;
  return null;
}
