/**
 * Model card v2: reading and changing a card (spec §5–§10). Every rule lives
 * in the pure modules (applicability, field state, controls, risk engine,
 * scores, gate, workflow, reassessment); this service loads the facts, calls
 * them, and writes the result with an append-only ledger event that records
 * who, what, before, after, when and why.
 */
import { createHash } from 'crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../../common/enums';
import { FeatureFlagsService } from '../../../common/feature-flags';
import { CurrentUser } from '../../../common/interfaces/current-user.interface';
import {
  AIModelEntity, AiRecordLinkEntity, CardApprovalEntity, CardControlAssessmentEntity, CardFieldValueEntity, CardRecordEntity, CardVersionEntity,
  ModelLedgerEventEntity, ProjectEntity, RiskAcceptanceEntity, RiskAssessmentEntity, RiskEntity, UserEntity,
} from '../../../database/entities';
import { assertFlag, modelForUser } from '../../governance-access';
import { governanceHooks } from '../../hooks';
import { MAINTAINERS } from '../../phase2-util';
import { cardV2Settings } from '../../settings/settings.model';
import { GovernanceSettingsService } from '../../settings/settings.service';
import { evaluateApplicability } from './applicability/engine';
import { factsFrom } from './applicability/facts';
import { CATALOGUE_VERSION, fieldDef, SECTIONS } from './catalogue';
import { resolveConfiguration, Tier } from './config-resolver';
import { checkConsistency } from './consistency';
import { ControlAssessment, ControlStateError, changeControl, controlViews, frameworkHeading } from './controls';
import {
  acceptImported, acceptSuggestion, attachEvidence, emptyField, enterValue, FieldStateError, FieldValue, markNotApplicable, markUnknown, verify,
} from './field-state';
import { finalisationGate } from './finalisation';
import { checkOwner } from './owners';
import { afterChange } from './reassessment';
import { RECORD_TYPES, RecordType, RELATIONS, Relation, relationAllows } from './record-types';
import { adoptedFromPacks, applicabilityLabel, frameworkApplicability } from './registry/registry';
import { FrameworkRegistryService } from './registry/framework-registry.service';
import { assessRisk, RiskAcceptanceRef } from './risk/engine';
import { controlScore, documentationScore, evidenceScore, regulatoryScore } from './scores';
import { ACTIONS, decide, nextReviewDate, reviewStatus, WorkflowAction, WorkflowState } from './workflow';

const TIERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

function toValue(r: CardFieldValueEntity): FieldValue {
  return {
    field_id: r.fieldId, value: r.value, status: r.status as FieldValue['status'], provenance: (r.provenance as FieldValue['provenance']) ?? null, source_ref: r.sourceRef,
    entered_by: r.enteredBy, entered_at: iso(r.enteredAt), accepted_by: r.acceptedBy, accepted_at: iso(r.acceptedAt), suggestion: r.suggestion ?? null,
    na_justification: r.naJustification, na_decided_by: r.naDecidedBy, evidence_refs: r.evidenceRefs ?? [], verified_by: r.verifiedBy, verified_at: iso(r.verifiedAt),
  };
}
function toAssessment(r: CardControlAssessmentEntity): ControlAssessment {
  return {
    framework_id: r.frameworkId, framework_revision: r.frameworkRevision, control_id: r.controlId, status: r.status as ControlAssessment['status'],
    justification: r.justification, evidence_refs: r.evidenceRefs ?? [], assessed_by: r.assessedBy, assessed_at: iso(r.assessedAt),
    implemented_by: r.implementedBy, verified_by: r.verifiedBy, migrated_from_v1_verdict: r.migratedFromV1Verdict,
  };
}

export type FieldAction = 'SET' | 'UNKNOWN' | 'NOT_APPLICABLE' | 'ACCEPT' | 'ACCEPT_SUGGESTION' | 'ATTACH_EVIDENCE' | 'VERIFY';
const FIELD_ACTIONS: FieldAction[] = ['SET', 'UNKNOWN', 'NOT_APPLICABLE', 'ACCEPT', 'ACCEPT_SUGGESTION', 'ATTACH_EVIDENCE', 'VERIFY'];

