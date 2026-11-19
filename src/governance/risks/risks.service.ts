/**
 * Risk register (E1.3). Risks scoped to a model, use case, vendor or the
 * organisation; inherent and residual likelihood × impact on the
 * organisation's matrix; treatments and actions; acceptance by the approver
 * the risk appetite names for the residual band (executive sign-off for HIGH
 * and CRITICAL by default); re-review on a date or an event; and the
 * residual-risk deploy gate (block or warn per tier, from settings).
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AuditType, IncidentStatus, Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AIAuditTrailEntity,
  AIIncidentEntity,
  AIModelEntity,
  DriftReportEntity,
  ProjectEntity,
  RiskAcceptanceEntity,
  RiskActionEntity,
  RiskAssessmentEntity,
  RiskEntity,
} from '../../database/entities';
import { AccountabilityService } from '../accountability/accountability.service';
import { assertFlag, modelForUser } from '../governance-access';
import { addCardFields, governanceHooks } from '../hooks';
import { GovernanceSettingsService } from '../settings/settings.service';
import { gateTierOf, GovernanceSettingsDoc, RISK_CATEGORIES } from '../settings/settings.model';
import {
  acceptanceRole,
  band,
  catalogueFor,
  OPEN_STATUSES,
  RISK_SCOPES,
  reviewIntervalDays,
  score,
  STARTER_CATALOGUE,
  TREATMENTS,
  validateRating,
  withinAppetite,
} from './risk.model';

const DAY = 86_400_000;
export const RISK_WRITERS: Role[] = [Role.OWNER, Role.CISO, Role.ADMIN, Role.APPROVER, Role.REVIEWER];

export interface GateFinding {
  code:
    | 'residual_risk_unaccepted'
    | 'risk_register_empty'
    | 'impact_assessment_required'
    | 'third_party_audit_required'
    // Phase 2
    | 'validation_required'
    | 'red_team_required'
    | 'audit_overdue';
  message: string;
}

/** Listeners other governance services register for re-review events (impact assessments). */
type EventListener = (modelId: string, event: string, detail?: Record<string, any>) => Promise<void>;

@Injectable()
export class RisksService implements OnModuleInit {
  private readonly logger = new Logger(RisksService.name);
  private readonly listeners: EventListener[] = [];
  private readonly gateContributors: Array<(model: AIModelEntity, orgId: string, settings: GovernanceSettingsDoc) => Promise<GateFinding[]>> = [];

  constructor(
    @InjectRepository(RiskEntity) private readonly risks: Repository<RiskEntity>,
    @InjectRepository(RiskAssessmentEntity) private readonly assessments: Repository<RiskAssessmentEntity>,
    @InjectRepository(RiskActionEntity) private readonly actions: Repository<RiskActionEntity>,
    @InjectRepository(RiskAcceptanceEntity) private readonly acceptances: Repository<RiskAcceptanceEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(AIAuditTrailEntity) private readonly audits: Repository<AIAuditTrailEntity>,
    private readonly settings: GovernanceSettingsService,
    private readonly accountability: AccountabilityService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    governanceHooks.onModelEvent = async (modelId, event, detail) => {
      if (this.flags.isEnabled('riskRegister')) await this.triggerReview(modelId, event, detail);
      // Listeners (impact assessments) check their own flags.
      for (const l of this.listeners) await l(modelId, event, detail);
    };
    governanceHooks.gateCheck = async (modelId) => this.gateCheck(modelId);
    addCardFields(async (modelId) => {
      const out: Record<string, any> = {};
      if (this.flags.isEnabled('contextProfile')) {
        const m = await this.models.findOne({ where: { id: modelId } });
        const p = (m?.contextProfile ?? {}) as any;
        out.known_limitations = p.knownLimitations ?? [];
        out.out_of_scope_uses = p.outOfScopeUses ?? [];
        out.intended_users = p.intendedUsers ?? [];
        out.oversight_pattern = p.oversightPattern ?? null;
      }
      if (this.flags.isEnabled('riskRegister')) out.residual_risks = await this.cardRisks(modelId);
      return Object.keys(out).length ? out : undefined;
    });
    const prevFacts = governanceHooks.modelGovernanceFacts;
    governanceHooks.modelGovernanceFacts = async (modelId, orgId) => {
      const base = (await prevFacts?.(modelId, orgId)) ?? {};
      if (!this.flags.isEnabled('riskRegister') || !orgId) return Object.keys(base).length ? base : undefined;
      return { ...base, riskRegister: await this.registerFacts(modelId, orgId) };
    };
  }

  onEvent(l: EventListener): void {
    this.listeners.push(l);
  }

