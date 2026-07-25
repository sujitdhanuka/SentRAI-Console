import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIModelEntity, ModelLedgerEventEntity, ProjectEntity } from '../database/entities';
import { Role } from '../common/enums';
import { maskDict } from '../common/dpdp';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { NotifierService } from '../common/notifier.service';

/**
 * Control-plane kill switch (Roadmap Pillar 2 — Control). A deliberate
 * operator action — separate from the drift-driven BCP fallback — that flips a
 * model's operational state to SUSPENDED. An integrated agent polls
 * `GET /control/models/:id/state` each loop and halts when it sees the kill
 * switch, so an institution can stop a misbehaving system in seconds without a
 * redeploy. Every change is written to the model ledger and pushed to the
 * governance webhook.
 */
@Injectable()
export class ControlService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly notifier: NotifierService,
  ) {}

  private async resolve(modelId: string): Promise<{ model: AIModelEntity; tenantId: string | null }> {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    let tenantId: string | null = null;
    if (model.projectId) {
      const p = await this.projects.findOne({ where: { id: model.projectId } });
      tenantId = p?.tenantId ?? null;
    }
    return { model, tenantId };
  }

  private assertTenant(user: CurrentUser, tenantId: string | null) {
    if (user.role !== Role.ADMIN && tenantId && user.tenantId !== tenantId) {
      throw new NotFoundException('Model not found');
    }
  }

  private async recordLedger(modelId: string, eventType: string, data: Record<string, any>, actor: string): Promise<void> {
    await this.ledger.save(this.ledger.create({
      id: uuidv4(), modelId, eventType, eventData: maskDict(data), actor, occurredAt: new Date(),
    }));
  }

  private detail(model: AIModelEntity) {
    return {
      model_id: model.id,
      name: model.name,
      state: model.operationalState ?? 'ACTIVE',
      kill_switch: (model.operationalState ?? 'ACTIVE') === 'SUSPENDED',
      reason: model.operationalStateReason ?? null,
      since: model.operationalStateSince ? model.operationalStateSince.toISOString() : null,
    };
  }

  async suspend(user: CurrentUser, modelId: string, reason: string) {
    const { model, tenantId } = await this.resolve(modelId);
    this.assertTenant(user, tenantId);
    if (model.operationalState === 'SUSPENDED') {
      throw new ForbiddenException('Model is already suspended.');
    }
    model.operationalState = 'SUSPENDED';
    model.operationalStateReason = reason.trim();
    model.operationalStateSince = new Date();
    model.updatedAt = new Date();
    await this.models.save(model);
    await this.recordLedger(modelId, 'OPERATIONAL_SUSPENDED', { reason: reason.trim(), by: user.email }, user.email);
    await this.notifier.notify('model_suspended', {
      model_id: modelId, model_name: model.name, reason: reason.trim(), by: user.email,
    });
    return this.detail(model);
  }

  async resume(user: CurrentUser, modelId: string) {
    const { model, tenantId } = await this.resolve(modelId);
    this.assertTenant(user, tenantId);
    if (model.operationalState !== 'SUSPENDED') {
      throw new ForbiddenException('Model is not suspended.');
    }
    model.operationalState = 'ACTIVE';
    model.operationalStateReason = null;
    model.operationalStateSince = new Date();
    model.updatedAt = new Date();
    await this.models.save(model);
    await this.recordLedger(modelId, 'OPERATIONAL_RESUMED', { by: user.email }, user.email);
    await this.notifier.notify('model_resumed', { model_id: modelId, model_name: model.name, by: user.email });
    return this.detail(model);
  }

  /**
   * The polled kill-switch contract an integrated agent checks each loop. Public
   * by model UUID (like the PDF export) so a deployed system can check its own
   * authorization without a user session — deliberately minimal, no reason text.
   */
  async publicState(modelId: string) {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    const state = model.operationalState ?? 'ACTIVE';
    return {
      model_id: model.id,
      state,
      kill_switch: state === 'SUSPENDED',
      since: model.operationalStateSince ? model.operationalStateSince.toISOString() : null,
      checked_at: new Date().toISOString(),
    };
  }

  async state(user: CurrentUser, modelId: string) {
    const { model, tenantId } = await this.resolve(modelId);
    this.assertTenant(user, tenantId);
    return this.detail(model);
  }

  /** Org-wide list of currently suspended models (console overview). */
  async listSuspended(user: CurrentUser) {
    const tenantId = user.role === Role.ADMIN ? null : user.tenantId;
    const qb = this.models.createQueryBuilder('m').where("m.operationalState = 'SUSPENDED'");
    if (tenantId) {
      qb.innerJoin(ProjectEntity, 'p', 'p.id = m.projectId').andWhere('p.tenantId = :tid', { tid: tenantId });
    }
    const rows = await qb.orderBy('m.operationalStateSince', 'DESC').getMany();
    return rows.map((m) => this.detail(m));
  }
}