@Injectable()
export class CardV2Service {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(CardRecordEntity) private readonly records: Repository<CardRecordEntity>,
    @InjectRepository(CardFieldValueEntity) private readonly values: Repository<CardFieldValueEntity>,
    @InjectRepository(CardControlAssessmentEntity) private readonly controls: Repository<CardControlAssessmentEntity>,
    @InjectRepository(CardApprovalEntity) private readonly approvals: Repository<CardApprovalEntity>,
    @InjectRepository(CardVersionEntity) private readonly versions: Repository<CardVersionEntity>,
    @InjectRepository(AiRecordLinkEntity) private readonly links: Repository<AiRecordLinkEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(RiskEntity) private readonly risks: Repository<RiskEntity>,
    @InjectRepository(RiskAssessmentEntity) private readonly riskAssessments: Repository<RiskAssessmentEntity>,
    @InjectRepository(RiskAcceptanceEntity) private readonly riskAcceptances: Repository<RiskAcceptanceEntity>,
    private readonly registry: FrameworkRegistryService,
    private readonly settings: GovernanceSettingsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  // ---- loading and computing ----

  private async access(user: CurrentUser, modelId: string) {
    assertFlag(this.flags, 'modelCardV2');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new NotFoundException('The record is not in an organisation');
    return { model, orgId };
  }

  private async valueMap(modelId: string): Promise<Record<string, FieldValue>> {
    const rows = await this.values.find({ where: { modelId } });
    return Object.fromEntries(rows.map((r) => [r.fieldId, toValue(r)]));
  }

  private async liveLinks(modelId: string) {
    return this.links.find({ where: { fromModelId: modelId, removedAt: IsNull() } });
  }

  /** The tier a person set on another record's card, or null. */
  private async tierOf(modelId: string): Promise<Tier | null> {
    const v = await this.values.findOne({ where: { modelId, fieldId: 'inherent_risk_tier' } });
    return v && v.acceptedBy && TIERS.includes(v.value) ? (v.value as Tier) : null;
  }

  private async acceptanceFor(orgId: string, ref: unknown, at: Date): Promise<RiskAcceptanceRef | null> {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const risk = await this.risks.findOne({ where: { id: ref.trim(), orgId } });
    if (!risk) return null;
    const latest = await this.riskAssessments.findOne({ where: { riskId: risk.id }, order: { version: 'DESC' } });
    const acc = await this.riskAcceptances.findOne({ where: { riskId: risk.id }, order: { acceptedAt: 'DESC' } });
    if (!acc) return null;
    const valid = risk.status === 'ACCEPTED' && Boolean(latest && acc.assessmentVersion === latest.version) && (!acc.expiresAt || acc.expiresAt.getTime() > at.getTime());
    return { risk_id: risk.id, accepted_by: acc.acceptedBy, accepted_at: acc.acceptedAt.toISOString(), expires_at: iso(acc.expiresAt), conditions: acc.note, valid };
  }