  addGateContributor(fn: (model: AIModelEntity, orgId: string, settings: GovernanceSettingsDoc) => Promise<GateFinding[]>): void {
    this.gateContributors.push(fn);
  }

  private assert(): void {
    assertFlag(this.flags, 'riskRegister');
  }

  /* ------------------------------------------------------------ helpers */

  private async loadRisk(user: CurrentUser, id: string): Promise<RiskEntity> {
    const r = await this.risks.findOne({ where: { id } });
    if (!r || (user.role !== Role.ADMIN && r.orgId !== user.tenantId)) throw new NotFoundException('Risk not found');
    return r;
  }

  /** Owners must be active members of the risk's organisation (L1). */
  private async assertOwner(orgId: string, ownerUserId: unknown): Promise<string | null> {
    if (ownerUserId === null || ownerUserId === undefined || ownerUserId === '') return null;
    const id = String(ownerUserId);
    if (!(await this.accountability.isMember(orgId, id))) throw new BadRequestException('owner_user_id must be an active member of the organization');
    return id;
  }

  private parseDue(v: unknown): Date | null {
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new BadRequestException('due_at must be a date');
    return d;
  }

  private async latestAssessment(riskId: string): Promise<RiskAssessmentEntity | null> {
    return this.assessments.findOne({ where: { riskId }, order: { version: 'DESC' } });
  }

  private async validAcceptance(riskId: string, version: number, now = new Date()): Promise<RiskAcceptanceEntity | null> {
    const rows = await this.acceptances.find({ where: { riskId, assessmentVersion: version }, order: { acceptedAt: 'DESC' } });
    return rows.find((a) => !a.expiresAt || a.expiresAt.getTime() > now.getTime()) ?? null;
  }

  async view(r: RiskEntity, settings?: GovernanceSettingsDoc, detail = false) {
    const s = settings ?? (await this.settings.inForce(r.orgId)).settings;
    const latest = await this.latestAssessment(r.id);
    const accepted = latest ? await this.validAcceptance(r.id, latest.version) : null;
    const inherent = latest ? { l: latest.inherentL, i: latest.inherentI } : null;
    const residual = latest ? { l: latest.residualL, i: latest.residualI } : null;
    const out: Record<string, any> = {
      risk_id: r.id,
      org_id: r.orgId,
      scope_type: r.scopeType,
      scope_id: r.scopeId,
      category: r.category,
      title: r.title,
      description: r.description,
      affected_parties: r.affectedParties ?? [],
      harm_type: r.harmType,
      source: r.source,
      source_ref: r.sourceRef,
      status: r.status,
      owner_user_id: r.ownerUserId,
      next_review_at: r.nextReviewAt,
      review_reason: r.reviewReason,
      dismissed_reason: r.dismissedReason,
      created_by: r.createdBy,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      assessment: latest
        ? {
            version: latest.version,
            matrix: latest.matrix,
            inherent: { likelihood: latest.inherentL, impact: latest.inherentI, score: score(inherent!), band: latest.inherentBand },
            residual: { likelihood: latest.residualL, impact: latest.residualI, score: score(residual!), band: latest.residualBand },
            rationale: latest.rationale,
            control_ids: latest.controlIds ?? [],
            assessed_by: latest.assessedBy,
            assessed_at: latest.assessedAt,
          }
        : null,
      // Matrix changed since the assessment: keep the score, re-score at the next review (design §4.1).
      rescore_required: Boolean(latest && latest.matrix !== s.scoringMatrix),
      within_appetite: residual ? withinAppetite(r.category, residual, s) : false,
      ceiling: s.appetite?.ceilings?.[r.category] ?? null,
      acceptance: accepted
        ? { accepted_by: accepted.acceptedBy, role: accepted.role, accepted_at: accepted.acceptedAt, expires_at: accepted.expiresAt, waiver_ref: accepted.waiverRef, note: accepted.note }
        : null,
      required_approvers: latest ? s.appetite?.approvers?.[latest.residualBand] ?? [] : [],
    };
    if (detail) {
      out.assessments = (await this.assessments.find({ where: { riskId: r.id }, order: { version: 'DESC' } })).map((a) => ({
        version: a.version, matrix: a.matrix, inherent: [a.inherentL, a.inherentI], residual: [a.residualL, a.residualI],
        inherent_band: a.inherentBand, residual_band: a.residualBand, rationale: a.rationale, assessed_by: a.assessedBy, assessed_at: a.assessedAt,
      }));
      out.actions = (await this.actions.find({ where: { riskId: r.id }, order: { createdAt: 'ASC' } })).map((a) => this.actionView(a));
      out.acceptances = (await this.acceptances.find({ where: { riskId: r.id }, order: { acceptedAt: 'DESC' } })).map((a) => ({
        assessment_version: a.assessmentVersion, accepted_by: a.acceptedBy, role: a.role, accepted_at: a.acceptedAt, expires_at: a.expiresAt, waiver_ref: a.waiverRef, note: a.note,
      }));
    }
    return out;
  }

