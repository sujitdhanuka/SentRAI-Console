/**
 * US adverse-action and reconsideration kit (E2.2): a reason-code map per
 * model, adverse-action notices generated from the per-decision explanation
 * with a check that the stated reasons match the top factors, decision-linked
 * grievances, appeals after a rejection, human reconsideration with reviewer,
 * authority, evidence and outcome, data-correction requests, a public request
 * path for consumers, and a retention purge (Reg B 25 months, Colorado 3 years).
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AdverseActionNoticeEntity,
  AIModelEntity,
  DecisionAppealEntity,
  ExplainabilityRecordEntity,
  GrievanceEntity,
  ImpactAssessmentEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
  UserEntity,
} from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts } from '../hooks';
import { phase2Param } from '../packs/parameter-resolver';
import { PacksService } from '../packs/packs.service';
import { addMonths, DAY_MS, MAINTAINERS, oneOf, optText, orgFor, orgOfModel, orgParams, reqText, requireRole } from '../phase2-util';
import {
  ADVERSE_SIGNS,
  AdverseSign,
  APPEAL_OUTCOMES,
  APPEAL_TYPES,
  AppealType,
  checkNotice,
  isCreditDecisioning,
  isFavourableOutcome,
  MAX_PRINCIPAL_REASONS,
  NOTICE_CHANNELS,
  REG_B_RETENTION_MONTHS,
  ReasonCodeMap,
  topFactors,
  validateReasonCodeMap,
} from './decisions.model';
import { scopeModelWhere } from '../project-scope';

const OPEN_APPEAL = ['OPEN'];

@Injectable()
export class DecisionsService implements OnModuleInit {
  private readonly logger = new Logger(DecisionsService.name);

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ExplainabilityRecordEntity) private readonly explanations: Repository<ExplainabilityRecordEntity>,
    @InjectRepository(AdverseActionNoticeEntity) private readonly notices: Repository<AdverseActionNoticeEntity>,
    @InjectRepository(DecisionAppealEntity) private readonly appeals: Repository<DecisionAppealEntity>,
    @InjectRepository(GrievanceEntity) private readonly grievances: Repository<GrievanceEntity>,
    @InjectRepository(ImpactAssessmentEntity) private readonly ias: Repository<ImpactAssessmentEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly packs: PacksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId, orgId) => {
      if (!this.flags.isEnabled('usKit') || !orgId) return undefined;
      return this.modelFacts(modelId, orgId);
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'usKit');
  }

  private async params(orgId: string | null) {
    const v = await orgParams(this.packs, orgId);
    return {
      retentionMonths: Math.max(REG_B_RETENTION_MONTHS, phase2Param(v, 'decisionRecordRetentionMonths')),
      appealDays: phase2Param(v, 'appealResponseDays'),
    };
  }

  private async ledgerEvent(modelId: string, eventType: string, data: Record<string, any>, actor: string) {
    await this.ledger.save(this.ledger.create({ id: uuidv4(), modelId, eventType, eventData: data, actor, occurredAt: new Date() }));
  }

  /* ---------------------------------------------------------------- facts */

  async modelFacts(modelId: string, orgId: string) {
    const m = await this.models.findOne({ where: { id: modelId } });
    if (!m) return undefined;
    const map = (m.reasonCodeMap ?? {}) as ReasonCodeMap;
    const notices = await this.notices.find({ where: { modelId } });
    const unmapped = new Set<string>();
    for (const n of notices) for (const f of (n.topFactors ?? []) as Array<{ feature: string }>) if (!map[f.feature]) unmapped.add(f.feature);
    const months = notices.map((n) => Math.round((n.retentionUntil.getTime() - n.sentAt.getTime()) / (30.44 * DAY_MS)));
    const appeals = await this.appeals.find({ where: { modelId } });
    const now = Date.now();
    const ias = await this.ias.find({ where: { modelId }, order: { version: 'DESC' } });
    const us = ias.find((r) => !['DRAFT', 'SUPERSEDED'].includes(r.status) && (r.packIds ?? []).includes('us-m25-21'));
    const p = await this.params(orgId);
    return {
      adverseAction: {
        applicable: isCreditDecisioning(m.functionalArea) || Object.keys(map).length > 0,
        mapped: Object.keys(map).length,
        unmappedTopFeatures: [...unmapped].sort(),
        notices: notices.length,
        inconsistent: notices.filter((n) => !n.consistent).length,
        minRetentionMonths: months.length ? Math.min(...months) : null,
        requiredRetentionMonths: p.retentionMonths,
      },
      appeals: {
        open: appeals.filter((a) => OPEN_APPEAL.includes(a.status)).length,
        overdue: appeals.filter((a) => OPEN_APPEAL.includes(a.status) && a.dueAt && a.dueAt.getTime() < now).length,
        decided: appeals.filter((a) => a.status === 'DECIDED').length,
      },
      usPolicy: {
        highImpact: us ? us.highImpact : null,
        determined: !!us && us.highImpact !== null,
        ownerNamed: m.ownerUserId ?? null,
      },
    };
  }

  /* ---------------------------------------------------------- reason codes */

  async getReasonCodes(user: CurrentUser, modelId: string) {
    this.assert();
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    return { model_id: modelId, credit_decisioning: isCreditDecisioning(model.functionalArea), adverse_sign: model.reasonCodeSign, map: model.reasonCodeMap ?? {} };
  }

  async putReasonCodes(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit reason codes');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    const map = body.map;
    const problems = validateReasonCodeMap(map);
    if (problems.length) throw new BadRequestException(problems);
    const clean: ReasonCodeMap = {};
    for (const [f, rc] of Object.entries(map as Record<string, any>)) clean[f.trim()] = { code: rc.code, text: rc.text.trim() };
    model.reasonCodeMap = clean;
    model.reasonCodeSign = oneOf(body.adverse_sign ?? model.reasonCodeSign, ADVERSE_SIGNS, 'adverse_sign (which contribution sign pushes towards the adverse outcome)');
    model.updatedAt = new Date();
    await this.models.save(model);
    await this.ledgerEvent(modelId, 'REASON_CODES_UPDATED', { features: Object.keys(clean).length }, user.email);
    if (req) req.auditSummary = { reason_codes_updated: { model_id: modelId, features: Object.keys(clean).length } };
    return { model_id: modelId, adverse_sign: model.reasonCodeSign, map: clean };
  }

  /* --------------------------------------------------------------- notices */

  private noticeView(n: AdverseActionNoticeEntity) {
    return {
      notice_id: n.id, model_id: n.modelId, decision_ref: n.decisionRef, explainability_record_id: n.explainabilityRecordId,
      reason_codes: n.reasonCodes, top_factors: n.topFactors, consistent: n.consistent, mismatches: n.mismatches ?? [],
      channel: n.channel, sent_at: n.sentAt, retention_until: n.retentionUntil, created_by: n.createdBy, created_at: n.createdAt,
    };
  }

  /**
   * The newest explanation recorded for a decision BY THIS MODEL. Explanations
   * that name no model are never used: decision references are not unique across
   * organisations, so an untied record could belong to anyone.
   */
  private async explanation(decisionRef: string, modelId: string) {
    return this.explanations.findOne({ where: { decisionRef, modelId }, order: { createdAt: 'DESC' } });
  }

  /** POST /governance/decisions/:ref/notices: build a notice from the decision's explanation and the model's map. */
  async createNotice(user: CurrentUser, decisionRef: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'issue adverse-action notices');
    const ref = reqText(decisionRef, 'decision_ref', 1, 255);
    const { model, orgId } = await modelForUser(this.models, this.projects, user, reqText(body.model_id, 'model_id'));
    if (!orgId) throw new BadRequestException('The model is not in an organization');
    const exp = await this.explanation(ref, model.id);
    if (!exp) throw new NotFoundException('No explanation is recorded for this decision by this model; record one with POST /audit/explainability/record and its model_id first');
    if (isFavourableOutcome(exp.decisionOutcome)) throw new BadRequestException(`The decision's outcome is ${exp.decisionOutcome}; adverse-action notices are for adverse decisions`);
    const map = (model.reasonCodeMap ?? {}) as ReasonCodeMap;
    if (!Object.keys(map).length) throw new BadRequestException('Map this model’s features to reason codes first (PUT /governance/models/:id/reason-codes)');
    const sign = model.reasonCodeSign as AdverseSign | null;
    if (!sign) throw new BadRequestException('Set which contribution sign is adverse for this model (adverse_sign on PUT /governance/models/:id/reason-codes)');
    const factors = topFactors(exp.topFeatures, MAX_PRINCIPAL_REASONS, sign);
    const stated = Array.isArray(body.reason_codes) ? body.reason_codes.map(String) : null;
    const check = checkNotice(map, factors, stated);
    if (!check.reasonCodes.length) throw new BadRequestException({ message: 'None of the decision’s top factors has a reason code', mismatches: check.mismatches });
    const sentAt = body.sent_at ? new Date(body.sent_at) : new Date();
    if (Number.isNaN(sentAt.getTime())) throw new BadRequestException('sent_at must be a date');
    // A notice is recorded when it is sent: no future dates, and no back-dating beyond 90 days (which would also shorten retention).
    if (sentAt.getTime() > Date.now() + DAY_MS || sentAt.getTime() < Date.now() - 90 * DAY_MS) throw new BadRequestException('sent_at must be within the last 90 days');
    const p = await this.params(orgId);
    const now = new Date();
    const n = await this.notices.save({
      id: uuidv4(), orgId, modelId: model.id, decisionRef: ref, explainabilityRecordId: exp.id, reasonCodes: check.reasonCodes,
      topFactors: factors, consistent: check.consistent, mismatches: check.mismatches.length ? check.mismatches : null,
      channel: oneOf(body.channel, NOTICE_CHANNELS, 'channel', 'MAIL'), sentAt, retentionUntil: addMonths(sentAt, p.retentionMonths),
      createdBy: user.email, createdAt: now,
    });
    await this.ledgerEvent(model.id, 'ADVERSE_ACTION_NOTICE', { notice_id: n.id, decision_ref: ref, consistent: n.consistent }, user.email);
    if (req) req.auditSummary = { adverse_action_notice: { notice_id: n.id, model_id: model.id, decision_ref: ref, consistent: n.consistent } };
    return this.noticeView(n);
  }

  async listNotices(user: CurrentUser, q: { model_id?: string; decision_ref?: string; org_id?: string; inconsistent?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const where: Record<string, any> = { orgId };
    if (q.model_id) where.modelId = q.model_id;
    if (q.decision_ref) where.decisionRef = q.decision_ref;
    if (q.inconsistent === 'true') where.consistent = false;
    return { org_id: orgId, notices: (await this.notices.find({ where: await scopeModelWhere(this.models, where), order: { createdAt: 'DESC' } })).map((n) => this.noticeView(n)) };
  }

  /** Everything recorded about one decision in the caller's organisation. */
  async decision(user: CurrentUser, decisionRef: string, q: { model_id?: string; org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const notices = await this.notices.find({ where: { orgId, decisionRef }, order: { createdAt: 'DESC' } });
    const appeals = await this.appeals.find({ where: { orgId, decisionRef }, order: { createdAt: 'DESC' } });
    const grievances = await this.grievances.find({ where: { tenantId: orgId, decisionRef }, order: { createdAt: 'DESC' } });
    // The explanation itself is shown only when the decision is already tied to
    // this organisation (a notice, appeal or grievance), or to a model the caller can see.
    let modelId = notices[0]?.modelId ?? appeals[0]?.modelId ?? grievances[0]?.modelId ?? null;
    if (q.model_id && (await modelForUser(this.models, this.projects, user, q.model_id)).orgId === orgId) modelId = q.model_id;
    if (!modelId) throw new NotFoundException('No record of this decision in your organization');
    const exp = await this.explanation(decisionRef, modelId);
    if (!exp && !notices.length && !appeals.length && !grievances.length) throw new NotFoundException('No record of this decision in your organization');
    const sign = (await this.models.findOne({ where: { id: modelId }, select: ['id', 'reasonCodeSign'] }))?.reasonCodeSign as AdverseSign | null;
    return {
      decision_ref: decisionRef,
      model_id: modelId,
      explanation: exp
        ? { record_id: exp.id, outcome: exp.decisionOutcome, confidence: exp.confidenceScore, top_factors: topFactors(exp.topFeatures, MAX_PRINCIPAL_REASONS, sign), summary: exp.humanReadableSummary, contestable: exp.isContestable, created_at: exp.createdAt }
        : null,
      notices: notices.map((n) => this.noticeView(n)),
      appeals: appeals.map((a) => this.appealView(a)),
      grievances: grievances.map((g) => ({ grievance_id: g.id, subject: g.subject, status: g.status, appeal_of: g.appealOf, created_at: g.createdAt })),
    };
  }

  /* ---------------------------------------------------- grievances/appeals */

  private appealView(a: DecisionAppealEntity) {
    return {
      appeal_id: a.id, model_id: a.modelId, grievance_id: a.grievanceId, decision_ref: a.decisionRef, type: a.type, status: a.status,
      request: a.request, requested_by: a.requestedBy, reviewer_user_id: a.reviewerUserId, authority: a.authority, evidence: a.evidence,
      outcome: a.outcome, outcome_notes: a.outcomeNotes, decided_at: a.decidedAt, decided_by: a.decidedBy, due_at: a.dueAt,
      overdue: a.status === 'OPEN' && !!a.dueAt && a.dueAt.getTime() < Date.now(), retention_until: a.retentionUntil, created_at: a.createdAt,
    };
  }

  private async grievanceForUser(user: CurrentUser, id: string): Promise<GrievanceEntity> {
    const g = await this.grievances.findOne({ where: { id } });
    if (!g || (user.role !== Role.ADMIN && g.tenantId !== user.tenantId)) throw new NotFoundException('Grievance not found');
    return g;
  }

  async linkDecision(user: CurrentUser, grievanceId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'link grievances to decisions');
    const g = await this.grievanceForUser(user, grievanceId);
    const ref = reqText(body.decision_ref, 'decision_ref', 1, 255);
    if (g.decisionRef && g.decisionRef !== ref) throw new BadRequestException('This grievance is already linked to another decision');
    if (!(await this.explanation(ref, g.modelId))) throw new NotFoundException('No explanation is recorded for this decision by this model');
    g.decisionRef = ref;
    g.updatedAt = new Date();
    await this.grievances.save(g);
    return { grievance_id: g.id, decision_ref: ref };
  }

  private async openAppeal(orgId: string, modelId: string, grievanceId: string | null, decisionRef: string, type: AppealType, request: string, requestedBy: string, createdBy: string) {
    const p = await this.params(orgId);
    const now = new Date();
    if (await this.appeals.findOne({ where: { decisionRef, modelId, type, status: In(OPEN_APPEAL) } })) {
      throw new BadRequestException(`An open ${type.toLowerCase().replace('_', ' ')} request already exists for this decision`);
    }
    const a = await this.appeals.save({
      id: uuidv4(), orgId, modelId, grievanceId, decisionRef, type, status: 'OPEN', request, requestedBy, reviewerUserId: null,
      authority: null, evidence: null, outcome: null, outcomeNotes: null, decidedAt: null, decidedBy: null,
      dueAt: new Date(now.getTime() + p.appealDays * DAY_MS), retentionUntil: null, createdBy, createdAt: now, updatedAt: now,
    });
    await this.ledgerEvent(modelId, 'DECISION_APPEAL_OPENED', { appeal_id: a.id, type, decision_ref: decisionRef }, createdBy);
    return a;
  }

  /**
   * Appeal after a rejection (a new grievance that points at the rejected one),
   * or a request for human reconsideration or data correction on a decision.
   */
  async requestFromGrievance(user: CurrentUser, grievanceId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'open appeals');
    const g = await this.grievanceForUser(user, grievanceId);
    const type = oneOf(body.type, APPEAL_TYPES, 'type', 'APPEAL');
    const ref = g.decisionRef ?? (body.decision_ref ? reqText(body.decision_ref, 'decision_ref', 1, 255) : null);
    if (!ref) throw new BadRequestException('Link the grievance to a decision first (decision_ref)');
    if (!g.tenantId) throw new BadRequestException('The grievance is not in an organization');
    const request = reqText(body.request, 'request', 10);
    let appealGrievanceId: string | null = g.id;
    if (type === 'APPEAL') {
      if (g.status !== 'REJECTED') throw new BadRequestException('An appeal follows a rejected grievance');
      if (await this.grievances.findOne({ where: { appealOf: g.id } })) throw new BadRequestException('This rejection has already been appealed');
      const now = new Date();
      const p = await this.params(g.tenantId);
      const appealG = await this.grievances.save(this.grievances.create({
        id: uuidv4(), modelId: g.modelId, tenantId: g.tenantId, subject: `Appeal: ${g.subject}`.slice(0, 200), description: request,
        complainant: g.complainant, channel: g.channel, category: g.category, severity: g.severity, status: 'RECEIVED', resolutionNotes: null,
        slaDueAt: new Date(now.getTime() + p.appealDays * DAY_MS), createdAt: now, updatedAt: now, acknowledgedAt: null, resolvedAt: null,
        decisionRef: ref, appealOf: g.id,
      }));
      appealGrievanceId = appealG.id;
    } else if (!g.decisionRef) {
      g.decisionRef = ref;
      await this.grievances.save(g);
    }
    const a = await this.openAppeal(g.tenantId, g.modelId, appealGrievanceId, ref, type, request, optText(body.requested_by, 'requested_by', 255) ?? 'consumer', user.email);
    return this.appealView(a);
  }

  /**
   * Human reconsideration: a reviewer with authority decides, with evidence.
   * The reviewer must not be the person who issued the notice on the decision.
   */
  async decide(user: CurrentUser, appealId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'decide appeals');
    const a = await this.appeals.findOne({ where: { id: appealId } });
    if (!a || (user.role !== Role.ADMIN && a.orgId !== user.tenantId)) throw new NotFoundException('Appeal not found');
    if (a.status !== 'OPEN') throw new BadRequestException(`This request is already ${a.status.toLowerCase()}`);
    const issuers = (await this.notices.find({ where: { decisionRef: a.decisionRef, modelId: a.modelId } })).map((n) => n.createdBy);
    if (issuers.includes(user.email)) throw new ForbiddenException('You issued the adverse-action notice on this decision; another reviewer must reconsider it');
    if (a.createdBy === user.email && user.role !== Role.ADMIN && !body.self_review_reason) {
      // Allowed only with a stated reason (small teams), recorded with the decision.
      throw new ForbiddenException('You opened this request; another reviewer should decide it, or give self_review_reason');
    }
    const outcome = oneOf(body.outcome, APPEAL_OUTCOMES, 'outcome');
    if (a.type === 'DATA_CORRECTION' && !['CORRECTED', 'NO_CHANGE'].includes(outcome)) throw new BadRequestException('A data-correction request is CORRECTED or NO_CHANGE');
    if (a.type !== 'DATA_CORRECTION' && outcome === 'CORRECTED') throw new BadRequestException('CORRECTED applies to data-correction requests');
    const authority = reqText(body.authority, 'authority (the reviewer’s authority to change the decision)', 5, 1000);
    const evidence = reqText(body.evidence, 'evidence considered', 10);
    const notes = reqText(body.outcome_notes, 'outcome_notes', 10);
    const p = await this.params(a.orgId);
    const now = new Date();
    a.status = 'DECIDED';
    a.outcome = outcome;
    a.outcomeNotes = body.self_review_reason ? `${notes}\n[self-review: ${String(body.self_review_reason).slice(0, 300)}]` : notes;
    a.authority = authority;
    a.evidence = evidence;
    a.reviewerUserId = (await this.users.findOne({ where: { email: user.email }, select: ['id'] }))?.id ?? null;
    a.decidedBy = user.email;
    a.decidedAt = now;
    a.retentionUntil = addMonths(now, p.retentionMonths);
    a.updatedAt = now;
    await this.appeals.save(a);
    // The appeal's own grievance closes with the outcome.
    if (a.type === 'APPEAL' && a.grievanceId) {
      const g = await this.grievances.findOne({ where: { id: a.grievanceId } });
      if (g && !['RESOLVED', 'REJECTED', 'CLOSED'].includes(g.status)) {
        g.status = outcome === 'UPHELD' || outcome === 'NO_CHANGE' ? 'REJECTED' : 'RESOLVED';
        g.resolutionNotes = `Appeal ${outcome.toLowerCase()} by ${user.email}: ${notes}`.slice(0, 2000);
        g.resolvedAt = now;
        g.acknowledgedAt = g.acknowledgedAt ?? now;
        g.updatedAt = now;
        await this.grievances.save(g);
      }
    }
    await this.ledgerEvent(a.modelId, 'DECISION_APPEAL_DECIDED', { appeal_id: a.id, type: a.type, outcome, reviewer: user.email }, user.email);
    if (req) req.auditSummary = { decision_appeal_decided: { appeal_id: a.id, decision_ref: a.decisionRef, type: a.type, outcome, reviewer: user.email } };
    return this.appealView(a);
  }

  async listAppeals(user: CurrentUser, q: { status?: string; model_id?: string; type?: string; org_id?: string; overdue?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const where: Record<string, any> = { orgId };
    if (q.status) where.status = q.status;
    if (q.model_id) where.modelId = q.model_id;
    if (q.type) where.type = q.type;
    if (q.overdue === 'true') Object.assign(where, { status: 'OPEN', dueAt: LessThan(new Date()) });
    const rows = await this.appeals.find({ where: await scopeModelWhere(this.models, where), order: { createdAt: 'DESC' } });
    const open = await this.appeals.find({ where: await scopeModelWhere(this.models, { orgId, status: 'OPEN' }) });
    return {
      org_id: orgId,
      appeals: rows.map((a) => this.appealView(a)),
      summary: { open: open.length, overdue: open.filter((a) => a.dueAt && a.dueAt.getTime() < Date.now()).length },
    };
  }

  /**
   * Public path (Colorado SB 26-189): a consumer asks for human
   * reconsideration or data correction of a decision, or appeals a rejected
   * grievance, by model ID and decision reference. The decision must exist.
   */
  async publicRequest(modelId: string, body: Record<string, any>) {
    this.assert();
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    const orgId = await orgOfModel(this.models, this.projects, modelId);
    if (!orgId) throw new NotFoundException('Model not found');
    const type = oneOf(body.type, APPEAL_TYPES, 'type', 'RECONSIDERATION');
    const ref = reqText(body.decision_ref, 'decision_ref', 1, 255);
    const description = reqText(body.description, 'description', 10);
    const exp = await this.explanation(ref, modelId);
    // Ties the decision to this model: a notice was issued, or a grievance was filed, about it.
    const known = exp && ((await this.notices.count({ where: { modelId, decisionRef: ref } })) > 0 || (await this.grievances.count({ where: { modelId, decisionRef: ref } })) > 0);
    if (!known) throw new NotFoundException('Decision not found for this system; use the reference on your notice');
    const complainant = optText(body.complainant, 'complainant', 255);
    const masked = complainant ? (complainant.includes('@') ? `${complainant.slice(0, 2)}***@${complainant.split('@')[1] ?? ''}` : `${complainant.slice(0, 2)}***`) : null;
    if (type === 'APPEAL') {
      const gid = reqText(body.grievance_id, 'grievance_id');
      const g = await this.grievances.findOne({ where: { id: gid } });
      if (!g || g.modelId !== modelId) throw new NotFoundException('Grievance not found');
      if (g.status !== 'REJECTED') throw new BadRequestException('An appeal follows a rejected grievance');
      if (await this.grievances.findOne({ where: { appealOf: g.id } })) throw new BadRequestException('This rejection has already been appealed');
    }
    // A request that is already open gets the same answer and creates nothing, so repeats cannot fill the grievance queue.
    const open = await this.appeals.findOne({ where: { decisionRef: ref, modelId, type, status: In(OPEN_APPEAL) } });
    if (open) return { type, status: 'RECEIVED', respond_by: open.dueAt };
    const p = await this.params(orgId);
    const now = new Date();
    const g = await this.grievances.save(this.grievances.create({
      id: uuidv4(), modelId, tenantId: orgId,
      subject: (type === 'DATA_CORRECTION' ? 'Data correction request' : type === 'APPEAL' ? 'Appeal of a rejected grievance' : 'Request for human reconsideration').slice(0, 200),
      description, complainant: masked, channel: 'web', category: type === 'DATA_CORRECTION' ? 'inaccuracy' : 'unfair_outcome', severity: 'MEDIUM',
      status: 'RECEIVED', resolutionNotes: null, slaDueAt: new Date(now.getTime() + p.appealDays * DAY_MS), createdAt: now, updatedAt: now,
      acknowledgedAt: null, resolvedAt: null, decisionRef: ref, appealOf: type === 'APPEAL' ? String(body.grievance_id) : null,
    }));
    const a = await this.openAppeal(orgId, modelId, g.id, ref, type, description, masked ?? 'consumer', 'public');
    return { type, status: 'RECEIVED', respond_by: a.dueAt };
  }

  /* -------------------------------------------------------------- retention */

  /**
   * Daily: delete notices and decided appeal records past their retention date.
   * Retention is worked out again at purge time from the organisation's current
   * parameters (strictest of the stored date and the current period), and nothing
   * is purged while the decision still has an open request or an unresolved grievance.
   * Linked grievances stay in the grievance register; their complainant details are
   * removed once the decision's records are gone.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(now = new Date()): Promise<{ notices: number; appeals: number; anonymised: number }> {
    if (!this.flags.isEnabled('usKit')) return { notices: 0, appeals: 0, anonymised: 0 };
    const months = new Map<string, number>();
    const monthsFor = async (orgId: string) => {
      if (!months.has(orgId)) {
        try {
          months.set(orgId, (await this.params(orgId)).retentionMonths);
        } catch {
          months.set(orgId, Number.POSITIVE_INFINITY); // unreadable settings: keep everything
        }
      }
      return months.get(orgId)!;
    };
    const busy = new Map<string, boolean>();
    const inUse = async (modelId: string, decisionRef: string) => {
      const k = `${modelId}|${decisionRef}`;
      if (!busy.has(k)) {
        const openAppeals = await this.appeals.count({ where: { modelId, decisionRef, status: In(OPEN_APPEAL) } });
        const openGrievances = await this.grievances.count({ where: { modelId, decisionRef, status: Not(In(['RESOLVED', 'REJECTED', 'CLOSED'])) } });
        busy.set(k, openAppeals + openGrievances > 0);
      }
      return busy.get(k)!;
    };
    const expired = async (orgId: string, stored: Date | null, from: Date | null) => {
      const m = await monthsFor(orgId);
      if (!Number.isFinite(m)) return false;
      const recomputed = from ? addMonths(from, m) : null;
      const until = [stored, recomputed].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0];
      return !!until && until.getTime() < now.getTime();
    };
    const notices: AdverseActionNoticeEntity[] = [];
    for (const n of await this.notices.find({ where: { retentionUntil: LessThan(now) } })) {
      if ((await expired(n.orgId, n.retentionUntil, n.sentAt)) && !(await inUse(n.modelId, n.decisionRef))) notices.push(n);
    }
    const appeals: DecisionAppealEntity[] = [];
    for (const a of await this.appeals.find({ where: { status: Not('OPEN'), retentionUntil: LessThan(now) } })) {
      if ((await expired(a.orgId, a.retentionUntil, a.decidedAt)) && !(await inUse(a.modelId, a.decisionRef))) appeals.push(a);
    }
    if (notices.length) await this.notices.remove(notices);
    if (appeals.length) await this.appeals.remove(appeals);
    let anonymised = 0;
    const done = new Set([...notices, ...appeals].map((r) => `${r.modelId}|${r.decisionRef}`));
    for (const k of done) {
      const [modelId, decisionRef] = k.split('|');
      if ((await this.notices.count({ where: { modelId, decisionRef } })) + (await this.appeals.count({ where: { modelId, decisionRef } }))) continue;
      for (const g of await this.grievances.find({ where: { modelId, decisionRef } })) {
        if (!g.complainant) continue;
        g.complainant = null;
        g.updatedAt = now;
        await this.grievances.save(g);
        anonymised++;
      }
    }
    if (notices.length + appeals.length) this.logger.log(`Decision records past retention purged: ${notices.length} notice(s), ${appeals.length} appeal(s); ${anonymised} grievance(s) anonymised`);
    return { notices: notices.length, appeals: appeals.length, anonymised };
  }

}
