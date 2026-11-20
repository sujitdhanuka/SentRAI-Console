/**
 * Model card v2: applicability rules (spec §6). Declarative and versioned;
 * evaluated only on the server. A rule names the facts it reads, so a fact
 * that is not assessed yet makes the rule UNDETERMINED instead of guessing.
 */
import { GENERATIVE_CATEGORIES } from '../catalogue/sections/s01-identity';

export const RULES_VERSION = '2.0.0';

export type Cond =
  | { fact: string; in: readonly string[] }
  | { fact: string; includes_any: readonly string[] }
  | { fact: string; gt: number }
  | { fact: string; eq: string | boolean }
  | { rule: string }
  | { all: Cond[] }
  | { any: Cond[] };

export interface RuleDef {
  id: string;
  version: string;
  title: string;
  /** Shown as "why is this required?" when the rule fires. */
  why: string;
  when: Cond;
}

const r = (id: string, title: string, why: string, when: Cond): RuleDef => ({ id, version: RULES_VERSION, title, why, when });
const US = ['US', 'US-CO'] as const;

export const RULES: readonly RuleDef[] = [
  r('R_GENERATIVE', 'Generative AI', 'The record is, uses or selects a generative model, so transparency, AI-content labelling, hallucination and harmful-output evaluation, prompt-injection testing and the NIST AI 600-1 profile apply.',
    { any: [{ fact: 'model_category', in: GENERATIVE_CATEGORIES }, { fact: 'uses_generative', eq: true }] }),
  r('R_RAG', 'RAG pipeline', 'The record is a RAG pipeline, so the retrieval and knowledge-base fields apply.', { fact: 'record_type', in: ['RAG_PIPELINE'] }),
  r('R_AGENT', 'Agent or autonomy', 'The record is an agent or acts with some autonomy, so tools, permissions, limits and the emergency stop must be documented.',
    { any: [{ fact: 'record_type', in: ['AGENT'] }, { fact: 'autonomy_level', in: ['SUGGESTS', 'ACTS_WITH_APPROVAL', 'ACTS_AUTONOMOUSLY'] }] }),
  r('R_PERSONAL_DATA', 'Personal data', 'Personal data is processed, so privacy impact, lawful basis, retention, residency and transfer fields apply.', { fact: 'personal_data', eq: 'YES' }),
  r('R_EU', 'EU jurisdiction', 'An EU or EEA jurisdiction is in scope, so the EU AI Act role and classification must be recorded.', { fact: 'jurisdictions', includes_any: ['EU', 'EEA'] }),
  r('R_EU_DEPLOYER', 'EU deployer', 'The organisation is a deployer under the EU AI Act.', { all: [{ rule: 'R_EU' }, { fact: 'eu_role', includes_any: ['DEPLOYER'] }] }),
  r('R_EU_FRIA', 'EU fundamental rights impact assessment', 'The organisation is a deployer and meets the Art. 27 criteria, so a fundamental rights impact assessment is needed.',
    { all: [{ rule: 'R_EU_DEPLOYER' }, { fact: 'eu_art27_criteria', eq: 'YES' }] }),
  r('R_GPAI_PROVIDER', 'GPAI model provider', 'The organisation provides a general-purpose AI model in the EU, so GPAI-model-provider duties apply.', { fact: 'eu_role', includes_any: ['GPAI_MODEL_PROVIDER'] }),
  r('R_THIRD_PARTY', 'Third-party provider', 'A third party supplies a model, API or hosting, so Third-party governance applies.', { fact: 'third_party_provider_used', eq: 'YES' }),
  r('R_MULTI_TENANT', 'Shared across tenants', 'One change reaches more than one tenant, so change management, tenant notification and cross-tenant leakage testing apply.',
    { any: [{ fact: 'tenant_reach', in: ['SOME_TENANTS', 'ALL_TENANTS'] }, { fact: 'tenant_count', gt: 1 }] }),
  r('R_PEOPLE_IMPACT', 'Decisions about people', 'Its outputs support or make decisions about people, so impact, fairness, explanation and grievance fields apply.',
    { fact: 'decision_impact', in: ['SUPPORTS_DECISIONS_ABOUT_PEOPLE', 'MAKES_DECISIONS_ABOUT_PEOPLE', 'SAFETY_CRITICAL'] }),
  r('R_HIGH_RISK', 'High inherent risk', 'The inherent risk tier is HIGH or CRITICAL, so independent validation and red teaming apply.', { fact: 'inherent_risk_tier', in: ['HIGH', 'CRITICAL'] }),
  r('R_SELF_HOSTED', 'Self-hosted', 'You run the hardware, so hardware, water and utilisation fields apply.', { fact: 'hosting_type', in: ['SELF_HOSTED', 'PRIVATE_CLOUD', 'ON_DEVICE'] }),
  r('R_DEPLOYED', 'Deployed', 'It is deployed, so monitoring must be documented.', { fact: 'deployment_status', in: ['DEPLOYED_NON_PRODUCTION', 'DEPLOYED_PRODUCTION'] }),
  r('R_HAS_JURISDICTION', 'Jurisdiction recorded', 'Jurisdictions are recorded, so regulatory notification duties must be stated.',
    { fact: 'jurisdictions', includes_any: ['EU', 'EEA', 'UK', 'IN', 'KR', 'CN', 'US', 'US-CO', 'SG', 'AU', 'OTHER'] }),
  r('R_IN', 'India', 'India is in scope.', { fact: 'jurisdictions', includes_any: ['IN'] }),
  r('R_KR', 'South Korea', 'South Korea is in scope.', { fact: 'jurisdictions', includes_any: ['KR'] }),
  r('R_CN', 'China', 'China is in scope.', { fact: 'jurisdictions', includes_any: ['CN'] }),
  r('R_US', 'United States', 'The United States is in scope.', { fact: 'jurisdictions', includes_any: US }),
  r('R_GDPR', 'GDPR', 'Personal data is processed and an EU or EEA jurisdiction is in scope.', { all: [{ rule: 'R_PERSONAL_DATA' }, { rule: 'R_EU' }] }),
  r('R_DPDP', 'India DPDP', 'Personal data is processed and India is in scope.', { all: [{ rule: 'R_PERSONAL_DATA' }, { rule: 'R_IN' }] }),
];

export const RULE_IDS: ReadonlySet<string> = new Set(RULES.map((x) => x.id));
export const ruleDef = (id: string) => RULES.find((x) => x.id === id);