  private actionView(a: RiskActionEntity) {
    return {
      action_id: a.id, treatment: a.treatment, action: a.action, owner_user_id: a.ownerUserId, due_at: a.dueAt,
      status: a.status, overdue: a.status === 'OPEN' && !!a.dueAt && a.dueAt.getTime() < Date.now(), created_by: a.createdBy, created_at: a.createdAt, completed_at: a.completedAt,
    };
  }

  /** The org a new risk belongs to, checking scope access. */
  private async orgForScope(user: CurrentUser, scopeType: string, scopeId: string | null, orgId?: string): Promise<string> {
    if (scopeType === 'MODEL') {
      if (!scopeId) throw new BadRequestException('scope_id (the model id) is required for MODEL risks');
      const { orgId: modelOrg } = await modelForUser(this.models, this.projects, user, scopeId);
      if (!modelOrg) throw new BadRequestException('The model is not in an organization');
      return modelOrg;
    }
    const org = user.role === Role.ADMIN && orgId ? orgId : user.tenantId;
    if (!org) throw new BadRequestException('No organization');
    return org;
  }

  /* --------------------------------------------------------------- CRUD */

  async list(user: CurrentUser, q: { scope_type?: string; scope_id?: string; model_id?: string; status?: string; category?: string; org_id?: string }) {
    this.assert();
    const orgId = user.role === Role.ADMIN && q.org_id ? q.org_id : user.tenantId;
    if (!orgId) throw new BadRequestException('Name an organization with ?org_id= (platform admin)');
    const where: Record<string, any> = { orgId };
    if (q.scope_type) where.scopeType = q.scope_type;
    if (q.model_id) Object.assign(where, { scopeType: 'MODEL', scopeId: q.model_id });
    if (q.scope_id) where.scopeId = q.scope_id;
    if (q.status) where.status = In(q.status.split(','));
    if (q.category) where.category = q.category;
    const rows = await this.risks.find({ where, order: { updatedAt: 'DESC' } });
    const s = (await this.settings.inForce(orgId)).settings;
    const risks: Array<Record<string, any>> = [];
    for (const r of rows) risks.push(await this.view(r, s));
    return {
      org_id: orgId,
      scoring_matrix: s.scoringMatrix,
      bands: s.bands,
      risks,
      summary: {
        total: risks.length,
        open: risks.filter((r) => OPEN_STATUSES.includes(r.status)).length,
        review_due: risks.filter((r) => r.status === 'REVIEW_DUE').length,
        accepted: risks.filter((r) => r.status === 'ACCEPTED').length,
        above_appetite_unaccepted: risks.filter((r) => r.assessment && !r.within_appetite && !r.acceptance && !['CLOSED', 'DISMISSED'].includes(r.status)).length,
      },
    };
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    return this.view(await this.loadRisk(user, id), undefined, true);
  }

  async create(user: CurrentUser, dto: Record<string, any>) {
    this.assert();
    const scopeType = String(dto.scope_type ?? 'MODEL').toUpperCase();
    if (!(RISK_SCOPES as readonly string[]).includes(scopeType)) throw new BadRequestException(`scope_type must be one of ${RISK_SCOPES.join(', ')}`);
    const category = String(dto.category ?? '').toUpperCase();
    if (!(RISK_CATEGORIES as readonly string[]).includes(category)) throw new BadRequestException(`category must be one of ${RISK_CATEGORIES.join(', ')}`);
    const title = String(dto.title ?? '').trim();
    if (title.length < 3) throw new BadRequestException('title is required');
    const scopeId = dto.scope_id ? String(dto.scope_id) : null;
    const orgId = await this.orgForScope(user, scopeType, scopeId, dto.org_id);
    const ownerUserId = await this.assertOwner(orgId, dto.owner_user_id);
    const now = new Date();
    const row = await this.risks.save({
      id: uuidv4(), orgId, scopeType, scopeId, category, title: title.slice(0, 300),
      description: dto.description ?? null, affectedParties: Array.isArray(dto.affected_parties) ? dto.affected_parties.map(String) : null,
      harmType: dto.harm_type ?? null, source: 'MANUAL', sourceRef: null, status: 'DRAFT',
      ownerUserId, nextReviewAt: null, reviewReason: null, dismissedReason: null,
      createdBy: user.email, createdAt: now, updatedAt: now,
    });
    return this.view(row, undefined, true);
  }

