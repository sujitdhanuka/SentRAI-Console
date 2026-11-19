/**
 * Nonconformity and corrective-action register (E1.7, ISO 10.2): one register
 * fed by failed controls, audit findings, incidents, validation findings,
 * management review and resolved grievances. An action closes only with a
 * root cause and an effectiveness review; overdue actions surface in the
 * console's gap queue.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AIAuditTrailEntity,
  AIIncidentEntity,
  AIModelEntity,
  CorrectiveActionEntity,
  GrievanceEntity,
  ProjectEntity,
  RiskActionEntity,
  RiskEntity,
} from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';

export const CA_SOURCES = ['AUDIT', 'CONTROL', 'INCIDENT', 'VALIDATION', 'MGMT_REVIEW', 'GRIEVANCE', 'OTHER'] as const;
const OPEN = ['OPEN', 'IN_PROGRESS', 'AWAITING_EFFECTIVENESS'];

const parseDate = (v: any): Date | null => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('due_at must be a date');
  return d;
};

@Injectable()
export class CorrectiveActionsService {
  constructor(
    @InjectRepository(CorrectiveActionEntity) private readonly rows: Repository<CorrectiveActionEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(GrievanceEntity) private readonly grievances: Repository<GrievanceEntity>,
    @InjectRepository(AIAuditTrailEntity) private readonly audits: Repository<AIAuditTrailEntity>,
    @InjectRepository(RiskEntity) private readonly risks: Repository<RiskEntity>,
    @InjectRepository(RiskActionEntity) private readonly riskActions: Repository<RiskActionEntity>,
    private readonly flags: FeatureFlagsService,
  ) {}

  private assert(): void {
    assertFlag(this.flags, 'correctiveActions');
  }

  private async load(user: CurrentUser, id: string): Promise<CorrectiveActionEntity> {
    const r = await this.rows.findOne({ where: { id } });
    if (!r || (user.role !== Role.ADMIN && r.orgId !== user.tenantId)) throw new NotFoundException('Corrective action not found');
    return r;
  }

  view(r: CorrectiveActionEntity) {
    return {
      action_id: r.id, org_id: r.orgId, source: r.source, source_id: r.sourceId, model_id: r.modelId,
      nonconformity: r.nonconformity, root_cause: r.rootCause, action: r.action, owner_user_id: r.ownerUserId,
      due_at: r.dueAt, status: r.status, overdue: OPEN.includes(r.status) && !!r.dueAt && r.dueAt.getTime() < Date.now(),
      effectiveness_review: r.effectivenessReview, effective: r.effective, closed_at: r.closedAt, closed_by: r.closedBy,
      created_by: r.createdBy, created_at: r.createdAt, updated_at: r.updatedAt,
    };
  }

  /**
   * Resolve the source record to its organisation and model, so an action can
   * only be raised from a record the caller can see.
   */
  private async resolveSource(user: CurrentUser, source: string, sourceId: string | null, modelId: string | null): Promise<{ orgId: string; modelId: string | null }> {
    const byModel = async (mid: string) => {
      const { orgId } = await modelForUser(this.models, this.projects, user, mid);
      if (!orgId) throw new BadRequestException('The model is not in an organization');
      return { orgId, modelId: mid };
    };
    if (source === 'INCIDENT') {
      const i = sourceId ? await this.incidents.findOne({ where: { id: sourceId } }) : null;
      if (!i) throw new NotFoundException('Incident not found');
      return byModel(i.modelId);
    }
    if (source === 'GRIEVANCE') {
      const g = sourceId ? await this.grievances.findOne({ where: { id: sourceId } }) : null;
      if (!g) throw new NotFoundException('Grievance not found');
      return byModel(g.modelId);
    }
    if (source === 'AUDIT') {
      const a = sourceId ? await this.audits.findOne({ where: { id: sourceId } }) : null;
      if (a) return byModel(a.modelId);
      // An AIMS internal-audit finding (no model) is org-level.
    }
    if (source === 'CONTROL' && !modelId) throw new BadRequestException('model_id is required for a failed-control action');
    if (modelId) return byModel(modelId);
    if (!user.tenantId) throw new BadRequestException('No organization');
    return { orgId: user.tenantId, modelId: null };
  }

  async create(user: CurrentUser, body: Record<string, any>) {
    this.assert();
    const source = String(body.source ?? 'OTHER').toUpperCase();
    if (!(CA_SOURCES as readonly string[]).includes(source)) throw new BadRequestException(`source must be one of ${CA_SOURCES.join(', ')}`);
    const nonconformity = String(body.nonconformity ?? '').trim();
    const action = String(body.action ?? '').trim();
    if (nonconformity.length < 5) throw new BadRequestException('Describe the nonconformity');
    if (action.length < 3) throw new BadRequestException('Describe the corrective action');
    const sourceId = body.source_id ? String(body.source_id) : null;
    const { orgId, modelId } = await this.resolveSource(user, source, sourceId, body.model_id ? String(body.model_id) : null);
    const now = new Date();
    const r = await this.rows.save({
      id: uuidv4(), orgId, source, sourceId, modelId, nonconformity, rootCause: body.root_cause ?? null, action,
      ownerUserId: body.owner_user_id ?? null, dueAt: parseDate(body.due_at), status: 'OPEN', effectivenessReview: null,
      effective: null, closedAt: null, closedBy: null, createdBy: user.email, createdAt: now, updatedAt: now,
    });
    return this.view(r);
  }

  async list(user: CurrentUser, q: { status?: string; source?: string; model_id?: string; overdue?: string; source_id?: string; org_id?: string }) {
    this.assert();
    const orgId = user.role === Role.ADMIN && q.org_id ? q.org_id : user.tenantId;
    if (!orgId) throw new BadRequestException('No organization');
    const where: Record<string, any> = { orgId };
    if (q.status) where.status = In(q.status.split(','));
    if (q.source) where.source = q.source;
    if (q.model_id) where.modelId = q.model_id;
    if (q.source_id) where.sourceId = q.source_id;
    if (q.overdue === 'true') Object.assign(where, { status: In(OPEN), dueAt: LessThan(new Date()) });
    const rows = q.source === 'RISK' ? [] : await this.rows.find({ where, order: { createdAt: 'DESC' } });
    const all = await this.rows.find({ where: { orgId, status: In(OPEN) } });
    const treatments = await this.riskTreatments(orgId, q);
    return {
      org_id: orgId,
      actions: [...rows.map((r) => this.view(r)), ...treatments],
      // The ISO 10.2 counts (read by the corrective-action control) stay as they were; risk treatments are counted separately.
      summary: {
        open: all.length,
        overdue: all.filter((r) => r.dueAt && r.dueAt.getTime() < Date.now()).length,
        risk_treatments_open: treatments.filter((t) => t.status === 'OPEN').length,
        risk_treatments_overdue: treatments.filter((t) => t.overdue).length,
      },
    };
  }

  /**
   * Risk-treatment actions from the risk register, listed in the same queue so
   * there is one place to see everything owed. They stay owned by their risk
   * (read only here, completed in the register) and are not ISO 10.2
   * nonconformities, so they are marked source RISK and read_only.
   */
  private async riskTreatments(orgId: string, q: { status?: string; source?: string; model_id?: string; overdue?: string; source_id?: string }) {
    if (!this.flags.isEnabled('riskRegister')) return [];
    if (q.source && q.source !== 'RISK') return [];
    const statusMap: Record<string, string> = { OPEN: 'OPEN', DONE: 'CLOSED', CANCELLED: 'CANCELLED' };
    const wanted = q.status ? q.status.split(',') : null;
    const riskWhere: Record<string, any> = { orgId };
    if (q.source_id) riskWhere.id = q.source_id;
    const risks = await this.risks.find({ where: riskWhere });
    if (!risks.length) return [];
    const byId = new Map(risks.map((r) => [r.id, r]));
    const acts = await this.riskActions.find({ where: { riskId: In([...byId.keys()]) }, order: { createdAt: 'DESC' } });
    const now = Date.now();
    return acts
      .map((a) => {
        const r = byId.get(a.riskId)!;
        const modelId = r.scopeType === 'MODEL' ? r.scopeId : null;
        const status = statusMap[a.status] ?? a.status;
        return {
          action_id: a.id, org_id: orgId, source: 'RISK', source_id: r.id, model_id: modelId,
          nonconformity: `Risk: ${r.title}`, root_cause: null, action: `${a.treatment.toLowerCase()}: ${a.action}`,
          owner_user_id: a.ownerUserId, due_at: a.dueAt, status,
          overdue: a.status === 'OPEN' && !!a.dueAt && a.dueAt.getTime() < now,
          effectiveness_review: null, closed_by: null, closed_at: a.completedAt, created_by: a.createdBy, created_at: a.createdAt,
          read_only: true, treatment: a.treatment,
        };
      })
      .filter((t) => (!q.model_id || t.model_id === q.model_id) && (!wanted || wanted.includes(t.status)) && (q.overdue !== 'true' || t.overdue));
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    return this.view(await this.load(user, id));
  }

  async update(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    const r = await this.load(user, id);
    if (['CLOSED', 'CANCELLED'].includes(r.status)) throw new BadRequestException(`A ${r.status.toLowerCase()} action cannot be changed`);
    for (const [k, f] of [['root_cause', 'rootCause'], ['action', 'action'], ['owner_user_id', 'ownerUserId']] as const) {
      if (body[k] !== undefined) (r as any)[f] = body[k];
    }
    if (body.due_at !== undefined) r.dueAt = parseDate(body.due_at);
    if (body.status !== undefined) {
      if (!['OPEN', 'IN_PROGRESS', 'AWAITING_EFFECTIVENESS', 'CANCELLED'].includes(body.status)) throw new BadRequestException('Use /close to close an action');
      if (body.status === 'CANCELLED') {
        // L4: cancelling drops the action from the overdue count CTL-ORG-CA reads,
        // so it is limited to the Owner, CISO or Admin and needs a real reason.
        if (![Role.OWNER, Role.CISO, Role.ADMIN].includes(user.role)) throw new ForbiddenException('Only the Owner, CISO or an Admin can cancel a corrective action');
        if (String(body.reason ?? '').trim().length < 10) throw new BadRequestException('A reason (at least 10 characters) is required to cancel');
        r.effectivenessReview = `Cancelled by ${user.email}: ${String(body.reason).trim().slice(0, 1000)}`;
        if (req) req.auditSummary = { corrective_action_cancelled: { action_id: r.id, reason: String(body.reason).trim().slice(0, 500), cancelled_by: user.email } };
      }
      r.status = body.status;
    }
    r.updatedAt = new Date();
    await this.rows.save(r);
    return this.view(r);
  }

  /** Close: root cause and an effectiveness review are required (ISO 10.2 d–e). An ineffective action stays open. */
  async close(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    const r = await this.load(user, id);
    if (!OPEN.includes(r.status)) throw new BadRequestException(`A ${r.status.toLowerCase()} action cannot be closed`);
    const rootCause = String(body.root_cause ?? r.rootCause ?? '').trim();
    const review = String(body.effectiveness_review ?? '').trim();
    if (rootCause.length < 5) throw new BadRequestException('Record the root cause before closing');
    if (review.length < 5) throw new BadRequestException('Record the effectiveness review before closing');
    if (typeof body.effective !== 'boolean') throw new BadRequestException('effective must be true or false');
    r.rootCause = rootCause;
    r.effectivenessReview = review;
    r.effective = body.effective;
    r.updatedAt = new Date();
    if (!body.effective) {
      // Not effective: the nonconformity is not resolved; keep it open for a further action.
      r.status = 'IN_PROGRESS';
      await this.rows.save(r);
      return { ...this.view(r), closed: false };
    }
    r.status = 'CLOSED';
    r.closedAt = new Date();
    r.closedBy = user.email;
    await this.rows.save(r);
    if (req) req.auditSummary = { corrective_action_closed: { action_id: r.id, source: r.source, source_id: r.sourceId, closed_by: user.email } };
    return { ...this.view(r), closed: true };
  }

  async orgFacts(orgId: string) {
    const open = await this.rows.find({ where: { orgId, status: In(OPEN) } });
    const closed = await this.rows.count({ where: { orgId, status: 'CLOSED' } });
    return { open: open.length, overdue: open.filter((r) => r.dueAt && r.dueAt.getTime() < Date.now()).length, closed };
  }

  /** Open actions for a model (the gap queue). */
  async openForModel(modelId: string) {
    return (await this.rows.find({ where: { modelId, status: Not(In(['CLOSED', 'CANCELLED'])) } })).map((r) => this.view(r));
  }
}
