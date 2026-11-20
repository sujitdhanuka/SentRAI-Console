/**
 * Model card v2: maps a v1 record (the ai_models row and what the v1 card
 * showed) onto catalogue fields (spec §13). Pure, so the dry run and the real
 * run share it and the golden fixture tests it directly.
 *
 * - Every mapped value has provenance IMPORTED_V1 and is NOT accepted.
 * - The record type is a CODE_SCAN value, also unaccepted (decision 3).
 * - v1 AI text is kept verbatim as the imported value; a cleaned copy is
 *   offered as a suggestion where AI may draft the field.
 * - Personal data becomes UNKNOWN. Counts that v1 showed as 0 are not
 *   imported, because v1 could not tell "none recorded" from "no data".
 * - The risk tier is kept but flagged REQUIRES_REASSESSMENT; framework
 *   verdicts become NOT_ASSESSED, the old verdict kept for history.
 */
import { sanitiseSuggestion } from '../../../../summarizer/sanitise';
import { fieldDef } from '../catalogue';
import { checkConsistency, ConsistencyFinding } from '../consistency';
import { emptyField, FieldValue, suggest, systemValue } from '../field-state';
import { checkOwner, OwnerCandidate, OwnerCheck } from '../owners';
import { ComponentLifecycle, DeploymentStatus, ModelLifecycle, OperationalStatus, RecordType, suggestRecordType } from '../record-types';

export interface V1Record {
  id: string;
  name: string;
  modelType: string;
  functionalArea: string;
  useCaseDescription: string | null;
  descriptionSource: string | null;
  targetCustomerSegments: string[];
  riskLevel: string;
  riskRationale: string | null;
  riskRationaleSource: string | null;
  lifecycleStage: string;
  operationalState: string;
  deploymentDate: string | null;
  ownerTeam: string;
  ownerUserId: string | null;
  developedBy: string | null;
  humanOversightRequired: boolean;
  autonomousScope: string | null;
  dependencies: any[];
  sourceRefs: string[];
  detectionSignals: string[];
  detectedTools: string[];
  boardPolicyRef: string | null;
  lastRedTeamDate: string | null;
  nextAuditDue: string | null;
  grievanceCount: number;
  energyKwh: number | null;
  registeredAt: string;
}

export interface V1Context {
  record: V1Record;
  orgId: string | null;
  owner: OwnerCandidate | null;
  /** Any linked dataset is marked as holding personal data. */
  datasetPersonalData: boolean;
  /** Framework verdicts the v1 card showed ("compliant" or open gaps). */
  verdicts: Array<{ framework: string; pass: boolean; gaps: number }>;
  /** Transparency-card fields v1 read through the governance hook. */
  governance?: { intended_users?: string[]; out_of_scope_uses?: string[]; known_limitations?: string[] };
}

export interface MigrationPlan {
  model_id: string;
  model_name: string;
  record_type: { value: RecordType | null; reasons: string[] };
  fields: FieldValue[];
  consistency: ConsistencyFinding[];
  owner: OwnerCheck & { v1_owner_text: string };
  risk: { imported_tier: string | null; status: 'REQUIRES_REASSESSMENT'; reasons: string[] };
  verdicts_reset: Array<{ framework: string; v1_verdict: string; v2_status: 'NOT_ASSESSED' }>;
  notes: string[];
}