  async update(user: CurrentUser, id: string, dto: Record<string, any>, req?: any) {
    this.assert();
    const r = await this.loadRisk(user, id);
    if (dto.category !== undefined) {
      const c = String(dto.category).toUpperCase();
      if (!(RISK_CATEGORIES as readonly string[]).includes(c)) throw new BadRequestException('Unknown category');
      r.category = c;
    }
    if (dto.title !== undefined) r.title = String(dto.title).slice(0, 300);
    if (dto.description !== undefined) r.description = dto.description;
    if (dto.affected_parties !== undefined) r.affectedParties = Array.isArray(dto.affected_parties) ? dto.affected_parties.map(String) : null;
    if (dto.harm_type !== undefined) r.harmType = dto.harm_type;
    if (dto.owner_user_id !== undefined) r.ownerUserId = await this.assertOwner(r.orgId, dto.owner_user_id);
    if (dto.status !== undefined) {
      if (dto.status !== 'CLOSED') throw new BadRequestException('Only CLOSED can be set directly; other statuses follow the workflow');
      const reason = String(dto.reason ?? '').trim();
      if (reason.length < 5) throw new BadRequestException('A reason is required to close a risk');
      if (['DISMISSED', 'CLOSED'].includes(r.status)) throw new BadRequestException(`The risk is already ${r.status.toLowerCase()}`);
      // H2: closing must not be a way round acceptance. An assessed risk whose
      // residual is above appetite and has no valid acceptance can only be
      // closed by the approver the appetite names for its residual band.
      const s = (await this.settings.inForce(r.orgId)).settings;
      const latest = await this.latestAssessment(r.id);
      let closedAs: string | null = null;
      if (latest) {
        const within = withinAppetite(r.category, { l: latest.residualL, i: latest.residualI }, s);
        const accepted = await this.validAcceptance(r.id, latest.version);
        if (!within && !accepted) {
          if (user.tenantId !== r.orgId) throw new ForbiddenException('Only members of the risk’s organization can close it');
          const official = (await this.accountability.isAccountableOfficial(r.orgId, user.userId)) || (await this.accountability.isAccountableOfficialEmail(r.orgId, user.email));
          closedAs = acceptanceRole(latest.residualBand, s, user, official);
          if (!closedAs) {
            const who = (s.appetite.approvers[latest.residualBand] ?? []).map((w) => (w === 'ACCOUNTABLE_OFFICIAL' ? 'the accountable official' : w)).join(' or ');
            throw new ForbiddenException(`This ${latest.residualBand} residual risk is above appetite and not accepted: only ${who || 'a named approver'} can close it`);
          }
        }
      }
      const from = r.status;
      r.status = 'CLOSED';
      r.reviewReason = reason.slice(0, 300);
      if (req) {
        req.auditSummary = {
          risk_closed: {
            risk_id: r.id, title: r.title, from_status: from, reason: reason.slice(0, 500), closed_by: user.email,
            residual_band: latest?.residualBand ?? null, above_appetite_unaccepted: Boolean(closedAs), approver_role: closedAs,
          },
        };
      }
    }
    r.updatedAt = new Date();
    await this.risks.save(r);
    return this.view(r, undefined, true);
  }

  /** Record inherent and residual ratings (new version); resets any acceptance. */
  async assess(user: CurrentUser, id: string, dto: Record<string, any>, req?: any) {
    this.assert();
    const r = await this.loadRisk(user, id);
    if (['DISMISSED', 'CLOSED'].includes(r.status)) throw new BadRequestException(`A ${r.status.toLowerCase()} risk cannot be assessed`);
    const s = (await this.settings.inForce(r.orgId)).settings;
    const inherent = { l: Number(dto.inherent_likelihood), i: Number(dto.inherent_impact) };
    const residual = { l: Number(dto.residual_likelihood), i: Number(dto.residual_impact) };
    for (const rating of [inherent, residual]) {
      const err = validateRating(rating, s.scoringMatrix);
      if (err) throw new BadRequestException(err);
    }
    if (score(residual) > score(inherent)) throw new BadRequestException('Residual risk cannot exceed inherent risk; check the ratings');
    const rationale = String(dto.rationale ?? '').trim();
    if (rationale.length < 10) throw new BadRequestException('A rationale (at least 10 characters) is required');
    const latest = await this.latestAssessment(id);
    const now = new Date();
    const residualBand = band(residual, s);
    const a = await this.assessments.save({
      id: uuidv4(), riskId: id, version: (latest?.version ?? 0) + 1, matrix: s.scoringMatrix,
      inherentL: inherent.l, inherentI: inherent.i, residualL: residual.l, residualI: residual.i,
      inherentBand: band(inherent, s), residualBand, rationale,
      controlIds: Array.isArray(dto.control_ids) ? dto.control_ids.map(String) : null,
      assessedBy: user.email, assessedAt: now,
    });
    r.status = 'ASSESSED';
    r.reviewReason = null;
    r.nextReviewAt = new Date(now.getTime() + reviewIntervalDays(residualBand) * DAY);
    r.updatedAt = now;
    await this.risks.save(r);
    if (dto.treatment && dto.action) await this.addAction(user, id, { treatment: dto.treatment, action: dto.action, owner_user_id: dto.owner_user_id, due_at: dto.due_at });
    if (req) req.auditSummary = { risk_assessment: { risk_id: id, version: a.version, inherent: [inherent.l, inherent.i], residual: [residual.l, residual.i], residual_band: residualBand, rationale: rationale.slice(0, 500) } };
    return this.view(r, s, true);
  }

