import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  AIModelEntity,
  AttestationCampaignEntity,
  AttestationItemEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
} from '../database/entities';
import { RiskLevel, Role } from '../common/enums';
import { maskDict } from '../common/dpdp';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { NotifierService } from '../common/notifier.service';
import { AttestDto, OpenCampaignDto } from './alignment.dto';

/** Roles that may record an attestation — everyone with a governance stake. */
const ATTESTER_ROLES = new Set<Role>([Role.OWNER, Role.REVIEWER, Role.APPROVER, Role.CISO, Role.ADMIN]);
/** Roles that may open or close a campaign. */
const CAMPAIGN_ADMIN_ROLES = new Set<Role>([Role.OWNER, Role.APPROVER, Role.CISO, Role.ADMIN]);
const RISK_ORDER: Record<string, number> = {
  [RiskLevel.LOW]: 0, [RiskLevel.MEDIUM]: 1, [RiskLevel.HIGH]: 2,
};

/**
 * Attestation campaigns (Pillar 1 — Alignment): periodic re-certification that
 * every active model is still operating within its sanctioned scope. Opening a
 * campaign snapshots the in-scope inventory into per-model items; owners then
 * ATTEST or FLAG each one. Items still PENDING past the due date are escalated
 * by the scheduled job (reusing the incident overdue-escalation pattern), which
 * is what makes governance recurring rather than one-and-done.
 */
@Injectable()
export class AttestationsService {
  private readonly logger = new Logger(AttestationsService.name);

  constructor(
    @InjectRepository(AttestationCampaignEntity) private readonly campaigns: Repository<AttestationCampaignEntity>,
    @InjectRepository(AttestationItemEntity) private readonly items: Repository<AttestationItemEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly notifier: NotifierService,
  ) {}

  private scope(user: CurrentUser) {
    return user.role === Role.ADMIN ? null : user.tenantId;
  }

  private async recordLedger(modelId: string, eventType: string, data: Record<string, any>, actor: string): Promise<void> {
    await this.ledger.save(this.ledger.create({
      id: uuidv4(), modelId, eventType, eventData: maskDict(data), actor, occurredAt: new Date(),
    }));
  }

