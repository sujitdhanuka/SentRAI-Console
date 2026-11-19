/**
 * Disclosures and regulator exports (E3.2): the annual transparency statement
 * with a review reminder and a notification log; the RBI inspection export;
 * the OMB AI use case inventory; the Colorado developer disclosure package,
 * a deployer register and material-update notices to deployers.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import { generateGovernancePdf } from '../../compliance/pdf-generator';
import {
  AIAuditTrailEntity,
  AIIncidentEntity,
  AIModelEntity,
  AimsRecordEntity,
  BcpStateEntity,
  DatasetEntity,
  DisclosureEntity,
  DriftReportEntity,
  GrievanceEntity,
  ImpactAssessmentEntity,
  ModelDatasetEntity,
  ModelDeployerEntity,
  ModelValidationEntity,
  OrganizationEntity,
  ProjectEntity,
  RiskActionEntity,
  RiskEntity,
  UserEntity,
} from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts, addOrgFacts } from '../hooks';
import { addMonths, MAINTAINERS, OFFICERS, oneOf, optDate, optText, orgFor, orgModels, reqText, requireRole, toCsv, saveVersioned } from '../phase2-util';
import { RisksService } from '../risks/risks.service';
import { buildXlsx } from './xlsx';
import {
  buildDeveloperDisclosure,
  buildTransparencyStatement,
  contentHash,
  developerGaps,
  DISCLOSURE_KINDS,
  ModelExtras,
  ModelRow,
  OMB_FIELDS,
  ombInventoryRows,
  RBI_FIELDS,
  rbiInspectionRows,
  TRANSPARENCY_NARRATIVE,
  transparencyGaps,
} from './disclosures.model';

const NOTIFICATION_CHANNELS = ['WEBSITE', 'EMAIL', 'PORTAL', 'REGULATOR', 'LETTER', 'OTHER'] as const;
const OPEN_INCIDENT = ['REPORTED', 'UNDER_INVESTIGATION', 'REMEDIATION_IN_PROGRESS'];
const OPEN_GRIEVANCE = ['RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING'];

@Injectable()
export class DisclosuresService implements OnModuleInit {
  private readonly logger = new Logger(DisclosuresService.name);

  constructor(
    @InjectRepository(DisclosureEntity) private readonly rows: Repository<DisclosureEntity>,
    @InjectRepository(ModelDeployerEntity) private readonly deployers: Repository<ModelDeployerEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(GrievanceEntity) private readonly grievances: Repository<GrievanceEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(AIAuditTrailEntity) private readonly audits: Repository<AIAuditTrailEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(BcpStateEntity) private readonly bcp: Repository<BcpStateEntity>,
    @InjectRepository(ImpactAssessmentEntity) private readonly impacts: Repository<ImpactAssessmentEntity>,
    @InjectRepository(ModelValidationEntity) private readonly validations: Repository<ModelValidationEntity>,
    @InjectRepository(ModelDatasetEntity) private readonly modelDatasets: Repository<ModelDatasetEntity>,
    @InjectRepository(DatasetEntity) private readonly datasets: Repository<DatasetEntity>,
    @InjectRepository(RiskEntity) private readonly risks: Repository<RiskEntity>,
    @InjectRepository(RiskActionEntity) private readonly riskActions: Repository<RiskActionEntity>,
    @InjectRepository(AimsRecordEntity) private readonly aims: Repository<AimsRecordEntity>,
    private readonly risksService: RisksService,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addOrgFacts(async (orgId) => {
      if (!this.flags.isEnabled('disclosures')) return undefined;
      return { disclosures: await this.orgFacts(orgId) };
    });
    addModelFacts(async (modelId, orgId) => {
      if (!this.flags.isEnabled('disclosures') || !orgId) return undefined;
      return { deployers: await this.deployerFacts(modelId) };
    });
    // A material change to a model with deployers makes an update notice due (Colorado developer duty).
    this.risksService.onEvent(async (modelId, event, detail) => {
      if (!this.flags.isEnabled('disclosures') || !['MATERIAL_CHANGE', 'CONTEXT_CHANGED', 'VENDOR_CHANGE'].includes(event)) return;
      await this.noticeDue(modelId, event, detail?.ref ?? null);
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'disclosures');
  }

  /* ------------------------------------------------------------ facts */

  async orgFacts(orgId: string, now = new Date()) {
    const ts = await this.rows.findOne({ where: { orgId, kind: 'TRANSPARENCY_STATEMENT', status: 'PUBLISHED' }, order: { publishedAt: 'DESC' } });
    return { transparencyPublishedAt: ts?.publishedAt?.toISOString() ?? null, reviewOverdue: !!ts?.reviewDueAt && ts.reviewDueAt.getTime() < now.getTime() };
  }

  async deployerFacts(modelId: string) {
    const deployers = await this.deployers.count({ where: { modelId, active: true } });
    const noticesDue = deployers ? await this.rows.count({ where: { modelId, kind: 'CO_UPDATE_NOTICE', status: 'DRAFT' } }) : 0;
    return { deployers, noticesDue };
  }

  /* ------------------------------------------------------------ data */

  private modelRow(m: AIModelEntity, owners: Map<string, string>): ModelRow {
    return {
      id: m.id, name: m.name, modelType: m.modelType, functionalArea: m.functionalArea, useCaseDescription: m.useCaseDescription,
      riskLevel: m.riskLevel, lifecycleStage: m.lifecycleStage, ownerTeam: m.ownerTeam, ownerName: m.ownerUserId ? owners.get(m.ownerUserId) ?? null : null,
      developedBy: m.developedBy, humanOversightRequired: m.humanOversightRequired, boardPolicyRef: m.boardPolicyRef, lastRedTeamDate: m.lastRedTeamDate,
      nextAuditDue: m.nextAuditDue, deploymentDate: m.deploymentDate, targetCustomerSegments: m.targetCustomerSegments ?? [], contextProfile: m.contextProfile,
      energyKwh: this.flags.isEnabled('energy') ? m.energyKwh : null, co2eKg: this.flags.isEnabled('energy') ? m.co2eKg : null,
    };
  }

  private async loadOrg(orgId: string) {
    const models = await orgModels(this.models, this.projects, orgId);
    const users = await this.users.find({ where: { tenantId: orgId } });
    const owners = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    return { models, rows: models.map((m) => this.modelRow(m, owners)), users };
  }

  private async extras(models: AIModelEntity[]): Promise<Map<string, ModelExtras>> {
    const ids = models.map((m) => m.id);
    const out = new Map<string, ModelExtras>();
    if (!ids.length) return out;
    const [inc, griev, aud, drift, bcp, ia, val, links, risks] = await Promise.all([
      this.incidents.find({ where: { modelId: In(ids) } }),
      this.grievances.find({ where: { modelId: In(ids) } }),
      this.audits.find({ where: { modelId: In(ids) }, order: { createdAt: 'DESC' } }),
      this.drifts.find({ where: { modelId: In(ids) }, select: ['id', 'modelId'] }),
      this.bcp.find({ where: { modelId: In(ids) } }),
      this.impacts.find({ where: { modelId: In(ids) }, order: { version: 'DESC' } }),
      this.validations.find({ where: { modelId: In(ids) }, order: { version: 'DESC' } }),
      this.modelDatasets.find({ where: { modelId: In(ids) } }),
      this.risks.find({ where: { scopeType: 'MODEL', scopeId: In(ids) } }),
    ]);
    const ds = links.length ? await this.datasets.find({ where: { id: In([...new Set(links.map((l) => l.datasetId))]) } }) : [];
    const actions = risks.length ? await this.riskActions.find({ where: { riskId: In(risks.map((r) => r.id)) } }) : [];
    for (const m of models) {
      const myInc = inc.filter((x) => x.modelId === m.id);
      const myG = griev.filter((x) => x.modelId === m.id);
      const myA = aud.filter((x) => x.modelId === m.id);
      const myIa = ia.find((x) => x.modelId === m.id && x.status !== 'DRAFT' && x.status !== 'SUPERSEDED');
      const myVal = val.find((x) => x.modelId === m.id);
      const b = bcp.find((x) => x.modelId === m.id);
      out.set(m.id, {
        incidents: { total: myInc.length, open: myInc.filter((x) => OPEN_INCIDENT.includes(x.status)).length, serious: myInc.filter((x) => ['P1_CRITICAL', 'P2_HIGH'].includes(x.severity)).length },
        grievances: { total: myG.length, open: myG.filter((x) => OPEN_GRIEVANCE.includes(x.status)).length },
        audits: { total: myA.length, lastVerdict: myA[0]?.overallVerdict ?? null, lastAt: myA[0]?.createdAt ?? null },
        drift: { reports: drift.filter((x) => x.modelId === m.id).length },
        bcp: { configured: Boolean(b?.rulesEngineRef), lastDrill: b?.drillLastConducted ?? null },
        highImpact: myIa?.highImpact ?? null,
        impactAssessment: myIa ? `${myIa.status} v${myIa.version}${myIa.signedAt ? ` signed ${myIa.signedAt.toISOString().slice(0, 10)}` : ''}` : null,
        validation: myVal ? `${myVal.status}${myVal.result ? ` (${myVal.result})` : ''}` : null,
        // Deleted datasets no longer count as the model's data.
        datasets: links
          .filter((l) => l.modelId === m.id)
          .map((l) => ds.find((x) => x.id === l.datasetId && x.deletionStatus !== 'DELETED') ? { l, d: ds.find((x) => x.id === l.datasetId)! } : null)
          .filter((x): x is { l: ModelDatasetEntity; d: DatasetEntity } => Boolean(x))
          .map(({ l, d }) => ({ name: d.name, purpose: l.purpose, personalData: Boolean(d.personalData), lawfulBasis: d.lawfulBasis ?? null, provenance: d.provenance ?? null })),
        risks: risks.filter((r) => r.scopeId === m.id && !['DISMISSED'].includes(r.status)).map((r) => ({
          title: r.title, category: r.category, status: r.status, treatment: actions.filter((a) => a.riskId === r.id).map((a) => `${a.treatment}: ${a.action}`).join('; ') || null,
        })),
      });
    }
    return out;
  }

  /* ------------------------------------------------------------ records */

  private view(r: DisclosureEntity, withContent = false) {
    return {
      disclosure_id: r.id, kind: r.kind, model_id: r.modelId, version: r.version, title: r.title,
      period_start: r.periodStart, period_end: r.periodEnd, status: r.status, content_hash: r.contentHash,
      published_by: r.publishedBy, published_at: r.publishedAt, public_url: r.publicUrl, review_due_at: r.reviewDueAt,
      notifications: r.notifications ?? [], created_by: r.createdBy, created_at: r.createdAt, updated_at: r.updatedAt,
      gaps: r.kind === 'TRANSPARENCY_STATEMENT' ? transparencyGaps(r.content) : r.kind === 'CO_DEVELOPER' ? developerGaps(r.content) : [],
      ...(withContent ? { content: r.content } : {}),
    };
  }

  private async load(user: CurrentUser, id: string): Promise<DisclosureEntity> {
    const r = await this.rows.findOne({ where: { id } });
    if (!r || r.orgId !== orgFor(user, r.orgId)) throw new NotFoundException('Disclosure not found');
    return r;
  }

  async list(user: CurrentUser, q: { org_id?: string; kind?: string; model_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const where: Record<string, any> = { orgId };
    if (q.kind) where.kind = oneOf(q.kind, DISCLOSURE_KINDS, 'kind');
    if (q.model_id) where.modelId = q.model_id;
    const rows = await this.rows.find({ where, order: { createdAt: 'DESC' } });
    return { org_id: orgId, kinds: DISCLOSURE_KINDS, disclosures: rows.map((r) => this.view(r)) };
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    return this.view(await this.load(user, id), true);
  }

  private async nextVersion(orgId: string, kind: string, modelId: string | null): Promise<number> {
    const last = await this.rows.findOne({ where: { orgId, kind, ...(modelId ? { modelId } : {}) }, order: { version: 'DESC' } });
    return (last?.version ?? 0) + 1;
  }

  /** Generate a draft transparency statement or Colorado developer disclosure. */
  async create(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'prepare disclosures');
    const kind = oneOf(body.kind, ['TRANSPARENCY_STATEMENT', 'CO_DEVELOPER'] as const, 'kind');
    const orgId = orgFor(user, body.org_id);
    const now = new Date();
    let content: Record<string, any>;
    let title: string;
    let modelId: string | null = null;
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (kind === 'TRANSPARENCY_STATEMENT') {
      periodEnd = optDate(body.period_end, 'period_end') ?? now;
      periodStart = optDate(body.period_start, 'period_start') ?? addMonths(periodEnd, -12);
      if (periodStart >= periodEnd) throw new BadRequestException('period_start must be before period_end');
      content = await this.transparencyContent(orgId, periodStart, periodEnd, body.narrative);
      title = `AI transparency statement ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`;
    } else {
      const { model, orgId: mOrg } = await modelForUser(this.models, this.projects, user, String(body.model_id ?? ''));
      if (mOrg !== orgId) throw new NotFoundException('Model not found');
      modelId = model.id;
      content = await this.developerContent(orgId, model);
      title = `Developer disclosure: ${model.name}`.slice(0, 255);
    }
    const version = await this.nextVersion(orgId, kind, modelId);
    const r = await saveVersioned(() => this.rows.save(this.rows.create({
      id: uuidv4(), orgId, kind, modelId, version, title, periodStart, periodEnd,
      content, contentHash: contentHash(content), status: 'DRAFT', publishedBy: null, publishedAt: null, publicUrl: null, reviewDueAt: null,
      notifications: [], createdBy: user.email, createdAt: now, updatedAt: now,
    })));
    if (req) req.auditSummary = { disclosure_drafted: { disclosure_id: r.id, kind, model_id: modelId } };
    return this.view(r, true);
  }

  private async transparencyContent(orgId: string, periodStart: Date, periodEnd: Date, narrative?: Record<string, any>) {
    const { models, rows } = await this.loadOrg(orgId);
    const ids = models.map((m) => m.id);
    const org = await this.orgs.findOne({ where: { id: orgId } });
    const official = org?.accountableOfficialUserId ? await this.users.findOne({ where: { id: org.accountableOfficialUserId } }) : null;
    const policy = await this.aims.findOne({ where: { orgId, type: 'POLICY', status: 'APPROVED' }, order: { approvedAt: 'DESC' } });
    const [g, inc] = ids.length
      ? await Promise.all([this.grievances.find({ where: { modelId: In(ids) } }), this.incidents.find({ where: { modelId: In(ids) } })])
      : [[], []];
    return buildTransparencyStatement({
      organisation: org?.name ?? orgId, periodStart, periodEnd, models: rows,
      grievances: g.map((x) => ({ category: x.category, status: x.status, createdAt: x.createdAt, resolvedAt: x.resolvedAt })),
      incidents: inc.map((x) => ({ severity: x.severity, status: x.status, createdAt: x.createdAt, seniorSignOffAt: x.seniorSignOffAt })),
      accountableOfficial: official ? official.fullName || official.email : null,
      policyApprovedAt: policy?.approvedAt?.toISOString().slice(0, 10) ?? null,
      energy: this.flags.isEnabled('energy'),
      narrative: this.parseNarrative(narrative),
    });
  }

  private parseNarrative(n: unknown): Record<string, string> {
    if (n === undefined || n === null) return {};
    if (typeof n !== 'object' || Array.isArray(n)) throw new BadRequestException('narrative must be an object');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (!(TRANSPARENCY_NARRATIVE as readonly string[]).includes(k)) throw new BadRequestException(`narrative.${k} is not a section (${TRANSPARENCY_NARRATIVE.join(', ')})`);
      out[k] = optText(v, `narrative.${k}`, 4000) ?? '';
    }
    return out;
  }

  private async developerContent(orgId: string, model: AIModelEntity) {
    const users = await this.users.find({ where: { tenantId: orgId } });
    const owners = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    const x = (await this.extras([model])).get(model.id)!;
    const deps = await this.deployers.find({ where: { modelId: model.id, active: true } });
    return buildDeveloperDisclosure(this.modelRow(model, owners), x, deps);
  }

  /** Edit the narrative of a draft transparency statement, or regenerate a draft from current data. */
  async update(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'prepare disclosures');
    const r = await this.load(user, id);
    if (r.status !== 'DRAFT') throw new BadRequestException('Only a draft can be changed; generate a new version instead');
    if (r.kind === 'TRANSPARENCY_STATEMENT') {
      const narrative = { ...(r.content.narrative ?? {}), ...this.parseNarrative(body.narrative) };
      r.content = body.regenerate ? await this.transparencyContent(r.orgId, r.periodStart!, r.periodEnd!, narrative) : { ...r.content, narrative };
    } else if (r.kind === 'CO_DEVELOPER' && body.regenerate) {
      const m = await this.models.findOne({ where: { id: r.modelId! } });
      if (!m) throw new NotFoundException('Model not found');
      r.content = await this.developerContent(r.orgId, m);
    } else if (r.kind === 'CO_UPDATE_NOTICE' && body.summary !== undefined) {
      r.content = { ...r.content, summary: reqText(body.summary, 'summary', 10, 2000) };
    }
    r.contentHash = contentHash(r.content);
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (req) req.auditSummary = { disclosure_updated: { disclosure_id: r.id } };
    return this.view(r, true);
  }

  /** Officers publish a draft: content frozen with its hash, review date set, earlier publications superseded. */
  async publish(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'publish disclosures');
    const r = await this.load(user, id);
    if (r.status !== 'DRAFT') throw new BadRequestException('Already published');
    const gaps = r.kind === 'TRANSPARENCY_STATEMENT' ? transparencyGaps(r.content) : [];
    if (gaps.length) throw new BadRequestException({ message: 'Write every section before publishing', missing: gaps });
    // A developer disclosure goes to deployers: every required statement must be there (fill the context profile and refresh).
    const devGaps = r.kind === 'CO_DEVELOPER' ? developerGaps(r.content) : [];
    if (devGaps.length) throw new BadRequestException({ message: 'Complete the developer disclosure before publishing (context profile, data register, validation or impact assessment), then refresh it', missing: devGaps });
    if (r.kind === 'CO_UPDATE_NOTICE' && !String(r.content.summary ?? '').trim()) throw new BadRequestException('Describe the update (summary) before notifying deployers');
    const publicUrl = optText(body.public_url, 'public_url', 500);
    if (publicUrl && !/^https:\/\//i.test(publicUrl)) throw new BadRequestException('public_url must be an https link');
    const now = new Date();
    const previous = await this.rows.find({ where: { orgId: r.orgId, kind: r.kind, status: 'PUBLISHED', ...(r.modelId ? { modelId: r.modelId } : {}) } });
    for (const p of previous) {
      p.status = 'SUPERSEDED';
      p.updatedAt = now;
    }
    if (previous.length) await this.rows.save(previous);
    r.status = 'PUBLISHED';
    r.publishedBy = user.email;
    r.publishedAt = now;
    r.publicUrl = publicUrl;
    r.reviewDueAt = r.kind === 'TRANSPARENCY_STATEMENT' ? addMonths(now, 12) : null;
    r.contentHash = contentHash(r.content);
    if (r.kind === 'CO_UPDATE_NOTICE') {
      // The notice goes to every active deployer of the model; each is logged.
      const deps = await this.deployers.find({ where: { modelId: r.modelId!, active: true } });
      r.notifications = [...(r.notifications ?? []), ...deps.map((d) => ({ recipient: d.name, contact: d.contact, channel: 'EMAIL', reference: null, at: now.toISOString(), by: user.email }))].slice(-200);
      await this.notifier.notify('deployer_update_notice', { tenant_id: r.orgId, model_id: r.modelId, deployers: deps.map((d) => d.name), summary: r.content.summary });
    }
    r.updatedAt = now;
    await this.rows.save(r);
    if (req) req.auditSummary = { disclosure_published: { disclosure_id: r.id, kind: r.kind, content_hash: r.contentHash } };
    return this.view(r, true);
  }

  /** Log where a published disclosure was sent or posted (notification log). */
  async notify(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'log disclosure notifications');
    const r = await this.load(user, id);
    if (r.status !== 'PUBLISHED') throw new BadRequestException('Only a published disclosure can be sent');
    const entry = {
      recipient: reqText(body.recipient, 'recipient', 2, 200), contact: optText(body.contact, 'contact', 255),
      channel: oneOf(body.channel, NOTIFICATION_CHANNELS, 'channel', 'EMAIL'), reference: optText(body.reference, 'reference', 200),
      at: new Date().toISOString(), by: user.email,
    };
    r.notifications = [...(r.notifications ?? []), entry].slice(-200);
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (req) req.auditSummary = { disclosure_notified: { disclosure_id: r.id, recipient: entry.recipient, channel: entry.channel } };
    return this.view(r);
  }

  async exportOne(user: CurrentUser, id: string, format = 'pdf'): Promise<{ body: Buffer | string; type: string; filename: string }> {
    this.assert();
    const r = await this.load(user, id);
    const slug = `${r.kind.toLowerCase().replace(/_/g, '-')}-v${r.version}`;
    if (format === 'json') return { body: JSON.stringify({ ...this.view(r, true) }, null, 2), type: 'application/json', filename: `${slug}.json` };
    if (format !== 'pdf') throw new BadRequestException('format must be pdf or json');
    const c = r.content;
    const facts: Array<[string, string]> = [['Version', `v${r.version} (${r.status.toLowerCase()})`], ['Published', r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : 'not yet'], ['Content hash', r.contentHash]];
    const list = (o: Record<string, number> | undefined) => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
    const sections =
      r.kind === 'TRANSPARENCY_STATEMENT'
        ? [
            { heading: 'Why and how we use AI', paragraphs: [c.narrative?.intentions || '(to be written)'] },
            { heading: 'AI systems in use', paragraphs: [`${c.ai_use.systems} systems. By usage: ${list(c.ai_use.by_usage_pattern)}. By domain: ${list(c.ai_use.by_domain)}. By risk: ${list(c.ai_use.by_risk)}. With human oversight: ${c.ai_use.with_human_oversight}.`],
              rows: (c.systems ?? []).map((s: any) => ({ title: s.name, lines: [s.purpose, `Risk ${s.risk}; ${s.human_oversight ? 'human oversight' : 'no human oversight'}; ${s.stage}`] })) },
            { heading: 'Monitoring and effectiveness', paragraphs: [c.narrative?.monitoring || '(to be written)'] },
            { heading: 'Compliance and governance', paragraphs: [c.narrative?.compliance || '(to be written)', `Accountable official: ${c.governance.accountable_official ?? 'not designated'}. AI policy approved: ${c.governance.ai_policy_approved ?? 'no'}.`] },
            { heading: 'Complaints and incidents', paragraphs: [`Complaints received: ${c.grievances.received}, resolved: ${c.grievances.resolved}${c.grievances.median_days_to_resolve !== null ? `, median ${c.grievances.median_days_to_resolve} days` : ''}. Incidents: ${c.incidents.total} (${list(c.incidents.by_severity)}).`] },
            ...(c.energy ? [{ heading: 'Energy and emissions', paragraphs: [`${c.energy.kwh} kWh and ${c.energy.co2e_kg} kg CO2e across ${c.energy.systems_measured} measured systems.`] }] : []),
            { heading: 'Contact', paragraphs: [c.narrative?.contact || '(to be written)'] },
          ]
        : r.kind === 'CO_DEVELOPER'
          ? [
              { heading: 'Purpose and intended benefits', paragraphs: [c.purpose, c.intended_benefits ?? ''] },
              { heading: 'Known harmful or inappropriate uses', paragraphs: c.known_harmful_or_inappropriate_uses.length ? c.known_harmful_or_inappropriate_uses : ['Not documented.'] },
              { heading: 'Known limitations', paragraphs: c.known_limitations.length ? c.known_limitations : ['Not documented.'] },
              { heading: 'Training data', rows: c.training_data.map((t: any) => ({ title: t.name, lines: [`${t.purpose}; personal data: ${t.personal_data ? 'yes' : 'no'}; lawful basis: ${t.lawful_basis ?? '—'}`, t.provenance ?? ''] })) },
              { heading: 'Evaluation', paragraphs: [`Validation: ${c.evaluation.validation ?? 'none'}. Impact assessment: ${c.evaluation.impact_assessment ?? 'none'}. Audits: ${c.evaluation.audits}.`] },
              { heading: 'Algorithmic discrimination risks and mitigations', rows: [...c.discrimination_risks, ...c.mitigations].map((x: any) => ({ title: x.title, lines: [x.treatment ?? x.status ?? ''] })) },
              { heading: 'Use and monitoring', paragraphs: [`Human oversight: ${c.use_and_monitoring.human_oversight ? 'yes' : 'no'}; pattern: ${c.use_and_monitoring.oversight_pattern ?? '—'}.`] },
            ]
          : [{ heading: 'Update', paragraphs: [String(c.summary ?? ''), `Change: ${c.change ?? ''}`] }, { heading: 'Deployers notified', rows: (r.notifications ?? []).map((n: any) => ({ title: n.recipient, lines: [`${n.channel} ${n.at.slice(0, 10)}`] })) }];
    const body = await generateGovernancePdf({ title: r.title, facts, sections, footer: 'Generated by SentRAI from the organization’s AI inventory and registers.' });
    return { body, type: 'application/pdf', filename: `${slug}.pdf` };
  }

  /* ------------------------------------------------------------ regulator exports */

  async regulatorExport(user: CurrentUser, which: 'rbi-inspection' | 'omb-inventory', q: { org_id?: string; format?: string }): Promise<{ body: Buffer | string; type: string; filename: string }> {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const { models, rows } = await this.loadOrg(orgId);
    const extras = await this.extras(models);
    const org = await this.orgs.findOne({ where: { id: orgId } });
    const fields = which === 'rbi-inspection' ? RBI_FIELDS : OMB_FIELDS;
    const data: Array<Record<string, any>> = which === 'rbi-inspection' ? rbiInspectionRows(rows, extras) : ombInventoryRows(org?.name ?? orgId, rows, extras);
    const format = (q.format ?? 'json').toLowerCase();
    const base = which === 'rbi-inspection' ? 'rbi-inspection' : 'omb-ai-use-case-inventory';
    if (format === 'csv') return { body: toCsv(fields as any, data), type: 'text/csv; charset=utf-8', filename: `${base}.csv` };
    if (format === 'xlsx') return { body: buildXlsx(base, fields.map((f) => f.label), data.map((r) => fields.map((f) => r[f.key]))), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${base}.xlsx` };
    if (format !== 'json') throw new BadRequestException('format must be json, csv or xlsx');
    // Field completeness: every empty field of every system is listed, so a gap is never silent.
    const incomplete = data
      .map((r) => ({ system: r.name ?? r.use_case_name ?? r.model_id ?? r.id, missing: fields.filter((f) => r[f.key] === null || r[f.key] === undefined || r[f.key] === '').map((f) => f.key) }))
      .filter((x) => x.missing.length);
    return { body: JSON.stringify({ org_id: orgId, generated_at: new Date().toISOString(), fields, rows: data, completeness: { systems: data.length, complete: data.length - incomplete.length, incomplete } }), type: 'application/json', filename: `${base}.json` };
  }

  /* ------------------------------------------------------------ deployers */

  private deployerView(d: ModelDeployerEntity) {
    return { deployer_id: d.id, model_id: d.modelId, name: d.name, contact: d.contact, active: d.active, added_by: d.addedBy, added_at: d.addedAt };
  }

  async listDeployers(user: CurrentUser, modelId: string) {
    this.assert();
    await modelForUser(this.models, this.projects, user, modelId);
    const rows = await this.deployers.find({ where: { modelId }, order: { addedAt: 'ASC' } });
    return { model_id: modelId, deployers: rows.map((d) => this.deployerView(d)), facts: await this.deployerFacts(modelId) };
  }

  async addDeployer(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record deployers');
    const { orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    if ((await this.deployers.count({ where: { modelId } })) >= 500) throw new BadRequestException('At most 500 deployers per model');
    const d = await this.deployers.save(this.deployers.create({
      id: uuidv4(), orgId, modelId, name: reqText(body.name, 'name', 2, 200), contact: optText(body.contact, 'contact', 255), active: true, addedBy: user.email, addedAt: new Date(),
    }));
    if (req) req.auditSummary = { deployer_added: { model_id: modelId, deployer_id: d.id } };
    return this.deployerView(d);
  }

  async updateDeployer(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record deployers');
    const d = await this.deployers.findOne({ where: { id } });
    if (!d || d.orgId !== orgFor(user, d.orgId)) throw new NotFoundException('Deployer not found');
    if (body.active !== undefined) d.active = body.active === true;
    if (body.contact !== undefined) d.contact = optText(body.contact, 'contact', 255);
    await this.deployers.save(d);
    if (req) req.auditSummary = { deployer_updated: { deployer_id: d.id, active: d.active } };
    return this.deployerView(d);
  }

  /** A material update to a model with active deployers opens one draft notice (one at a time). */
  async noticeDue(modelId: string, event: string, ref: string | null): Promise<void> {
    const deps = await this.deployers.find({ where: { modelId, active: true } });
    if (!deps.length) return;
    const open = await this.rows.findOne({ where: { modelId, kind: 'CO_UPDATE_NOTICE', status: 'DRAFT' } });
    const change = `${event}${ref ? `: ${ref}` : ''}`;
    const now = new Date();
    if (open) {
      open.content = { ...open.content, changes: [...(open.content.changes ?? []), { change, at: now.toISOString() }].slice(-50) };
      open.contentHash = contentHash(open.content);
      open.updatedAt = now;
      await this.rows.save(open);
      return;
    }
    const m = await this.models.findOne({ where: { id: modelId } });
    if (!m) return;
    const orgId = deps[0].orgId;
    const content = { model: m.name, change, changes: [{ change, at: now.toISOString() }], summary: '', deployers: deps.map((d) => d.name) };
    await this.rows.save(this.rows.create({
      id: uuidv4(), orgId, kind: 'CO_UPDATE_NOTICE', modelId, version: await this.nextVersion(orgId, 'CO_UPDATE_NOTICE', modelId), title: `Material update notice: ${m.name}`.slice(0, 255),
      periodStart: null, periodEnd: null, content, contentHash: contentHash(content), status: 'DRAFT', publishedBy: null, publishedAt: null, publicUrl: null,
      reviewDueAt: null, notifications: [], createdBy: 'system', createdAt: now, updatedAt: now,
    }));
  }

  /* ------------------------------------------------------------ reminders */

  /** Daily: published transparency statements due for their annual review within 30 days, per organisation. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async reviewReminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('disclosures')) return 0;
    const candidates = await this.rows.find({ where: { kind: 'TRANSPARENCY_STATEMENT', status: 'PUBLISHED', reviewDueAt: LessThan(new Date(now.getTime() + 30 * 86_400_000)) } });
    // Remind 30 and 7 days ahead, on the day, then weekly while overdue: not every day.
    const due = candidates.filter((r) => reminderDay(r.reviewDueAt!, now));
    for (const r of due) {
      try {
        await this.notifier.notify('transparency_statement_review_due', { tenant_id: r.orgId, disclosure_id: r.id, review_due_at: r.reviewDueAt });
      } catch (e) {
        this.logger.warn(`review reminder failed for ${r.orgId}: ${String(e)}`);
      }
    }
    return due.length;
  }
}

/** Whether `now` is a reminder day for a review due on `dueAt`: 30 and 7 days before, the day itself, then every 7 days overdue. */
export function reminderDay(dueAt: Date, now: Date): boolean {
  const days = Math.floor((Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), dueAt.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  if (days >= 0) return days === 30 || days === 7 || days === 0;
  return -days % 7 === 0;
}
