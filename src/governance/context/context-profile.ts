/**
 * Model context profile (E1.5): structured fields that replace free text for
 * NIST MAP 1.1–3.2, ISO A.6.2.2 / A.8.2, SR 26-2 and the DTA usage pattern.
 */
export const OVERSIGHT_PATTERNS = ['HUMAN_IN_THE_LOOP', 'HUMAN_ON_THE_LOOP', 'HUMAN_OUT_OF_THE_LOOP'] as const;

/** DTA policy v2.1 Appendix D usage patterns (labels paraphrased). */
export const DTA_USAGE_PATTERNS = ['ANALYTICS_AND_INSIGHTS', 'DECISION_SUPPORT', 'AUTOMATED_DECISION', 'CONTENT_GENERATION', 'WORKPLACE_PRODUCTIVITY', 'IMAGE_AND_VIDEO', 'CONVERSATIONAL'] as const;

export interface ContextProfile {
  intendedUsers?: string[];
  deploymentSettings?: string[];
  benefits?: string;
  costOfErrors?: string;
  knownLimitations?: string[];
  outOfScopeUses?: string[];
  assumptions?: string[];
  businessValue?: string;
  oversightPattern?: (typeof OVERSIGHT_PATTERNS)[number];
  namedOperator?: string;
  dtaUsagePattern?: (typeof DTA_USAGE_PATTERNS)[number];
  dtaDomain?: string;
  systemRequirements?: string[];
}

const LIST_FIELDS = ['intendedUsers', 'deploymentSettings', 'knownLimitations', 'outOfScopeUses', 'assumptions', 'systemRequirements'] as const;
const TEXT_FIELDS = ['benefits', 'costOfErrors', 'businessValue', 'namedOperator', 'dtaDomain'] as const;

/** snake_case API body → validated profile. Throws a message on bad input. */
export function parseContextProfile(body: Record<string, any>): ContextProfile {
  const out: ContextProfile = {};
  const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  for (const f of LIST_FIELDS) {
    const v = body[snake(f)] ?? body[f];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${snake(f)} must be a list of text`);
    (out as any)[f] = v.map((x: string) => x.trim()).filter(Boolean).slice(0, 50).map((x: string) => x.slice(0, 500));
  }
  for (const f of TEXT_FIELDS) {
    const v = body[snake(f)] ?? body[f];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') throw new Error(`${snake(f)} must be text`);
    (out as any)[f] = v ? v.slice(0, 4000) : undefined;
  }
  const op = body.oversight_pattern ?? body.oversightPattern;
  if (op !== undefined && op !== null) {
    if (!(OVERSIGHT_PATTERNS as readonly string[]).includes(op)) throw new Error(`oversight_pattern must be one of ${OVERSIGHT_PATTERNS.join(', ')}`);
    out.oversightPattern = op;
  }
  const dp = body.dta_usage_pattern ?? body.dtaUsagePattern;
  if (dp !== undefined && dp !== null) {
    if (!(DTA_USAGE_PATTERNS as readonly string[]).includes(dp)) throw new Error(`dta_usage_pattern must be one of ${DTA_USAGE_PATTERNS.join(', ')}`);
    out.dtaUsagePattern = dp;
  }
  return out;
}

export function contextView(p: ContextProfile | null | undefined) {
  const c = p ?? {};
  return {
    intended_users: c.intendedUsers ?? [],
    deployment_settings: c.deploymentSettings ?? [],
    benefits: c.benefits ?? null,
    cost_of_errors: c.costOfErrors ?? null,
    known_limitations: c.knownLimitations ?? [],
    out_of_scope_uses: c.outOfScopeUses ?? [],
    assumptions: c.assumptions ?? [],
    business_value: c.businessValue ?? null,
    oversight_pattern: c.oversightPattern ?? null,
    named_operator: c.namedOperator ?? null,
    dta_usage_pattern: c.dtaUsagePattern ?? null,
    dta_domain: c.dtaDomain ?? null,
    system_requirements: c.systemRequirements ?? [],
  };
}

/** Required for a complete profile (ISO A.6.2.2 / A.8.2, NIST MAP 1.1 / 3.2). */
export const REQUIRED_FIELDS: Array<keyof ContextProfile> = ['intendedUsers', 'knownLimitations', 'outOfScopeUses', 'oversightPattern', 'costOfErrors'];

export function missingFields(p: ContextProfile | null | undefined, fields: Array<keyof ContextProfile> = REQUIRED_FIELDS): string[] {
  const c = p ?? {};
  return fields.filter((f) => {
    const v = (c as any)[f];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  }) as string[];
}

/**
 * A starting suggestion from the fields the model already has (never saved
 * automatically). AI drafting through the description pipeline can replace
 * this later; the suggestion is clearly marked as derived.
 */
export function suggestContext(model: {
  functionalArea: string; targetCustomerSegments: string[]; humanOversightRequired: boolean; autonomousScope: string | null;
  useCaseDescription: string; ownerTeam: string;
}): ContextProfile {
  return {
    intendedUsers: model.ownerTeam ? [`${model.ownerTeam} (operators)`] : [],
    deploymentSettings: model.functionalArea ? [model.functionalArea.replace(/_/g, ' ')] : [],
    outOfScopeUses: model.autonomousScope ? [`Anything beyond: ${model.autonomousScope}`] : [],
    oversightPattern: model.humanOversightRequired ? 'HUMAN_IN_THE_LOOP' : model.autonomousScope ? 'HUMAN_ON_THE_LOOP' : undefined,
    benefits: model.useCaseDescription ? model.useCaseDescription.slice(0, 500) : undefined,
    knownLimitations: [],
    assumptions: (model.targetCustomerSegments ?? []).length ? [`Used for segments: ${model.targetCustomerSegments.join(', ')}`] : [],
  };
}
