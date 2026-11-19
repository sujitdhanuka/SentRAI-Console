/**
 * Incident extensions (E3.3, AU PO-5 / IA-11, NIST MANAGE 4.3, ISO A.8.4,
 * RBI Rec 19, US AP-4): senior-executive sign-off before a serious incident
 * is resolved or closed, notice to the affected people, a link to the
 * customer's ITSM ticket, a DTA notification record, the CISA playbook
 * mapping, and ITSM (Jira, ServiceNow) and SIEM / SOC webhooks for incidents
 * and runtime alerts. Webhook secrets are encrypted at rest and never returned.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { decryptSecret, encryptSecret } from '../../ai/key-crypto';
import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AIIncidentEntity, AIModelEntity, IntegrationDeliveryEntity, IntegrationEndpointEntity, OrganizationEntity, ProjectEntity, UserEntity } from '../../database/entities';
import { assertFlag } from '../governance-access';
import { addModelFacts, governanceHooks } from '../hooks';
import { MAINTAINERS, OFFICERS, oneOf, optDate, optText, orgFor, orgOfModel, reqText, requireRole, selfUserId } from '../phase2-util';
import { RisksService } from '../risks/risks.service';
import {
  affectedCount,
  cisaMapping,
  CISA_PHASES,
  closeBlocker,
  incidentFacts,
  INTEGRATION_EVENTS,
  INTEGRATION_KINDS,
  IntegrationKind,
  jiraPayload,
  SERIOUS,
  serviceNowPayload,
  siemEvent,
  signBody,
  ticketRef,
  webhookUrlProblem,
} from './incident-ext.model';

const NOTICE_CHANNELS = ['LETTER', 'EMAIL', 'SMS', 'PHONE', 'IN_APP', 'PUBLIC_NOTICE', 'OTHER'] as const;
const MODEL_EVENT_TO_INTEGRATION: Record<string, string> = { INCIDENT: 'INCIDENT_REPORTED', DRIFT_ALERT: 'DRIFT_ALERT', RED_TEAM_FINDING: 'RED_TEAM_FINDING', RISK_ESCALATION: 'RISK_ESCALATION' };

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

@Injectable()
export class IncidentExtensionsService implements OnModuleInit {
  private readonly logger = new Logger(IncidentExtensionsService.name);
  /** Outbound HTTP; tests replace it. */
  fetcher: Fetcher = (url, init) => fetch(url, init as any) as any;

  constructor(
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(IntegrationEndpointEntity) private readonly endpoints: Repository<IntegrationEndpointEntity>,
    @InjectRepository(IntegrationDeliveryEntity) private readonly deliveries: Repository<IntegrationDeliveryEntity>,
    private readonly risks: RisksService,
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    governanceHooks.incidentCloseCheck = async (incidentId) => {
      if (!this.flags.isEnabled('incidentExtensions')) return null;
      const inc = await this.incidents.findOne({ where: { id: incidentId } });
      return inc ? closeBlocker(inc) : null;
    };
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('incidentExtensions')) return undefined;
      return { incidentExt: incidentFacts(await this.incidents.find({ where: { modelId } })) };
    });
    // Incidents and runtime alerts go to the organisation's ITSM and SIEM webhooks (in the background).
    this.risks.onEvent(async (modelId, event, detail) => {
      if (!this.flags.isEnabled('incidentExtensions')) return;
      const kind = MODEL_EVENT_TO_INTEGRATION[event];
      if (!kind) return;
      void this.dispatchModelEvent(modelId, kind, detail).catch((e) => this.logger.warn(`webhook dispatch failed: ${String(e)}`));
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'incidentExtensions');
  }

  private get key(): string {
    return (this.config.get('encryption') as { key: string }).key;
  }

  /* ------------------------------------------------------------ incident access */

  private async orgOfIncident(inc: AIIncidentEntity): Promise<string | null> {
    if (inc.projectId) return (await this.projects.findOne({ where: { id: inc.projectId } }))?.tenantId ?? null;
    return orgOfModel(this.models, this.projects, inc.modelId);
  }

  /** An incident of the caller's organisation (another organisation's is a 404). */
  private async load(user: CurrentUser, id: string): Promise<{ inc: AIIncidentEntity; orgId: string | null }> {
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw new NotFoundException('Incident not found');
    const orgId = await this.orgOfIncident(inc);
    if (user.role !== Role.ADMIN && (orgId ?? null) !== (user.tenantId ?? null)) throw new NotFoundException('Incident not found');
    return { inc, orgId };
  }

  private view(inc: AIIncidentEntity) {
    const ext = inc.governanceExt ?? {};
    return {
      incident_id: inc.id, model_id: inc.modelId, model_name: inc.modelName, severity: inc.severity, status: inc.status, category: inc.incidentCategory,
      serious: SERIOUS.includes(inc.severity),
      senior_sign_off: inc.seniorSignOffAt ? { by: inc.seniorSignOffBy, at: inc.seniorSignOffAt, role: ext.signOff?.role ?? null, note: ext.signOff?.note ?? null } : null,
      affected: { count: affectedCount(inc), notified_at: inc.affectedPartiesNotifiedAt, notice: ext.notice ?? null },
      external_ticket_ref: inc.externalTicketRef,
      dta_notification: ext.dta ?? null,
      cisa: cisaMapping(inc),
      close_blocker: closeBlocker(inc),
    };
  }

  private async save(inc: AIIncidentEntity, patch: Record<string, any>): Promise<AIIncidentEntity> {
    inc.governanceExt = { ...(inc.governanceExt ?? {}), ...patch };
    inc.updatedAt = new Date();
    return this.incidents.save(inc);
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    const { inc } = await this.load(user, id);
    const del = await this.deliveries.find({ where: { refId: id }, order: { createdAt: 'DESC' }, take: 20 });
    return { ...this.view(inc), deliveries: del.map((d) => this.deliveryView(d)) };
  }

  /** Serious incidents of the organisation that still need sign-off or a notice. */
  async queue(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const projectIds = (await this.projects.find({ where: { tenantId: orgId }, select: ['id'] })).map((p) => p.id);
    if (!projectIds.length) return { org_id: orgId, incidents: [] };
    const modelIds = (await this.models.find({ where: { projectId: In(projectIds) }, select: ['id'] })).map((m) => m.id);
    const rows = await this.incidents.find({ where: [{ projectId: In(projectIds) }, ...(modelIds.length ? [{ modelId: In(modelIds) }] : [])], order: { createdAt: 'DESC' }, take: 500 });
    return { org_id: orgId, incidents: rows.map((r) => this.view(r)) };
  }

  /** Senior executive sign-off: officers or the organisation's accountable official. */
  async signOff(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    const { inc, orgId } = await this.load(user, id);
    const org = orgId ? await this.orgs.findOne({ where: { id: orgId } }) : null;
    const me = await selfUserId(this.users, user);
    const official = !!me && org?.accountableOfficialUserId === me;
    if (!OFFICERS.includes(user.role) && !official) throw new ForbiddenException('Only an Owner, CISO, Admin or the accountable official can sign off an incident');
    if (inc.seniorSignOffAt) throw new BadRequestException('Already signed off');
    const note = reqText(body.note, 'note', 10, 2000);
    inc.seniorSignOffBy = user.email;
    inc.seniorSignOffAt = new Date();
    await this.save(inc, { signOff: { note, role: official ? 'ACCOUNTABLE_OFFICIAL' : user.role } });
    if (req) req.auditSummary = { incident_signed_off: { incident_id: inc.id, severity: inc.severity } };
    return this.view(inc);
  }

  /** Notice to the people affected, or the reason none is needed. */
  async affectedNotice(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record notices to affected people');
    const { inc } = await this.load(user, id);
    const notRequired = optText(body.not_required_reason, 'not_required_reason', 1000);
    if (notRequired) {
      if (notRequired.length < 10) throw new BadRequestException('not_required_reason needs at least 10 characters');
      await this.save(inc, { notice: { notRequiredReason: notRequired, by: user.email, at: new Date().toISOString() } });
    } else {
      const at = optDate(body.notified_at, 'notified_at') ?? new Date();
      if (at.getTime() > Date.now() + 60_000) throw new BadRequestException('notified_at cannot be in the future');
      const count = body.people_notified === undefined ? null : Number(body.people_notified);
      if (count !== null && (!Number.isInteger(count) || count < 0)) throw new BadRequestException('people_notified must be a whole number');
      inc.affectedPartiesNotifiedAt = at;
      await this.save(inc, { notice: { channel: oneOf(body.channel, NOTICE_CHANNELS, 'channel', 'EMAIL'), peopleNotified: count, summary: reqText(body.summary, 'summary', 10, 2000), by: user.email, at: at.toISOString() } });
    }
    if (req) req.auditSummary = { incident_affected_notice: { incident_id: inc.id, not_required: Boolean(notRequired) } };
    return this.view(inc);
  }

  async externalTicket(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'link ITSM tickets');
    const { inc } = await this.load(user, id);
    inc.externalTicketRef = reqText(body.ref, 'ref', 2, 255);
    await this.save(inc, {});
    if (req) req.auditSummary = { incident_ticket_linked: { incident_id: inc.id, ref: inc.externalTicketRef } };
    return this.view(inc);
  }

  /** Record that the DTA was told about the incident (AU PO-5 / IA-11): officers only. */
  async dtaNotification(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'record a DTA notification');
    const { inc } = await this.load(user, id);
    const at = optDate(body.notified_at, 'notified_at') ?? new Date();
    if (at.getTime() > Date.now() + 60_000) throw new BadRequestException('notified_at cannot be in the future');
    await this.save(inc, { dta: { reference: reqText(body.reference, 'reference', 3, 200), notifiedAt: at.toISOString(), by: user.email } });
    if (req) req.auditSummary = { incident_dta_notified: { incident_id: inc.id } };
    return this.view(inc);
  }

  async cisaPhase(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'update the incident playbook');
    const { inc } = await this.load(user, id);
    const phase = oneOf(body.phase, CISA_PHASES, 'phase');
    if (typeof body.done !== 'boolean') throw new BadRequestException('done must be true or false');
    const phases = { ...(inc.governanceExt?.cisaPhases ?? {}), [phase]: { done: body.done, note: optText(body.note, 'note', 1000), at: new Date().toISOString(), by: user.email } };
    await this.save(inc, { cisaPhases: phases });
    if (req) req.auditSummary = { incident_playbook_phase: { incident_id: inc.id, phase, done: body.done } };
    return this.view(inc);
  }

  /* ------------------------------------------------------------ integrations */

  private endpointView(e: IntegrationEndpointEntity) {
    const cfg = e.events ?? {};
    return {
      integration_id: e.id, kind: e.kind, label: e.label, url: e.url, has_secret: Boolean(e.secretEncrypted), events: cfg.events ?? [],
      options: cfg.options ?? {}, enabled: e.enabled, last_delivery_at: e.lastDeliveryAt, last_status: e.lastStatus, created_by: e.createdBy, created_at: e.createdAt,
    };
  }

  private deliveryView(d: IntegrationDeliveryEntity) {
    return { delivery_id: d.id, integration_id: d.endpointId, event: d.event, ref_id: d.refId, status: d.status, http_status: d.httpStatus, error: d.error, payload_hash: d.payloadHash, created_at: d.createdAt };
  }

  private allowPrivate(): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env.GOV_WEBHOOK_ALLOW_PRIVATE ?? '').toLowerCase());
  }

  private parseEvents(v: unknown, kind: IntegrationKind): string[] {
    const def = kind === 'SIEM' ? ['INCIDENT_REPORTED', 'DRIFT_ALERT', 'RED_TEAM_FINDING', 'RISK_ESCALATION'] : ['INCIDENT_REPORTED', 'INCIDENT_PUSHED'];
    if (v === undefined || v === null) return def;
    if (!Array.isArray(v) || v.some((x) => !(INTEGRATION_EVENTS as readonly string[]).includes(String(x)))) throw new BadRequestException(`events must be a list of ${INTEGRATION_EVENTS.join(', ')}`);
    return [...new Set(v.map(String))];
  }

  private parseOptions(v: unknown): Record<string, string> {
    if (v === undefined || v === null) return {};
    if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('options must be an object');
    const o = v as Record<string, unknown>;
    const out: Record<string, string> = {};
    if (o.project_key !== undefined) {
      if (typeof o.project_key !== 'string' || !/^[A-Z][A-Z0-9_]{1,19}$/.test(o.project_key)) throw new BadRequestException('options.project_key must be a Jira project key');
      out.project_key = o.project_key;
    }
    if (o.issue_type !== undefined) out.issue_type = reqText(o.issue_type, 'options.issue_type', 2, 60);
    return out;
  }

  async listIntegrations(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    requireRole(user, OFFICERS, 'view integrations');
    const orgId = orgFor(user, q.org_id);
    return { org_id: orgId, kinds: INTEGRATION_KINDS, events: INTEGRATION_EVENTS, integrations: (await this.endpoints.find({ where: { orgId }, order: { createdAt: 'ASC' } })).map((e) => this.endpointView(e)) };
  }

  async createIntegration(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'configure integrations');
    const orgId = orgFor(user, body.org_id);
    if ((await this.endpoints.count({ where: { orgId } })) >= 20) throw new BadRequestException('At most 20 integrations per organization');
    const kind = oneOf(body.kind, INTEGRATION_KINDS, 'kind');
    const url = reqText(body.url, 'url', 10, 1000);
    const problem = webhookUrlProblem(url, this.allowPrivate());
    if (problem) throw new BadRequestException(problem);
    const secret = optText(body.secret, 'secret', 2000);
    const now = new Date();
    const e = await this.endpoints.save(this.endpoints.create({
      id: uuidv4(), orgId, kind, label: reqText(body.label ?? kind, 'label', 2, 200), url,
      secretEncrypted: secret ? encryptSecret(secret, this.key) : null,
      events: { events: this.parseEvents(body.events, kind), options: this.parseOptions(body.options) },
      enabled: body.enabled !== false, lastDeliveryAt: null, lastStatus: null, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { integration_created: { integration_id: e.id, kind, host: new URL(url).host } };
    return this.endpointView(e);
  }

  private async endpointInOrg(user: CurrentUser, id: string): Promise<IntegrationEndpointEntity> {
    const e = await this.endpoints.findOne({ where: { id } });
    if (!e || e.orgId !== orgFor(user, e.orgId)) throw new NotFoundException('Integration not found');
    return e;
  }

  async updateIntegration(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'configure integrations');
    const e = await this.endpointInOrg(user, id);
    if (body.url !== undefined) {
      const url = reqText(body.url, 'url', 10, 1000);
      const problem = webhookUrlProblem(url, this.allowPrivate());
      if (problem) throw new BadRequestException(problem);
      e.url = url;
    }
    if (body.label !== undefined) e.label = reqText(body.label, 'label', 2, 200);
    if (body.secret !== undefined) e.secretEncrypted = body.secret ? encryptSecret(reqText(body.secret, 'secret', 1, 2000), this.key) : null;
    if (body.enabled !== undefined) e.enabled = body.enabled === true;
    if (body.events !== undefined || body.options !== undefined) {
      e.events = { events: body.events !== undefined ? this.parseEvents(body.events, e.kind as IntegrationKind) : e.events?.events ?? [], options: body.options !== undefined ? this.parseOptions(body.options) : e.events?.options ?? {} };
    }
    e.updatedAt = new Date();
    await this.endpoints.save(e);
    if (req) req.auditSummary = { integration_updated: { integration_id: e.id, enabled: e.enabled } };
    return this.endpointView(e);
  }

  async listDeliveries(user: CurrentUser, q: { org_id?: string; integration_id?: string }) {
    this.assert();
    requireRole(user, OFFICERS, 'view integrations');
    const orgId = orgFor(user, q.org_id);
    const rows = await this.deliveries.find({ where: { orgId, ...(q.integration_id ? { endpointId: q.integration_id } : {}) }, order: { createdAt: 'DESC' }, take: 100 });
    return { org_id: orgId, deliveries: rows.map((d) => this.deliveryView(d)) };
  }

  /** Build the body for one endpoint. */
  private payload(e: IntegrationEndpointEntity, event: string, orgId: string, inc: AIIncidentEntity | null, data: { modelId: string; modelName?: string | null; ref?: string | null; detail?: string | null }) {
    const opts = e.events?.options ?? {};
    if (inc && e.kind === 'JIRA') return jiraPayload(inc, { projectKey: opts.project_key, issueType: opts.issue_type });
    if (inc && e.kind === 'SERVICENOW') return serviceNowPayload(inc);
    return siemEvent(event, orgId, { ...data, severity: inc?.severity ?? null, modelName: inc?.modelName ?? data.modelName ?? null });
  }

  /** Send one event to one endpoint and log the delivery. Never throws. */
  private async deliver(e: IntegrationEndpointEntity, event: string, refId: string | null, body: unknown): Promise<{ d: IntegrationDeliveryEntity; ticket: string | null }> {
    const json = JSON.stringify(body);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'SentRAI-Governance/1', 'X-SentRAI-Event': event };
    const secret = e.secretEncrypted ? decryptSecret(e.secretEncrypted, this.key) : null;
    if (secret) {
      // ITSM APIs take the stored value as the Authorization header; generic and SIEM webhooks get an HMAC signature.
      if (e.kind === 'JIRA' || e.kind === 'SERVICENOW') headers.Authorization = secret;
      else headers['X-SentRAI-Signature'] = signBody(secret, json);
    }
    let status = 'FAILED';
    let httpStatus: number | null = null;
    let error: string | null = null;
    let ticket: string | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await this.fetcher(e.url, { method: 'POST', headers, body: json, signal: controller.signal });
      httpStatus = res.status;
      status = res.ok ? 'DELIVERED' : 'FAILED';
      if (res.ok) ticket = ticketRef(e.kind as IntegrationKind, await res.json().catch(() => null));
      else error = `HTTP ${res.status}`;
    } catch (err) {
      error = String((err as Error)?.message ?? err).slice(0, 300);
    } finally {
      clearTimeout(timer);
    }
    const d = await this.deliveries.save(this.deliveries.create({
      id: uuidv4(), orgId: e.orgId, endpointId: e.id, event, refId, status, httpStatus, error, payloadHash: createHash('sha256').update(json).digest('hex'), createdAt: new Date(),
    }));
    e.lastDeliveryAt = d.createdAt;
    e.lastStatus = status;
    await this.endpoints.save(e);
    return { d, ticket };
  }

  private async active(orgId: string, event: string): Promise<IntegrationEndpointEntity[]> {
    return (await this.endpoints.find({ where: { orgId, enabled: true } })).filter((e) => (e.events?.events ?? []).includes(event));
  }

  async dispatchModelEvent(modelId: string, event: string, detail?: Record<string, any>): Promise<number> {
    const orgId = await orgOfModel(this.models, this.projects, modelId);
    if (!orgId) return 0;
    const targets = await this.active(orgId, event);
    if (!targets.length) return 0;
    const inc = event === 'INCIDENT_REPORTED' && detail?.ref ? await this.incidents.findOne({ where: { id: String(detail.ref) } }) : null;
    const m = await this.models.findOne({ where: { id: modelId }, select: ['id', 'name'] });
    for (const e of targets) {
      // ITSM endpoints only take incidents; runtime alerts go to SIEM and generic webhooks.
      if (!inc && (e.kind === 'JIRA' || e.kind === 'SERVICENOW')) continue;
      const { ticket } = await this.deliver(e, event, inc?.id ?? detail?.ref ?? null, this.payload(e, event, orgId, inc, { modelId, modelName: m?.name, ref: detail?.ref ?? null, detail: detail?.source ?? null }));
      if (inc && ticket && !inc.externalTicketRef) {
        inc.externalTicketRef = ticket;
        await this.incidents.save(inc);
      }
    }
    return targets.length;
  }

  /** Push an incident to the organisation's ITSM now; links the ticket the ITSM returns. */
  async push(user: CurrentUser, id: string, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'push incidents to ITSM');
    const { inc, orgId } = await this.load(user, id);
    if (!orgId) throw new BadRequestException('The incident has no organization');
    const targets = (await this.active(orgId, 'INCIDENT_PUSHED')).filter((e) => e.kind !== 'SIEM');
    if (!targets.length) throw new BadRequestException('No ITSM integration takes pushed incidents');
    const results: Array<ReturnType<IncidentExtensionsService["deliveryView"]>> = [];
    for (const e of targets) {
      const { d, ticket } = await this.deliver(e, 'INCIDENT_PUSHED', inc.id, this.payload(e, 'INCIDENT_PUSHED', orgId, inc, { modelId: inc.modelId }));
      if (ticket && !inc.externalTicketRef) inc.externalTicketRef = ticket;
      results.push(this.deliveryView(d));
    }
    await this.incidents.save(inc);
    if (req) req.auditSummary = { incident_pushed: { incident_id: inc.id, deliveries: results.length } };
    return { ...this.view(inc), deliveries: results };
  }

  /** Send a test event to one integration. */
  async test(user: CurrentUser, id: string) {
    this.assert();
    requireRole(user, OFFICERS, 'test integrations');
    const e = await this.endpointInOrg(user, id);
    const body = siemEvent('TEST', e.orgId, { modelId: 'test', ref: 'connectivity test', detail: 'SentRAI integration test' });
    return this.deliveryView((await this.deliver(e, 'TEST', null, body)).d);
  }
}