  /** Everything the card shows, computed from stored values. */
  private async compute(model: AIModelEntity, orgId: string, record: CardRecordEntity | null, values: Record<string, FieldValue>, at: Date) {
    const rt = values.record_type?.value;
    const recordType: RecordType | null = (RECORD_TYPES as readonly string[]).includes(rt) ? (rt as RecordType) : null;
    const links = await this.liveLinks(model.id);
    const targets = links.length ? await this.models.find({ where: { id: In([...new Set(links.map((l) => l.toModelId))]) } }) : [];
    const targetCats = links.length
      ? await this.values.find({ where: { modelId: In(links.map((l) => l.toModelId)), fieldId: 'model_category' } })
      : [];
    const generative = ['GENERATIVE', 'FOUNDATION', 'LLM', 'SLM', 'MULTIMODAL'];
    const linkedGen = links.some((l) => ['uses_model', 'selects_model'].includes(l.relation))
      ? targetCats.some((v) => generative.includes(v.value)) || targets.some((t) => t.modelType === 'GENERATIVE_AI')
      : undefined;
    const facts = factsFrom(values, linkedGen === undefined ? {} : { uses_generative: linkedGen });
    const applicability = evaluateApplicability(recordType, facts);

    const s = cardV2Settings((await this.settings.inForce(orgId, at)).settings);
    const current = await this.registry.current();
    const adopted = new Set(s.adoptedFrameworks ?? adoptedFromPacks(current, (await governanceHooks.orgPackIds?.(orgId, at)) ?? null));
    const fwApps = frameworkApplicability(current, { recordType, facts, adopted, at });
    const assessments = (await this.controls.find({ where: { modelId: model.id } })).map(toAssessment);
    const filled = new Set(Object.values(values).filter((v) => v.accepted_by).map((v) => v.field_id));
    const frameworks = fwApps.map((fw) => ({ fw, controls: controlViews(fw, assessments, filled) }));

    const state = (id: string) => (values[id] && values[id].status !== 'UNKNOWN' ? values[id].value ?? null : null);
    const consistency = checkConsistency({
      componentLifecycle: state('component_lifecycle'), modelLifecycle: state('model_lifecycle'),
      deploymentStatus: state('deployment_status'), operationalStatus: state('operational_status'),
    });

    // A configuration: effective model per tenant, and the inherent floor from the models it can select.
    let configuration = null as ReturnType<typeof resolveConfiguration> | null;
    if (recordType === 'MODEL_CONFIGURATION') {
      const selectable = await Promise.all(links.filter((l) => l.relation === 'selects_model').map(async (l) => {
        const t = targets.find((x) => x.id === l.toModelId);
        const rec = await this.records.findOne({ where: { modelId: l.toModelId } });
        return { id: l.toModelId, name: t?.name ?? l.toModelId, provider: (l.attributes as any)?.provider ?? null, inherentTier: await this.tierOf(l.toModelId), cardApproved: Boolean(rec?.lastApprovedVersion) };
      }));
      const def = values.config_default_model?.value;
      const rows = Array.isArray(values.config_tenant_overrides?.value) ? values.config_tenant_overrides.value : [];
      configuration = resolveConfiguration({
        defaultModelId: Array.isArray(def) ? def[0] ?? null : typeof def === 'string' ? def : null,
        overrides: rows.filter((r: any) => r && typeof r.tenant === 'string').map((r: any) => ({ tenant: r.tenant, byok: Boolean(r.byok), model_record_id: r.model_record_id ?? null, provider: r.provider ?? null, inherits_default: r.inherits_default !== false })),
        selectable,
        tenantReach: state('tenant_reach'),
      });
    }

    const verifiedControlIds = assessments.filter((a) => a.status === 'EFFECTIVENESS_TESTED').map((a) => `${a.framework_id}:${a.control_id}`);
    const risk = assessRisk({
      recordType, values, thresholds: s.riskThresholds, configFloor: configuration?.inherent_floor ?? null,
      acceptance: await this.acceptanceFor(orgId, values.risk_acceptance?.value, at), verifiedControlIds, at,
    });

    const ownerId = values.accountable_owner?.value;
    const owner = typeof ownerId === 'string' && ownerId ? checkOwner(await this.users.findOne({ where: { id: ownerId } }), orgId) : null;
    const gate = finalisationGate({ fields: applicability.fields, values, consistency, risk, owner });
    const scores = [
      documentationScore(applicability.fields, values),
      evidenceScore(applicability.fields, values, s.evidenceFreshnessDays, at),
      controlScore(frameworks),
      regulatoryScore(frameworks, values),
    ];
    return { recordType, facts, applicability, frameworks, consistency, configuration, risk, owner, gate, scores, settings: s, links };
  }

