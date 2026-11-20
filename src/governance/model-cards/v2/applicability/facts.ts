/**
 * Model card v2: the facts the applicability rules read, taken from the
 * card's field values plus facts from linked records (for example "this
 * configuration selects a generative model"). A value counts as a fact once
 * it is present, accepted or not: an unaccepted value still blocks FINAL
 * through the gate, but it already tells the engine which fields to ask for.
 */
import { FieldValue } from '../field-state';
import { Facts } from './engine';

const FACT_FIELDS = [
  'record_type', 'model_category', 'autonomy_level', 'personal_data', 'jurisdictions', 'eu_role', 'eu_art27_criteria',
  'third_party_provider_used', 'tenant_reach', 'tenant_count', 'decision_impact', 'inherent_risk_tier', 'hosting_type', 'deployment_status',
  'data_classification', 'capabilities',
] as const;

export interface LinkedFacts {
  /** A linked model (uses_model, selects_model) is in a generative category. */
  uses_generative?: boolean | null;
}

export function factsFrom(values: Map<string, FieldValue> | Record<string, FieldValue>, linked: LinkedFacts = {}): Facts {
  const get = (id: string) => (values instanceof Map ? values.get(id) : values[id]);
  const facts: Facts = {};
  for (const id of FACT_FIELDS) {
    const v = get(id);
    facts[id] = v && v.status !== 'NOT_ASSESSED' && v.status !== 'NOT_APPLICABLE' ? v.value : null;
  }
  if (linked.uses_generative !== undefined) facts.uses_generative = linked.uses_generative;
  return facts;
}