  /** Accept the latest residual rating. Only the approver the appetite names for the band may accept. */
  async accept(user: CurrentUser, id: string, dto: Record<string, any>, req?: any) {
    this.assert();
    const r = await this.loadRisk(user, id);
    const latest = await this.latestAssessment(id);
    if (!latest) throw new BadRequestException('Assess the risk before accepting it');
    if (['DISMISSED', 'CLOSED'].includes(r.status)) throw new BadRequestException(`A ${r.status.toLowerCase()} risk cannot be accepted`);
    if (r.status === 'REVIEW_DUE') throw new BadRequestException('The risk is due for re-review: re-assess it before accepting');
    const s = (await this.settings.inForce(r.orgId)).settings;
    if (latest.matrix !== s.scoringMatrix) throw new BadRequestException('The scoring matrix changed since this assessment: re-score before accepting');
    if (user.tenantId !== r.orgId) throw new ForbiddenException('Only members of the risk’s organization can accept it');
    const official = await this.accountability.isAccountableOfficial(r.orgId, user.userId);
    // CurrentUser.userId is the email in this codebase's JWT; also check by the user's id.
    const officialById = official || (await this.accountability.isAccountableOfficialEmail(r.orgId, user.email));
    const role = acceptanceRole(latest.residualBand, s, user, officialById);
    if (!role) {
      const who = (s.appetite.approvers[latest.residualBand] ?? []).map((w) => (w === 'ACCOUNTABLE_OFFICIAL' ? 'the accountable official' : w)).join(' or ');
      throw new ForbiddenException(`A ${latest.residualBand} residual risk must be accepted by ${who || 'a named approver'}`);
    }
    // M5 separation of duties: whoever rated a HIGH or CRITICAL residual cannot
    // also accept it.
    if ((latest.residualBand === 'HIGH' || latest.residualBand === 'CRITICAL') && latest.assessedBy === user.email) {
      throw new ForbiddenException(`You assessed this ${latest.residualBand} residual risk; a different approver must accept it`);
    }
    let expiresAt: Date | null = null;
    if (dto.expires_at) {
      expiresAt = new Date(dto.expires_at);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new BadRequestException('expires_at must be a future date');
    }
    const now = new Date();
    await this.acceptances.save({
      id: uuidv4(), riskId: id, assessmentVersion: latest.version, acceptedBy: user.email, role,
      acceptedAt: now, expiresAt, waiverRef: dto.waiver_ref ? String(dto.waiver_ref).slice(0, 200) : null,
      note: dto.note ? String(dto.note).slice(0, 1000) : null,
    });
    r.status = 'ACCEPTED';
    r.updatedAt = now;
    await this.risks.save(r);
    if (req) {
      req.auditSummary = {
        risk_acceptance: {
          risk_id: id, title: r.title, assessment_version: latest.version, residual_band: latest.residualBand,
          residual: [latest.residualL, latest.residualI], accepted_by: user.email, role, expires_at: expiresAt?.toISOString() ?? null,
          waiver_ref: dto.waiver_ref ?? null,
        },
      };
    }
    return this.view(r, s, true);
  }

  async addAction(user: CurrentUser, id: string, dto: Record<string, any>) {
    this.assert();
    const r = await this.loadRisk(user, id);
    const treatment = String(dto.treatment ?? '').toUpperCase();
    if (!(TREATMENTS as readonly string[]).includes(treatment)) throw new BadRequestException(`treatment must be one of ${TREATMENTS.join(', ')}`);
    const action = String(dto.action ?? '').trim();
    if (!action) throw new BadRequestException('action is required');
    const dueAt = this.parseDue(dto.due_at);
    const ownerUserId = await this.assertOwner(r.orgId, dto.owner_user_id);
    const a = await this.actions.save({
      id: uuidv4(), riskId: r.id, treatment, action: action.slice(0, 1000), ownerUserId,
      dueAt, status: 'OPEN', createdBy: user.email, createdAt: new Date(), completedAt: null,
    });
    return this.actionView(a);
  }

