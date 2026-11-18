/**
 * Pure rules for the US adverse-action kit (E2.2): which models make credit
 * decisions, the top factors of a decision, reason codes from a model's map,
 * and whether the reasons a notice states match the factors the model
 * actually weighed (Reg B: specific principal reasons that accurately
 * describe the factors considered).
 */
export const APPEAL_TYPES = ['APPEAL', 'RECONSIDERATION', 'DATA_CORRECTION'] as const;
export type AppealType = (typeof APPEAL_TYPES)[number];
export const APPEAL_OUTCOMES = ['UPHELD', 'OVERTURNED', 'PARTIALLY_OVERTURNED', 'CORRECTED', 'NO_CHANGE'] as const;
export const NOTICE_CHANNELS = ['MAIL', 'EMAIL', 'PORTAL', 'IN_PERSON', 'OTHER'] as const;
/** Reg B allows up to four principal reasons on a notice; more are discouraged. */
export const MAX_PRINCIPAL_REASONS = 4;
/** Reg B record retention (25 months) is the floor even without the US pack. */
export const REG_B_RETENTION_MONTHS = 25;

export interface ReasonCode {
  code: string;
  text: string;
}
export type ReasonCodeMap = Record<string, ReasonCode>;

/** Credit decisioning use cases, where adverse-action notices apply. */
export function isCreditDecisioning(functionalArea: string | null | undefined): boolean {
  const fa = (functionalArea ?? '').toLowerCase();
  return /credit|loan|lending|mortgage|underwrit/.test(fa);
}

/** Validate a reason-code map from the API. Returns problems (empty when valid). */
export function validateReasonCodeMap(map: unknown): string[] {
  const problems: string[] = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['map must be an object of feature → { code, text }'];
  const entries = Object.entries(map as Record<string, any>);
  if (entries.length > MAX_MAPPED_FEATURES) problems.push(`at most ${MAX_MAPPED_FEATURES} features`);
  for (const [feature, rc] of entries) {
    if (!feature.trim() || feature.length > 120) problems.push(`feature name "${feature.slice(0, 40)}" is empty or too long`);
    if (!rc || typeof rc !== 'object') { problems.push(`${feature}: needs { code, text }`); continue; }
    if (typeof rc.code !== 'string' || !/^[A-Za-z0-9._-]{1,20}$/.test(rc.code)) problems.push(`${feature}: code must be 1-20 letters, digits, dot, dash or underscore`);
    if (typeof rc.text !== 'string' || rc.text.trim().length < 5 || rc.text.length > 200) problems.push(`${feature}: text must be 5-200 characters`);
  }
  return problems;
}

export const ADVERSE_SIGNS = ['POSITIVE', 'NEGATIVE'] as const;
export type AdverseSign = (typeof ADVERSE_SIGNS)[number];

/** Largest reason-code map SentRAI accepts (keeps the stored JSON well under the column size). */
export const MAX_MAPPED_FEATURES = 300;

/**
 * The decision's principal reasons: the factors that pushed towards the adverse
 * outcome, largest first. `sign` says which contribution sign is adverse for the
 * model (POSITIVE for a default-risk score, NEGATIVE for an approval score);
 * favourable factors are never principal reasons. Without a sign every factor
 * ranks by size (used only for display).
 */
export function topFactors(
  features: Record<string, number> | null | undefined,
  n = MAX_PRINCIPAL_REASONS,
  sign?: AdverseSign | null,
): Array<{ feature: string; weight: number }> {
  return Object.entries(features ?? {})
    .filter(([, w]) => typeof w === 'number' && Number.isFinite(w) && w !== 0)
    .filter(([, w]) => !sign || (sign === 'POSITIVE' ? w > 0 : w < 0))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([feature, weight]) => ({ feature, weight }));
}

export interface NoticeCheck {
  reasonCodes: ReasonCode[];
  consistent: boolean;
  mismatches: Array<{ kind: 'NOT_A_TOP_FACTOR' | 'TOP_FACTOR_NOT_STATED' | 'NO_CODE_MAPPED' | 'UNKNOWN_CODE' | 'TOO_MANY_REASONS'; code?: string; feature?: string }>;
}

/**
 * Build or check a notice's reasons. With no stated codes the notice uses the
 * mapped codes of the top factors. With stated codes, every stated code must
 * belong to a top factor and every mapped top factor must be stated.
 */
export function checkNotice(map: ReasonCodeMap, factors: Array<{ feature: string }>, stated?: string[] | null): NoticeCheck {
  const mismatches: NoticeCheck['mismatches'] = [];
  const byCode = new Map<string, ReasonCode>();
  for (const rc of Object.values(map)) byCode.set(rc.code, rc);
  const topCodes = new Map<string, string>();
  for (const f of factors) {
    const rc = map[f.feature];
    if (!rc) mismatches.push({ kind: 'NO_CODE_MAPPED', feature: f.feature });
    else if (!topCodes.has(rc.code)) topCodes.set(rc.code, f.feature);
  }
  let codes: string[];
  if (!stated || !stated.length) {
    codes = [...topCodes.keys()];
  } else {
    codes = [...new Set(stated.map(String))];
    if (codes.length > MAX_PRINCIPAL_REASONS) mismatches.push({ kind: 'TOO_MANY_REASONS' });
    for (const c of codes) {
      if (!byCode.has(c)) mismatches.push({ kind: 'UNKNOWN_CODE', code: c });
      else if (!topCodes.has(c)) mismatches.push({ kind: 'NOT_A_TOP_FACTOR', code: c });
    }
    for (const [c, feature] of topCodes) if (!codes.includes(c)) mismatches.push({ kind: 'TOP_FACTOR_NOT_STATED', code: c, feature });
  }
  const reasonCodes = codes.filter((c) => byCode.has(c)).map((c) => byCode.get(c)!);
  return { reasonCodes, consistent: mismatches.length === 0 && reasonCodes.length > 0, mismatches };
}

/** Outcomes that are not adverse: no adverse-action notice is issued for them. */
export function isFavourableOutcome(outcome: string | null | undefined): boolean {
  const o = String(outcome ?? '').toLowerCase();
  if (/declin|deni|deny|reject|adverse|counter|refus|withdraw|fail/.test(o)) return false;
  return /approv|accept|grant|pass|allow/.test(o);
}
