/**
 * Model validation (E2.3, SR 26-2): MRM in-scope flag with an exclusion
 * reason (generative and agentic AI are outside SR 26-2), validations with an
 * independence check (the validator is not the model's named owner, its
 * developer or the person who registered it), conceptual-soundness,
 * implementation and outcomes-analysis records, findings raised into the
 * corrective-action register, temporary-use exceptions with compensating
 * controls and an expiry, vendor-model validation, an aggregate view across
 * interconnected models, and a deploy-gate finding per the settings.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { ModelType, Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AIModelEntity,
  CorrectiveActionEntity,
  ModelLedgerEventEntity,
  ModelValidationEntity,
  ProjectEntity,
  UserEntity,
} from '../../database/entities';
import { CorrectiveActionsService } from '../actions/actions.service';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts } from '../hooks';
import { phase2Param } from '../packs/parameter-resolver';
import { PacksService } from '../packs/packs.service';
import { addMonths, DAY_MS, MAINTAINERS, OFFICERS, oneOf, optDate, optText, orgFor, orgMember, orgModels, orgParams, reqText, requireRole } from '../phase2-util';
import { RisksService } from '../risks/risks.service';

export const VALIDATION_RESULTS = ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED'] as const;
const OPEN_STATUSES = ['PLANNED', 'IN_PROGRESS'];
/** Model types SR 26-2 places outside its definition of a model by default. */
const GENAI_TYPES: string[] = [ModelType.GENERATIVE_AI, ModelType.AGENT, ModelType.MCP_SERVER, ModelType.TOOL];
/** Longest temporary-use exception SentRAI accepts. */
const MAX_EXCEPTION_DAYS = 365;

/** Independence rules: returns the reasons the validator is NOT independent (empty when independent). */
export function independenceProblems(
  validator: { id: string; email: string; fullName: string; role: string },
  model: { ownerUserId: string | null; developedBy: string; ownerTeam: string },
  registeredBy: string | null,
): string[] {
  const out: string[] = [];
  const eq = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (validator.role === Role.VIEWER) out.push('a viewer has no standing to challenge the model');
  if (model.ownerUserId && model.ownerUserId === validator.id) out.push('the validator is the model’s named owner');
  if (eq(model.developedBy, validator.email) || eq(model.developedBy, validator.fullName)) out.push('the validator developed the model');
  if (eq(registeredBy, validator.email)) out.push('the validator registered the model');
  if (model.ownerTeam && (eq(model.ownerTeam, validator.fullName) || eq(model.ownerTeam, validator.email))) out.push('the validator is the owner team');
  return out;
}

