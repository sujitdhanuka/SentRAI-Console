/**
 * Impact assessment questionnaires per pack (E1.4, design §3.2). One record,
 * several report layouts. Questions paraphrase the source frameworks; the
 * derived flags (in scope, high impact, materiality) drive the deploy gate.
 */
export type QuestionType = 'yes_no' | 'text' | 'select';

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  options?: string[];
  required: boolean;
  /** Source clause the question evidences. */
  ref?: string;
}

export interface Questionnaire {
  id: string;
  title: string;
  /** Pack that makes this questionnaire apply automatically (null = baseline, always). */
  pack: string | null;
  /** Primary jurisdictions that include it by default. */
  jurisdictions?: string[];
  source: string;
  questions: Question[];
}

const yn = (id: string, text: string, ref?: string, required = true): Question => ({ id, text, type: 'yes_no', required, ref });
const tx = (id: string, text: string, ref?: string, required = true): Question => ({ id, text, type: 'text', required, ref });
const sel = (id: string, text: string, options: string[], ref?: string, required = true): Question => ({ id, text, type: 'select', options, required, ref });

export const QUESTIONNAIRES: Questionnaire[] = [
  {
    id: 'iso-42001',
    title: 'AI system impact assessment (ISO/IEC 42001 6.1.4, 8.4, A.5)',
    pack: null,
    source: 'ISO/IEC 42001:2023 clauses 6.1.4 and 8.4; Annex A.5.2–A.5.5',
    questions: [
      tx('purpose', 'What is the system for, and what decision or output does it produce?', 'A.5.2'),
      tx('affected_individuals', 'Which individuals are affected, and how could they be harmed or helped?', 'A.5.4'),
      tx('affected_groups', 'Which groups (including vulnerable or protected groups) could be affected differently?', 'A.5.4'),
      tx('societal_impacts', 'What wider societal or environmental impacts could the system have?', 'A.5.5'),
      sel('severity', 'Worst credible impact on an individual', ['LOW', 'MEDIUM', 'HIGH'], 'A.5.3'),
      sel('reversibility', 'Can a harmful outcome be reversed?', ['REVERSIBLE', 'PARTLY_REVERSIBLE', 'IRREVERSIBLE'], 'A.5.3'),
      tx('mitigations', 'What measures reduce these impacts (controls, oversight, redress)?', '6.1.4'),
      yn('residual_acceptable', 'Is the remaining impact acceptable to the organisation?', '8.4'),
    ],
  },
  {
    id: 'eu-fria',
    title: 'Fundamental rights impact assessment (EU AI Act Art. 27)',
    pack: 'eu-ai-act',
    jurisdictions: ['EU'],
    source: 'Regulation (EU) 2024/1689, Article 27',
    questions: [
      tx('deployer_process', 'In which of the deployer’s processes is the system used?', 'Art 27(1)(a)'),
      tx('period_frequency', 'For how long and how often will it be used?', 'Art 27(1)(b)'),
      tx('persons_affected', 'Which categories of natural persons and groups are likely to be affected?', 'Art 27(1)(c)'),
      tx('risks_of_harm', 'What specific risks of harm to those persons or groups are likely?', 'Art 27(1)(d)'),
      tx('human_oversight', 'How is human oversight carried out, following the instructions for use?', 'Art 27(1)(e)'),
      tx('if_risks_materialise', 'What happens if the risks materialise, including governance and complaint mechanisms?', 'Art 27(1)(f)'),
    ],
  },
  {
    id: 'au-dta',
    title: 'AI use case impact assessment: in-scope test (DTA policy v2.1, Appendix C)',
    pack: 'au-dta',
    jurisdictions: ['AU'],
    source: 'Digital Transformation Agency, Policy for the responsible use of AI in government v2.1, Appendix C (paraphrased)',
    questions: [
      yn('influences_decisions', 'Could the use case materially influence an administrative decision or action affecting people?', 'App C'),
      yn('public_interaction', 'Does the system interact directly with members of the public without a human in between?', 'App C'),
      yn('sensitive_data', 'Does it use sensitive or personal information, or information about vulnerable people?', 'App C'),
      yn('high_risk_area', 'Is it used in a listed high-risk area (for example welfare, health, policing, migration)?', 'App C'),
      tx('in_scope_rationale', 'Why is (or is not) the use case in scope?', 'App C'),
    ],
  },
  {
    id: 'us-m25-21',
    title: 'High-impact AI determination (OMB M-25-21)',
    pack: 'us-2026',
    jurisdictions: ['US'],
    source: 'OMB Memorandum M-25-21, high-impact AI use cases (paraphrased)',
    questions: [
      yn('principal_basis', 'Is the AI output a principal basis for a decision with legal, material, binding or similarly significant effect on people’s rights or safety?', 'M-25-21 §4'),
      yn('presumed_category', 'Does the use fall in a category the memorandum presumes high-impact?', 'M-25-21 §4'),
      tx('determination_rationale', 'Rationale for the high-impact determination', 'M-25-21 §4'),
      tx('pre_deployment_testing', 'What pre-deployment testing was done in a real-world context?', 'M-25-21 §4(b)'),
    ],
  },
  {
    id: 'us-sr26-2',
    title: 'Model materiality and tiering (SR 26-2)',
    pack: 'us-2026',
    jurisdictions: ['US'],
    source: 'Federal Reserve SR 26-2 model risk management guidance (paraphrased)',
    questions: [
      sel('exposure', 'Financial exposure the model drives', ['LOW', 'MEDIUM', 'HIGH'], 'SR 26-2 materiality'),
      sel('purpose_criticality', 'Criticality of the business purpose', ['LOW', 'MEDIUM', 'HIGH'], 'SR 26-2 materiality'),
      tx('tier_justification', 'Written justification for the assigned materiality tier', 'SR 26-2 tiering'),
    ],
  },
];

