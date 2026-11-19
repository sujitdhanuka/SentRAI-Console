/**
 * Model cards (governance E4.1): the pure part. A card is generated from the
 * model record and its governance registers, section by section. Each section
 * names the common-library controls it documents, and the framework clauses
 * it maps to are read from the packs in force for the model's organisation,
 * so a pack that is switched off (Governance > Setup) is never cited.
 *
 * Readiness counts required and recommended fields. A DRAFT can be frozen at
 * any time; a FINAL needs every required field and no blocking finding from
 * the existing gates (residual risk above appetite, impact assessment not
 * final). Each frozen version keeps a hash per section, so a later change to
 * the model shows the version as stale and names the sections that changed.
 */
import { createHash } from 'crypto';

import { canonicalJson, packRegistry } from '../packs/pack-loader';

export type CardStatus = 'DRAFT' | 'FINAL';
export const CARD_STATUSES: readonly CardStatus[] = ['DRAFT', 'FINAL'];

export interface CardField {
  key: string;
  label: string;
  value: any;
  required: boolean;
  filled: boolean;
  /** Where in the console the field is completed. */
  fix?: string;
}

export interface CardFrameworkRef {
  pack_id: string;
  pack_name: string;
  clauses: string[];
}

export interface CardSection {
  id: string;
  title: string;
  controls: string[];
  frameworks: CardFrameworkRef[];
  fields: CardField[];
}

export interface CardReadiness {
  percent: number;
  required_met: number;
  required_total: number;
  recommended_met: number;
  recommended_total: number;
  missing_required: Array<{ section: string; key: string; label: string; fix?: string }>;
  missing_recommended: Array<{ section: string; key: string; label: string; fix?: string }>;
  /** Findings from the existing gates that block a FINAL version. */
  gate_blockers: Array<{ code: string; message: string }>;
  gate_warnings: Array<{ code: string; message: string }>;
  final_allowed: boolean;
  /** Why FINAL is refused, in words, one line per reason. */
  final_blockers: string[];
}

export interface CardContent {
  schema: 'sentrai.model-card/1';
  model_id: string;
  model_name: string;
  organisation: string | null;
  project: string | null;
  packs_in_scope: Array<{ pack_id: string; name: string; version: string }>;
  sections: CardSection[];
  section_hashes: Record<string, string>;
}

/** Everything the card is generated from, gathered by the service. */
export interface CardFacts {
  model: {
    id: string;
    name: string;
    modelType: string;
    functionalArea: string;
    useCaseDescription: string;
    targetCustomerSegments: string[];
    riskLevel: string;
    lifecycleStage: string;
    ownerTeam: string;
    developedBy: string;
    deploymentDate: Date | string | null;
    dependencies: any[];
    performanceBenchmarks: any[];
    humanOversightRequired: boolean;
    autonomousScope: string | null;
    boardPolicyRef: string;
    lastRedTeamDate: Date | string | null;
    nextAuditDue: Date | string | null;
    grievanceCount: number;
    sourceRefs: string[];
    evidenceArtifacts: Array<{ type: string; ref: string; description?: string; added_at: string }>;
    riskRationale: string | null;
    registeredAt: Date | string;
    operationalState: string;
    energyKwh: number | null;
    co2eKg: number | null;
  };
  organisation: string | null;
  project: string | null;
  /** Pack ids that apply to the organisation. */
  packIds: string[];
  /** In-scope framework verdicts: name, pass, open gaps. */
  compliance: Array<{ framework: string; pass: boolean; gaps: number }>;
  /** Transparency-card governance fields (limitations, out-of-scope uses, residual risks), when their flags are on. */
  governance: Record<string, any>;
  datasets: Array<{ name: string; purpose: string; personal_data: boolean; provenance: string | null }>;
  approvals: Array<{ target_stage: string; status: string; resolved_at: string | null }>;
  validations: Array<{ version: number; status: string; result: string | null; independent: boolean }>;
  drift: string | null;
  incidents: { total: number; open: number };
}

