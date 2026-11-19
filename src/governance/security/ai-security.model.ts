/**
 * AI security (E3.6, RBI Rec 19, NIST MEASURE 2.7, US AP-2 / AP-3): the
 * attack-category catalogue used for threat models and security evaluations.
 * Each category carries reference mappings to MITRE ATLAS, the OWASP Top 10
 * for LLM applications (2025) and the NIST AI 100-2 taxonomy. The mappings
 * are references for the reader, not certification claims; they belong in
 * the compliance review like pack content.
 */
export interface AttackCategory {
  id: string;
  label: string;
  /** Model types it applies to by default ('*' = every type). */
  appliesTo: string[] | '*';
  atlas: string[];
  owasp: string[];
  nist: string;
  /** Evaluation area this category falls under (CAISI-aligned grouping used in eval evidence). */
  area: 'MODEL_INTEGRITY' | 'CONFIDENTIALITY' | 'MISUSE_AND_HIJACKING' | 'AVAILABILITY' | 'SUPPLY_CHAIN';
}

const GEN = ['GENERATIVE_AI', 'AGENT', 'MCP_SERVER', 'TOOL', 'HYBRID', 'NLP'];
const AGENTIC = ['AGENT', 'MCP_SERVER', 'TOOL'];

export const ATTACK_CATEGORIES: AttackCategory[] = [
  { id: 'DATA_POISONING', label: 'Training or fine-tuning data poisoning', appliesTo: '*', atlas: ['AML.T0020'], owasp: ['LLM04'], nist: 'Poisoning', area: 'MODEL_INTEGRITY' },
  { id: 'EVASION', label: 'Evasion with adversarial inputs', appliesTo: ['MACHINE_LEARNING', 'DEEP_LEARNING', 'NLP', 'HYBRID'], atlas: ['AML.T0015', 'AML.T0043'], owasp: [], nist: 'Evasion', area: 'MODEL_INTEGRITY' },
  { id: 'MODEL_EXTRACTION', label: 'Model extraction through the inference API', appliesTo: '*', atlas: ['AML.T0024.002'], owasp: ['LLM10'], nist: 'Privacy (model extraction)', area: 'CONFIDENTIALITY' },
  { id: 'MEMBERSHIP_INFERENCE', label: 'Membership inference and model inversion', appliesTo: '*', atlas: ['AML.T0024.000', 'AML.T0024.001'], owasp: ['LLM02'], nist: 'Privacy (data reconstruction, membership inference)', area: 'CONFIDENTIALITY' },
  { id: 'PROMPT_INJECTION', label: 'Direct prompt injection', appliesTo: GEN, atlas: ['AML.T0051.000'], owasp: ['LLM01'], nist: 'Misuse (direct prompting)', area: 'MISUSE_AND_HIJACKING' },
  { id: 'INDIRECT_PROMPT_INJECTION', label: 'Indirect prompt injection through retrieved content or tools', appliesTo: GEN, atlas: ['AML.T0051.001'], owasp: ['LLM01'], nist: 'Indirect prompt injection', area: 'MISUSE_AND_HIJACKING' },
  { id: 'JAILBREAK', label: 'Jailbreak of safety or policy controls', appliesTo: GEN, atlas: ['AML.T0054'], owasp: ['LLM01'], nist: 'Misuse (jailbreak)', area: 'MISUSE_AND_HIJACKING' },
  { id: 'SENSITIVE_DISCLOSURE', label: 'Sensitive information disclosure in outputs', appliesTo: GEN, atlas: ['AML.T0057'], owasp: ['LLM02', 'LLM07'], nist: 'Privacy (leakage)', area: 'CONFIDENTIALITY' },
  { id: 'OUTPUT_HANDLING', label: 'Improper handling of model output downstream', appliesTo: GEN, atlas: [], owasp: ['LLM05'], nist: 'Integrity (downstream)', area: 'MODEL_INTEGRITY' },
  { id: 'EXCESSIVE_AGENCY', label: 'Agent hijacking and excessive agency through tools', appliesTo: AGENTIC, atlas: ['AML.T0053'], owasp: ['LLM06'], nist: 'Agent hijacking', area: 'MISUSE_AND_HIJACKING' },
  { id: 'SUPPLY_CHAIN', label: 'Compromised model, dataset or dependency in the supply chain', appliesTo: '*', atlas: ['AML.T0010'], owasp: ['LLM03'], nist: 'Supply chain', area: 'SUPPLY_CHAIN' },
  { id: 'DENIAL_OF_SERVICE', label: 'Denial of service and unbounded resource consumption', appliesTo: '*', atlas: ['AML.T0029'], owasp: ['LLM10'], nist: 'Availability', area: 'AVAILABILITY' },
];

export const CATEGORY_IDS = ATTACK_CATEGORIES.map((c) => c.id);
export const EVAL_RESULTS = ['PASS', 'PARTIAL', 'FAIL'] as const;