  private view(model: AIModelEntity, orgId: string, record: CardRecordEntity | null, values: Record<string, FieldValue>, c: Awaited<ReturnType<CardV2Service['compute']>>, at: Date) {
    const fieldApp = new Map(c.applicability.fields.map((f) => [f.field_id, f]));
    return {
      model_id: model.id,
      model_name: model.name,
      org_id: orgId,
      catalogue_version: record?.catalogueVersion ?? CATALOGUE_VERSION,
      disclaimer: 'This model card documents the system. Framework mappings are not evidence of compliance or certification.',
      record: {
        exists: Boolean(record),
        workflow_state: (record?.workflowState ?? 'DRAFT') as WorkflowState,
        author: record?.author ?? null,
        reviewer: record?.reviewer ?? null,
        next_review_at: iso(record?.nextReviewAt),
        review_status: reviewStatus(record?.nextReviewAt ?? null, at),
        last_approved_version: record?.lastApprovedVersion ?? null,
        migrated_from_v1: record?.migratedFromV1 ?? false,
        migration_note: record?.migrationNote ?? null,
      },
      summary: {
        record_type: c.recordType,
        record_type_accepted: Boolean(values.record_type?.accepted_by),
        states: Object.fromEntries(['component_lifecycle', 'model_lifecycle', 'deployment_status', 'operational_status'].map((k) => [k, values[k]?.value ?? null])),
        inherent_risk_tier: c.risk.human.inherent_tier,
        residual_risk_tier: c.risk.human.residual_tier,
        risk_status: c.risk.status,
        regulatory_classification: { eu: values.eu_classification?.value ?? null, kr_high_impact: values.kr_high_impact?.value ?? null },
      },
      scores: c.scores,
      gate: c.gate,
      consistency: c.consistency,
      risk: c.risk,
      configuration: c.configuration,
      rules: c.applicability.rules,
      sections: SECTIONS.map((s) => {
        const sa = c.applicability.sections.find((x) => x.section_id === s.section_id)!;
        const fields = s.fields.map((f) => ({ ...fieldApp.get(f.field_id)!, label: f.label, help_text: f.help_text, data_type: f.data_type, allowed_values: f.allowed_values ?? null, columns: f.columns ?? null, evidence_required: f.evidence_required, framework_control_refs: f.framework_control_refs, sensitive: f.sensitive, triggers_reassessment: f.triggers_reassessment, value: values[f.field_id] ?? emptyField(f.field_id) }));
        const req = fields.filter((f) => f.applicable && f.effective === 'MANDATORY');
        return {
          section_id: s.section_id, number: s.number, title: s.title, applicable: sa.applicable, reason: sa.reason,
          completion: { numerator: req.filter((f) => f.value.accepted_by && ['POPULATED', 'EVIDENCE_PENDING', 'VERIFIED'].includes(f.value.status)).length, denominator: req.length },
          fields,
        };
      }),
      frameworks: c.frameworks.map(({ fw, controls }) => ({
        framework_id: fw.framework_id, revision: fw.revision, type: fw.type, binding: fw.binding, noun: fw.noun, title: fw.title, short_title: fw.short_title,
        heading: frameworkHeading(fw), applies: fw.applies, label: applicabilityLabel(fw), reasons: fw.reasons, in_force: fw.in_force, effective_from: fw.effective_from,
        effective_note: fw.effective_note, organisational_only: fw.organisational_only, verification_status: fw.verification_status,
        controls: controls.map((x) => ({ ...x, label: applicabilityLabel(x) })),
      })),
      links: c.links.map((l) => ({ id: l.id, relation: l.relation, to_model_id: l.toModelId, tenant_scope: l.tenantScope, attributes: l.attributes, created_by: l.createdBy, created_at: iso(l.createdAt) })),
    };
  }

  async read(user: CurrentUser, modelId: string, at = new Date()) {
    const { model, orgId } = await this.access(user, modelId);
    const record = await this.records.findOne({ where: { modelId } });
    const values = await this.valueMap(modelId);
    const c = await this.compute(model, orgId, record, values, at);
    const approvals = await this.approvals.find({ where: { modelId }, order: { decidedAt: 'ASC' } });
    return {
      ...this.view(model, orgId, record, values, c, at),
      approvals: approvals.map((a) => ({ step: a.step, decision: a.decision, conditions: a.conditions ?? [], comment: a.comment, decided_by: a.decidedBy, decided_role: a.decidedRole, decided_at: iso(a.decidedAt), superseded: a.superseded })),
      can_edit: MAINTAINERS.includes(user.role),
    };
  }

  // ---- writing ----

  private requireEditor(user: CurrentUser) {
    if (!MAINTAINERS.includes(user.role)) throw new ForbiddenException('Your role can read cards but not change them');
  }