export function questionnaireById(id: string): Questionnaire | undefined {
  return QUESTIONNAIRES.find((q) => q.id === id);
}

/** Questionnaires that apply by default: the baseline, any enabled pack's, and the primary jurisdiction's. */
export function defaultQuestionnaires(enabledPacks: string[], primaryJurisdiction: string): string[] {
  return QUESTIONNAIRES.filter(
    (q) => q.pack === null || enabledPacks.includes(q.pack) || (q.jurisdictions ?? []).includes(primaryJurisdiction),
  ).map((q) => q.id);
}

/** Validate answers against the included questionnaires; `complete` requires every required answer. */
export function checkAnswers(ids: string[], answers: Record<string, Record<string, any>>, complete: boolean): string[] {
  const problems: string[] = [];
  for (const id of Object.keys(answers ?? {})) if (!ids.includes(id)) problems.push(`${id} is not part of this assessment`);
  for (const id of ids) {
    const q = questionnaireById(id);
    if (!q) { problems.push(`unknown questionnaire ${id}`); continue; }
    const a = answers?.[id] ?? {};
    for (const key of Object.keys(a)) if (!q.questions.some((x) => x.id === key)) problems.push(`${id}.${key} is not a question`);
    for (const question of q.questions) {
      const v = a[question.id];
      if (v === undefined || v === null || v === '') {
        if (complete && question.required) problems.push(`${id}.${question.id} is unanswered`);
        continue;
      }
      if (question.type === 'yes_no' && typeof v !== 'boolean') problems.push(`${id}.${question.id} must be true or false`);
      if (question.type === 'text' && typeof v !== 'string') problems.push(`${id}.${question.id} must be text`);
      if (question.type === 'select' && !question.options!.includes(v)) problems.push(`${id}.${question.id} must be one of ${question.options!.join(', ')}`);
    }
  }
  return problems;
}

const RANK: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Flags derived from the answers (null where the relevant questionnaire is not included). */
export function deriveFlags(ids: string[], answers: Record<string, Record<string, any>>) {
  const au = ids.includes('au-dta') ? answers['au-dta'] ?? {} : null;
  const m = ids.includes('us-m25-21') ? answers['us-m25-21'] ?? {} : null;
  const sr = ids.includes('us-sr26-2') ? answers['us-sr26-2'] ?? {} : null;
  const inScope = au ? ['influences_decisions', 'public_interaction', 'sensitive_data', 'high_risk_area'].some((k) => au[k] === true) : null;
  const highImpact = m ? m.principal_basis === true || m.presumed_category === true : null;
  let materiality: string | null = null;
  if (sr && sr.exposure && sr.purpose_criticality) {
    materiality = RANK[sr.exposure] >= RANK[sr.purpose_criticality] ? sr.exposure : sr.purpose_criticality;
  }
  return { inScope, highImpact, materiality };
}
