/**
 * Engagement records (E3.7): the light register for consultation, expert input,
 * team composition, human-subject studies and non-AI alternatives, and the
 * report of the people-side items in both LIGHT_RECORD and CUSTOMER modes.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AIModelEntity, EngagementRecordEntity, ProjectEntity } from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addOrgFacts } from '../hooks';
import { MAINTAINERS, optDate, optText, orgFor, reqText, requireRole, isFuture } from '../phase2-util';
import { GovernanceSettingsService } from '../settings/settings.service';
import { ENGAGEMENT_TYPES, engagementStatus, engagementType, parseParticipants } from './engagement.model';

@Injectable()
export class EngagementService implements OnModuleInit {
  constructor(
    @InjectRepository(EngagementRecordEntity) private readonly rows: Repository<EngagementRecordEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly settings: GovernanceSettingsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addOrgFacts(async (orgId) => {
      if (!this.flags.isEnabled('orgRecords')) return undefined;
      return { engagement: { items: await this.status(orgId) } };
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'orgRecords');
  }

  async status(orgId: string, now = new Date()) {
    const s = (await this.settings.inForce(orgId)).settings;
    const recs = await this.rows.find({ where: { orgId }, select: ['id', 'type', 'occurredAt'] });
    return engagementStatus(s.peopleItems ?? {}, recs, now);
  }

  private view(r: EngagementRecordEntity) {
    return {
      record_id: r.id, type: r.type, label: engagementType(r.type)?.label ?? r.type, model_id: r.modelId, title: r.title, participants: r.participants,
      summary: r.summary, outcome: r.outcome, consent_ref: r.consentRef, occurred_at: r.occurredAt, created_by: r.createdBy, created_at: r.createdAt,
    };
  }

  async list(user: CurrentUser, q: { org_id?: string; type?: string; model_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const where: Record<string, any> = { orgId };
    if (q.type) where.type = String(q.type).toUpperCase();
    if (q.model_id) where.modelId = q.model_id;
    const recs = await this.rows.find({ where, order: { occurredAt: 'DESC' }, take: 500 });
    return { org_id: orgId, types: ENGAGEMENT_TYPES, items: await this.status(orgId), records: recs.map((r) => this.view(r)) };
  }

  async create(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record engagement');
    const orgId = orgFor(user, body.org_id);
    const t = engagementType(body.type);
    if (!t) throw new BadRequestException(`type must be one of ${ENGAGEMENT_TYPES.map((x) => x.type).join(', ')}`);
    if (t.peopleItem) {
      const s = (await this.settings.inForce(orgId)).settings;
      if (s.peopleItems?.[t.peopleItem]?.mode === 'CUSTOMER') {
        throw new ConflictException(`${t.label} is set as customer responsibility in the governance settings; change the people-side item to keep records here`);
      }
    }
    let modelId: string | null = null;
    if (body.model_id) {
      const { orgId: mOrg } = await modelForUser(this.models, this.projects, user, String(body.model_id));
      if (mOrg !== orgId) throw new NotFoundException('Model not found');
      modelId = String(body.model_id);
    }
    if (t.needsModel && !modelId) throw new BadRequestException(`${t.label} records need model_id`);
    const consentRef = optText(body.consent_ref, 'consent_ref', 255);
    if (t.needsConsent && !consentRef) throw new BadRequestException('A human-subject study needs consent_ref (the consent record or ethics approval)');
    let participants;
    try {
      participants = parseParticipants(body.participants);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const occurredAt = optDate(body.occurred_at, 'occurred_at') ?? new Date();
    if (isFuture(occurredAt, body.occurred_at)) throw new BadRequestException('occurred_at cannot be in the future');
    const r = await this.rows.save(this.rows.create({
      id: uuidv4(), orgId, type: t.type, modelId, title: reqText(body.title, 'title', 3, 200), participants,
      summary: reqText(body.summary, 'summary', 10, 8000), outcome: optText(body.outcome, 'outcome', 4000), consentRef,
      occurredAt, createdBy: user.email, createdAt: new Date(),
    }));
    if (req) req.auditSummary = { engagement_recorded: { record_id: r.id, type: t.type } };
    return this.view(r);
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    const r = await this.rows.findOne({ where: { id } });
    if (!r || r.orgId !== orgFor(user, r.orgId)) throw new NotFoundException('Record not found');
    return this.view(r);
  }

  async report(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const items = await this.status(orgId);
    const recs = await this.rows.find({ where: { orgId }, select: ['id', 'type', 'occurredAt', 'modelId'] });
    const byType = Object.fromEntries(ENGAGEMENT_TYPES.map((t) => [t.type, recs.filter((r) => r.type === t.type).length]));
    return { org_id: orgId, generated_at: new Date(), items, records_by_type: byType };
  }
}