const EVAL_EVIDENCE = new Set(['behavioral_eval', 'bias_test', 'bias_test_report', 'fairness_test', 'benchmark', 'red_team', 'validation_report', 'eval']);

const filledText = (v: unknown, min = 1) => typeof v === 'string' && v.trim().length >= min;
const filledList = (v: unknown) => Array.isArray(v) && v.length > 0;
const LIVE_STAGES = ['DEPLOYED', 'MONITORING'];
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const sha = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');

interface SectionSpec {
  id: string;
  title: string;
  controls: string[];
  fields: (f: CardFacts, fix: (tab: string) => string) => CardField[];
}

const field = (key: string, label: string, value: any, required: boolean, filled: boolean, fix?: string): CardField => ({ key, label, value, required, filled, ...(fix ? { fix } : {}) });

/** The card's sections, in order. Controls are common-library ids; clauses come from the packs. */
export const CARD_SECTIONS: SectionSpec[] = [
  {
    id: 'details',
    title: 'Model details',
    controls: ['CTL-ACC-01', 'CTL-OWNER-01', 'CTL-DOC-01', 'CTL-DOC-02'],
    fields: (f, fix) => {
      const m = f.model;
      const owned = filledText(m.ownerTeam) && !m.ownerTeam.toLowerCase().includes('unassigned');
      return [
        field('name', 'Name', m.name, true, filledText(m.name)),
        field('model_type', 'Model type', m.modelType, true, filledText(m.modelType)),
        field('functional_area', 'Functional area', m.functionalArea, true, filledText(m.functionalArea)),
        field('owner_team', 'Accountable owner', owned ? m.ownerTeam : null, true, owned, fix('overview')),
        field('developed_by', 'Developed by', m.developedBy || null, false, filledText(m.developedBy), fix('overview')),
        field('lifecycle_stage', 'Lifecycle stage', m.lifecycleStage, false, filledText(m.lifecycleStage)),
        // Filled on promotion to DEPLOYED, or entered on the model page; not expected before the model goes live.
        field('deployment_date', 'Deployment date', m.deploymentDate ? iso(m.deploymentDate) : LIVE_STAGES.includes(m.lifecycleStage) ? null : 'Not deployed yet', false, Boolean(m.deploymentDate) || !LIVE_STAGES.includes(m.lifecycleStage), fix('overview')),
        field('registered_at', 'Registered', iso(m.registeredAt), false, true),
        field('model_id', 'Record id', m.id, false, true),
      ];
    },
  },
  {
    id: 'intended_use',
    title: 'Intended use',
    controls: ['CTL-CTX-01', 'CTL-CTX-02', 'CTL-CTX-03', 'CTL-HUM-01', 'CTL-AUTO-01', 'CTL-INFO-01'],
    fields: (f, fix) => {
      const m = f.model;
      const g = f.governance;
      return [
        field('purpose', 'Purpose and use case', m.useCaseDescription || null, true, filledText(m.useCaseDescription, 20), fix('overview')),
        field('intended_users', 'Intended users', g.intended_users ?? [], false, filledList(g.intended_users), fix('risk')),
        field('target_segments', 'Affected customer segments', m.targetCustomerSegments ?? [], false, filledList(m.targetCustomerSegments), fix('overview')),
        field('out_of_scope_uses', 'Out-of-scope uses', g.out_of_scope_uses ?? [], false, filledList(g.out_of_scope_uses), fix('risk')),
        field('human_oversight', 'Human oversight', m.humanOversightRequired ? 'A person reviews outputs before they are acted on' : 'Autonomous within a declared scope', true, true),
        field('autonomous_scope', 'Autonomous scope', m.autonomousScope || null, !m.humanOversightRequired, m.humanOversightRequired || filledText(m.autonomousScope, 10), fix('overview')),
      ];
    },
  },
  {
    id: 'risk',
    title: 'Risk and impact',
    controls: ['CTL-RISK-01', 'CTL-RISK-02', 'CTL-IMPACT-01', 'CTL-US-HIGHIMPACT', 'CTL-PRIV-01'],
    fields: (f, fix) => {
      const g = f.governance;
      return [
        field('risk_tier', 'Risk tier', f.model.riskLevel, true, filledText(f.model.riskLevel)),
        field('risk_rationale', 'Why this tier', f.model.riskRationale || null, true, filledText(f.model.riskRationale, 20), fix('overview')),
        field('known_limitations', 'Known limitations', g.known_limitations ?? [], false, filledList(g.known_limitations), fix('risk')),
        field('residual_risks', 'Residual risks', (g.residual_risks ?? []).map((r: any) => `${r.title} (${r.residual_band}, ${r.status})`), false, filledList(g.residual_risks), fix('risk')),
      ];
    },
  },
  {
    id: 'data',
    title: 'Data and provenance',
    controls: ['CTL-DATA-01', 'CTL-DATA-02', 'CTL-PROV-01'],
    fields: (f, fix) => [
      field('datasets', 'Datasets', f.datasets.map((d) => `${d.name} (${d.purpose}${d.personal_data ? ', personal data' : ''})`), false, f.datasets.length > 0, fix('data')),
      field('dependencies', 'Dependencies', (f.model.dependencies ?? []).map((d: any) => (typeof d === 'string' ? d : d?.name ?? JSON.stringify(d))), false, filledList(f.model.dependencies)),
      field('source_refs', 'Source code', f.model.sourceRefs ?? [], false, filledList(f.model.sourceRefs)),
    ],
  },
  {
    id: 'evaluation',
    title: 'Evaluation and testing',
    controls: ['CTL-PERF-01', 'CTL-FAIR-01', 'CTL-SEC-01', 'CTL-SEC-AI-01', 'CTL-TEVV-01', 'CTL-VAL-01', 'CTL-MON-01'],
    fields: (f, fix) => {
      const m = f.model;
      const evidence = (m.evidenceArtifacts ?? []).filter((e) => EVAL_EVIDENCE.has(String(e.type).toLowerCase()));
      const benchmarks = (m.performanceBenchmarks ?? []).map((b: any) => (typeof b === 'string' ? b : [b?.metric ?? b?.name, b?.value].filter((x) => x !== undefined).join(': ') || JSON.stringify(b)));
      return [
        field('evaluation_evidence', 'Evaluation evidence', [...evidence.map((e) => `${e.type}: ${e.ref}`), ...benchmarks], true, evidence.length > 0 || benchmarks.length > 0, fix('overview')),
        field('last_red_team', 'Last red team', iso(m.lastRedTeamDate), false, Boolean(m.lastRedTeamDate), fix('overview')),
        field('validations', 'Independent validation', f.validations.map((v) => `v${v.version} ${v.status}${v.result ? ` (${v.result})` : ''}${v.independent ? ', independent' : ''}`), false, f.validations.length > 0, fix('risk')),
      ];
    },
  },
  {
    id: 'governance',
    title: 'Governance and compliance',
    controls: ['CTL-POL-01', 'CTL-ORG-POLICY', 'CTL-AUD-01'],
    fields: (f, fix) => [
      field('board_policy_ref', 'Board-approved AI policy', f.model.boardPolicyRef || null, true, filledText(f.model.boardPolicyRef), fix('overview')),
      field('next_audit_due', 'Next audit due', iso(f.model.nextAuditDue), false, Boolean(f.model.nextAuditDue)),
      field('approvals', 'Deployment approvals', f.approvals.map((a) => `${a.target_stage}: ${a.status}${a.resolved_at ? ` (${iso(a.resolved_at)})` : ''}`), false, f.approvals.length > 0, fix('approvals')),
      field('compliance', 'Framework verdicts (enabled packs)', f.compliance.map((c) => `${c.framework}: ${c.pass ? 'compliant' : `${c.gaps} open gap${c.gaps === 1 ? '' : 's'}`}`), false, true),
    ],
  },
  {
    id: 'operations',
    title: 'Monitoring and operations',
    controls: ['CTL-MON-02', 'CTL-INC-01', 'CTL-INC-02', 'CTL-BCP-01', 'CTL-ENERGY-01', 'CTL-REC-01'],
    fields: (f, fix) => [
      field('operational_state', 'Operational state', f.model.operationalState, false, true),
      field('drift', 'Latest drift status', f.drift, false, Boolean(f.drift), fix('operations')),
      field('incidents', 'Incidents', `${f.incidents.total} reported, ${f.incidents.open} open`, false, true),
      field('grievances', 'Consumer grievances', String(f.model.grievanceCount ?? 0), false, true),
      field('energy', 'Energy and emissions', f.model.energyKwh != null ? `${f.model.energyKwh.toFixed(3)} kWh, ${(f.model.co2eKg ?? 0).toFixed(3)} kg CO2e` : null, false, f.model.energyKwh != null, fix('operations')),
    ],
  },
];

