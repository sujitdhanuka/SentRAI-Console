/**
 * Third-party AI risk (E2.5): the due-diligence checklist, its scoring, the
 * contract terms a bank's third-party guidance expects, and licence
 * classification for AI bill-of-materials components. Pure functions so the
 * rules are unit-tested without a database.
 */
export const VENDOR_KINDS = ['MODEL_PROVIDER', 'DATA_PROVIDER', 'PLATFORM', 'SERVICE', 'OPEN_SOURCE'] as const;
export const VENDOR_CRITICALITY = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const VENDOR_STATUSES = ['PROSPECTIVE', 'ACTIVE', 'UNDER_REVIEW', 'EXITED'] as const;
export const BOM_KINDS = ['MODEL', 'API', 'LIBRARY', 'DATASET', 'PLATFORM'] as const;
export const LICENCE_CLASSES = ['PERMISSIVE', 'COPYLEFT', 'RESTRICTED', 'PROPRIETARY', 'UNKNOWN'] as const;
export type LicenceClass = (typeof LICENCE_CLASSES)[number];

export interface ChecklistItem {
  id: string;
  question: string;
  /** A "no" on a critical item caps the result at UNSATISFACTORY. */
  critical: boolean;
}

/** Due-diligence checklist (OCC 2023-17 / SR 26-2 third-party, ISO 42001 A.10.3, NIST GOVERN 6.1). */
export const VENDOR_CHECKLIST: ChecklistItem[] = [
  { id: 'responsible_ai_policy', question: 'The vendor has a published responsible-AI policy and model documentation', critical: false },
  { id: 'security_certification', question: 'Current security certification (SOC 2 Type II, ISO 27001 or equivalent)', critical: true },
  { id: 'incident_notification', question: 'Contract requires prompt notice of incidents affecting our data or outputs', critical: true },
  { id: 'monitoring_rights', question: 'We can monitor performance and receive the vendor’s own test results', critical: false },
  { id: 'data_use_limited', question: 'Our data is used only to provide the service', critical: true },
  { id: 'no_training_on_customer_data', question: 'Our data is not used to train the vendor’s models without consent', critical: true },
  { id: 'ip_indemnity', question: 'IP indemnity for outputs and training data', critical: false },
  { id: 'portability_exit', question: 'Data return and portability on exit', critical: false },
  { id: 'model_change_notice', question: 'Advance notice of material model or version changes', critical: false },
  { id: 'audit_rights', question: 'Audit and regulator-access rights', critical: true },
  { id: 'sub_processors_disclosed', question: 'Sub-processors and sub-contractors disclosed', critical: false },
  { id: 'testing_before_award', question: 'We tested the model or service on our own use case before award', critical: false },
];

/** Contract terms a material AI vendor contract should carry. */
export const CONTRACT_TERMS = ['incident_notification', 'audit_rights', 'data_use_limited', 'model_change_notice', 'portability_exit', 'termination_assistance'] as const;

export type Answer = 'YES' | 'NO' | 'PARTIAL' | 'NA';

export interface AssessmentResult {
  score: number;
  result: 'SATISFACTORY' | 'CONDITIONAL' | 'UNSATISFACTORY';
  gaps: Array<{ id: string; question: string; answer: Answer; critical: boolean }>;
}

/** Score = share of applicable items answered YES (PARTIAL counts half). A critical NO is UNSATISFACTORY. */
export function scoreAssessment(answers: Record<string, Answer>): AssessmentResult {
  let applicable = 0;
  let points = 0;
  const gaps: AssessmentResult['gaps'] = [];
  let criticalFail = false;
  let criticalPartial = false;
  for (const item of VENDOR_CHECKLIST) {
    const a = answers[item.id];
    if (a === 'NA') continue;
    applicable++;
    if (a === 'YES') points += 1;
    else if (a === 'PARTIAL') points += 0.5;
    if (a !== 'YES') {
      gaps.push({ id: item.id, question: item.question, answer: a ?? 'NO', critical: item.critical });
      if (item.critical) (a === 'PARTIAL' ? (criticalPartial = true) : (criticalFail = true));
    }
  }
  const score = applicable ? Math.round((points / applicable) * 100) : 0;
  const result = criticalFail || score < 50 ? 'UNSATISFACTORY' : score >= 80 && !criticalPartial ? 'SATISFACTORY' : 'CONDITIONAL';
  return { score, result, gaps };
}

