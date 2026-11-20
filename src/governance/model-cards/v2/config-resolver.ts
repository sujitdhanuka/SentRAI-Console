/**
 * Model card v2: model configurations (spec §4). A MODEL_CONFIGURATION card
 * shows the effective model per tenant (the global default, or the tenant's
 * own BYOK or override), sets a floor on the configuration's inherent risk
 * from the models it can select, raised by its blast radius, and decides
 * whether a change of default model may go ahead.
 *
 * Pure. The service gathers the linked model records and their card status.
 */
import { RISK_TIERS } from './catalogue/sections/s06-risk';

export type Tier = (typeof RISK_TIERS)[number];

export const tierRank = (t: Tier) => RISK_TIERS.indexOf(t);
export const maxTier = (ts: Tier[]): Tier | null => (ts.length ? ts.reduce((a, b) => (tierRank(b) > tierRank(a) ? b : a)) : null);
export const raiseTier = (t: Tier, steps = 1): Tier => RISK_TIERS[Math.min(RISK_TIERS.length - 1, tierRank(t) + steps)];

export interface LinkedModel {
  id: string;
  name: string;
  provider: string | null;
  /** The model card's inherent tier, or null if not assessed. */
  inherentTier: Tier | null;
  /** True when the model's card has a current approved (FINAL) version. */
  cardApproved: boolean;
}

export interface TenantOverride {
  tenant: string;
  byok: boolean;
  model_record_id?: string | null;
  provider?: string | null;
  inherits_default: boolean;
}

export interface ConfigInput {
  defaultModelId: string | null;
  overrides: TenantOverride[];
  /** Every model the configuration can select (selects_model links). */
  selectable: LinkedModel[];
  tenantReach: string | null;
}

export interface EffectiveModel {
  tenant: string;
  model_id: string | null;
  model_name: string | null;
  source: 'GLOBAL_DEFAULT' | 'TENANT_OVERRIDE' | 'BYOK';
  /** Who answers for the model and the key: the platform, or the tenant for BYOK. */
  key_responsibility: 'PLATFORM' | 'TENANT';
}

export interface ConfigResolution {
  effective: EffectiveModel[];
  /** Lowest inherent tier the configuration may have; null when a selectable model is not assessed. */
  inherent_floor: Tier | null;
  findings: Array<{ code: string; message: string }>;
  explanation: string[];
}

export function resolveConfiguration(c: ConfigInput): ConfigResolution {
  const byId = new Map(c.selectable.map((m) => [m.id, m]));
  const findings: ConfigResolution['findings'] = [];
  const explanation: string[] = [];
  const def = c.defaultModelId ? byId.get(c.defaultModelId) ?? null : null;
  if (!c.defaultModelId) findings.push({ code: 'CONFIG_NO_DEFAULT', message: 'The default model is not recorded.' });
  else if (!def) findings.push({ code: 'CONFIG_DEFAULT_NOT_LINKED', message: 'The default model is not among the models this configuration can select.' });

  const effective: EffectiveModel[] = [{ tenant: '(all tenants without an override)', model_id: def?.id ?? c.defaultModelId, model_name: def?.name ?? null, source: 'GLOBAL_DEFAULT', key_responsibility: 'PLATFORM' }];
  for (const o of c.overrides) {
    const m = o.inherits_default ? def : o.model_record_id ? byId.get(o.model_record_id) ?? null : null;
    if (!o.inherits_default && o.model_record_id && !m) {
      findings.push({ code: 'CONFIG_OVERRIDE_NOT_LINKED', message: `Tenant ${o.tenant} uses a model that is not linked to this configuration.` });
    }
    effective.push({
      tenant: o.tenant, model_id: m?.id ?? o.model_record_id ?? null, model_name: m?.name ?? null,
      source: o.inherits_default ? 'GLOBAL_DEFAULT' : o.byok ? 'BYOK' : 'TENANT_OVERRIDE', key_responsibility: o.byok ? 'TENANT' : 'PLATFORM',
    });
  }

  const unassessed = c.selectable.filter((m) => !m.inherentTier);
  let floor: Tier | null = null;
  if (!c.selectable.length) findings.push({ code: 'CONFIG_NO_MODELS', message: 'No selectable model is linked, so the risk floor cannot be set.' });
  else if (unassessed.length) {
    findings.push({ code: 'CONFIG_MODEL_NOT_ASSESSED', message: `The inherent risk of ${unassessed.map((m) => m.name).join(', ')} is not assessed, so the configuration's risk floor is unknown.` });
  } else {
    const highest = maxTier(c.selectable.map((m) => m.inherentTier!))!;
    explanation.push(`Highest inherent risk among selectable models: ${highest}.`);
    // An unrecorded reach counts as the worst plausible: every tenant.
    const reach = c.tenantReach ?? 'ALL_TENANTS';
    floor = reach === 'ALL_TENANTS' ? raiseTier(highest) : highest;
    explanation.push(reach === 'ALL_TENANTS'
      ? `Raised one tier to ${floor} because one change reaches every tenant${c.tenantReach ? '' : ' (tenant reach not recorded, so the worst case is assumed)'}.`
      : `Tenant reach ${reach} does not raise it further.`);
  }
  return { effective, inherent_floor: floor, findings, explanation };
}

export interface SwitchDecision {
  allowed: boolean;
  /** A change of default always sends the configuration back for reassessment. */
  reassessment_required: true;
  reason: string;
  risk_acceptance_used: boolean;
}

/** May the default switch to `target`? Not without an approved card, unless a named person accepts the risk. */
export function decideDefaultSwitch(target: LinkedModel | null, acceptance?: { by: string; reason: string } | null): SwitchDecision {
  if (!target) return { allowed: false, reassessment_required: true, reason: 'The target model is not linked to this configuration.', risk_acceptance_used: false };
  if (target.cardApproved) return { allowed: true, reassessment_required: true, reason: `${target.name} has an approved model card.`, risk_acceptance_used: false };
  if (acceptance?.by?.trim() && acceptance.reason?.trim().length >= 10) {
    return { allowed: true, reassessment_required: true, reason: `${target.name} has no approved model card; ${acceptance.by} accepted the risk: ${acceptance.reason.trim()}`, risk_acceptance_used: true };
  }
  return { allowed: false, reassessment_required: true, reason: `${target.name} has no approved model card. Approve its card first, or record an explicit risk acceptance.`, risk_acceptance_used: false };
}