  private async ensureRecord(orgId: string, modelId: string, user: CurrentUser, at: Date): Promise<CardRecordEntity> {
    const r = await this.records.findOne({ where: { modelId } });
    if (r) {
      if (r.workflowState === 'RETIRED') throw new BadRequestException('A retired card cannot change; it stays readable');
      return r;
    }
    return this.records.save(this.records.create({
      id: uuidv4(), orgId, modelId, catalogueVersion: CATALOGUE_VERSION, workflowState: 'DRAFT', author: user.email, reviewer: null,
      nextReviewAt: null, lastApprovedVersion: null, migratedFromV1: false, migrationNote: null, createdAt: at, updatedAt: at,
    }));
  }

  private async event(modelId: string, type: string, actor: string, at: Date, data: Record<string, unknown>) {
    await this.ledger.save(this.ledger.create({ id: uuidv4(), modelId, eventType: type, actor, occurredAt: at, eventData: data }));
  }

  /** Apply a change trigger: move the card and supersede approvals that no longer apply. */
  private async reassessIfNeeded(record: CardRecordEntity, change: { fieldIds?: string[]; linkRelation?: string | null }, actor: string, at: Date) {
    const o = afterChange(record.workflowState as WorkflowState, change);
    if (!o.triggered) return null;
    const from = record.workflowState;
    record.workflowState = o.to;
    record.updatedAt = at;
    await this.records.save(record);
    await this.approvals.update({ modelId: record.modelId, superseded: false }, { superseded: true });
    await this.event(record.modelId, 'CARD_REASSESSMENT_TRIGGERED', actor, at, { from, to: o.to, reason: o.reason, ...change });
    return { from, to: o.to, reason: o.reason };
  }

  async changeField(user: CurrentUser, modelId: string, fieldId: string, body: Record<string, any>) {
    const at = new Date();
    const { orgId } = await this.access(user, modelId);
    this.requireEditor(user);
    const def = fieldDef(fieldId);
    if (!def) throw new NotFoundException(`Unknown field ${fieldId}`);
    const action = String(body?.action ?? 'SET').toUpperCase() as FieldAction;
    if (!FIELD_ACTIONS.includes(action)) throw new BadRequestException(`action must be one of ${FIELD_ACTIONS.join(', ')}`);
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null;
    const record = await this.ensureRecord(orgId, modelId, user, at);
    const row = await this.values.findOne({ where: { modelId, fieldId } });
    const prev = row ? toValue(row) : emptyField(fieldId);
    let next: FieldValue;
    try {
      switch (action) {
        case 'SET':
          if (fieldId === 'accountable_owner' && body.value) {
            const check = checkOwner(await this.users.findOne({ where: { id: String(body.value) } }), orgId);
            if (!check.ok) throw new FieldStateError(check.code, check.message);
          }
          next = enterValue(prev, def, body.value, user.email, at);
          break;
        case 'UNKNOWN': next = markUnknown(prev, user.email, at); break;
        case 'NOT_APPLICABLE': next = markNotApplicable(prev, user.email, String(body.justification ?? ''), at); break;
        case 'ACCEPT': next = acceptImported(prev, def, user.email, at); break;
        case 'ACCEPT_SUGGESTION': next = acceptSuggestion(prev, def, user.email, at, body.value); break;
        case 'ATTACH_EVIDENCE': next = attachEvidence(prev, { ref: String(body.ref ?? ''), type: String(body.type ?? def.evidence_required.type ?? 'DOCUMENT'), added_by: user.email }, at); break;
        case 'VERIFY': next = verify(prev, user.email, at); break;
      }
    } catch (e) {
      if (e instanceof FieldStateError) throw new BadRequestException({ code: e.code, message: e.message });
      throw e;
    }
    await this.values.save(this.values.create({
      id: row?.id ?? uuidv4(), orgId, modelId, fieldId, value: next.value, status: next.status, provenance: next.provenance, sourceRef: next.source_ref,
      enteredBy: next.entered_by, enteredAt: next.entered_at ? new Date(next.entered_at) : null, acceptedBy: next.accepted_by, acceptedAt: next.accepted_at ? new Date(next.accepted_at) : null,
      suggestion: next.suggestion, naJustification: next.na_justification, naDecidedBy: next.na_decided_by, evidenceRefs: next.evidence_refs,
      verifiedBy: next.verified_by, verifiedAt: next.verified_at ? new Date(next.verified_at) : null, catalogueVersion: record.catalogueVersion, updatedAt: at,
    }));
    record.updatedAt = at;
    await this.records.save(record);
    const before = { value: prev.value, status: prev.status, provenance: prev.provenance, accepted_by: prev.accepted_by };
    const after = { value: next.value, status: next.status, provenance: next.provenance, accepted_by: next.accepted_by };
    await this.event(modelId, 'CARD_FIELD_CHANGED', user.email, at, { field_id: fieldId, action, before: def.sensitive ? '(sensitive)' : before, after: def.sensitive ? '(sensitive)' : after, reason });
    // A value change (not acceptance, evidence or verification) of a triggering field reopens an approved card.
    const changed = stable(prev.value) !== stable(next.value);
    const reassessment = changed ? await this.reassessIfNeeded(record, { fieldIds: [fieldId] }, user.email, at) : null;
    return { field: next, reassessment, card: await this.read(user, modelId, at) };
  }