const LIVE = ['DEPLOYED', 'MONITORING'];
const COMPONENT_OF: Record<string, ComponentLifecycle> = {
  DESIGN: 'PLANNED', DEVELOPMENT: 'IN_DEVELOPMENT', VALIDATION: 'IN_TEST', DEPLOYED: 'RELEASED', MONITORING: 'RELEASED', DECOMMISSIONED: 'RETIRED',
};
const CATEGORY_OF: Record<string, string> = { MACHINE_LEARNING: 'TRADITIONAL_ML', DEEP_LEARNING: 'DEEP_LEARNING', GENERATIVE_AI: 'GENERATIVE', AGENT: 'AGENTIC_COMPONENT' };
const TIERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RECORD_TYPES_WITH_MODEL_LIFECYCLE: RecordType[] = ['AI_MODEL', 'AI_SYSTEM', 'AGENT'];
const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined);
const day = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export function planV1Migration(ctx: V1Context, at: Date): MigrationPlan {
  const m = ctx.record;
  const fields = new Map<string, FieldValue>();
  const notes: string[] = [];
  const put = (id: string, value: any, source: string, provenance: 'IMPORTED_V1' | 'CODE_SCAN' = 'IMPORTED_V1') => {
    if (!filled(value)) return;
    const def = fieldDef(id)!;
    const v = systemValue(fields.get(id) ?? emptyField(id), def, value, provenance === 'CODE_SCAN' ? 'IMPORTED_V1' : provenance, source, at);
    fields.set(id, provenance === 'CODE_SCAN' ? { ...v, provenance: 'CODE_SCAN', entered_by: 'code-scan' } : v);
  };

  // Record type and model category: code-scan values, unaccepted.
  const rt = suggestRecordType({ name: m.name, modelType: m.modelType, sourceRefs: m.sourceRefs, detectionSignals: m.detectionSignals, detectedTools: m.detectedTools });
  put('record_type', rt.type, `scan: ${m.sourceRefs[0] ?? m.name}`, 'CODE_SCAN');
  const category = rt.type === 'MODEL_CONFIGURATION' ? 'NOT_A_MODEL' : CATEGORY_OF[m.modelType] ?? null;
  put('model_category', category, `scan: v1 modelType ${m.modelType}`, 'CODE_SCAN');
  if (m.modelType) notes.push(`v1 type ${m.modelType} is kept as a detection signal, not as the record type.`);

  put('name', m.name, 'ai_models.name');
  put('developer', m.developedBy, 'ai_models.developedBy');
  put('affected_segments', m.targetCustomerSegments, 'ai_models.targetCustomerSegments');
  put('intended_users', ctx.governance?.intended_users, 'governance.intended_users');
  put('out_of_scope_uses', ctx.governance?.out_of_scope_uses, 'governance.out_of_scope_uses');
  put('known_limitations', ctx.governance?.known_limitations, 'governance.known_limitations');
  put('third_party_services', (m.dependencies ?? []).map((d: any) => (typeof d === 'string' ? d : d?.name ?? JSON.stringify(d))), 'ai_models.dependencies');
  put('automation_boundaries', m.autonomousScope, 'ai_models.autonomousScope');
  put('safety_policies', m.boardPolicyRef ? [m.boardPolicyRef] : [], 'ai_models.boardPolicyRef');
  put('red_team', m.lastRedTeamDate ? `Red team recorded on ${day(m.lastRedTeamDate)}` : null, 'ai_models.lastRedTeamDate');
  put('next_review_date', day(m.nextAuditDue), 'ai_models.nextAuditDue');
  put('inference_energy', m.energyKwh != null ? `${m.energyKwh} kWh (metered)` : null, 'ai_models.energyKwh');
  put('registration_date', day(m.registeredAt), 'ai_models.registeredAt');
  if (m.functionalArea && m.functionalArea !== 'unclassified') notes.push(`v1 functional area: ${m.functionalArea}.`);

  // Purpose and risk rationale: imported verbatim, unaccepted. AI text gets a cleaned suggestion where AI may draft.
  const purposeSrc = `ai_models.useCaseDescription (${m.descriptionSource ?? 'unknown'})`;
  put('purpose', m.useCaseDescription, purposeSrc);
  if (m.useCaseDescription && (m.descriptionSource === 'ai' || m.descriptionSource === 'heuristic')) {
    const clean = sanitiseSuggestion(m.useCaseDescription);
    if (clean.text) fields.set('purpose', suggest(fields.get('purpose')!, fieldDef('purpose')!, { value: clean.text, provenance: 'AI_SUGGESTED', source_ref: purposeSrc, removed: clean.removed }, at));
  }
  put('risk_rationale', m.riskRationale, `ai_models.riskRationale (${m.riskRationaleSource ?? 'unknown'})`);
  if (m.riskRationale && m.riskRationaleSource !== 'human') notes.push('The v1 risk rationale was drafted by AI. A risk rationale must be written by a person.');

  // The four state fields.
  const hasModelLifecycle = !rt.type || RECORD_TYPES_WITH_MODEL_LIFECYCLE.includes(rt.type);
  if (hasModelLifecycle) put('model_lifecycle', m.lifecycleStage, 'ai_models.lifecycleStage');
  else put('component_lifecycle', COMPONENT_OF[m.lifecycleStage] ?? null, `ai_models.lifecycleStage (${m.lifecycleStage})`);
  const deployment: DeploymentStatus = m.deploymentDate || LIVE.includes(m.lifecycleStage) ? 'DEPLOYED_PRODUCTION' : 'NOT_DEPLOYED';
  put('deployment_status', deployment, 'ai_models.deploymentDate / lifecycleStage');
  put('deployment_date', day(m.deploymentDate), 'ai_models.deploymentDate');
  put('operational_status', m.operationalState, 'ai_models.operationalState');
  if (m.operationalState === 'ACTIVE') notes.push('v1 operational state ACTIVE is the column default for every record; confirm it.');
  const consistency = checkConsistency({
    componentLifecycle: hasModelLifecycle ? null : COMPONENT_OF[m.lifecycleStage] ?? null,
    modelLifecycle: hasModelLifecycle ? (m.lifecycleStage as ModelLifecycle) : null,
    deploymentStatus: deployment,
    operationalStatus: m.operationalState as OperationalStatus,
  });

  // Personal data is never inferred; a dataset marked personal is a code-scan suggestion of YES.
  let pd = { ...emptyField('personal_data'), value: 'UNKNOWN', status: 'UNKNOWN' as const, provenance: 'IMPORTED_V1' as const, source_ref: 'v1 had no personal-data field', entered_by: 'v1-migration', entered_at: at.toISOString() };
  if (ctx.datasetPersonalData) pd = suggest(pd, fieldDef('personal_data')!, { value: 'YES', provenance: 'CODE_SCAN', source_ref: 'linked dataset marked personal data', removed: [] }, at) as typeof pd;
  fields.set('personal_data', pd);

  // Owner: a named human only.
  const ownerCheck = m.ownerUserId ? checkOwner(ctx.owner, ctx.orgId) : ({ ok: false, code: 'OWNER_NOT_FOUND', message: 'v1 had no named owner, only a team name.' } as const);
  if (ownerCheck.ok) put('accountable_owner', m.ownerUserId, 'ai_models.ownerUserId');
  if (m.humanOversightRequired) notes.push('v1 said "a person reviews outputs before they are acted on" for every record; oversight must be described for this record type.');
  notes.push('v1 incident and grievance counts are not imported: v1 could not tell "none recorded" from "no data".');

  // Risk tier: kept, flagged for reassessment.
  const tier = TIERS.includes(m.riskLevel) ? m.riskLevel : null;
  put('inherent_risk_tier', tier, 'ai_models.riskLevel');
  const reasons = ['Imported from v1; v1 tiers were not assessed against the v2 risk inputs.'];
  if (rt.type === 'MODEL_CONFIGURATION') reasons.push('A shared configuration that reaches every tenant cannot be LOW without a documented risk acceptance.');
  if (!m.autonomousScope) reasons.push('v1 used a blank autonomous scope as evidence; an empty input never lowers risk.');

  return {
    model_id: m.id,
    model_name: m.name,
    record_type: { value: rt.type, reasons: rt.reasons },
    fields: [...fields.values()],
    consistency,
    owner: { ...ownerCheck, v1_owner_text: m.ownerTeam },
    risk: { imported_tier: tier, status: 'REQUIRES_REASSESSMENT', reasons },
    verdicts_reset: ctx.verdicts.map((v) => ({ framework: v.framework, v1_verdict: v.pass ? 'compliant' : `${v.gaps} open gap(s)`, v2_status: 'NOT_ASSESSED' })),
    notes,
  };
}
