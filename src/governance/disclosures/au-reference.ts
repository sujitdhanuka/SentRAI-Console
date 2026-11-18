/**
 * Reference content for the Australia pack (E2.1). Australia's eight AI
 * Ethics Principles (Department of Industry, Science and Resources, 2019),
 * paraphrased, each mapped to the SentRAI controls that produce evidence for
 * it; and an indicative mapping of the lifecycle stages of the DTA technical
 * standard for government's use of AI to the same controls.
 *
 * The mapping is SentRAI's own and needs the compliance reviewer's sign-off
 * before it is shown to a customer as authoritative (plan §9, pack content
 * review). Nothing here changes a check result.
 */
export const AU_ETHICS_PRINCIPLES = [
  { id: 'wellbeing', name: 'Human, societal and environmental wellbeing', summary: 'AI systems should benefit individuals, society and the environment.', controls: ['CTL-IMPACT-01', 'CTL-CTX-03'] },
  { id: 'human_values', name: 'Human-centred values', summary: 'AI systems should respect human rights, diversity and the autonomy of individuals.', controls: ['CTL-IMPACT-01', 'CTL-HUM-01'] },
  { id: 'fairness', name: 'Fairness', summary: 'AI systems should be inclusive and accessible, and should not involve or result in unfair discrimination.', controls: ['CTL-FAIR-01', 'CTL-FL-01', 'CTL-FL-02'] },
  { id: 'privacy', name: 'Privacy protection and security', summary: 'AI systems should respect and uphold privacy rights and data protection, and ensure the security of data.', controls: ['CTL-PRIV-01', 'CTL-SEC-01', 'CTL-DATA-02'] },
  { id: 'reliability', name: 'Reliability and safety', summary: 'AI systems should reliably operate in accordance with their intended purpose.', controls: ['CTL-MON-01', 'CTL-RES-01', 'CTL-VAL-01'] },
  { id: 'transparency', name: 'Transparency and explainability', summary: 'People should know when they are significantly impacted by AI and be able to find out when an AI system is engaging with them.', controls: ['CTL-EXPL-01', 'CTL-AU-REG'] },
  { id: 'contestability', name: 'Contestability', summary: 'When an AI system significantly impacts a person, there should be a timely process to challenge its use or outcomes.', controls: ['CTL-APPEAL-01'] },
  { id: 'accountability', name: 'Accountability', summary: 'People responsible for each phase of the AI lifecycle should be identifiable and accountable, with human oversight enabled.', controls: ['CTL-OWNER-01', 'CTL-ORG-ACCOUNTABLE', 'CTL-ACC-01'] },
];

export const AU_TECHNICAL_STANDARD_STAGES = [
  { stage: 'Discover', summary: 'Problem definition, in-scope test and impact assessment', controls: ['CTL-AU-INSCOPE', 'CTL-IMPACT-01', 'CTL-CTX-03'] },
  { stage: 'Operate', summary: 'Data, model development, verification and validation', controls: ['CTL-DATA-02', 'CTL-VAL-01', 'CTL-FAIR-01'] },
  { stage: 'Deploy', summary: 'Pre-deployment testing, approval and transparency', controls: ['CTL-RT-02', 'CTL-AU-REG', 'CTL-HUM-01'] },
  { stage: 'Monitor', summary: 'Monitoring, incidents, review and decommissioning', controls: ['CTL-MON-01', 'CTL-INC-01', 'CTL-AU-REVIEW'] },
];

/** Appendix C higher-risk areas (paraphrased) that raise the triage hint for AU organisations. */
export const AU_HIGH_RISK_AREAS = [
  'recruitment', 'employment', 'discretionary_automated_decision', 'justice', 'democracy', 'law_enforcement', 'policing',
  'welfare', 'social_services', 'health', 'immigration', 'migration', 'education', 'critical_infrastructure', 'biometrics',
];

/** True when a model's functional area falls in an Appendix C higher-risk area. */
export function auHighRiskArea(functionalArea: string | null | undefined): string | null {
  const fa = (functionalArea ?? '').toLowerCase();
  return AU_HIGH_RISK_AREAS.find((a) => fa.includes(a)) ?? null;
}
