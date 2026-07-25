import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIModelEntity, GrievanceEntity, ModelLedgerEventEntity, ProjectEntity } from '../database/entities';
import { Role } from '../common/enums';
import { maskDict } from '../common/dpdp';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { NotifierService } from '../common/notifier.service';
import { FileGrievanceDto, GrievanceStatusDto } from './grievances.dto';

/** SLA to first resolution, by severity (days). */
const SLA_DAYS: Record<string, number> = { HIGH: 7, MEDIUM: 15, LOW: 30 };
/** Permitted state transitions — the redress workflow's shape. */
const TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ['ACKNOWLEDGED', 'REJECTED'],
  ACKNOWLEDGED: ['INVESTIGATING', 'RESOLVED', 'REJECTED'],
  INVESTIGATING: ['RESOLVED', 'REJECTED'],
  RESOLVED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};
const TERMINAL = new Set(['RESOLVED', 'REJECTED', 'CLOSED']);
const STATUS_ROLES = new Set<Role>([Role.OWNER, Role.REVIEWER, Role.APPROVER, Role.CISO, Role.ADMIN]);

/** Lightly mask an optional complainant contact — never stored in the clear. */
function maskContact(v: string): string {
  const s = v.trim();
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u.slice(0, 2)}***@${d ?? ''}`; }
  return s.length <= 4 ? '***' : s.slice(0, 2) + '***' + s.slice(-2);
}

/**
 * Consumer grievance workflow (Pillar 5 — Societal). A first-class record with a
 * state machine and an SLA deadline: file → acknowledge → investigate → resolve
 * (or reject) → close. Overdue grievances are escalated by the scheduled job.
 * Every transition is mirrored onto the model ledger so redress shows up in the
 * cross-ledger timeline alongside governance and runtime events.
 */
@Injectable()
export class GrievancesService {
  constructor(
    @InjectRepository(GrievanceEntity) private readonly grievances: Repository<GrievanceEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly notifier: NotifierService,
  ) {}

  private scope(user: CurrentUser) {
    return user.role === Role.ADMIN ? null : user.tenantId;
  }

  private async resolveModel(modelId: string): Promise<{ model: AIModelEntity; tenantId: string | null }> {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    let tenantId: string | null = null;
    if (model.projectId) {
      const p = await this.projects.findOne({ where: { id: model.projectId } });
      tenantId = p?.tenantId ?? null;
    }
    return { model, tenantId };
  }

  private async recordLedger(modelId: string, eventType: string, data: Record<string, any>, actor: string): Promise<void> {
    await this.ledger.save(this.ledger.create({
      id: uuidv4(), modelId, eventType, eventData: maskDict(data), actor, occurredAt: new Date(),
    }));
  }

  private response(g: GrievanceEntity) {
    return {
      grievance_id: g.id,
      model_id: g.modelId,
      subject: g.subject,
      description: g.description,
      category: g.category,
      severity: g.severity,
      channel: g.channel,
      status: g.status,
      complainant: g.complainant,
      resolution_notes: g.resolutionNotes,
      sla_due_at: g.slaDueAt.toISOString(),
      is_overdue: !TERMINAL.has(g.status) && g.slaDueAt.getTime() < Date.now(),
      created_at: g.createdAt.toISOString(),
      acknowledged_at: g.acknowledgedAt ? g.acknowledgedAt.toISOString() : null,
      resolved_at: g.resolvedAt ? g.resolvedAt.toISOString() : null,
    };
  }

  /**
   * File a grievance. `actor` is the console user or 'consumer' for public
   * submissions; the model's grievance counter is bumped so existing inventory
   * KPIs stay in sync.
   */
  async file(
    modelId: string,
    dto: { subject: string; description: string; category?: string; severity?: string; channel?: string; complainant?: string },
    actor: string,
  ) {
    const { model, tenantId } = await this.resolveModel(modelId);
    const severity = dto.severity && SLA_DAYS[dto.severity] ? dto.severity : 'MEDIUM';
    const now = new Date();
    const g = await this.grievances.save(this.grievances.create({
      id: uuidv4(),
      modelId: model.id,
      tenantId,
      subject: dto.subject.trim(),
      description: dto.description.trim(),
      complainant: dto.complainant?.trim() ? maskContact(dto.complainant) : null,
      channel: dto.channel ?? 'web',
      category: dto.category ?? 'other',
      severity,
      status: 'RECEIVED',
      resolutionNotes: null,
      slaDueAt: new Date(now.getTime() + SLA_DAYS[severity] * 86_400_000),
      createdAt: now,
      updatedAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
    }));

    // Keep the legacy counter in sync so inventory KPIs still reflect grievances.
    model.grievanceCount = (model.grievanceCount ?? 0) + 1;
    model.updatedAt = now;
    await this.models.save(model);

    await this.recordLedger(model.id, 'GRIEVANCE_FILED', { grievance_id: g.id, severity, category: g.category, sla_due_at: g.slaDueAt.toISOString() }, actor);
    await this.notifier.notify('grievance_filed', { grievance_id: g.id, model_id: model.id, model_name: model.name, severity, category: g.category });
    return this.response(g);
  }

  async fileAuthed(user: CurrentUser, dto: FileGrievanceDto) {
    return this.file(dto.model_id, dto, user.email);
  }

  async updateStatus(user: CurrentUser, id: string, dto: GrievanceStatusDto) {
    if (!STATUS_ROLES.has(user.role)) throw new ForbiddenException('Your role may not update grievances.');
    const g = await this.grievances.findOne({ where: { id } });
    if (!g) throw new NotFoundException('Grievance not found');
    const tenantId = this.scope(user);
    if (tenantId && g.tenantId !== tenantId) throw new NotFoundException('Grievance not found');

    if (dto.status !== g.status) {
      const allowed = TRANSITIONS[g.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Cannot move a grievance from ${g.status} to ${dto.status}.`);
      }
    }
    const now = new Date();
    const prev = g.status;
    g.status = dto.status;
    if (dto.notes !== undefined) g.resolutionNotes = dto.notes.trim() || g.resolutionNotes;
    if ((dto.status === 'ACKNOWLEDGED' || dto.status === 'INVESTIGATING') && !g.acknowledgedAt) g.acknowledgedAt = now;
    if ((dto.status === 'RESOLVED' || dto.status === 'REJECTED' || dto.status === 'CLOSED') && !g.resolvedAt) g.resolvedAt = now;
    g.updatedAt = now;
    await this.grievances.save(g);

    // On resolution, reflect the note on the model (legacy field the UI reads).
    if (dto.status === 'RESOLVED' && g.resolutionNotes) {
      const model = await this.models.findOne({ where: { id: g.modelId } });
      if (model) { model.grievanceResolutionNotes = g.resolutionNotes; model.updatedAt = now; await this.models.save(model); }
    }

    const eventType = dto.status === 'RESOLVED' ? 'GRIEVANCE_RESOLVED' : 'GRIEVANCE_STATUS_CHANGED';
    await this.recordLedger(g.modelId, eventType, { grievance_id: g.id, from: prev, to: dto.status }, user.email);
    return this.response(g);
  }

  async list(user: CurrentUser, opts: { status?: string; modelId?: string }) {
    const tenantId = this.scope(user);
    const qb = this.grievances.createQueryBuilder('g').orderBy('g.createdAt', 'DESC').take(300);
    if (tenantId) qb.andWhere('g.tenantId = :tid', { tid: tenantId });
    if (opts.status) qb.andWhere('g.status = :st', { st: opts.status });
    if (opts.modelId) qb.andWhere('g.modelId = :mid', { mid: opts.modelId });
    const rows = await qb.getMany();
    return rows.map((r) => this.response(r));
  }

  async summary(user: CurrentUser) {
    const tenantId = this.scope(user);
    const base = () => {
      const qb = this.grievances.createQueryBuilder('g');
      if (tenantId) qb.where('g.tenantId = :tid', { tid: tenantId });
      return qb;
    };
    const total = await base().getCount();
    const open = await base().andWhere('g.status NOT IN (:...t)', { t: [...TERMINAL] }).getCount();
    const overdue = await base().andWhere('g.status NOT IN (:...t)', { t: [...TERMINAL] }).andWhere('g.slaDueAt < :now', { now: new Date() }).getCount();
    const resolved = await base().andWhere('g.status = :r', { r: 'RESOLVED' }).getCount();
    return { total, open, overdue, resolved };
  }

  /** Cron entrypoint: escalate grievances past their SLA that aren't resolved. */
  async escalateOverdue(): Promise<number> {
    const overdue = await this.grievances.find({
      where: { slaDueAt: LessThan(new Date()), resolvedAt: IsNull(), status: Not('CLOSED') },
    });
    const live = overdue.filter((g) => !TERMINAL.has(g.status));
    if (live.length) {
      await this.notifier.notify('grievances_overdue', {
        count: live.length,
        grievances: live.slice(0, 50).map((g) => ({ grievance_id: g.id, model_id: g.modelId, severity: g.severity, sla_due_at: g.slaDueAt.toISOString() })),
      });
      for (const g of live) {
        await this.recordLedger(g.modelId, 'GRIEVANCE_SLA_BREACHED', { grievance_id: g.id, severity: g.severity }, 'system');
      }
    }
    return live.length;
  }

  /** Grievance summary for one model — used by the public transparency card. */
  async publicSummaryForModel(modelId: string) {
    const rows = await this.grievances.find({ where: { modelId } });
    const resolved = rows.filter((g) => g.status === 'RESOLVED' || g.status === 'CLOSED').length;
    return { total: rows.length, open: rows.filter((g) => !TERMINAL.has(g.status)).length, resolved };
  }
}
