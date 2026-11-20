import { M, SectionDef, sectionFields } from '../types';

const S = 'security';

export const SECURITY: SectionDef = {
  section_id: S,
  number: 12,
  title: 'Security and resilience',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['authn', 'Authentication', 'text', 'How callers and users are authenticated.', { req: M }],
    ['authz', 'Authorisation', 'text', 'How permissions are checked.', { req: M }],
    ['access_control', 'Access control', 'longtext', 'Who can reach it and its data.'],
    ['key_management', 'API-key and BYOK key management', 'longtext', 'How API keys, including tenants\' own keys, are stored, rotated and revoked.', { rule: 'R_THIRD_PARTY', sensitive: true }],
    ['encryption_at_rest', 'Encryption at rest', 'text', 'How stored data is encrypted.'],
    ['encryption_in_transit', 'Encryption in transit', 'text', 'How data in transit is encrypted.'],
    ['prompt_injection_protection', 'Prompt-injection protection', 'longtext', 'Controls against prompt injection.', { rule: 'R_GENERATIVE', refs: ['nist-ai-600-1:INFORMATION_SECURITY'] }],
    ['model_extraction_protection', 'Model-extraction protection', 'text', 'Controls against stealing the model through its outputs.', { rt: ['AI_MODEL', 'AI_SYSTEM'] }],
    ['adversarial_resistance', 'Adversarial resistance', 'text', 'Controls against adversarial inputs.', { rt: ['AI_MODEL', 'AI_SYSTEM', 'AGENT'] }],
    ['poisoning_protection', 'Poisoning protection', 'text', 'Controls against poisoned data.', { rt: ['AI_MODEL', 'AI_SYSTEM', 'RAG_PIPELINE'] }],
    ['supply_chain_security', 'Supply-chain security', 'text', 'How dependencies are vetted and pinned.'],
    ['vulnerability_management', 'Vulnerability management', 'text', 'How vulnerabilities are found and fixed.'],
    ['rate_limiting', 'Rate limiting', 'text', 'Limits on request rates.'],
    ['abuse_prevention', 'Abuse prevention', 'text', 'Controls against abuse.'],
    ['incident_response', 'Incident response', 'url', 'The incident-response plan that covers it.', { req: M }],
    ['disaster_recovery', 'Disaster recovery', 'text', 'How it is recovered after a failure.'],
    ['rollback', 'Rollback', 'text', 'How a bad release or change is rolled back.'],
    ['business_continuity', 'Business continuity', 'text', 'What happens if it is unavailable.', { register: 'bcp' }],
    ['security_assessment', 'Security assessment evidence', 'url', 'The latest security assessment or threat model.', { register: 'threat_models', ev: 'security_test', refs: ['eu-ai-act-2024:ART-15'] }],
  ]),
};