  async updateAction(user: CurrentUser, id: string, actionId: string, dto: Record<string, any>) {
    this.assert();
    const r = await this.loadRisk(user, id);
    const a = await this.actions.findOne({ where: { id: actionId, riskId: id } });
    if (!a) throw new NotFoundException('Action not found');
    if (dto.status) {
      if (!['OPEN', 'DONE', 'CANCELLED'].includes(dto.status)) throw new BadRequestException('status must be OPEN, DONE or CANCELLED');
      a.status = dto.status;
      a.completedAt = dto.status === 'DONE' ? new Date() : null;
    }
    if (dto.due_at !== undefined) a.dueAt = this.parseDue(dto.due_at);
    if (dto.owner_user_id !== undefined) a.ownerUserId = await this.assertOwner(r.orgId, dto.owner_user_id);
    await this.actions.save(a);
    return this.actionView(a);
  }

  /** Dismiss a suggested risk with a reason (design §3.3: keep, edit or dismiss each suggestion). */
  async dismiss(user: CurrentUser, id: string, reason: string) {
    this.assert();
    const r = await this.loadRisk(user, id);
    if ((reason ?? '').trim().length < 5) throw new BadRequestException('A reason is required to dismiss a risk');
    if (r.status !== 'DRAFT') throw new BadRequestException('Only draft (unassessed) risks can be dismissed; close an assessed risk instead');
    r.status = 'DISMISSED';
    r.dismissedReason = reason.trim().slice(0, 500);
    r.updatedAt = new Date();
    await this.risks.save(r);
    return this.view(r);
  }

  /* -------------------------------------------- catalogue and suggestions */

  catalogue() {
    this.assert();
    return { catalogue: STARTER_CATALOGUE };
  }

  /**
   * Pre-fill draft risks for a model: catalogue entries that fit its use and
   * enabled packs, plus one per operational signal (open incidents, a drift
   * alert, scan security findings). Idempotent: nothing is suggested twice.
   */
  async suggest(user: CurrentUser, modelId: string) {
    this.assert();
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model is not in an organization');
    const s = (await this.settings.inForce(orgId)).settings;
    const existing = await this.risks.find({ where: { scopeType: 'MODEL', scopeId: modelId } });
    const have = new Set(existing.map((r) => `${r.source}|${r.sourceRef}`));
    const now = new Date();
    const created: RiskEntity[] = [];
    const add = async (source: string, sourceRef: string, category: string, title: string, description: string) => {
      if (have.has(`${source}|${sourceRef}`)) return;
      have.add(`${source}|${sourceRef}`);
      created.push(await this.risks.save({
        id: uuidv4(), orgId, scopeType: 'MODEL', scopeId: modelId, category, title, description,
        affectedParties: model.targetCustomerSegments ?? null, harmType: null, source, sourceRef, status: 'DRAFT',
        ownerUserId: model.ownerUserId ?? null, nextReviewAt: null, reviewReason: null, dismissedReason: null,
        createdBy: user.email, createdAt: now, updatedAt: now,
      }));
    };
    for (const c of catalogueFor(model, s.enabledPacks)) await add('CATALOGUE', c.id, c.category, c.title, c.description);
    const openIncidents = await this.incidents.find({ where: { modelId, status: Not(In([IncidentStatus.RESOLVED, IncidentStatus.CLOSED])) } });
    for (const i of openIncidents) {
      await add('INCIDENT', i.id, i.incidentCategory === 'BIAS_DISCRIMINATION' ? 'FAIRNESS' : i.incidentCategory === 'DATA_PRIVACY_BREACH' ? 'PRIVACY' : i.incidentCategory === 'ADVERSARIAL_ATTACK' ? 'SECURITY' : i.incidentCategory === 'SYSTEM_UNAVAILABILITY' ? 'RESILIENCE' : i.incidentCategory === 'MODEL_DRIFT' ? 'PERFORMANCE' : 'CONDUCT',
        `Incident: ${String(i.description ?? i.incidentCategory).slice(0, 120)}`, `Raised from incident ${i.id} (${i.severity}).`);
    }
    const drift = await this.drifts.findOne({ where: { modelId }, order: { computedAt: 'DESC' } });
    if (drift && drift.status !== 'NOMINAL') {
      await add('DRIFT_ALERT', drift.id, 'PERFORMANCE', `Drift alert: ${drift.status.toLowerCase().replace(/_/g, ' ')}`, `Latest drift evaluation ${drift.computedAt.toISOString().slice(0, 10)} reported ${drift.status}.`);
    }
    const findings = (model as any).securityFindings as any[] | null;
    if (Array.isArray(findings) && findings.length) {
      await add('SCAN_FINDING', `security:${findings.length}`, 'SECURITY', 'Security findings from the code scan', `${findings.length} security finding(s) recorded on the model by the scanner.`);
    }
    const views: Array<Record<string, any>> = [];
    for (const r of created) views.push(await this.view(r, s));
    return { model_id: modelId, created: views.length, risks: views };
  }