  async openCampaign(user: CurrentUser, dto: OpenCampaignDto) {
    if (!CAMPAIGN_ADMIN_ROLES.has(user.role)) {
      throw new ForbiddenException('Only OWNER, APPROVER, CISO, or ADMIN roles may open a campaign.');
    }
    const tenantId = this.scope(user);

    // Snapshot the active inventory in scope. Risk filter is inclusive upward:
    // MEDIUM includes MEDIUM and HIGH.
    const qb = this.models.createQueryBuilder('m').where('m.isActive = 1');
    if (tenantId) {
      qb.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: tenantId });
    }
    let models = await qb.getMany();
    if (dto.risk_filter) {
      const floor = RISK_ORDER[dto.risk_filter] ?? 0;
      models = models.filter((m) => (RISK_ORDER[m.riskLevel] ?? 0) >= floor);
    }
    if (!models.length) {
      throw new UnprocessableEntityException('No active models match this scope — nothing to attest.');
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + dto.cadence_days * 86_400_000);
    const campaign = await this.campaigns.save(this.campaigns.create({
      id: uuidv4(),
      tenantId: tenantId ?? null,
      title: dto.title.trim(),
      riskFilter: dto.risk_filter ?? null,
      cadenceDays: dto.cadence_days,
      status: 'OPEN',
      itemCount: models.length,
      openedBy: user.email,
      note: dto.note?.trim() || null,
      dueAt,
      createdAt: now,
      closedAt: null,
    }));

    for (const m of models) {
      let itemTenant: string | null = tenantId ?? null;
      if (!itemTenant && m.projectId) {
        const project = await this.projects.findOne({ where: { id: m.projectId } });
        itemTenant = project?.tenantId ?? null;
      }
      await this.items.save(this.items.create({
        id: uuidv4(),
        campaignId: campaign.id,
        tenantId: itemTenant,
        modelId: m.id,
        modelName: m.name,
        riskLevel: m.riskLevel,
        status: 'PENDING',
        attestedBy: null,
        attestedByRole: null,
        note: null,
        dueAt,
        attestedAt: null,
        createdAt: now,
      }));
      await this.recordLedger(m.id, 'ATTESTATION_REQUESTED', {
        campaign: campaign.title, due_at: dueAt.toISOString(),
      }, user.email);
    }

    await this.notifier.notify('attestation_campaign_opened', {
      campaign_id: campaign.id, title: campaign.title, models: models.length,
      cadence_days: dto.cadence_days, due_at: dueAt.toISOString(), opened_by: user.email,
    });

    return this.campaignResponse(campaign, models.length, 0);
  }

  async attest(user: CurrentUser, itemId: string, dto: AttestDto) {
    if (!ATTESTER_ROLES.has(user.role)) {
      throw new ForbiddenException('Your role may not record attestations.');
    }
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Attestation item not found');
    const tenantId = this.scope(user);
    if (tenantId && item.tenantId !== tenantId) throw new NotFoundException('Attestation item not found');

    item.status = dto.decision === 'ATTEST' ? 'ATTESTED' : 'FLAGGED';
    item.attestedBy = user.email;
    item.attestedByRole = user.role;
    item.note = dto.note?.trim() || null;
    item.attestedAt = new Date();
    await this.items.save(item);

    await this.recordLedger(item.modelId, 'ATTESTATION_RECORDED', {
      decision: dto.decision, by: user.email, campaign_id: item.campaignId,
    }, user.email);

    // A flag is a live concern — escalate it the moment it is raised.
    if (dto.decision === 'FLAG') {
      await this.notifier.notify('attestation_flagged', {
        item_id: item.id, model_id: item.modelId, model_name: item.modelName,
        risk_level: item.riskLevel, by: user.email, note: item.note,
      });
    }

    return this.itemResponse(item);
  }

  async closeCampaign(user: CurrentUser, campaignId: string) {
    if (!CAMPAIGN_ADMIN_ROLES.has(user.role)) {
      throw new ForbiddenException('Only OWNER, APPROVER, CISO, or ADMIN roles may close a campaign.');
    }
    const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const tenantId = this.scope(user);
    if (tenantId && campaign.tenantId !== tenantId) throw new NotFoundException('Campaign not found');
    campaign.status = 'CLOSED';
    campaign.closedAt = new Date();
    await this.campaigns.save(campaign);
    const attested = await this.items.count({ where: { campaignId, status: 'ATTESTED' } });
    return this.campaignResponse(campaign, campaign.itemCount, attested);
  }

  async listCampaigns(user: CurrentUser) {
    const tenantId = this.scope(user);
    const qb = this.campaigns.createQueryBuilder('c').orderBy('c.createdAt', 'DESC');
    if (tenantId) qb.andWhere('c.tenantId = :tid', { tid: tenantId });
    const rows = await qb.getMany();
    return Promise.all(rows.map(async (c) => {
      const attested = await this.items.count({ where: { campaignId: c.id, status: 'ATTESTED' } });
      const flagged = await this.items.count({ where: { campaignId: c.id, status: 'FLAGGED' } });
      return this.campaignResponse(c, c.itemCount, attested, flagged);
    }));
  }

  async getCampaign(user: CurrentUser, campaignId: string) {
    const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const tenantId = this.scope(user);
    if (tenantId && campaign.tenantId !== tenantId) throw new NotFoundException('Campaign not found');
    const items = await this.items.find({ where: { campaignId }, order: { riskLevel: 'DESC', modelName: 'ASC' } });
    const attested = items.filter((i) => i.status === 'ATTESTED').length;
    const flagged = items.filter((i) => i.status === 'FLAGGED').length;
    return {
      ...this.campaignResponse(campaign, items.length, attested, flagged),
      items: items.map((i) => this.itemResponse(i)),
    };
  }

  /** Cron entrypoint: escalate items still PENDING past their due date. */
  async escalateOverdue(): Promise<number> {
    const overdue = await this.items.find({
      where: { status: 'PENDING', dueAt: LessThan(new Date()), attestedAt: IsNull() },
    });
    if (overdue.length) {
      await this.notifier.notify('attestations_overdue', {
        count: overdue.length,
        items: overdue.slice(0, 50).map((i) => ({
          item_id: i.id, model_id: i.modelId, model_name: i.modelName,
          risk_level: i.riskLevel, due_at: i.dueAt.toISOString(),
        })),
      });
    }
    return overdue.length;
  }

  private campaignResponse(c: AttestationCampaignEntity, total: number, attested: number, flagged = 0) {
    return {
      campaign_id: c.id,
      title: c.title,
      risk_filter: c.riskFilter,
      cadence_days: c.cadenceDays,
      status: c.status,
      total_items: total,
      attested,
      flagged,
      pending: Math.max(0, total - attested - flagged),
      opened_by: c.openedBy,
      note: c.note,
      due_at: c.dueAt.toISOString(),
      created_at: c.createdAt.toISOString(),
      closed_at: c.closedAt ? c.closedAt.toISOString() : null,
    };
  }

  private itemResponse(i: AttestationItemEntity) {
    return {
      item_id: i.id,
      campaign_id: i.campaignId,
      model_id: i.modelId,
      model_name: i.modelName,
      risk_level: i.riskLevel,
      status: i.status,
      attested_by: i.attestedBy,
      attested_by_role: i.attestedByRole,
      note: i.note,
      due_at: i.dueAt.toISOString(),
      attested_at: i.attestedAt ? i.attestedAt.toISOString() : null,
      is_overdue: i.status === 'PENDING' && i.dueAt.getTime() < Date.now(),
    };
  }
}
