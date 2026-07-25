import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  AgentActionEventEntity,
  AIIncidentEntity,
  AIModelEntity,
  DeploymentGateEventEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
} from '../database/entities';
import { Role } from '../common/enums';
import { maskDict } from '../common/dpdp';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { authorizeTools } from '../domain/tool-authorization';
import { ActionEventDto, IngestEventsDto } from './telemetry.dto';

/**
 * Runtime action telemetry (Roadmap Pillar 3 — Visibility). Ingests the events
 * a deployed agent emits — tagged by its registry model id — and turns three
 * previously-siloed records (the model ledger, CI gate decisions, incidents,
 * drift, and now runtime actions) into one cross-ledger timeline per model.
 *
 * The connective tissue to Pillar 2: a `tool_call` whose tool falls outside the
 * model's declared permitted set is flagged the moment it arrives — static tool
 * authorization, observed at runtime.
 */
@Injectable()
export class TelemetryService {
  constructor(
    @InjectRepository(AgentActionEventEntity) private readonly actions: Repository<AgentActionEventEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(DeploymentGateEventEntity) private readonly gates: Repository<DeploymentGateEventEntity>,
  ) {}

  private scope(user: CurrentUser) {
    return user.role === Role.ADMIN ? null : user.tenantId;
  }

  private async tenantOf(model: AIModelEntity): Promise<string | null> {
    if (!model.projectId) return null;
    const p = await this.projects.findOne({ where: { id: model.projectId } });
    return p?.tenantId ?? null;
  }

  /** Ingest a batch of runtime action events; unauthorized tool calls are flagged. */
  async ingest(user: CurrentUser, dto: IngestEventsDto) {
    // Resolve the referenced models once.
    const cache = new Map<string, AIModelEntity | null>();
    const resolve = async (id: string) => {
      if (!cache.has(id)) cache.set(id, (await this.models.findOne({ where: { id } })) ?? null);
      return cache.get(id)!;
    };

    let ingested = 0;
    let flagged = 0;
    const unknownModels = new Set<string>();
    const userTenant = this.scope(user);

    for (const ev of dto.events) {
      const model = await resolve(ev.sentrai_model_id);
      if (!model) { unknownModels.add(ev.sentrai_model_id); continue; }
      const tenantId = await this.tenantOf(model);
      // Tenant isolation: a non-admin can only report for their org's models.
      if (userTenant && tenantId && userTenant !== tenantId) { unknownModels.add(ev.sentrai_model_id); continue; }

      const { isFlagged, outcome } = this.evaluateEvent(ev, model);
      if (isFlagged) flagged += 1;

      await this.actions.save(this.actions.create({
        id: uuidv4(),
        modelId: model.id,
        tenantId,
        sessionId: ev.session_id ?? null,
        eventType: ev.type,
        tool: ev.tool ?? null,
        outcome,
        flagged: isFlagged,
        detail: ev.detail ? maskDict(ev.detail) : null,
        actor: user.email,
        occurredAt: ev.occurred_at ? new Date(ev.occurred_at) : new Date(),
      }));
      ingested += 1;
    }

    return { ingested, flagged, unknown_models: [...unknownModels] };
  }

  /** Decide the outcome + whether a tool_call violates static authorization. */
  private evaluateEvent(ev: ActionEventDto, model: AIModelEntity): { isFlagged: boolean; outcome: string } {
    if (ev.type === 'tool_call' && ev.tool) {
      const permitted = model.permittedTools ?? [];
      // Only enforce once a permitted set is declared (matches the CI gate's
      // default: undeclared scope is surfaced elsewhere, not treated as a breach).
      if (permitted.length > 0) {
        const auth = authorizeTools(permitted, [ev.tool]);
        if (auth.unauthorized.length > 0) return { isFlagged: true, outcome: 'unauthorized_tool' };
      }
    }
    const allowed = ['success', 'blocked', 'error', 'unauthorized_tool'];
    return { isFlagged: false, outcome: allowed.includes(ev.outcome ?? '') ? (ev.outcome as string) : 'success' };
  }

  private eventResponse(e: AgentActionEventEntity) {
    return {
      event_id: e.id,
      model_id: e.modelId,
      session_id: e.sessionId,
      type: e.eventType,
      tool: e.tool,
      outcome: e.outcome,
      flagged: e.flagged,
      detail: e.detail ?? null,
      actor: e.actor,
      occurred_at: e.occurredAt.toISOString(),
    };
  }

  async listForModel(user: CurrentUser, modelId: string, limit = 100) {
    const tenantId = this.scope(user);
    const qb = this.actions.createQueryBuilder('a').where('a.modelId = :mid', { mid: modelId }).orderBy('a.occurredAt', 'DESC').take(Math.min(Math.max(limit, 1), 500));
    if (tenantId) qb.andWhere('a.tenantId = :tid', { tid: tenantId });
    const rows = await qb.getMany();
    return rows.map((r) => this.eventResponse(r));
  }