@Injectable()
export class ValidationService implements OnModuleInit {
  constructor(
    @InjectRepository(ModelValidationEntity) private readonly rows: Repository<ModelValidationEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(CorrectiveActionEntity) private readonly cas: Repository<CorrectiveActionEntity>,
    private readonly actions: CorrectiveActionsService,
    private readonly risks: RisksService,
    private readonly packs: PacksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('modelValidation')) return undefined;
      return { validation: await this.modelFacts(modelId) };
    });
    this.risks.addGateContributor(async (model) => {
      if (!this.flags.isEnabled('modelValidation') || model.mrmInScope !== true) return [];
      const f = await this.modelFacts(model.id);
      const now = Date.now();
      const current = f.status === 'COMPLETED' && f.independent && f.result !== 'REJECTED' && (!f.expiresAt || f.expiresAt.getTime() > now);
      const excepted = !!f.exceptionUntil && f.exceptionUntil.getTime() > now;
      if (current || excepted) return [];
      return [{
        code: 'validation_required' as const,
        message: f.status === 'COMPLETED'
          ? f.result === 'REJECTED' ? 'The latest validation rejected the model' : !f.independent ? 'The validation was not independent' : `The validation expired on ${f.expiresAt?.toISOString().slice(0, 10)}`
          : 'SR 26-2 in-scope model with no completed independent validation and no temporary-use exception',
      }];
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'modelValidation');
  }

  /* ---------------------------------------------------------------- facts */

  async modelFacts(modelId: string) {
    const m = await this.models.findOne({ where: { id: modelId } });
    const latest = await this.rows.findOne({ where: { modelId, status: Not('CANCELLED') }, order: { version: 'DESC' } });
    const completed = await this.rows.findOne({ where: { modelId, status: 'COMPLETED' }, order: { completedAt: 'DESC' } });
    // H3: an exception only counts on the latest validation while it is still open; completing or cancelling ends it.
    const exceptionUntil = latest && OPEN_STATUSES.includes(latest.status) && latest.tempUseException ? latest.exceptionExpiresAt : null;
    // Independence is re-checked now (owner, developer or registrant may have changed since completion).
    let independentNow = false;
    if (completed && m && completed.independenceAttestedBy) {
      const v = completed.validatorUserId ? await this.users.findOne({ where: { id: completed.validatorUserId } }) : null;
      independentNow = !!v && independenceProblems(v, m, await this.registeredBy(modelId)).length === 0;
    }
    const overdueFindings = await this.cas.count({ where: { modelId, source: 'VALIDATION', status: In(['OPEN', 'IN_PROGRESS', 'AWAITING_EFFECTIVENESS']), dueAt: LessThan(new Date()) } });
    const basis = completed ?? latest;
    return {
      inScope: m?.mrmInScope ?? null,
      exclusionReason: m?.mrmExclusionReason ?? null,
      status: basis?.status ?? null,
      result: completed?.result ?? null,
      independent: completed ? independentNow : basis?.independent ?? false,
      expiresAt: completed?.expiresAt ?? null,
      exceptionUntil,
      overdueFindings,
      vendorModel: basis?.vendorModel ?? false,
      openValidation: latest && OPEN_STATUSES.includes(latest.status) ? latest.id : null,
    };
  }

  /* ---------------------------------------------------------------- scope */

  async setScope(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'set model-risk scope');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    if (typeof body.in_scope !== 'boolean') throw new BadRequestException('in_scope must be true or false');
    // Excluding a model removes the validation gate, so it is an officer's decision.
    if (body.in_scope === false) requireRole(user, OFFICERS, 'exclude a model from model-risk management');
    model.mrmInScope = body.in_scope;
    model.mrmExclusionReason = body.in_scope ? null : reqText(body.exclusion_reason, 'exclusion_reason', 10, 500);
    model.updatedAt = new Date();
    await this.models.save(model);
    if (req) req.auditSummary = { mrm_scope: { model_id: modelId, in_scope: model.mrmInScope, reason: model.mrmExclusionReason } };
    return this.scopeView(model);
  }

  private scopeView(m: AIModelEntity) {
    return {
      model_id: m.id, name: m.name, model_type: m.modelType, in_scope: m.mrmInScope, exclusion_reason: m.mrmExclusionReason,
      // Generative and agentic AI fall outside SR 26-2's definition of a model unless the bank decides otherwise.
      suggested_in_scope: !GENAI_TYPES.includes(m.modelType),
    };
  }

  /* ----------------------------------------------------------- validations */

  view(r: ModelValidationEntity) {
    const now = Date.now();
    return {
      validation_id: r.id, model_id: r.modelId, version: r.version, status: r.status, result: r.result,
      validator_user_id: r.validatorUserId, validator_email: r.validatorEmail, independent: r.independent,
      independence_problems: r.independenceReasons ?? [], independence_attested_by: r.independenceAttestedBy, independence_attested_at: r.independenceAttestedAt, scope: r.scope, conceptual_soundness: r.conceptualSoundness,
      implementation_review: r.implementationReview, outcomes_analysis: r.outcomesAnalysis, vendor_model: r.vendorModel,
      temp_use_exception: r.tempUseException, compensating_controls: r.compensatingControls, exception_expires_at: r.exceptionExpiresAt,
      exception_active: r.tempUseException && !!r.exceptionExpiresAt && r.exceptionExpiresAt.getTime() > now,
      expires_at: r.expiresAt, expired: !!r.expiresAt && r.expiresAt.getTime() < now, findings: r.findings ?? [],
      completed_at: r.completedAt, created_by: r.createdBy, created_at: r.createdAt, updated_at: r.updatedAt,
    };
  }

  private async load(user: CurrentUser, id: string) {
    const r = await this.rows.findOne({ where: { id } });
    if (!r || (user.role !== Role.ADMIN && r.orgId !== user.tenantId)) throw new NotFoundException('Validation not found');
    return r;
  }

  private async registeredBy(modelId: string): Promise<string | null> {
    const first = await this.ledger.findOne({ where: { modelId }, order: { occurredAt: 'ASC' } });
    return first?.actor ?? null;
  }

  private async checkIndependence(r: ModelValidationEntity) {
    const model = await this.models.findOne({ where: { id: r.modelId } });
    const validator = r.validatorUserId ? await this.users.findOne({ where: { id: r.validatorUserId } }) : null;
    if (!model || !validator) {
      r.independent = false;
      r.independenceReasons = ['no validator named'];
      return;
    }
    const problems = independenceProblems(validator, model, await this.registeredBy(model.id));
    // Users carry no team field, so separation from the owning team is attested by an officer who is not the validator.
    if (!r.independenceAttestedBy) problems.push('no officer has attested that the validator is outside the owning team');
    r.independent = problems.length === 0;
    r.independenceReasons = problems;
    r.validatorEmail = validator.email;
  }

  async create(user: CurrentUser, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'plan validations');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, reqText(body.model_id, 'model_id'));
    if (!orgId) throw new BadRequestException('The model is not in an organization');
    if (model.mrmInScope === false) throw new BadRequestException(`The model is excluded from model-risk management: ${model.mrmExclusionReason}`);
    if (await this.rows.findOne({ where: { modelId: model.id, status: In(OPEN_STATUSES) } })) throw new BadRequestException('This model already has a validation in progress');
    const validator = await orgMember(this.users, orgId, body.validator_user_id, 'validator_user_id');
    const last = await this.rows.findOne({ where: { modelId: model.id }, order: { version: 'DESC' } });
    const now = new Date();
    const r = this.rows.create({
      id: uuidv4(), orgId, modelId: model.id, version: (last?.version ?? 0) + 1, status: 'PLANNED', result: null,
      validatorUserId: validator.id, validatorEmail: validator.email, independent: false, independenceReasons: null, independenceAttestedBy: null, independenceAttestedAt: null,
      scope: optText(body.scope, 'scope'), conceptualSoundness: null, implementationReview: null, outcomesAnalysis: null,
      vendorModel: body.vendor_model === true, tempUseException: false, compensatingControls: null, exceptionExpiresAt: null,
      expiresAt: null, findings: [], completedAt: null, createdBy: user.email, createdAt: now, updatedAt: now,
    });
    await this.checkIndependence(r);
    await this.rows.save(r);
    return this.view(r);
  }

  async list(user: CurrentUser, q: { model_id?: string; status?: string; org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const where: Record<string, any> = { orgId };
    if (q.model_id) where.modelId = q.model_id;
    if (q.status) where.status = q.status;
    return { org_id: orgId, validations: (await this.rows.find({ where, order: { createdAt: 'DESC' } })).map((r) => this.view(r)) };
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    return this.view(await this.load(user, id));
  }

  async update(user: CurrentUser, id: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit validations');
    const r = await this.load(user, id);
    if (!OPEN_STATUSES.includes(r.status)) throw new BadRequestException(`A ${r.status.toLowerCase()} validation cannot be edited; start a new one`);
    // Only the validator writes the validation's analysis (effective challenge is theirs).
    const analysis = ['conceptual_soundness', 'implementation_review', 'outcomes_analysis'].some((k) => body[k] !== undefined);
    if (analysis && r.validatorEmail?.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException('Only the named validator can record the analysis');
    if (body.validator_user_id !== undefined) {
      const v = await orgMember(this.users, r.orgId, body.validator_user_id, 'validator_user_id');
      if (v.id !== r.validatorUserId) {
        r.independenceAttestedBy = null;
        r.independenceAttestedAt = null;
      }
      r.validatorUserId = v.id;
    }
    if (body.scope !== undefined) r.scope = optText(body.scope, 'scope');
    if (body.conceptual_soundness !== undefined) r.conceptualSoundness = optText(body.conceptual_soundness, 'conceptual_soundness', 20000);
    if (body.implementation_review !== undefined) r.implementationReview = optText(body.implementation_review, 'implementation_review', 20000);
    if (body.outcomes_analysis !== undefined) r.outcomesAnalysis = optText(body.outcomes_analysis, 'outcomes_analysis', 20000);
    if (body.vendor_model !== undefined) r.vendorModel = body.vendor_model === true;
    if (body.status !== undefined) {
      if (!['PLANNED', 'IN_PROGRESS', 'CANCELLED'].includes(body.status)) throw new BadRequestException('Use /complete to complete a validation');
      if (body.status === 'CANCELLED') {
        requireRole(user, OFFICERS, 'cancel a validation');
        if (r.tempUseException && r.exceptionExpiresAt && r.exceptionExpiresAt.getTime() > Date.now()) r.exceptionExpiresAt = new Date();
      }
      r.status = body.status;
    }
    await this.checkIndependence(r);
    r.updatedAt = new Date();
    await this.rows.save(r);
    return this.view(r);
  }

  /** A finding goes into the corrective-action register (source VALIDATION) and onto the validation. */
  async addFinding(user: CurrentUser, id: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record findings');
    const r = await this.load(user, id);
    if (r.status === 'CANCELLED') throw new BadRequestException('The validation was cancelled');
    if ((r.findings ?? []).length >= 200) throw new BadRequestException('A validation holds at most 200 findings; raise the rest as corrective actions');
    const severity = oneOf(body.severity, ['LOW', 'MEDIUM', 'HIGH'] as const, 'severity', 'MEDIUM');
    const description = reqText(body.description, 'description', 10, 2000);
    const dueAt = optDate(body.due_at, 'due_at');
    let actionId: string | null = null;
    if (this.flags.isEnabled('correctiveActions')) {
      const ca = await this.actions.create({ ...user, tenantId: r.orgId }, {
        source: 'VALIDATION', source_id: r.id, model_id: r.modelId, nonconformity: `Validation v${r.version} finding (${severity}): ${description}`,
        action: reqText(body.action ?? 'Remediate the validation finding', 'action', 3), owner_user_id: body.owner_user_id ?? null, due_at: dueAt?.toISOString() ?? null,
      });
      actionId = ca.action_id;
    }
    const finding = { finding_id: uuidv4(), severity, description, due_at: dueAt?.toISOString() ?? null, action_id: actionId, recorded_by: user.email, recorded_at: new Date().toISOString() };
    r.findings = [...(r.findings ?? []), finding];
    r.updatedAt = new Date();
    await this.rows.save(r);
    return { ...this.view(r), finding };
  }

  async complete(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    const r = await this.load(user, id);
    if (!OPEN_STATUSES.includes(r.status)) throw new BadRequestException(`A ${r.status.toLowerCase()} validation cannot be completed`);
    if (r.validatorEmail?.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException('Only the named validator can complete the validation');
    await this.checkIndependence(r);
    if (!r.independent) throw new ForbiddenException(`The validator is not independent: ${(r.independenceReasons ?? []).join('; ')}`);
    if (!r.conceptualSoundness || r.conceptualSoundness.length < 20) throw new BadRequestException('Record the conceptual-soundness review first');
    if (!r.implementationReview || r.implementationReview.length < 20) throw new BadRequestException('Record the implementation review first');
    if (!r.outcomesAnalysis || r.outcomesAnalysis.length < 20) throw new BadRequestException('Record the outcomes analysis first');
    const result = oneOf(body.result, VALIDATION_RESULTS, 'result');
    const params = await orgParams(this.packs, r.orgId);
    const months = phase2Param(params, 'validationValidityMonths');
    const now = new Date();
    const requested = optDate(body.expires_at, 'expires_at');
    const maxExpiry = addMonths(now, months);
    if (requested && requested.getTime() > maxExpiry.getTime()) throw new BadRequestException(`A validation stays current for at most ${months} months`);
    if (requested && requested.getTime() <= now.getTime()) throw new BadRequestException('expires_at must be in the future');
    r.status = 'COMPLETED';
    r.result = result;
    r.completedAt = now;
    r.expiresAt = result === 'REJECTED' ? null : requested ?? maxExpiry;
    // A completed validation ends any temporary-use exception granted while it was open.
    if (r.tempUseException && r.exceptionExpiresAt && r.exceptionExpiresAt.getTime() > now.getTime()) r.exceptionExpiresAt = now;
    r.updatedAt = now;
    await this.rows.save(r);
    if (req) req.auditSummary = { model_validation_completed: { validation_id: r.id, model_id: r.modelId, result, validator: user.email, expires_at: r.expiresAt } };
    return this.view(r);
  }

  /** An officer (not the validator) attests that the validator sits outside the owning team and its reporting line. */
  async attestIndependence(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'attest validator independence');
    const r = await this.load(user, id);
    if (!OPEN_STATUSES.includes(r.status)) throw new BadRequestException('Independence is attested while the validation is open');
    if (r.validatorEmail?.toLowerCase() === user.email.toLowerCase()) throw new ForbiddenException('The validator cannot attest their own independence');
    const statement = reqText(body.statement, 'statement (how the validator is separate from the owning team)', 20, 2000);
    r.independenceAttestedBy = user.email;
    r.independenceAttestedAt = new Date();
    await this.checkIndependence(r);
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (req) req.auditSummary = { validator_independence_attested: { validation_id: r.id, validator: r.validatorEmail, attested_by: user.email, statement } };
    return this.view(r);
  }

  /** Temporary use before validation (SR 26-2): compensating controls, an expiry, and an officer's sign-off. */
  async exception(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'grant a temporary-use exception');
    const r = await this.load(user, id);
    if (!OPEN_STATUSES.includes(r.status)) throw new BadRequestException('A temporary-use exception applies while the validation is open');
    const controls = reqText(body.compensating_controls, 'compensating_controls', 20);
    const expires = optDate(body.expires_at, 'expires_at');
    if (!expires || expires.getTime() <= Date.now()) throw new BadRequestException('expires_at must be a future date');
    if (expires.getTime() > Date.now() + MAX_EXCEPTION_DAYS * DAY_MS) throw new BadRequestException(`A temporary-use exception lasts at most ${MAX_EXCEPTION_DAYS} days`);
    r.tempUseException = true;
    r.compensatingControls = `${controls}\n[granted by ${user.email} on ${new Date().toISOString().slice(0, 10)}]`;
    r.exceptionExpiresAt = expires;
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (req) req.auditSummary = { validation_exception: { validation_id: r.id, model_id: r.modelId, expires_at: expires, granted_by: user.email } };
    return this.view(r);
  }

  /** Aggregate view across interconnected models: per project, and per vendor-model flag. */
  async aggregate(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const models = await orgModels(this.models, this.projects, orgId);
    const projects = await this.projects.find({ where: { tenantId: orgId } });
    const now = Date.now();
    const groups: any[] = [];
    let totals = { models: 0, in_scope: 0, excluded: 0, undecided: 0, validated: 0, exception: 0, missing: 0, open_findings: 0 };
    for (const p of projects) {
      const ms = models.filter((m) => m.projectId === p.id);
      if (!ms.length) continue;
      const rows: any[] = [];
      for (const m of ms) {
        const f = await this.modelFacts(m.id);
        const current = f.status === 'COMPLETED' && f.independent && f.result !== 'REJECTED' && (!f.expiresAt || f.expiresAt.getTime() > now);
        const excepted = !!f.exceptionUntil && f.exceptionUntil.getTime() > now;
        const openFindings = await this.cas.count({ where: { modelId: m.id, source: 'VALIDATION', status: In(['OPEN', 'IN_PROGRESS', 'AWAITING_EFFECTIVENESS']) } });
        const state = f.inScope === false ? 'EXCLUDED' : f.inScope === null ? 'UNDECIDED' : current ? 'VALIDATED' : excepted ? 'EXCEPTION' : 'MISSING';
        rows.push({ model_id: m.id, name: m.name, risk_level: m.riskLevel, model_type: m.modelType, state, expires_at: f.expiresAt, exception_until: f.exceptionUntil, vendor_model: f.vendorModel, open_findings: openFindings, dependencies: (m.dependencies ?? []).length });
      }
      const count = (s: string) => rows.filter((r) => r.state === s).length;
      const g = { project_id: p.id, project: p.name, models: rows.length, in_scope: rows.filter((r) => !['EXCLUDED', 'UNDECIDED'].includes(r.state)).length, excluded: count('EXCLUDED'), undecided: count('UNDECIDED'), validated: count('VALIDATED'), exception: count('EXCEPTION'), missing: count('MISSING'), open_findings: rows.reduce((a, r) => a + r.open_findings, 0), rows };
      totals = { models: totals.models + g.models, in_scope: totals.in_scope + g.in_scope, excluded: totals.excluded + g.excluded, undecided: totals.undecided + g.undecided, validated: totals.validated + g.validated, exception: totals.exception + g.exception, missing: totals.missing + g.missing, open_findings: totals.open_findings + g.open_findings };
      groups.push(g);
    }
    return { org_id: orgId, totals, projects: groups, scope: models.map((m) => this.scopeView(m)) };
  }
}