export interface Threat {
  category: string;
  applicable: boolean;
  rationale: string | null;
  likelihood: number | null;
  impact: number | null;
  mitigations: string | null;
  risk_id: string | null;
}

export function defaultApplicable(c: AttackCategory, modelType: string): boolean {
  return c.appliesTo === '*' || c.appliesTo.includes(modelType);
}

export function templateThreats(modelType: string): Threat[] {
  return ATTACK_CATEGORIES.map((c) => ({
    category: c.id, applicable: defaultApplicable(c, modelType), rationale: null, likelihood: null, impact: null, mitigations: null, risk_id: null,
  }));
}

/** Validate edits to a threat list (categories fixed by the template). */
export function mergeThreats(current: Threat[], edits: unknown): Threat[] {
  if (!Array.isArray(edits) || edits.length > CATEGORY_IDS.length) throw new Error('threats must be a list of { category, ... }');
  const out = current.map((t) => ({ ...t }));
  for (const [i, e] of (edits as any[]).entries()) {
    const t = out.find((x) => x.category === e?.category);
    if (!t) throw new Error(`threats[${i}].category must be one of ${CATEGORY_IDS.join(', ')}`);
    if (e.applicable !== undefined) {
      if (typeof e.applicable !== 'boolean') throw new Error(`threats[${i}].applicable must be true or false`);
      t.applicable = e.applicable;
    }
    for (const k of ['likelihood', 'impact'] as const) {
      if (e[k] === undefined) continue;
      if (e[k] === null) { t[k] = null; continue; }
      const n = Number(e[k]);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`threats[${i}].${k} must be 1 to 5`);
      t[k] = n;
    }
    for (const k of ['rationale', 'mitigations'] as const) {
      if (e[k] === undefined) continue;
      if (e[k] !== null && typeof e[k] !== 'string') throw new Error(`threats[${i}].${k} must be text`);
      t[k] = e[k] ? String(e[k]).trim().slice(0, 2000) || null : null;
    }
  }
  return out;
}

/** Why a threat model cannot be approved yet. */
export function approvalProblems(threats: Threat[]): string[] {
  const p: string[] = [];
  for (const t of threats) {
    if (!t.applicable && !t.rationale) p.push(`${t.category}: say why it does not apply`);
    if (t.applicable && (!t.likelihood || !t.impact)) p.push(`${t.category}: rate likelihood and impact`);
    if (t.applicable && !t.mitigations) p.push(`${t.category}: name the mitigations`);
  }
  return p;
}

export interface EvalCategory {
  category: string;
  result: (typeof EVAL_RESULTS)[number];
  findings: string | null;
  mitigated: boolean;
}

export function parseEvalCategories(v: unknown): EvalCategory[] {
  if (!Array.isArray(v) || !v.length || v.length > CATEGORY_IDS.length) throw new Error('categories must be a list of { category, result, findings?, mitigated? }');
  const seen = new Set<string>();
  return v.map((c: any, i) => {
    if (!CATEGORY_IDS.includes(c?.category)) throw new Error(`categories[${i}].category must be one of ${CATEGORY_IDS.join(', ')}`);
    if (seen.has(c.category)) throw new Error(`categories[${i}].category is listed twice`);
    seen.add(c.category);
    if (!(EVAL_RESULTS as readonly string[]).includes(c.result)) throw new Error(`categories[${i}].result must be PASS, PARTIAL or FAIL`);
    const findings = c.findings ? String(c.findings).trim().slice(0, 2000) : null;
    if (c.result !== 'PASS' && !findings) throw new Error(`categories[${i}]: describe the findings of a ${c.result} result`);
    return { category: c.category, result: c.result, findings, mitigated: c.mitigated === true };
  });
}

/** Facts for CTL-SEC-AI-01 from the latest threat model and the evaluations in the window. */
export function securityFacts(tm: { status: string; threats: Threat[] } | null, evals: Array<{ evaluatedAt: Date; categories: EvalCategory[] }>, now = new Date(), windowDays = 365) {
  if (!tm) return { threatModel: 'NONE', applicable: 0, untested: [] as string[], failingUnmitigated: [] as string[] };
  const applicable = tm.threats.filter((t) => t.applicable).map((t) => t.category);
  const recent = evals.filter((e) => now.getTime() - e.evaluatedAt.getTime() <= windowDays * 86_400_000).sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  const latest = new Map<string, EvalCategory>();
  for (const e of recent) for (const c of e.categories) if (!latest.has(c.category)) latest.set(c.category, c);
  return {
    threatModel: tm.status,
    applicable: applicable.length,
    untested: applicable.filter((c) => !latest.has(c)),
    failingUnmitigated: applicable.filter((c) => latest.get(c) && latest.get(c)!.result !== 'PASS' && !latest.get(c)!.mitigated),
  };
}