  /** Organization-wide runtime-visibility summary. */
  async summary(user: CurrentUser) {
    const tenantId = this.scope(user);
    const base = () => {
      const qb = this.actions.createQueryBuilder('a');
      if (tenantId) qb.where('a.tenantId = :tid', { tid: tenantId });
      return qb;
    };

    const total = await base().getCount();
    const flagged = await base().andWhere('a.flagged = :f', { f: true }).getCount();
    const dayAgo = new Date(Date.now() - 86_400_000);
    const last24h = await base().andWhere('a.occurredAt > :d', { d: dayAgo }).getCount();

    const rows = await base().orderBy('a.occurredAt', 'DESC').take(500).getMany();
    const byType: Record<string, number> = {};
    const sessions = new Set<string>();
    const models = new Set<string>();
    for (const r of rows) {
      byType[r.eventType] = (byType[r.eventType] ?? 0) + 1;
      if (r.sessionId) sessions.add(r.sessionId);
      models.add(r.modelId);
    }
    const recentFlagged = rows.filter((r) => r.flagged).slice(0, 15).map((r) => this.eventResponse(r));

    return {
      total_events: total,
      flagged_tool_calls: flagged,
      events_last_24h: last24h,
      by_type: byType,
      active_sessions: sessions.size,
      models_reporting: models.size,
      recent: rows.slice(0, 20).map((r) => this.eventResponse(r)),
      recent_flagged: recentFlagged,
    };
  }

  /**
   * Cross-ledger investigation: one time-sorted view of everything that has
   * happened to a model — governance-ledger events, CI gate decisions (for its
   * project), incidents, drift reports, and runtime actions.
   */
  async timeline(user: CurrentUser, modelId: string, limit = 120) {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');
    const tenantId = this.scope(user);
    const modelTenant = await this.tenantOf(model);
    if (tenantId && modelTenant && tenantId !== modelTenant) throw new NotFoundException('Model not found');

    const cap = Math.min(Math.max(limit, 1), 300);
    type Row = { ts: string; source: string; type: string; summary: string; flagged?: boolean; actor?: string };
    const rows: Row[] = [];

    const ledger = await this.ledger.find({ where: { modelId }, order: { occurredAt: 'DESC' }, take: cap });
    for (const e of ledger) rows.push({ ts: e.occurredAt.toISOString(), source: 'ledger', type: e.eventType, summary: this.ledgerSummary(e.eventType, e.eventData), actor: e.actor });

    const actions = await this.actions.find({ where: { modelId }, order: { occurredAt: 'DESC' }, take: cap });
    for (const a of actions) rows.push({ ts: a.occurredAt.toISOString(), source: 'action', type: a.eventType, flagged: a.flagged, summary: a.tool ? `${a.eventType} · ${a.tool} · ${a.outcome}` : `${a.eventType} · ${a.outcome}`, actor: a.actor });

    const incidents = await this.incidents.find({ where: { modelId }, order: { createdAt: 'DESC' }, take: 50 });
    for (const i of incidents) rows.push({ ts: (i.createdAt ?? new Date()).toISOString(), source: 'incident', type: i.severity, summary: `${i.incidentCategory} · ${i.status}`, flagged: true });

    const drift = await this.drifts.find({ where: { modelId }, order: { computedAt: 'DESC' }, take: 30 });
    for (const d of drift) rows.push({ ts: d.computedAt.toISOString(), source: 'drift', type: d.status, summary: `PSI ${Number(d.psiScore ?? 0).toFixed(3)}${d.circuitBreakerActive ? ' · breaker tripped' : ''}`, flagged: Boolean(d.circuitBreakerActive) });

    if (model.projectId) {
      const gate = await this.gates.find({ where: { projectId: model.projectId }, order: { occurredAt: 'DESC' }, take: 30 });
      for (const g of gate) rows.push({ ts: g.occurredAt.toISOString(), source: 'gate', type: g.verdict, summary: `CI gate ${g.verdict} · ${g.modelsDetected} model(s), ${(g.blockingGaps?.length ?? 0)} blocking`, flagged: g.verdict === 'fail', actor: g.triggeredBy });
    }

    rows.sort((a, b) => b.ts.localeCompare(a.ts));
    return {
      model_id: modelId,
      model_name: model.name,
      sentrai_model_id: model.id,
      count: Math.min(rows.length, cap),
      timeline: rows.slice(0, cap),
    };
  }

  private ledgerSummary(type: string, data: Record<string, any>): string {
    if (type === 'GOVERNANCE_UPDATED') return `governance updated: ${Object.keys(data).join(', ')}`;
    if (type === 'APPROVAL_GRANTED' || type === 'APPROVAL_REQUESTED') return `${type.toLowerCase().replace('_', ' ')}`;
    if (type === 'OPERATIONAL_SUSPENDED') return `suspended — ${data.reason ?? ''}`;
    if (type === 'EVAL_EVIDENCE_INGESTED') return `eval evidence: ${data.suite} ${data.passed}/${data.total}`;
    return type.toLowerCase().replace(/_/g, ' ');
  }
}
