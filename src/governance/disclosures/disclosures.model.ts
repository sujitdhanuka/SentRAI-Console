/**
 * Disclosure and regulator-export builders (E3.2). Pure functions over plain
 * rows so every export's field list can be tested for completeness.
 *
 *  - Transparency statement (AU DTA policy SO-1, ISO A.8.5, RBI Rec 25)
 *  - RBI inspection export (Rec 23 / Rec 25 supervisory access)
 *  - OMB AI use case inventory (M-25-21 s.3(a)(iv), M21-3)
 *  - Colorado developer disclosure package (CO-1) and material-update notices to deployers
 */
import { createHash } from 'crypto';

export const DISCLOSURE_KINDS = ['TRANSPARENCY_STATEMENT', 'CO_DEVELOPER', 'CO_UPDATE_NOTICE', 'RBI_INSPECTION', 'OMB_INVENTORY'] as const;
export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number];

export interface ModelRow {
  id: string;
  name: string;
  modelType: string;
  functionalArea: string;
  useCaseDescription: string;
  riskLevel: string;
  lifecycleStage: string;
  ownerTeam: string;
  ownerName: string | null;
  developedBy: string;
  humanOversightRequired: boolean;
  boardPolicyRef: string;
  lastRedTeamDate: Date | null;
  nextAuditDue: Date | null;
  deploymentDate: Date | null;
  targetCustomerSegments: string[];
  contextProfile: Record<string, any> | null;
  energyKwh: number | null;
  co2eKg: number | null;
}

export interface ModelExtras {
  incidents: { total: number; open: number; serious: number };
  grievances: { total: number; open: number };
  audits: { total: number; lastVerdict: string | null; lastAt: Date | null };
  drift: { reports: number };
  bcp: { configured: boolean; lastDrill: Date | null };
  highImpact: boolean | null;
  impactAssessment: string | null;
  validation: string | null;
  datasets: Array<{ name: string; purpose: string; personalData: boolean; lawfulBasis: string | null; provenance: string | null }>;
  risks: Array<{ title: string; category: string; status: string; treatment: string | null }>;
}

const d = (x: Date | string | null | undefined) => (x ? new Date(x).toISOString().slice(0, 10) : '');

function tally<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || 'not recorded';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/* ------------------------------------------------------- transparency statement */

export interface TransparencyInputs {
  organisation: string;
  periodStart: Date;
  periodEnd: Date;
  models: ModelRow[];
  grievances: Array<{ category: string; status: string; createdAt: Date; resolvedAt: Date | null }>;
  incidents: Array<{ severity: string; status: string; createdAt: Date; seniorSignOffAt?: Date | null; affectedPartiesNotifiedAt?: Date | null }>;
  accountableOfficial: string | null;
  policyApprovedAt: string | null;
  energy: boolean;
  narrative?: Record<string, string>;
}

export const TRANSPARENCY_NARRATIVE = ['intentions', 'monitoring', 'compliance', 'contact'] as const;

export function buildTransparencyStatement(i: TransparencyInputs) {
  const live = i.models.filter((m) => m.lifecycleStage !== 'DECOMMISSIONED');
  const inPeriod = <T extends { createdAt: Date }>(rows: T[]) => rows.filter((r) => r.createdAt >= i.periodStart && r.createdAt <= i.periodEnd);
  const g = inPeriod(i.grievances);
  const inc = inPeriod(i.incidents);
  const resolved = g.filter((x) => x.resolvedAt);
  const days = resolved.map((x) => (x.resolvedAt!.getTime() - x.createdAt.getTime()) / 86_400_000).sort((a, b) => a - b);
  const median = days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : null;
  const content: Record<string, any> = {
    organisation: i.organisation,
    period: { start: d(i.periodStart), end: d(i.periodEnd) },
    narrative: Object.fromEntries(TRANSPARENCY_NARRATIVE.map((k) => [k, i.narrative?.[k] ?? ''])),
    ai_use: {
      systems: live.length,
      by_usage_pattern: tally(live, (m) => m.contextProfile?.dtaUsagePattern),
      by_domain: tally(live, (m) => m.contextProfile?.dtaDomain ?? m.functionalArea),
      by_risk: tally(live, (m) => m.riskLevel),
      with_human_oversight: live.filter((m) => m.humanOversightRequired).length,
      public_facing: live.filter((m) => (m.targetCustomerSegments ?? []).length > 0).length,
    },
    systems: live.map((m) => ({
      name: m.name, purpose: m.useCaseDescription, usage_pattern: m.contextProfile?.dtaUsagePattern ?? null,
      domain: m.contextProfile?.dtaDomain ?? m.functionalArea, risk: m.riskLevel, human_oversight: m.humanOversightRequired, stage: m.lifecycleStage,
    })),
    governance: { accountable_official: i.accountableOfficial, ai_policy_approved: i.policyApprovedAt },
    grievances: { received: g.length, resolved: resolved.length, median_days_to_resolve: median, by_category: tally(g, (x) => x.category) },
    incidents: { total: inc.length, by_severity: tally(inc, (x) => x.severity), serious_closed_with_sign_off: inc.filter((x) => ['P1_CRITICAL', 'P2_HIGH'].includes(x.severity) && x.seniorSignOffAt).length },
  };
  if (i.energy) {
    const measured = live.filter((m) => m.energyKwh !== null && m.energyKwh !== undefined);
    content.energy = {
      systems_measured: measured.length,
      kwh: Math.round(measured.reduce((a, m) => a + (m.energyKwh ?? 0), 0) * 1000) / 1000,
      co2e_kg: Math.round(measured.reduce((a, m) => a + (m.co2eKg ?? 0), 0) * 1000) / 1000,
    };
  }
  return content;
}