/** Validates checklist answers; every item needs one of YES / NO / PARTIAL / NA. Returns an error or null. */
export function checkAnswers(answers: unknown): string | null {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return 'answers must map checklist item ids to YES, NO, PARTIAL or NA';
  const a = answers as Record<string, unknown>;
  const known = new Set(VENDOR_CHECKLIST.map((i) => i.id));
  for (const k of Object.keys(a)) if (!known.has(k)) return `Unknown checklist item: ${k}`;
  for (const item of VENDOR_CHECKLIST) {
    const v = String(a[item.id] ?? '').toUpperCase();
    if (!['YES', 'NO', 'PARTIAL', 'NA'].includes(v)) return `Answer every checklist item (missing or invalid: ${item.id})`;
    // A critical item always applies; NA would let it drop out of the score.
    if (v === 'NA' && item.critical) return `${item.id} is a critical item and cannot be marked NA`;
  }
  return null;
}

/** Contract terms the vendor's contract lacks. */
export function contractGaps(terms: Record<string, unknown> | null | undefined): string[] {
  return CONTRACT_TERMS.filter((t) => !terms?.[t]);
}

const PERMISSIVE = [/^bsl-1\.0$/, /^boost/, /^mit$/, /^apache/, /^bsd/, /^isc$/, /^unlicense$/, /^cc0/, /^cc-by(-\d|$)/, /^zlib$/, /^python-2/, /^psf/];
const COPYLEFT = [/^l?gpl/, /^agpl/, /^mpl/, /^epl/, /^cc-by-sa/, /^eupl/];
const RESTRICTED = [/-nc\b/, /non-?commercial/, /^cc-by-nc/, /openrail/, /^llama/, /research[- ]only/, /^gemma/, /^bigscience/, /^sspl/, /^busl/, /^bsl-1\.1/];
const PROPRIETARY = [/^proprietary$/, /^commercial$/, /^saas$/, /terms of (service|use)/, /^api terms$/, /^enterprise/];

/** Classifies an SPDX id or free-text licence. Unknown and empty strings are UNKNOWN. */
export function classifyLicence(licence: string | null | undefined): LicenceClass {
  const l = String(licence ?? '').trim().toLowerCase().replace(/^\(|\)$/g, '');
  if (!l || l === 'unknown' || l === 'noassertion') return 'UNKNOWN';
  // SPDX expressions: OR lets the user pick the friendliest licence, AND / WITH bind them to the strictest.
  const ORDER: LicenceClass[] = ['PERMISSIVE', 'PROPRIETARY', 'COPYLEFT', 'UNKNOWN', 'RESTRICTED'];
  if (/\s+or\s+/.test(l)) {
    const parts = l.split(/\s+or\s+/).map(classifyLicence);
    return parts.reduce((a, b) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a));
  }
  if (/\s+and\s+/.test(l)) {
    const parts = l.split(/\s+and\s+/).map(classifyLicence);
    return parts.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a));
  }
  // "MIT License", "Apache License 2.0", "GPL-3.0 WITH Classpath-exception-2.0".
  const id = l.split(/\s+with\s+/)[0].replace(/\blicen[cs]e\b/g, '').replace(/\s*(version|v)\s*/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  for (const x of [l, id]) {
    if (RESTRICTED.some((r) => r.test(x))) return 'RESTRICTED';
    if (COPYLEFT.some((r) => r.test(x))) return 'COPYLEFT';
    if (PERMISSIVE.some((r) => r.test(x))) return 'PERMISSIVE';
    if (PROPRIETARY.some((r) => r.test(x))) return 'PROPRIETARY';
  }
  return 'UNKNOWN';
}

