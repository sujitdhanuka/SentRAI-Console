/**
 * Model card v2: the finalisation gate (spec §9). A card cannot become FINAL
 * while any of these holds:
 *  - a mandatory field, or a conditional field whose rule fired, is not
 *    populated and accepted by a person (UNKNOWN does not count);
 *  - such a field holds an AI suggestion or imported value nobody accepted;
 *  - a consistency check fails;
 *  - a field is NOT_APPLICABLE without a justification and a named decider;
 *  - the risk assessment is missing or breaks a hard rule;
 *  - the accountable owner is not an active named person in the organisation.
 * Recommended fields never block.
 */
import { fieldDef } from './catalogue';
import { FieldApplicability } from './applicability/engine';
import { ConsistencyFinding } from './consistency';
import { awaitingAcceptance, FieldValue } from './field-state';
import { RiskResult } from './risk/engine';
import { satisfied } from './scores';

export interface GateItem {
  code: string;
  message: string;
  field_id?: string;
}

export interface GateResult {
  can_finalise: boolean;
  blockers: GateItem[];
  /** Shown, never blocking (recommended fields, advice from the risk engine). */
  warnings: GateItem[];
}

export interface GateInput {
  fields: FieldApplicability[];
  values: Record<string, FieldValue | undefined>;
  consistency: ConsistencyFinding[];
  risk: RiskResult;
  /** Result of checkOwner for the accountable owner; null when no owner is recorded. */
  owner: { ok: boolean; code?: string; message?: string } | null;
}

const label = (id: string) => fieldDef(id)?.label ?? id;

export function finalisationGate(g: GateInput): GateResult {
  const blockers: GateItem[] = [];
  const warnings: GateItem[] = [];

  for (const f of g.fields.filter((x) => x.applicable)) {
    const v = g.values[f.field_id];
    if (f.effective === 'MANDATORY' && !satisfied(v)) {
      const why = f.default_requirement === 'CONDITIONAL' && f.rule ? ` (required because ${f.rule.id} fired)` : '';
      if (awaitingAcceptance(v)) {
        blockers.push({ code: 'UNACCEPTED_SUGGESTION', field_id: f.field_id, message: `${label(f.field_id)}: a suggested or imported value is waiting for a person to accept or edit it${why}.` });
      } else if (v?.status === 'UNKNOWN') {
        blockers.push({ code: 'MANDATORY_UNKNOWN', field_id: f.field_id, message: `${label(f.field_id)} is UNKNOWN; find out and record it${why}.` });
      } else {
        blockers.push({ code: 'MANDATORY_MISSING', field_id: f.field_id, message: `${label(f.field_id)} is required${why}.` });
      }
    } else if (f.effective === 'RECOMMENDED' && !satisfied(v)) {
      warnings.push({ code: 'RECOMMENDED_MISSING', field_id: f.field_id, message: `${label(f.field_id)} is recommended.` });
    }
  }
  for (const [id, v] of Object.entries(g.values)) {
    if (v?.status === 'NOT_APPLICABLE' && !(v.na_justification && v.na_justification.trim().length >= 10 && v.na_decided_by)) {
      blockers.push({ code: 'UNJUSTIFIED_NOT_APPLICABLE', field_id: id, message: `${label(id)} is marked not applicable without a written justification and the name of who decided.` });
    }
  }
  for (const c of g.consistency) blockers.push({ code: c.code, message: c.message });

  if (g.risk.status === 'NOT_ASSESSED') blockers.push({ code: 'RISK_NOT_ASSESSED', message: 'A person must set the inherent and residual risk tiers.' });
  for (const f of g.risk.findings) {
    if (f.blocking && !['INHERENT_TIER_NOT_SET', 'RESIDUAL_TIER_NOT_SET'].includes(f.code)) blockers.push({ code: f.code, message: f.message });
    else if (!f.blocking) warnings.push({ code: f.code, message: f.message });
  }
  if (!g.owner) blockers.push({ code: 'OWNER_MISSING', message: 'Name an accountable owner: an active person in the organisation.' });
  else if (!g.owner.ok) blockers.push({ code: g.owner.code ?? 'OWNER_INVALID', message: g.owner.message ?? 'The accountable owner must be an active named person in the organisation.' });

  return { can_finalise: blockers.length === 0, blockers, warnings };
}