/** Clauses of the packs in scope that map to these controls, per pack. */
export function frameworkRefs(controls: string[], packIds: string[], at: Date = new Date()): CardFrameworkRef[] {
  const out: CardFrameworkRef[] = [];
  for (const p of packRegistry().activeAt(at)) {
    if (!packIds.includes(p.definition.id)) continue;
    const clauses = [...new Set(p.definition.clauses.filter((c) => controls.includes(c.control)).map((c) => c.clause ?? c.code))];
    if (clauses.length) out.push({ pack_id: p.definition.id, pack_name: p.definition.name, clauses });
  }
  return out;
}

/** Generate the live card content from the facts. */
export function buildCard(facts: CardFacts, at: Date = new Date()): CardContent {
  const fix = (tab: string) => `#/model?id=${encodeURIComponent(facts.model.id)}&tab=${tab}`;
  const sections = CARD_SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    controls: s.controls,
    frameworks: frameworkRefs(s.controls, facts.packIds, at),
    fields: s.fields(facts, fix),
  }));
  const section_hashes = Object.fromEntries(sections.map((s) => [s.id, sha(s.fields.map((x) => [x.key, x.value]))]));
  const packs = packRegistry().activeAt(at).filter((p) => facts.packIds.includes(p.definition.id));
  return {
    schema: 'sentrai.model-card/1',
    model_id: facts.model.id,
    model_name: facts.model.name,
    organisation: facts.organisation,
    project: facts.project,
    packs_in_scope: packs.map((p) => ({ pack_id: p.definition.id, name: p.definition.name, version: p.definition.version })),
    sections,
    section_hashes,
  };
}