  async changeControl(user: CurrentUser, modelId: string, frameworkId: string, controlId: string, body: Record<string, any>) {
    const at = new Date();
    const { orgId } = await this.access(user, modelId);
    this.requireEditor(user);
    const fw = await this.registry.get(frameworkId);
    if (!fw.controls.some((c) => c.control_id === controlId)) throw new NotFoundException(`${frameworkId} has no control ${controlId}`);
    const record = await this.ensureRecord(orgId, modelId, user, at);
    const row = await this.controls.findOne({ where: { modelId, frameworkId, controlId } });
    let next: ControlAssessment;
    try {
      next = changeControl(row ? toAssessment(row) : null, { framework_id: frameworkId, framework_revision: fw.revision, control_id: controlId },
        { status: String(body?.status ?? ''), justification: body?.justification ?? null, evidence_refs: Array.isArray(body?.evidence_refs) ? body.evidence_refs.map((e: any) => ({ ref: String(e.ref ?? ''), type: String(e.type ?? 'DOCUMENT'), added_by: user.email, added_at: at.toISOString() })) : undefined },
        user.email, at);
    } catch (e) {
      if (e instanceof ControlStateError) throw new BadRequestException({ code: e.code, message: e.message });
      throw e;
    }
    await this.controls.save(this.controls.create({
      id: row?.id ?? uuidv4(), orgId, modelId, frameworkId, frameworkRevision: next.framework_revision, controlId, status: next.status, justification: next.justification,
      evidenceRefs: next.evidence_refs, assessedBy: next.assessed_by, assessedAt: at, implementedBy: next.implemented_by, verifiedBy: next.verified_by,
      migratedFromV1Verdict: next.migrated_from_v1_verdict, updatedAt: at,
    }));
    record.updatedAt = at;
    await this.records.save(record);
    await this.event(modelId, 'CARD_CONTROL_CHANGED', user.email, at, {
      framework_id: frameworkId, framework_revision: fw.revision, control_id: controlId, before: row?.status ?? null, after: next.status, justification: next.justification,
    });
    return { control: next, card: await this.read(user, modelId, at) };
  }

  async addLink(user: CurrentUser, modelId: string, body: Record<string, any>) {
    const at = new Date();
    const { orgId } = await this.access(user, modelId);
    this.requireEditor(user);
    const relation = String(body?.relation ?? '') as Relation;
    if (!(RELATIONS as readonly string[]).includes(relation)) throw new BadRequestException(`relation must be one of ${RELATIONS.join(', ')}`);
    const toId = String(body?.to_model_id ?? '');
    if (toId === modelId) throw new BadRequestException('A record cannot link to itself');
    const { orgId: targetOrg } = await modelForUser(this.models, this.projects, user, toId);
    if (targetOrg !== orgId) throw new NotFoundException('Model not found');
    const targetType = (await this.values.findOne({ where: { modelId: toId, fieldId: 'record_type' } }))?.value ?? null;
    if (!relationAllows(relation, targetType)) throw new BadRequestException(`${relation} cannot point at a ${targetType ?? 'record with no record type'}`);
    const record = await this.ensureRecord(orgId, modelId, user, at);
    const link = await this.links.save(this.links.create({
      id: uuidv4(), orgId, fromModelId: modelId, toModelId: toId, relation, tenantScope: typeof body?.tenant_scope === 'string' ? body.tenant_scope.slice(0, 120) : null,
      attributes: body?.attributes && typeof body.attributes === 'object' ? body.attributes : null, createdBy: user.email, createdAt: at, removedAt: null, removedBy: null,
    }));
    await this.event(modelId, 'CARD_LINK_ADDED', user.email, at, { link_id: link.id, relation, to_model_id: toId, tenant_scope: link.tenantScope });
    const reassessment = await this.reassessIfNeeded(record, { linkRelation: relation }, user.email, at);
    return { link_id: link.id, reassessment, card: await this.read(user, modelId, at) };
  }