/** Narrative sections still empty (all must be written before publishing). */
export function transparencyGaps(content: Record<string, any>): string[] {
  return TRANSPARENCY_NARRATIVE.filter((k) => !String(content.narrative?.[k] ?? '').trim());
}

/* ------------------------------------------------------- RBI inspection export */

export const RBI_FIELDS = [
  { key: 'model_id', label: 'Model ID' }, { key: 'name', label: 'Name' }, { key: 'model_type', label: 'Type' },
  { key: 'functional_area', label: 'Functional area' }, { key: 'purpose', label: 'Purpose' }, { key: 'risk_tier', label: 'Risk tier' },
  { key: 'lifecycle', label: 'Lifecycle stage' }, { key: 'owner_team', label: 'Owner team' }, { key: 'named_owner', label: 'Named owner' },
  { key: 'developed_by', label: 'Developed by' }, { key: 'human_oversight', label: 'Human oversight' }, { key: 'board_policy_ref', label: 'Board policy reference' },
  { key: 'last_red_team', label: 'Last red team' }, { key: 'audits', label: 'Audits' }, { key: 'last_audit_verdict', label: 'Last audit verdict' },
  { key: 'next_audit_due', label: 'Next audit due' }, { key: 'incidents_total', label: 'Incidents' }, { key: 'incidents_open', label: 'Open incidents' },
  { key: 'grievances_total', label: 'Grievances' }, { key: 'grievances_open', label: 'Open grievances' }, { key: 'drift_reports', label: 'Drift reports' },
  { key: 'bcp_configured', label: 'BCP fallback configured' }, { key: 'last_bcp_drill', label: 'Last BCP drill' }, { key: 'datasets', label: 'Registered datasets' },
] as const;

export function rbiInspectionRows(models: ModelRow[], extras: Map<string, ModelExtras>) {
  return models.map((m) => {
    const x = extras.get(m.id)!;
    return {
      model_id: m.id, name: m.name, model_type: m.modelType, functional_area: m.functionalArea, purpose: m.useCaseDescription,
      risk_tier: m.riskLevel, lifecycle: m.lifecycleStage, owner_team: m.ownerTeam, named_owner: m.ownerName ?? '',
      developed_by: m.developedBy, human_oversight: m.humanOversightRequired ? 'Yes' : 'No', board_policy_ref: m.boardPolicyRef || '',
      last_red_team: d(m.lastRedTeamDate), audits: x.audits.total, last_audit_verdict: x.audits.lastVerdict ?? '', next_audit_due: d(m.nextAuditDue),
      incidents_total: x.incidents.total, incidents_open: x.incidents.open, grievances_total: x.grievances.total, grievances_open: x.grievances.open,
      drift_reports: x.drift.reports, bcp_configured: x.bcp.configured ? 'Yes' : 'No', last_bcp_drill: d(x.bcp.lastDrill), datasets: x.datasets.length,
    };
  });
}

/* ------------------------------------------------------- OMB use case inventory */