/** Hash of a card's content (stable across key order). */
export function cardHash(content: CardContent): string {
  return sha({ packs: content.packs_in_scope.map((p) => `${p.pack_id}@${p.version}`), sections: content.section_hashes });
}

/** Readiness of a live card, with the existing gates' findings. */
export function readiness(content: CardContent, gate: { block: Array<{ code: string; message: string }>; warn: Array<{ code: string; message: string }> } | null): CardReadiness {
  const missingReq: CardReadiness['missing_required'] = [];
  const missingRec: CardReadiness['missing_recommended'] = [];
  let reqTotal = 0, reqMet = 0, recTotal = 0, recMet = 0;
  for (const s of content.sections) {
    for (const f of s.fields) {
      const row = { section: s.title, key: f.key, label: f.label, ...(f.fix ? { fix: f.fix } : {}) };
      if (f.required) {
        reqTotal++;
        if (f.filled) reqMet++;
        else missingReq.push(row);
      } else {
        recTotal++;
        if (f.filled) recMet++;
        else missingRec.push(row);
      }
    }
  }
  // Required fields weigh twice as much as recommended ones.
  const percent = Math.round(((reqMet * 2 + recMet) / Math.max(1, reqTotal * 2 + recTotal)) * 100);
  const blockers = gate?.block ?? [];
  const final_blockers = [
    ...missingReq.map((m) => `Required: ${m.label} (${m.section})`),
    ...blockers.map((b) => `Gate: ${b.message}`),
  ];
  return {
    percent,
    required_met: reqMet,
    required_total: reqTotal,
    recommended_met: recMet,
    recommended_total: recTotal,
    missing_required: missingReq,
    missing_recommended: missingRec,
    gate_blockers: blockers,
    gate_warnings: gate?.warn ?? [],
    final_allowed: final_blockers.length === 0,
    final_blockers,
  };
}

