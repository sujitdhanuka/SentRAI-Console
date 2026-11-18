/**
 * AIMS workspace record types (E1.6): which ISO/IEC 42001 clause each record
 * evidences, the content each needs, and the RBI Rec 14 policy sections.
 */
export interface AimsType {
  type: string;
  label: string;
  isoClauses: string[];
  /** Required text fields in content. */
  required: string[];
  /** Light people-side record governed by the people-items setting. */
  peopleItem?: string;
  /** Default months between reviews once approved. */
  reviewMonths?: number;
}

export const AIMS_TYPES: AimsType[] = [
  { type: 'SCOPE', label: 'AIMS scope', isoClauses: ['4.3', '4.4'], required: ['boundaries', 'ai_systems'], reviewMonths: 12 },
  { type: 'POLICY', label: 'AI policy', isoClauses: ['5.2', 'A.2.2', 'A.2.3', 'A.2.4'], required: [], reviewMonths: 12 },
  { type: 'CONTEXT', label: 'Context of the organisation', isoClauses: ['4.1'], required: ['internal_issues', 'external_issues'], reviewMonths: 12 },
  { type: 'INTERESTED_PARTY', label: 'Interested party', isoClauses: ['4.2'], required: ['party', 'needs'], reviewMonths: 12 },
  { type: 'OBJECTIVE', label: 'AI objective', isoClauses: ['6.2'], required: ['objective', 'measure', 'target'], reviewMonths: 12 },
  { type: 'MGMT_REVIEW', label: 'Management review', isoClauses: ['9.3'], required: ['review_date'], reviewMonths: 12 },
  { type: 'AUDIT_PROGRAMME', label: 'Internal audit programme', isoClauses: ['9.2'], required: ['period'], reviewMonths: 12 },
  { type: 'RESOURCE', label: 'Resources', isoClauses: ['7.1', 'A.4.2'], required: ['description'], reviewMonths: 12 },
  { type: 'COMMUNICATION', label: 'Communication plan', isoClauses: ['7.4'], required: ['description'], reviewMonths: 12 },
  { type: 'CHANGE', label: 'Planned change', isoClauses: ['6.3'], required: ['description'] },
  { type: 'COMPETENCE', label: 'Competence record', isoClauses: ['7.2'], required: ['person_or_role', 'evidence'], peopleItem: 'competence' },
  { type: 'AWARENESS', label: 'Awareness record', isoClauses: ['7.3'], required: ['person_or_role', 'evidence'], peopleItem: 'awareness' },
];

export function aimsType(type: string): AimsType | undefined {
  return AIMS_TYPES.find((t) => t.type === type);
}

/** RBI FREE-AI Rec 14: what a board-approved AI policy should set out (paraphrased). */
export const REC14_SECTIONS = [
  'governance_structure', 'accountability', 'risk_appetite', 'operational_safeguards', 'auditability',
  'consumer_protection', 'ai_disclosures', 'model_lifecycle', 'liability',
] as const;

/** ISO/IEC 42001 5.2: what the AI policy must include (paraphrased). */
export const ISO_POLICY_SECTIONS = ['purpose_alignment', 'objectives_framework', 'requirements_commitment', 'continual_improvement'] as const;

/** Content checks per type; returns problems. */
export function checkContent(type: string, content: Record<string, any>): string[] {
  const t = aimsType(type);
  if (!t) return [`unknown record type ${type}`];
  const problems: string[] = [];
  for (const f of t.required) {
    const v = content?.[f];
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) problems.push(`content.${f} is required`);
  }
  if (type === 'POLICY') {
    const sections = content?.sections ?? {};
    if (typeof sections !== 'object' || Array.isArray(sections)) problems.push('content.sections must be an object of section → text');
    for (const s of ISO_POLICY_SECTIONS) if (!String(sections?.[s] ?? '').trim()) problems.push(`content.sections.${s} is required (ISO 5.2)`);
  }
  if (type === 'AUDIT_PROGRAMME') {
    const audits = content?.audits;
    if (!Array.isArray(audits) || !audits.length) problems.push('content.audits must list the planned audits');
    for (const [i, a] of (Array.isArray(audits) ? audits : []).entries()) {
      if (!a?.area || !a?.planned_date || !a?.auditor) problems.push(`content.audits[${i}] needs area, planned_date and auditor`);
      // ISO 9.2: auditors are chosen to keep the audit objective and impartial.
      if (a?.auditor_independent !== true) problems.push(`content.audits[${i}].auditor_independent must be true: an auditor cannot audit their own work`);
    }
  }
  if (type === 'MGMT_REVIEW') {
    if (Number.isNaN(Date.parse(content?.review_date))) problems.push('content.review_date must be a date');
    for (const [i, a] of (content?.actions ?? []).entries()) if (!a?.action) problems.push(`content.actions[${i}].action is required`);
  }
  if (type === 'CONTEXT' && content?.climate_change_relevant !== undefined && typeof content.climate_change_relevant !== 'boolean') {
    problems.push('content.climate_change_relevant must be true or false');
  }
  return problems;
}

export function missingRec14(content: Record<string, any>): string[] {
  const s = content?.sections ?? {};
  return REC14_SECTIONS.filter((k) => !String(s[k] ?? '').trim());
}