  /* -------------------------------------------------------------- heatmap */

  async heatmap(user: CurrentUser, q: { model_id?: string; org_id?: string }) {
    this.assert();
    const orgId = user.role === Role.ADMIN && q.org_id ? q.org_id : user.tenantId;
    if (!orgId) throw new BadRequestException('No organization');
    if (q.model_id) await modelForUser(this.models, this.projects, user, q.model_id);
    const s = (await this.settings.inForce(orgId)).settings;
    const n = s.scoringMatrix === '3x3' ? 3 : 5;
    const empty = () => Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
    const inherent = empty();
    const residual = empty();
    const where: Record<string, any> = { orgId, status: Not(In(['DISMISSED', 'CLOSED'])) };
    if (q.model_id) Object.assign(where, { scopeType: 'MODEL', scopeId: q.model_id });
    let counted = 0;
    let skipped = 0;
    for (const r of await this.risks.find({ where })) {
      const a = await this.latestAssessment(r.id);
      if (!a) continue;
      // Risks scored on another matrix cannot be placed on this grid until re-scored.
      if (a.matrix !== s.scoringMatrix) { skipped++; continue; }
      inherent[a.inherentL - 1][a.inherentI - 1]++;
      residual[a.residualL - 1][a.residualI - 1]++;
      counted++;
    }
    return { org_id: orgId, model_id: q.model_id ?? null, matrix: s.scoringMatrix, bands: s.bands, axes: { rows: 'likelihood', cols: 'impact' }, inherent, residual, counted, awaiting_rescore: skipped };
  }

  /* ------------------------------------------------------- re-review */

  /** An event on a model moves its assessed and accepted risks to REVIEW_DUE. */
  async triggerReview(modelId: string, event: string, detail?: Record<string, any>): Promise<number> {
    const rows = await this.risks.find({ where: { scopeType: 'MODEL', scopeId: modelId, status: In(['ASSESSED', 'ACCEPTED']) } });
    const reason = `${event.toLowerCase().replace(/_/g, ' ')}${detail?.ref ? ` (${detail.ref})` : ''} on ${new Date().toISOString().slice(0, 10)}`;
    for (const r of rows) {
      r.status = 'REVIEW_DUE';
      r.reviewReason = reason.slice(0, 300);
      r.updatedAt = new Date();
      await this.risks.save(r);
    }
    return rows.length;
  }

