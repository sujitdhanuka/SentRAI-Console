/**
 * The prompt catalog: every AI use case, its variables, and its system-default
 * template. Defaults live HERE (code, not DB rows) so product upgrades can
 * improve them without touching orgs that customized theirs — resolution is
 * always "the org's active vault version, else this default".
 *
 * Templates use {{variable}} placeholders. Variables marked required must
 * appear in any saved custom template; unknown placeholders produce warnings
 * (they render as empty, never as literal braces to an LLM).
 */

export interface PromptVariableSpec {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptUseCase {
  useCase: string;
  title: string;
  description: string;
  variables: PromptVariableSpec[];
  defaultBody: string;
}

export const PROMPT_USE_CASES: PromptUseCase[] = [
  {
    useCase: 'model_summary',
    title: 'Model summary',
    description: 'Rewrites a model\'s description as a plain-language governance summary (the ✨ Summarize button).',
    variables: [
      { name: 'name', description: 'Model name', required: true },
      { name: 'model_type', description: 'Detected type (GENERATIVE_AI, AGENT, …)', required: false },
      { name: 'functional_area', description: 'Business function the model supports', required: false },
      { name: 'signals', description: 'Static-analysis signals, comma-separated', required: false },
      { name: 'domain_tags', description: 'Domain classification tags', required: false },
      { name: 'human_oversight', description: '"true"/"false" — human-in-the-loop required', required: false },
      { name: 'existing_description', description: 'Current description (secret-masked)', required: false },
      { name: 'snippet_block', description: 'Secret-masked source excerpt, or empty when unavailable', required: false },
    ],
    defaultBody: [
      'You are an AI-governance analyst. Write a concise, plain-language summary of what this software component does, for a compliance inventory read by risk officers and auditors (not engineers).',
      'Rules: 2–4 sentences. Say what it does, what decisions/outputs it influences, and who/what it affects. Note if it processes personal data. Do NOT restate code identifiers or include code. Do NOT invent capabilities not evidenced below.',
      '',
      'Name: {{name}}',
      'Detected type: {{model_type}}',
      'Functional area: {{functional_area}}',
      'Static-analysis signals: {{signals}}',
      'Domain tags: {{domain_tags}}',
      'Human oversight required: {{human_oversight}}',
      'Existing description (may be raw docstring): {{existing_description}}',
      '{{snippet_block}}',
    ].join('\n'),
  },
  {
    useCase: 'risk_rationale',
    title: 'Risk rationale',
    description: 'Drafts an auditor-ready justification of a model\'s assigned risk level (Phase 3 button).',
    variables: [
      { name: 'name', description: 'Model name', required: true },
      { name: 'model_type', description: 'Model type', required: false },
      { name: 'functional_area', description: 'Business function', required: false },
      { name: 'risk_level', description: 'Assigned risk level (LOW/MEDIUM/HIGH/CRITICAL)', required: true },
      { name: 'triage_factors', description: 'Factors the rule-based triage applied', required: false },
      { name: 'security_findings', description: 'Hardcoded-secret findings (masked)', required: false },
      { name: 'human_oversight', description: '"true"/"false"', required: false },
      { name: 'autonomous_scope', description: 'Declared autonomous scope, if any', required: false },
      { name: 'existing_description', description: 'Model description', required: false },
    ],
    defaultBody: [
      'You are an AI-governance analyst. Draft an auditor-ready rationale for why this AI model is classified {{risk_level}} risk. 3–5 sentences, plain language, grounded ONLY in the factors below. If evidence is thin, state what must be verified rather than inventing it.',
      '',
      'Model: {{name}} ({{model_type}}) — {{functional_area}}',
      'Assigned risk level: {{risk_level}}',
      'Triage factors: {{triage_factors}}',
      'Security findings: {{security_findings}}',
      'Human oversight required: {{human_oversight}}',
      'Autonomous scope: {{autonomous_scope}}',
      'Description: {{existing_description}}',
    ].join('\n'),
  },
  {
    useCase: 'autonomous_scope',
    title: 'Autonomous scope',
    description: 'Proposes the autonomy boundary of a model from its code signals, for a human to confirm (the Draft scope button).',
    variables: [
      { name: 'name', description: 'Model name', required: true },
      { name: 'model_type', description: 'Detected type (AGENT, GENERATIVE_AI, …)', required: false },
      { name: 'functional_area', description: 'Business function', required: false },
      { name: 'signals', description: 'Static-analysis signals, comma-separated', required: false },
      { name: 'human_oversight', description: '"true"/"false" — human-in-the-loop required', required: false },
      { name: 'existing_description', description: 'Model description', required: false },
      { name: 'snippet_block', description: 'Secret-masked source excerpt, or empty when unavailable', required: false },
    ],
    defaultBody: [
      'You are an AI-governance analyst. Propose the AUTONOMOUS SCOPE of this system — the boundary of what it may do WITHOUT a human approving each action — for a governance record. RBI FREE-AI Recommendation 16 requires clear autonomous action limits.',
      'Rules: ONE sentence, specific and grounded ONLY in the evidence below. State (a) the actions it may take on its own, (b) any hard limits actually present in the code (step/iteration caps, which tools or APIs it may call), and (c) the conditions under which it MUST escalate to a human. Do NOT invent limits. If human oversight is required, respond that it is fully supervised with no autonomous action. This is a proposal for a human owner to confirm — do not assert it as approved policy.',
      '',
      'Name: {{name}}',
      'Detected type: {{model_type}}',
      'Functional area: {{functional_area}}',
      'Static-analysis signals: {{signals}}',
      'Human oversight required: {{human_oversight}}',
      'Description: {{existing_description}}',
      '{{snippet_block}}',
    ].join('\n'),
  },
  {
    useCase: 'gap_remediation',
    title: 'Gap remediation',
    description: 'Drafts one actionable remediation step per open compliance gap (Phase 3 button).',
    variables: [
      { name: 'name', description: 'Model name', required: true },
      { name: 'model_type', description: 'Model type', required: false },
      { name: 'functional_area', description: 'Business function', required: false },
      { name: 'risk_level', description: 'Assigned risk level', required: false },
      { name: 'gaps', description: 'The open gaps, one per line, prefixed by framework', required: true },
    ],
    defaultBody: [
      'You are an AI-governance analyst. For each open compliance gap below, draft ONE actionable remediation step — owner-ready, imperative, specific (name the artifact to produce or the field to set). Group by framework. Do not invent gaps and do not mark anything resolved.',
      '',
      'Model: {{name}} ({{model_type}}) — {{functional_area}}, risk {{risk_level}}',
      'Open gaps:',
      '{{gaps}}',
    ].join('\n'),
  },
  {
    useCase: 'exec_narrative',
    title: 'Executive narrative',
    description: 'One-paragraph executive summary for the portfolio readiness report (future use).',
    variables: [
      { name: 'portfolio_stats', description: 'Portfolio rollup statistics', required: true },
      { name: 'top_gaps', description: 'Most common open gaps', required: false },
      { name: 'ci_metrics', description: 'CI-gate enforcement metrics', required: false },
    ],
    defaultBody: [
      'You are drafting the executive-summary paragraph of an AI-governance readiness report for a financial-services board. One paragraph, 4–6 sentences, factual, no hype. Cover: portfolio size, overall compliance posture, the most material gaps, and pre-deployment (CI gate) enforcement.',
      '',
      'Portfolio statistics: {{portfolio_stats}}',
      'Top gaps: {{top_gaps}}',
      'CI gate metrics: {{ci_metrics}}',
    ].join('\n'),
  },
];

export function getUseCase(useCase: string): PromptUseCase | undefined {
  return PROMPT_USE_CASES.find((u) => u.useCase === useCase);
}
