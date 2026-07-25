import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  AIModelEntity,
  ModelApprovalEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
} from '../database/entities';
import { ApprovalDecision } from '../database/entities/model-approval.entity';
import { ModelLifecycleStage, Role } from '../common/enums';
import { maskDict } from '../common/dpdp';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { NotifierService } from '../common/notifier.service';
import { ApprovalDecisionDto, ApprovalRequestDto } from './alignment.dto';

/** Roles that may cast an approval decision — an independent governance board. */
const DECIDER_ROLES = new Set<Role>([Role.APPROVER, Role.CISO, Role.ADMIN]);
const LIVE_STAGES = new Set<ModelLifecycleStage>([
  ModelLifecycleStage.DEPLOYED,
  ModelLifecycleStage.MONITORING,
]);

/**
 * The review-board approval workflow (Pillar 1 — Alignment).
 *
 * An owner requests sign-off to take a model live; one or more independent
 * approvers (never the requester — separation of duties) record a decision.
 * Only when the APPROVE quorum is met does the request reach APPROVED, which is
 * what the inventory lifecycle gate checks before letting a MEDIUM/HIGH model
 * go to a live stage. Every transition is mirrored into the model ledger, so
 * the sign-off is a permanent part of the audit trail rather than a mutable
 * flag. Reuses the existing APPROVER/CISO roles and the model ledger — no new
 * primitives, exactly as the roadmap intends ("reuse before build").
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @InjectRepository(ModelApprovalEntity) private readonly approvals: Repository<ModelApprovalEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly notifier: NotifierService,
  ) {}

  /** Resolve a model and its owning tenant (via the project) or 404. */
  private async resolveModel(modelId: string): Promise<{ model: AIModelEntity; tenantId: string | null }> {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    let tenantId: string | null = null;
    if (model.projectId) {
      const project = await this.projects.findOne({ where: { id: model.projectId } });
      tenantId = project?.tenantId ?? null;
    }
    return { model, tenantId };
  }

  private async recordLedger(modelId: string, eventType: string, data: Record<string, any>, actor: string): Promise<void> {
    await this.ledger.save(this.ledger.create({
      id: uuidv4(),
      modelId,
      eventType,
      eventData: maskDict(data),
      actor,
      occurredAt: new Date(),
    }));
  }

  private toResponse(a: ModelApprovalEntity) {
    const approvals = a.decisions.filter((d) => d.decision === 'APPROVE').length;
    return {
      approval_id: a.id,
      model_id: a.modelId,
      model_name: a.modelName,
      risk_level: a.riskLevel,
      target_stage: a.targetStage,
      status: a.status,
      required_approvals: a.requiredApprovals,
      approvals_recorded: approvals,
      requested_by: a.requestedBy,
      requested_by_role: a.requestedByRole,
      request_note: a.requestNote,
      decisions: a.decisions,
      created_at: a.createdAt.toISOString(),
      resolved_at: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    };
  }

  /** Tenant filter mirrors inventory: any ADMIN sees all; others see their org. */
  private scope(user: CurrentUser) {
    return user.role === Role.ADMIN ? null : user.tenantId;
  }

  async request(user: CurrentUser, dto: ApprovalRequestDto) {
    if (!LIVE_STAGES.has(dto.target_stage)) {
      throw new BadRequestException('Approval requests only apply to live stages (DEPLOYED or MONITORING).');
    }
    const { model, tenantId } = await this.resolveModel(dto.model_id);

    // At most one open request per model — a fresh decision needs a fresh request.
    const existing = await this.approvals.findOne({ where: { modelId: model.id, status: 'PENDING' } });
    if (existing) {
      throw new ConflictException('This model already has a pending approval request.');
    }

    const entity = await this.approvals.save(this.approvals.create({
      id: uuidv4(),
      modelId: model.id,
      tenantId,
      modelName: model.name,
      riskLevel: model.riskLevel,
      targetStage: dto.target_stage,
      status: 'PENDING',
      requiredApprovals: dto.required_approvals ?? 1,
      requestedBy: user.email,
      requestedByRole: user.role,
      requestNote: dto.note?.trim() || null,
      decisions: [],
      createdAt: new Date(),
      resolvedAt: null,
    }));

    await this.recordLedger(model.id, 'APPROVAL_REQUESTED', {
      target_stage: dto.target_stage,
      required_approvals: entity.requiredApprovals,
      requested_by: user.email,
    }, user.email);
    await this.notifier.notify('approval_requested', {
      model_id: model.id,
      model_name: model.name,
      risk_level: model.riskLevel,
      target_stage: dto.target_stage,
      requested_by: user.email,
    });

    return this.toResponse(entity);
  }

  async decide(user: CurrentUser, approvalId: string, dto: ApprovalDecisionDto) {
    if (!DECIDER_ROLES.has(user.role)) {
      throw new ForbiddenException('Only APPROVER, CISO, or ADMIN roles may decide approvals.');
    }
    const approval = await this.approvals.findOne({ where: { id: approvalId } });
    if (!approval) throw new NotFoundException('Approval request not found');
    // Tenant isolation: a decider may only act on their own org's requests
    // (a null-tenant request — a model with no project — is treated as global).
    if (approval.tenantId && user.role !== Role.ADMIN && user.tenantId !== approval.tenantId) {
      throw new NotFoundException('Approval request not found');
    }
    if (approval.status !== 'PENDING') {
      throw new ConflictException(`This request is already ${approval.status.toLowerCase()}.`);
    }
    // Separation of duties: the requester cannot approve their own request, and
    // no approver may vote twice.
    if (approval.requestedBy === user.email) {
      throw new ForbiddenException('The requester cannot decide their own approval (separation of duties).');
    }
    if (approval.decisions.some((d) => d.actor === user.email)) {
      throw new ConflictException('You have already recorded a decision on this request.');
    }

    const decision: ApprovalDecision = {
      actor: user.email,
      role: user.role,
      decision: dto.decision,
      note: dto.note?.trim() || null,
      decidedAt: new Date().toISOString(),
    };
    approval.decisions = [...approval.decisions, decision];

    if (dto.decision === 'REJECT') {
      approval.status = 'REJECTED';
      approval.resolvedAt = new Date();
    } else {
      const approvals = approval.decisions.filter((d) => d.decision === 'APPROVE').length;
      if (approvals >= approval.requiredApprovals) {
        approval.status = 'APPROVED';
        approval.resolvedAt = new Date();
      }
    }
    await this.approvals.save(approval);

    const eventType =
      approval.status === 'APPROVED' ? 'APPROVAL_GRANTED'
        : approval.status === 'REJECTED' ? 'APPROVAL_REJECTED'
          : 'APPROVAL_VOTE_RECORDED';
    await this.recordLedger(approval.modelId, eventType, {
      decision: dto.decision,
      by: user.email,
      role: user.role,
      status: approval.status,
    }, user.email);
    await this.notifier.notify('approval_decided', {
      approval_id: approval.id,
      model_id: approval.modelId,
      model_name: approval.modelName,
      decision: dto.decision,
      status: approval.status,
      by: user.email,
    });

    return this.toResponse(approval);
  }

  async withdraw(user: CurrentUser, approvalId: string) {
    const approval = await this.approvals.findOne({ where: { id: approvalId } });
    if (!approval) throw new NotFoundException('Approval request not found');
    if (approval.tenantId && user.role !== Role.ADMIN && user.tenantId !== approval.tenantId) {
      throw new NotFoundException('Approval request not found');
    }
    if (approval.status !== 'PENDING') {
      throw new ConflictException(`This request is already ${approval.status.toLowerCase()}.`);
    }
    const privileged = user.role === Role.ADMIN || user.role === Role.CISO;
    if (approval.requestedBy !== user.email && !privileged) {
      throw new ForbiddenException('Only the requester, an ADMIN, or a CISO may withdraw a request.');
    }
    approval.status = 'WITHDRAWN';
    approval.resolvedAt = new Date();
    await this.approvals.save(approval);
    await this.recordLedger(approval.modelId, 'APPROVAL_WITHDRAWN', { by: user.email }, user.email);
    return this.toResponse(approval);
  }

  async list(user: CurrentUser, opts: { status?: string; modelId?: string }) {
    const tenantId = this.scope(user);
    const qb = this.approvals.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (tenantId) qb.andWhere('a.tenantId = :tid', { tid: tenantId });
    if (opts.status) qb.andWhere('a.status = :st', { st: opts.status });
    if (opts.modelId) qb.andWhere('a.modelId = :mid', { mid: opts.modelId });
    const rows = await qb.getMany();
    return rows.map((r) => this.toResponse(r));
  }

  async get(user: CurrentUser, approvalId: string) {
    const approval = await this.approvals.findOne({ where: { id: approvalId } });
    if (!approval) throw new NotFoundException('Approval request not found');
    const tenantId = this.scope(user);
    if (tenantId && approval.tenantId !== tenantId) throw new NotFoundException('Approval request not found');
    return this.toResponse(approval);
  }
}