export const OMB_FIELDS = [
  { key: 'use_case_id', label: 'Use case ID' }, { key: 'use_case_name', label: 'Use case name' }, { key: 'organisation', label: 'Agency / organization' },
  { key: 'topic_area', label: 'Topic area' }, { key: 'purpose_benefits', label: 'Purpose and expected benefits' }, { key: 'outputs', label: 'AI system outputs' },
  { key: 'stage', label: 'Stage of development' }, { key: 'high_impact', label: 'High-impact AI (M-25-21)' }, { key: 'impact_assessment', label: 'AI impact assessment' },
  { key: 'independent_evaluation', label: 'Independent evaluation' }, { key: 'ongoing_monitoring', label: 'Ongoing monitoring' },
  { key: 'human_oversight', label: 'Human oversight' }, { key: 'remedy', label: 'Appeal / remedy process' }, { key: 'developed', label: 'Developed in-house or acquired' },
  { key: 'deployment_date', label: 'Deployment date' },
] as const;

export function ombStage(stage: string): string {
  return ({ DESIGN: 'Initiated', DEVELOPMENT: 'Acquisition and/or Development', VALIDATION: 'Acquisition and/or Development', DEPLOYED: 'Operation and Maintenance', MONITORING: 'Operation and Maintenance', DECOMMISSIONED: 'Retired' } as Record<string, string>)[stage] ?? stage;
}

export function ombInventoryRows(organisation: string, models: ModelRow[], extras: Map<string, ModelExtras>) {
  return models.map((m) => {
    const x = extras.get(m.id)!;
    const p = m.contextProfile ?? {};
    return {
      use_case_id: m.id, use_case_name: m.name, organisation, topic_area: m.functionalArea,
      purpose_benefits: [m.useCaseDescription, p.benefits].filter(Boolean).join(' Benefits: '),
      outputs: p.outputs ?? p.intendedOutputs ?? '', stage: ombStage(m.lifecycleStage),
      high_impact: x.highImpact === null ? 'Not determined' : x.highImpact ? 'Yes' : 'No',
      impact_assessment: x.impactAssessment ?? 'None', independent_evaluation: x.validation ?? 'None',
      ongoing_monitoring: x.drift.reports > 0 ? 'Yes' : 'No', human_oversight: m.humanOversightRequired ? 'Yes' : 'No',
      remedy: 'Yes (grievance and appeal channel)', developed: /vendor|third|external/i.test(m.developedBy ?? '') ? 'Acquired' : 'In-house',
      deployment_date: d(m.deploymentDate),
    };
  });
}

/* ------------------------------------------------------- Colorado developer package */

export function buildDeveloperDisclosure(m: ModelRow, x: ModelExtras, deployers: Array<{ name: string }>) {
  const p = m.contextProfile ?? {};
  return {
    system: { id: m.id, name: m.name, type: m.modelType, risk: m.riskLevel },
    purpose: m.useCaseDescription,
    intended_benefits: p.benefits ?? null,
    intended_uses: p.intendedUsers ?? [],
    known_harmful_or_inappropriate_uses: p.outOfScopeUses ?? [],
    known_limitations: p.knownLimitations ?? [],
    training_data: x.datasets.map((ds) => ({ name: ds.name, purpose: ds.purpose, personal_data: ds.personalData, lawful_basis: ds.lawfulBasis, provenance: ds.provenance })),
    evaluation: { validation: x.validation, impact_assessment: x.impactAssessment, audits: x.audits.total, last_audit_verdict: x.audits.lastVerdict },
    discrimination_risks: x.risks.filter((r) => r.category === 'FAIRNESS').map((r) => ({ title: r.title, status: r.status, treatment: r.treatment })),
    mitigations: x.risks.filter((r) => r.treatment).map((r) => ({ title: r.title, treatment: r.treatment })),
    use_and_monitoring: { human_oversight: m.humanOversightRequired, oversight_pattern: p.oversightPattern ?? null, operator: p.operator ?? null },
    deployers: deployers.map((dp) => dp.name),
  };
}

/** Sections of a developer disclosure that are still empty (shown as gaps, never invented). */
export function developerGaps(c: ReturnType<typeof buildDeveloperDisclosure>): string[] {
  const gaps: string[] = [];
  if (!c.known_harmful_or_inappropriate_uses.length) gaps.push('known harmful or inappropriate uses');
  if (!c.known_limitations.length) gaps.push('known limitations');
  if (!c.training_data.length) gaps.push('training data summary');
  if (!c.evaluation.validation && !c.evaluation.impact_assessment) gaps.push('performance and discrimination evaluation');
  return gaps;
}

export function contentHash(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