/** Sections whose content differs between a frozen version and the live card. */
export function changedSections(frozen: CardContent, live: CardContent): string[] {
  const out: string[] = [];
  for (const s of live.sections) if (frozen.section_hashes?.[s.id] !== live.section_hashes[s.id]) out.push(s.title);
  const packsBefore = (frozen.packs_in_scope ?? []).map((p) => `${p.pack_id}@${p.version}`).sort().join(',');
  const packsNow = live.packs_in_scope.map((p) => `${p.pack_id}@${p.version}`).sort().join(',');
  if (packsBefore !== packsNow) out.push('Frameworks in scope');
  return out;
}

const show = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join('; ') : '—';
  return String(v);
};

/** Header facts shared by the Markdown and PDF exports. */
export interface CardExportMeta {
  status: CardStatus | 'LIVE DRAFT';
  version: number | null;
  generated_at: string;
  created_by?: string | null;
  content_hash: string;
  stale?: boolean;
  changed_sections?: string[];
  readiness?: CardReadiness | null;
}

/** The card as Markdown. */
export function cardMarkdown(c: CardContent, meta: CardExportMeta): string {
  // Field values may carry Markdown (bold, italic, lists). A table cell holds
  // one line, so paragraphs and list items become <br> breaks, which GitHub
  // and most viewers render; inline emphasis is kept as written.
  const esc = (t: string) => t.replace(/\|/g, '\\|').replace(/\r\n?/g, '\n').trim()
    .replace(/\n\s*\n+/g, '<br><br>').replace(/\n\s*(?=[-*+•]\s|\d{1,3}[.)]\s)/g, '<br>').replace(/\n/g, ' ');
  const lines: string[] = [];
  lines.push(`# Model card: ${c.model_name}`, '');
  lines.push(`**Status:** ${meta.status}${meta.version ? ` (version ${meta.version})` : ''}  `);
  if (c.organisation) lines.push(`**Organisation:** ${c.organisation}${c.project ? ` · ${c.project}` : ''}  `);
  lines.push(`**Generated:** ${meta.generated_at}${meta.created_by ? ` by ${meta.created_by}` : ''}  `);
  lines.push(`**Frameworks in scope:** ${c.packs_in_scope.map((p) => `${p.name} v${p.version}`).join('; ') || '—'}  `);
  lines.push(`**Content hash:** \`${meta.content_hash}\``, '');
  if (meta.status !== 'FINAL') lines.push('> DRAFT: not a final model card. It has not passed the required-field and gate checks for a final version.', '');
  if (meta.stale) lines.push(`> STALE: the model has changed since this version was frozen (${(meta.changed_sections ?? []).join(', ')}).`, '');
  if (meta.readiness) lines.push(`Readiness: ${meta.readiness.percent}% (${meta.readiness.required_met}/${meta.readiness.required_total} required, ${meta.readiness.recommended_met}/${meta.readiness.recommended_total} recommended)`, '');
  for (const s of c.sections) {
    lines.push(`## ${s.title}`, '');
    if (s.frameworks.length) lines.push(`_Maps to: ${s.frameworks.map((f) => `${f.pack_name} ${f.clauses.join(', ')}`).join(' · ')}_`, '');
    lines.push('| Field | Value |', '|---|---|');
    for (const f of s.fields) lines.push(`| ${esc(f.label)}${f.required ? ' *' : ''} | ${esc(show(f.value))} |`);
    lines.push('');
  }
  lines.push('\\* required for a final version.', '');
  lines.push('Generated by SentRAI from the model record and its governance registers. A model card documents the system; it is not a certification.');
  return lines.join('\n') + '\n';
}

export { show as showCardValue };