  async removeLink(user: CurrentUser, modelId: string, linkId: string) {
    const at = new Date();
    const { orgId } = await this.access(user, modelId);
    this.requireEditor(user);
    const link = await this.links.findOne({ where: { id: linkId, fromModelId: modelId, removedAt: IsNull() } });
    if (!link) throw new NotFoundException('Link not found');
    const record = await this.ensureRecord(orgId, modelId, user, at);
    link.removedAt = at;
    link.removedBy = user.email;
    await this.links.save(link);
    await this.event(modelId, 'CARD_LINK_REMOVED', user.email, at, { link_id: link.id, relation: link.relation, to_model_id: link.toModelId });
    const reassessment = await this.reassessIfNeeded(record, { linkRelation: link.relation }, user.email, at);
    return { reassessment, card: await this.read(user, modelId, at) };
  }

  /** A workflow action: move the card, record the approval, write the ledger, and freeze a version on final approval. */
  async workflow(user: CurrentUser, modelId: string, body: Record<string, any>) {
    const at = new Date();
    const { model, orgId } = await this.access(user, modelId);
    const action = String(body?.action ?? '').toUpperCase() as WorkflowAction | 'ASSIGN_REVIEWER';
    if (action === 'ASSIGN_REVIEWER') {
      if (![Role.OWNER, Role.CISO, Role.ADMIN].includes(user.role)) throw new ForbiddenException('Only an owner, CISO or administrator assigns reviewers');
      const reviewer = await this.users.findOne({ where: { email: String(body?.reviewer ?? '') } });
      if (!reviewer || reviewer.tenantId !== orgId || !reviewer.isActive || (reviewer.accountType ?? 'HUMAN') !== 'HUMAN') throw new BadRequestException('The reviewer must be an active person in the organisation');
      const record = await this.ensureRecord(orgId, modelId, user, at);
      if (record.author === reviewer.email) throw new BadRequestException('The author cannot review their own card');
      const before = record.reviewer;
      record.reviewer = reviewer.email;
      record.updatedAt = at;
      await this.records.save(record);
      await this.event(modelId, 'CARD_REVIEWER_ASSIGNED', user.email, at, { before, after: reviewer.email });
      return this.read(user, modelId, at);
    }
    if (!(ACTIONS as readonly string[]).includes(action)) throw new BadRequestException(`action must be one of ${[...ACTIONS, 'ASSIGN_REVIEWER'].join(', ')}`);
    const record = await this.ensureRecord(orgId, modelId, user, at);
    const values = await this.valueMap(modelId);
    const c = await this.compute(model, orgId, record, values, at);
    const d = decide({
      state: record.workflowState as WorkflowState, action: action as WorkflowAction, actor: { email: user.email, role: user.role }, author: record.author,
      riskApproverRoles: c.settings.riskApproverRoles, reviewer: record.reviewer, gate: c.gate, risk: c.risk,
      comment: typeof body?.comment === 'string' ? body.comment : null, conditions: Array.isArray(body?.conditions) ? body.conditions : undefined,
    });
    if (!d.ok) throw new BadRequestException({ code: 'WORKFLOW_REFUSED', message: d.errors[0], errors: d.errors });
    const from = record.workflowState;
    if (d.approval) {
      await this.approvals.save(this.approvals.create({
        id: uuidv4(), orgId, modelId, step: d.approval.step, decision: d.approval.decision, conditions: d.approval.conditions, comment: body?.comment ?? null,
        decidedBy: user.email, decidedRole: user.role, decidedAt: at, superseded: false,
      }));
    }
    if (d.to === 'REASSESSMENT' || d.approval?.decision === 'REJECTED') await this.approvals.update({ modelId, superseded: false }, { superseded: true });
    let version: number | null = null;
    if (d.approval?.step === 'FINAL') {
      record.nextReviewAt = nextReviewDate(at, c.settings.reviewCycleMonths);
      record.workflowState = d.to;
      version = await this.freeze(user, model, orgId, record, 'APPROVED', 'Final approval', at);
      record.lastApprovedVersion = version;
    }
    record.workflowState = d.to;
    record.updatedAt = at;
    await this.records.save(record);
    await this.event(modelId, 'CARD_WORKFLOW', user.email, at, {
      action, from, to: d.to, approval: d.approval ?? null, comment: body?.comment ?? null, version,
    });
    return this.read(user, modelId, at);
  }