  /** Daily: risks past their review date become REVIEW_DUE. */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async reviewDates(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('riskRegister')) return 0;
    const due = await this.risks.find({ where: { status: In(['ASSESSED', 'ACCEPTED']), nextReviewAt: LessThan(now) } });
    for (const r of due) {
      r.status = 'REVIEW_DUE';
      r.reviewReason = `review date ${r.nextReviewAt!.toISOString().slice(0, 10)} passed`;
      r.updatedAt = now;
      await this.risks.save(r);
    }
    // L2: an accepted risk whose acceptance has lapsed is due for review too, so
    // its status matches what the gate already treats it as.
    let lapsed = 0;
    for (const r of await this.risks.find({ where: { status: 'ACCEPTED' } })) {
      const a = await this.latestAssessment(r.id);
      if (!a || (await this.validAcceptance(r.id, a.version, now))) continue;
      r.status = 'REVIEW_DUE';
      r.reviewReason = 'risk acceptance expired';
      r.updatedAt = now;
      await this.risks.save(r);
      lapsed++;
    }
    if (due.length + lapsed) this.logger.log(`risk register: ${due.length + lapsed} risk(s) due for review`);
    return due.length + lapsed;
  }

  /* --------------------------------------------------------------- gate */

  async registerFacts(modelId: string, orgId: string) {
    const s = (await this.settings.inForce(orgId)).settings;
    const rows = await this.risks.find({ where: { scopeType: 'MODEL', scopeId: modelId, status: Not(In(['DISMISSED', 'CLOSED'])) } });
    let assessed = 0;
    let unaccepted = 0;
    for (const r of rows) {
      const a = await this.latestAssessment(r.id);
      if (!a) { unaccepted++; continue; }
      assessed++;
      const ok = r.status !== 'REVIEW_DUE' && (withinAppetite(r.category, { l: a.residualL, i: a.residualI }, s) || (await this.validAcceptance(r.id, a.version)));
      if (!ok) unaccepted++;
    }
    return { total: rows.length, assessed, unaccepted };
  }

  /**
   * Residual-risk gate for a model: findings that block or warn per the
   * organisation's gate mode for the model's tier. Every risk must be
   * accepted or within appetite; HIGH/CRITICAL models need a register.
   */
  async gateCheck(modelId: string): Promise<{ mode: string; tier: string; block: GateFinding[]; warn: GateFinding[] } | null> {
    const risksOn = this.flags.isEnabled('riskRegister');
    if (!this.flags.isEnabled('governanceSettings') || (!risksOn && !this.flags.isEnabled('impactAssessment'))) return null;
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model?.projectId) return null;
    const project = await this.projects.findOne({ where: { id: model.projectId } });
    const orgId = project?.tenantId;
    if (!orgId) return null;
    const s = (await this.settings.inForce(orgId)).settings;
    const tier = gateTierOf(model.riskLevel);
    const mode = s.gateMode[tier] ?? 'OFF';
    if (mode === 'OFF') return { mode, tier, block: [], warn: [] };
    const findings: GateFinding[] = [];
    if (risksOn) {
      const facts = await this.registerFacts(modelId, orgId);
      if ((tier === 'HIGH' || tier === 'CRITICAL') && facts.assessed === 0) {
        findings.push({ code: 'risk_register_empty', message: `${tier} model has no assessed risks in the register` });
      }
      if (facts.unaccepted > 0) {
        findings.push({ code: 'residual_risk_unaccepted', message: `${facts.unaccepted} risk(s) above appetite, unassessed or due for review without a valid acceptance` });
      }
    }
    // M1: the appetite (or the RBI pack floor) can require a third-party audit for the tier.
    if (s.appetite?.requiredAuditType?.[tier] === 'THIRD_PARTY') {
      const external = await this.audits.count({ where: { modelId, auditType: In([AuditType.THIRD_PARTY, AuditType.SUPERVISORY]) } });
      if (!external) findings.push({ code: 'third_party_audit_required', message: `${tier} models need a third-party audit under the organization's risk appetite; none is recorded` });
    }
    for (const c of this.gateContributors) findings.push(...(await c(model, orgId, s)));
    return { mode, tier, block: mode === 'BLOCK' ? findings : [], warn: mode === 'WARN' ? findings : [] };
  }

  async gateView(user: CurrentUser, modelId: string) {
    if (!this.flags.isEnabled('riskRegister') && !this.flags.isEnabled('impactAssessment')) throw new NotFoundException();
    await modelForUser(this.models, this.projects, user, modelId);
    const g = await this.gateCheck(modelId);
    return { model_id: modelId, ...(g ?? { mode: 'OFF', tier: null, block: [], warn: [] }), verdict: g?.block.length ? 'BLOCK' : g?.warn.length ? 'WARN' : 'PASS' };
  }

  /** Residual risks and limitations for the public transparency card (closes NIST MANAGE 1.4). */
  async cardRisks(modelId: string) {
    const rows = await this.risks.find({ where: { scopeType: 'MODEL', scopeId: modelId, status: In(['ASSESSED', 'ACCEPTED', 'REVIEW_DUE']) } });
    const out: Array<Record<string, any>> = [];
    for (const r of rows) {
      const a = await this.latestAssessment(r.id);
      if (!a) continue;
      out.push({ category: r.category, title: publicRiskTitle(r), residual_band: a.residualBand, status: r.status === 'ACCEPTED' ? 'accepted' : 'under management' });
    }
    return out;
  }
}

/**
 * M3: the public card never shows internal risk titles. Starter-catalogue
 * risks keep their generic catalogue title; anything else (manual entries,
 * incident, drift or scan derived risks) is published as its category only.
 */
export function publicRiskTitle(r: { source: string; sourceRef: string | null; category: string }): string {
  if (r.source === 'CATALOGUE') {
    const entry = STARTER_CATALOGUE.find((c) => c.id === r.sourceRef);
    if (entry) return entry.title;
  }
  const label = r.category.charAt(0) + r.category.slice(1).toLowerCase().replace(/_/g, ' ');
  return `${label} risk`;
}