/** "xgboost==2.0.3", "torch>=2.0", "@scope/pkg@1.2.0", "requests" → name and version (or constraint). */
export function parseDependency(d: string): { name: string; version: string | null } {
  const t = d.trim();
  const py = /^([A-Za-z0-9_.\-\[\]]+)\s*(==|>=|<=|~=|!=|>|<)\s*(.+)$/.exec(t);
  if (py) return { name: py[1], version: py[2] === '==' ? py[3] : `${py[2]}${py[3]}` };
  const at = t.lastIndexOf('@');
  if (at > 0) return { name: t.slice(0, at), version: t.slice(at + 1) || null };
  return { name: t, version: null };
}

export interface InferredComponent {
  component: string;
  kind: (typeof BOM_KINDS)[number];
  provider: string | null;
  version: string | null;
  licence: string | null;
}

/** Signal categories from discovery and the component each implies. */
const SIGNAL_COMPONENTS: Record<string, InferredComponent> = {
  llm_api_call: { component: 'Hosted LLM API', kind: 'API', provider: null, version: null, licence: null },
  llm_sdk_import: { component: 'LLM provider SDK', kind: 'LIBRARY', provider: null, version: null, licence: null },
  ast_llm_sdk: { component: 'LLM provider SDK', kind: 'LIBRARY', provider: null, version: null, licence: null },
  ml_library_import: { component: 'ML library', kind: 'LIBRARY', provider: null, version: null, licence: null },
  agent_definition: { component: 'Agent framework', kind: 'LIBRARY', provider: null, version: null, licence: null },
  ast_agent_sdk: { component: 'Agent framework', kind: 'LIBRARY', provider: null, version: null, licence: null },
  mcp_server: { component: 'MCP server or client', kind: 'LIBRARY', provider: null, version: null, licence: null },
};

/** Components implied by a model's inventory record: its vendor (developedBy), declared dependencies and discovery signals. */
export function inferComponents(model: { developedBy?: string | null; dependencies?: any[] | null; detectionSignals?: string[] | null }): InferredComponent[] {
  const out = new Map<string, InferredComponent>();
  const add = (c: InferredComponent) => {
    const key = c.component.toLowerCase();
    if (!out.has(key)) out.set(key, c);
  };
  const dev = String(model.developedBy ?? '').trim();
  if (dev && !/^(internal|in-house|inhouse)$/i.test(dev)) add({ component: dev.slice(0, 200), kind: 'MODEL', provider: dev.slice(0, 100), version: null, licence: null });
  for (const d of model.dependencies ?? []) {
    if (typeof d === 'string' && d.trim()) {
      const { name, version } = parseDependency(d);
      add({ component: name.slice(0, 200), kind: 'LIBRARY', provider: null, version: version?.slice(0, 100) ?? null, licence: null });
    } else if (d && typeof d === 'object' && typeof d.name === 'string' && d.name.trim()) {
      const kind = String(d.kind ?? d.type ?? '').toUpperCase();
      add({
        component: d.name.trim().slice(0, 200),
        kind: (BOM_KINDS as readonly string[]).includes(kind) ? (kind as InferredComponent['kind']) : 'LIBRARY',
        provider: typeof d.provider === 'string' ? d.provider.slice(0, 100) : null,
        version: d.version != null ? String(d.version).slice(0, 100) : null,
        licence: typeof d.licence === 'string' ? d.licence.slice(0, 100) : typeof d.license === 'string' ? d.license.slice(0, 100) : null,
      });
    }
  }
  for (const s of model.detectionSignals ?? []) if (SIGNAL_COMPONENTS[s]) add({ ...SIGNAL_COMPONENTS[s] });
  return [...out.values()];
}