  /** Freeze the card as it stands. APPROVED versions come only from final approval. */
  private async freeze(user: CurrentUser, model: AIModelEntity, orgId: string, record: CardRecordEntity, kind: 'APPROVED' | 'SNAPSHOT', reason: string, at: Date): Promise<number> {
    const values = await this.valueMap(model.id);
    const c = await this.compute(model, orgId, record, values, at);
    const content = { ...this.view(model, orgId, record, values, c, at), frozen_at: at.toISOString(), frozen_by: user.email, kind };
    const hash = createHash('sha256').update(stable({ values, frameworks: content.frameworks, risk: c.risk, scores: c.scores })).digest('hex');
    const last = await this.versions.findOne({ where: { modelId: model.id }, order: { version: 'DESC' } });
    const version = (last?.version ?? 0) + 1;
    await this.versions.save(this.versions.create({
      id: uuidv4(), orgId, modelId: model.id, version, kind, workflowState: record.workflowState, content, contentHash: hash, reason, createdBy: user.email, createdAt: at,
    }));
    await this.event(model.id, 'CARD_VERSION_FROZEN', user.email, at, { version, kind, content_hash: hash, reason });
    return version;
  }

  async snapshot(user: CurrentUser, modelId: string, body: Record<string, any>) {
    const at = new Date();
    const { model, orgId } = await this.access(user, modelId);
    this.requireEditor(user);
    const record = await this.ensureRecord(orgId, modelId, user, at);
    const version = await this.freeze(user, model, orgId, record, 'SNAPSHOT', typeof body?.reason === 'string' ? body.reason.slice(0, 500) : 'Snapshot', at);
    return { version };
  }

  async listVersions(user: CurrentUser, modelId: string) {
    await this.access(user, modelId);
    const rows = await this.versions.find({ where: { modelId }, order: { version: 'DESC' }, select: ['version', 'kind', 'workflowState', 'contentHash', 'reason', 'createdBy', 'createdAt'] });
    return rows.map((r) => ({ version: r.version, kind: r.kind, workflow_state: r.workflowState, content_hash: r.contentHash, reason: r.reason, created_by: r.createdBy, created_at: iso(r.createdAt) }));
  }

  async getVersion(user: CurrentUser, modelId: string, version: number) {
    await this.access(user, modelId);
    const r = await this.versions.findOne({ where: { modelId, version } });
    if (!r) throw new NotFoundException(`Version ${version} not found`);
    return { version: r.version, kind: r.kind, workflow_state: r.workflowState, content_hash: r.contentHash, created_by: r.createdBy, created_at: iso(r.createdAt), content: r.content };
  }

  /** The audit trail of this card (ledger events written by v2). */
  async history(user: CurrentUser, modelId: string) {
    await this.access(user, modelId);
    const rows = await this.ledger.find({ where: { modelId }, order: { occurredAt: 'ASC' } });
    return rows.filter((r) => r.eventType.startsWith('CARD_')).map((r) => ({ event: r.eventType, actor: r.actor, at: iso(r.occurredAt), data: r.eventData }));
  }
}
