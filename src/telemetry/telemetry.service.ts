import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
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
import { NotifierService } from '../common/notifier.service';
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
    private readonly notifier: NotifierService,
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

  /**
   * Scope-deviation alerts (Pillar 4 — Security, unblocked by Pillar 3's action
   * telemetry): models whose runtime tool calls have breached their sanctioned
   * scope. Aggregates the flagged action events per model over a window and
   * grades severity by the model's risk and oversight posture.
   */
  async scopeDeviations(user: CurrentUser, windowDays = 7) {
    const tenantId = this.scope(user);
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const qb = this.actions.createQueryBuilder('a').where('a.flagged = :f', { f: true }).andWhere('a.occurredAt > :s', { s: since }).orderBy('a.occurredAt', 'DESC').take(2000);
    if (tenantId) qb.andWhere('a.tenantId = :tid', { tid: tenantId });
    const flagged = await qb.getMany();
    return this.aggregateDeviations(flagged, windowDays);
  }

  private async aggregateDeviations(flagged: AgentActionEventEntity[], windowDays: number) {
    const byModel = new Map<string, { count: number; tools: Set<string>; last: Date }>();
    for (const e of flagged) {
      const g = byModel.get(e.modelId) ?? { count: 0, tools: new Set<string>(), last: e.occurredAt };
      g.count += 1;
      if (e.tool) g.tools.add(e.tool);
      if (e.occurredAt > g.last) g.last = e.occurredAt;
      byModel.set(e.modelId, g);
    }
    const models = byModel.size ? await this.models.find({ where: { id: In([...byModel.keys()]) } }) : [];
    const modelMap = new Map(models.map((m) => [m.id, m]));

    const out = [...byModel.entries()].map(([modelId, g]) => {
      const m = modelMap.get(modelId);
      const highRisk = m?.riskLevel === 'HIGH';
      const autonomous = m ? !m.humanOversightRequired : false;
      const severity = highRisk || autonomous || g.count >= 5 ? 'HIGH' : 'MEDIUM';
      return {
        model_id: modelId,
        model_name: m?.name ?? '(unknown)',
        risk_level: m?.riskLevel ?? null,
        human_oversight_required: m?.humanOversightRequired ?? null,
        unauthorized_calls: g.count,
        tools: [...g.tools],
        last_at: g.last.toISOString(),
        severity,
      };
    });
    out.sort((a, b) => (a.severity === b.severity ? b.unauthorized_calls - a.unauthorized_calls : a.severity === 'HIGH' ? -1 : 1));
    return { window_days: windowDays, count: out.length, deviations: out };
  }

  /**
   * Cron entrypoint: raise scope-deviation alerts for models with flagged
   * runtime tool calls in the last day. Writes a ledger event on each affected
   * model (so it shows in the cross-ledger timeline) and pushes a webhook.
   */
  async escalateScopeDeviations(): Promise<number> {
    const since = new Date(Date.now() - 86_400_000);
    const flagged = await this.actions.find({ where: { flagged: true, occurredAt: MoreThan(since) }, take: 2000 });
    const { deviations } = await this.aggregateDeviations(flagged, 1);
    for (const d of deviations) {
      await this.ledger.save(this.ledger.create({
        id: uuidv4(),
        modelId: d.model_id,
        eventType: 'SCOPE_DEVIATION_DETECTED',
        eventData: maskDict({ unauthorized_calls: d.unauthorized_calls, tools: d.tools, severity: d.severity, window: '24h' }),
        actor: 'system',
        occurredAt: new Date(),
      }));
    }
    if (deviations.length) {
      await this.notifier.notify('scope_deviations', {
        count: deviations.length,
        models: deviations.slice(0, 25).map((d) => ({ model_id: d.model_id, model_name: d.model_name, unauthorized_calls: d.unauthorized_calls, severity: d.severity })),
      });
    }
    return deviations.length;
  }

  private ledgerSummary(type: string, data: Record<string, any>): string {
    if (type === 'GOVERNANCE_UPDATED') return `governance updated: ${Object.keys(data).join(', ')}`;
    if (type === 'APPROVAL_GRANTED' || type === 'APPROVAL_REQUESTED') return `${type.toLowerCase().replace('_', ' ')}`;
    if (type === 'OPERATIONAL_SUSPENDED') return `suspended — ${data.reason ?? ''}`;
    if (type === 'SCOPE_DEVIATION_DETECTED') return `scope deviation: ${data.unauthorized_calls} unauthorized tool call(s)`;
    if (type === 'ADVERSARIAL_EVIDENCE_INGESTED') return `adversarial eval: ${data.suite} · ${data.failures} breach(es)`;
    if (type === 'EVAL_EVIDENCE_INGESTED') return `eval evidence: ${data.suite} ${data.passed}/${data.total}`;
    if (type === 'INCIDENT_REPORTED') return `incident reported — ${data.category} (${data.severity})`;
    if (type === 'INCIDENT_RESOLVED') return `incident ${String(data.status ?? 'resolved').toLowerCase()} — ${data.category}`;
    return type.toLowerCase().replace(/_/g, ' ');
  }
}
