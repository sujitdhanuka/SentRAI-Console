/**
 * Third-party AI risk (E2.5, OCC / SR 26-2 third-party guidance, ISO 42001
 * A.10.3, NIST GOVERN 6.1): a vendor register with criticality, contract
 * terms, responsibility split and exit / failover plans; versioned
 * due-diligence assessments scored against a checklist; and an AI bill of
 * materials per model, seeded from what discovery recorded, with licence
 * classification. A change to an upstream component's version is a model
 * event, so the model's risks come up for review.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import { AiBomItemEntity, AIModelEntity, ProjectEntity, VendorAssessmentEntity, VendorEntity } from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts, emitModelEvent } from '../hooks';
import { MAINTAINERS, OFFICERS, oneOf, optDate, optText, orgFor, orgModels, reqText, requireRole } from '../phase2-util';
import {
  Answer,
  BOM_KINDS,
  checkAnswers,
  classifyLicence,
  CONTRACT_TERMS,
  contractGaps,
  inferComponents,
  scoreAssessment,
  VENDOR_CHECKLIST,
  VENDOR_CRITICALITY,
  VENDOR_KINDS,
  VENDOR_STATUSES,
} from './vendors.model';

@Injectable()
export class VendorsService implements OnModuleInit {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    @InjectRepository(VendorEntity) private readonly vendors: Repository<VendorEntity>,
    @InjectRepository(VendorAssessmentEntity) private readonly assessments: Repository<VendorAssessmentEntity>,
    @InjectRepository(AiBomItemEntity) private readonly bom: Repository<AiBomItemEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('vendors')) return undefined;
      return { vendors: await this.modelFacts(modelId) };
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'vendors');
  }

  /* ---------------------------------------------------------------- facts */

  private async latestAssessments(vendorIds: string[]): Promise<Map<string, VendorAssessmentEntity>> {
    const out = new Map<string, VendorAssessmentEntity>();
    if (!vendorIds.length) return out;
    for (const a of await this.assessments.find({ where: { vendorId: In(vendorIds) }, order: { version: 'ASC' } })) out.set(a.vendorId, a);
    return out;
  }

  async modelFacts(modelId: string) {
    const items = await this.bom.find({ where: { modelId } });
    const vendorIds = [...new Set(items.map((i) => i.vendorId).filter((v): v is string => !!v))];
    const vendors = vendorIds.length ? await this.vendors.find({ where: { id: In(vendorIds) } }) : [];
    const latest = await this.latestAssessments(vendorIds);
    const live = vendors.filter((v) => v.status !== 'EXITED');
    return {
      components: items.length,
      vendors: live.length,
      // A component with a named provider but no vendor record has not been through due diligence.
      unassessed: live.filter((v) => !latest.has(v.id)).length + items.filter((i) => !i.vendorId && i.provider).length,
      unsatisfactory: live.filter((v) => latest.get(v.id)?.result === 'UNSATISFACTORY').length,
      // An assessment stops counting once its review date has passed.
      stale: live.filter((v) => latest.has(v.id) && !!v.nextReviewAt && v.nextReviewAt.getTime() < Date.now()).length,
      // A component still sourced from a vendor the bank has exited.
      exitedInUse: vendors.filter((v) => v.status === 'EXITED').length,
      highWithoutExit: live.filter((v) => v.criticality === 'HIGH' && (!v.exitPlan || !v.failoverPlan)).length,
      contractGaps: live.filter((v) => v.kind !== 'OPEN_SOURCE' && contractGaps(v.contractTerms).length > 0).length,
      unknownLicences: items.filter((i) => i.licenceClass === 'UNKNOWN' && i.kind !== 'API' && i.kind !== 'PLATFORM').length,
      restrictedLicences: items.filter((i) => i.licenceClass === 'RESTRICTED').length,
    };
  }

  /* --------------------------------------------------------------- vendors */

  private async vendorInOrg(user: CurrentUser, id: string): Promise<VendorEntity> {
    const v = await this.vendors.findOne({ where: { id } });
    if (!v) throw new NotFoundException('Vendor not found');
    if (v.orgId !== orgFor(user, v.orgId)) throw new NotFoundException('Vendor not found');
    return v;
  }

  private parseTerms(v: unknown): Record<string, boolean> | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('contract_terms must map terms to true or false');
    const out: Record<string, boolean> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (!(CONTRACT_TERMS as readonly string[]).includes(k)) throw new BadRequestException(`Unknown contract term: ${k}`);
      out[k] = val === true;
    }
    return out;
  }

  private parseSplit(v: unknown): Array<{ area: string; vendor: string; bank: string }> | null {
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v)) throw new BadRequestException('responsibility_split must be a list of { area, vendor, bank }');
    return v.slice(0, 50).map((r: any) => ({ area: String(r?.area ?? '').slice(0, 200), vendor: String(r?.vendor ?? '').slice(0, 500), bank: String(r?.bank ?? '').slice(0, 500) })).filter((r) => r.area);
  }

  private async view(v: VendorEntity, latest?: VendorAssessmentEntity | null, models?: Array<{ model_id: string; name: string }>) {
    return {
      vendor_id: v.id, org_id: v.orgId, name: v.name, kind: v.kind, criticality: v.criticality, status: v.status,
      contact: v.contact, services: v.services, contract_terms: v.contractTerms ?? {}, contract_gaps: v.kind === 'OPEN_SOURCE' ? [] : contractGaps(v.contractTerms),
      responsibility_split: v.responsibilitySplit ?? [], exit_plan: v.exitPlan, failover_plan: v.failoverPlan,
      exit_plan_required: v.criticality === 'HIGH', next_review_at: v.nextReviewAt,
      review_overdue: !!v.nextReviewAt && v.nextReviewAt.getTime() < Date.now(),
      latest_assessment: latest ? { version: latest.version, score: latest.score, result: latest.result, assessed_at: latest.assessedAt, assessed_by: latest.assessedBy } : null,
      models: models ?? undefined,
      created_by: v.createdBy, created_at: v.createdAt, updated_at: v.updatedAt,
    };
  }

  checklist() {
    this.assert();
    return { checklist: VENDOR_CHECKLIST, contract_terms: CONTRACT_TERMS, kinds: VENDOR_KINDS, criticality: VENDOR_CRITICALITY, statuses: VENDOR_STATUSES, bom_kinds: BOM_KINDS };
  }

  async list(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const rows = await this.vendors.find({ where: { orgId }, order: { name: 'ASC' } });
    const latest = await this.latestAssessments(rows.map((r) => r.id));
    const items = rows.length ? await this.bom.find({ where: { vendorId: In(rows.map((r) => r.id)) } }) : [];
    const modelIds = [...new Set(items.map((i) => i.modelId))];
    const names = new Map((modelIds.length ? await this.models.find({ where: { id: In(modelIds) }, select: ['id', 'name'] }) : []).map((m) => [m.id, m.name]));
    const out: any[] = [];
    for (const r of rows) {
      const ms = [...new Set(items.filter((i) => i.vendorId === r.id).map((i) => i.modelId))].map((id) => ({ model_id: id, name: names.get(id) ?? id }));
      out.push(await this.view(r, latest.get(r.id), ms));
    }
    return { org_id: orgId, vendors: out };
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    const v = await this.vendorInOrg(user, id);
    const history = await this.assessments.find({ where: { vendorId: id }, order: { version: 'DESC' } });
    const items = await this.bom.find({ where: { vendorId: id } });
    const names = new Map((items.length ? await this.models.find({ where: { id: In([...new Set(items.map((i) => i.modelId))]) }, select: ['id', 'name'] }) : []).map((m) => [m.id, m.name]));
    return {
      ...(await this.view(v, history[0] ?? null, [...new Set(items.map((i) => i.modelId))].map((mid) => ({ model_id: mid, name: names.get(mid) ?? mid })))),
      assessments: history.map((a) => this.assessmentView(a)),
      components: items.map((i) => this.bomView(i)),
    };
  }

  async create(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'add vendors');
    const orgId = orgFor(user, body.org_id);
    const name = reqText(body.name, 'name', 2, 200);
    if (await this.vendors.findOne({ where: { orgId, name } })) throw new BadRequestException('A vendor with that name is already registered');
    const now = new Date();
    const v = await this.vendors.save(this.vendors.create({
      id: uuidv4(), orgId, name,
      kind: oneOf(body.kind, VENDOR_KINDS, 'kind', 'MODEL_PROVIDER'),
      criticality: oneOf(body.criticality, VENDOR_CRITICALITY, 'criticality', 'MEDIUM'),
      status: oneOf(body.status, VENDOR_STATUSES, 'status', 'ACTIVE'),
      contact: optText(body.contact, 'contact', 255), services: optText(body.services, 'services', 4000),
      contractTerms: this.parseTerms(body.contract_terms), responsibilitySplit: this.parseSplit(body.responsibility_split),
      exitPlan: optText(body.exit_plan, 'exit_plan', 8000), failoverPlan: optText(body.failover_plan, 'failover_plan', 8000),
      nextReviewAt: optDate(body.next_review_at, 'next_review_at'),
      createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { vendor_created: { vendor_id: v.id, name: v.name, criticality: v.criticality } };
    return this.view(v);
  }

  async update(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit vendors');
    const v = await this.vendorInOrg(user, id);
    const before = { criticality: v.criticality, status: v.status };
    if (body.name !== undefined) v.name = reqText(body.name, 'name', 2, 200);
    if (body.kind !== undefined) v.kind = oneOf(body.kind, VENDOR_KINDS, 'kind');
    if (body.criticality !== undefined) {
      // Lowering criticality changes what the controls demand; keep it with the officers.
      const next = oneOf(body.criticality, VENDOR_CRITICALITY, 'criticality');
      if (VENDOR_CRITICALITY.indexOf(next) < VENDOR_CRITICALITY.indexOf(v.criticality as any)) requireRole(user, OFFICERS, 'lower a vendor’s criticality');
      v.criticality = next;
    }
    if (body.status !== undefined) {
      const next = oneOf(body.status, VENDOR_STATUSES, 'status');
      // Clearing a review hold or exiting a vendor changes what the controls demand; keep it with the officers.
      if (next !== v.status && (v.status === 'UNDER_REVIEW' || next === 'EXITED')) requireRole(user, OFFICERS, next === 'EXITED' ? 'exit a vendor' : 'take a vendor off review');
      v.status = next;
    }
    if (body.contact !== undefined) v.contact = optText(body.contact, 'contact', 255);
    if (body.services !== undefined) v.services = optText(body.services, 'services', 4000);
    if (body.contract_terms !== undefined) v.contractTerms = this.parseTerms(body.contract_terms);
    if (body.responsibility_split !== undefined) v.responsibilitySplit = this.parseSplit(body.responsibility_split);
    if (body.exit_plan !== undefined) v.exitPlan = optText(body.exit_plan, 'exit_plan', 8000);
    if (body.failover_plan !== undefined) v.failoverPlan = optText(body.failover_plan, 'failover_plan', 8000);
    if (body.next_review_at !== undefined) v.nextReviewAt = optDate(body.next_review_at, 'next_review_at');
    v.updatedAt = new Date();
    await this.vendors.save(v);
    if (req) req.auditSummary = { vendor_updated: { vendor_id: v.id, before, after: { criticality: v.criticality, status: v.status } } };
    return this.get(user, id);
  }

  private assessmentView(a: VendorAssessmentEntity) {
    return { assessment_id: a.id, vendor_id: a.vendorId, version: a.version, answers: a.answers, score: a.score, result: a.result, gaps: a.gaps ?? [], notes: a.notes, assessed_by: a.assessedBy, assessed_at: a.assessedAt };
  }

  async assess(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'assess vendors');
    const v = await this.vendorInOrg(user, id);
    const err = checkAnswers(body.answers);
    if (err) throw new BadRequestException(err);
    const answers = Object.fromEntries(Object.entries(body.answers as Record<string, string>).map(([k, a]) => [k, String(a).toUpperCase() as Answer]));
    const r = scoreAssessment(answers);
    const prev = await this.assessments.findOne({ where: { vendorId: id }, order: { version: 'DESC' } });
    const now = new Date();
    const a = await this.assessments.save(this.assessments.create({
      id: uuidv4(), vendorId: id, orgId: v.orgId, version: (prev?.version ?? 0) + 1, answers, score: r.score, result: r.result, gaps: r.gaps,
      notes: optText(body.notes, 'notes', 4000), assessedBy: user.email, assessedAt: now,
    }));
    // Next due-diligence review: yearly for HIGH, two-yearly otherwise, unless one is already set sooner.
    const next = new Date(now.getTime());
    next.setUTCFullYear(next.getUTCFullYear() + (v.criticality === 'HIGH' ? 1 : 2));
    if (!v.nextReviewAt || v.nextReviewAt.getTime() < now.getTime() || v.nextReviewAt.getTime() > next.getTime()) v.nextReviewAt = next;
    if (r.result === 'UNSATISFACTORY' && v.status === 'ACTIVE') v.status = 'UNDER_REVIEW';
    v.updatedAt = now;
    await this.vendors.save(v);
    if (req) req.auditSummary = { vendor_assessed: { vendor_id: id, version: a.version, score: a.score, result: a.result } };
    return this.assessmentView(a);
  }

  /* ------------------------------------------------------------------- BOM */

  private bomView(i: AiBomItemEntity) {
    return {
      item_id: i.id, model_id: i.modelId, vendor_id: i.vendorId, component: i.component, kind: i.kind, provider: i.provider, version: i.version,
      licence: i.licence, licence_class: i.licenceClass, source: i.source, last_change_at: i.lastChangeAt, previous_version: i.previousVersion,
      created_at: i.createdAt, updated_at: i.updatedAt,
    };
  }

  private async vendorForItem(orgId: string, vendorId: unknown): Promise<string | null> {
    if (vendorId === undefined || vendorId === null || vendorId === '') return null;
    const v = await this.vendors.findOne({ where: { id: String(vendorId) } });
    if (!v || v.orgId !== orgId) throw new BadRequestException('vendor_id must be a vendor of this organization');
    return v.id;
  }

  async modelBom(user: CurrentUser, modelId: string) {
    this.assert();
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    const items = await this.bom.find({ where: { modelId }, order: { component: 'ASC' } });
    const vendorIds = [...new Set(items.map((i) => i.vendorId).filter((v): v is string => !!v))];
    const vendors = new Map((vendorIds.length ? await this.vendors.find({ where: { id: In(vendorIds) } }) : []).map((v) => [v.id, v]));
    const latest = await this.latestAssessments(vendorIds);
    return {
      model_id: modelId, name: model.name,
      components: items.map((i) => ({
        ...this.bomView(i),
        vendor: i.vendorId && vendors.get(i.vendorId) ? { name: vendors.get(i.vendorId)!.name, criticality: vendors.get(i.vendorId)!.criticality, result: latest.get(i.vendorId)?.result ?? null } : null,
      })),
      suggested: inferComponents(model).filter((c) => !items.some((i) => i.component.toLowerCase() === c.component.toLowerCase())),
      facts: await this.modelFacts(modelId),
    };
  }

  /** Adds the components discovery recorded on the model that are not on its BOM yet. */
  async syncBom(user: CurrentUser, modelId: string) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit the AI bill of materials');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    const existing = await this.bom.find({ where: { modelId } });
    const now = new Date();
    let added = 0;
    for (const c of inferComponents(model)) {
      if (existing.some((i) => i.component.toLowerCase() === c.component.toLowerCase())) continue;
      await this.bom.save(this.bom.create({
        id: uuidv4(), orgId, modelId, vendorId: null, component: c.component, kind: c.kind, provider: c.provider, version: c.version,
        licence: c.licence, licenceClass: classifyLicence(c.licence), source: 'DISCOVERY', lastChangeAt: null, previousVersion: null, createdAt: now, updatedAt: now,
      }));
      added++;
    }
    return { added, ...(await this.modelBom(user, modelId)) };
  }

  async addItem(user: CurrentUser, modelId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit the AI bill of materials');
    const { orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    const component = reqText(body.component, 'component', 1, 200);
    if ((await this.bom.find({ where: { modelId } })).some((i) => i.component.toLowerCase() === component.toLowerCase())) throw new BadRequestException('That component is already on the bill of materials');
    const licence = optText(body.licence, 'licence', 100);
    const now = new Date();
    const i = await this.bom.save(this.bom.create({
      id: uuidv4(), orgId, modelId, vendorId: await this.vendorForItem(orgId, body.vendor_id), component,
      kind: oneOf(body.kind, BOM_KINDS, 'kind', 'LIBRARY'), provider: optText(body.provider, 'provider', 100), version: optText(body.version, 'version', 100),
      licence, licenceClass: classifyLicence(licence), source: 'MANUAL', lastChangeAt: null, previousVersion: null, createdAt: now, updatedAt: now,
    }));
    return this.bomView(i);
  }

  private async itemFor(user: CurrentUser, itemId: string): Promise<AiBomItemEntity> {
    const i = await this.bom.findOne({ where: { id: itemId } });
    if (!i) throw new NotFoundException('Component not found');
    await modelForUser(this.models, this.projects, user, i.modelId).catch(() => {
      throw new NotFoundException('Component not found');
    });
    return i;
  }

  /** Edits a component. A new version of an upstream component is a material change: the model's risks come up for review. */
  async updateItem(user: CurrentUser, itemId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit the AI bill of materials');
    const i = await this.itemFor(user, itemId);
    if (body.vendor_id !== undefined) i.vendorId = await this.vendorForItem(i.orgId, body.vendor_id);
    if (body.kind !== undefined) i.kind = oneOf(body.kind, BOM_KINDS, 'kind');
    if (body.provider !== undefined) i.provider = optText(body.provider, 'provider', 100);
    if (body.licence !== undefined) {
      i.licence = optText(body.licence, 'licence', 100);
      i.licenceClass = classifyLicence(i.licence);
    }
    let changed: { from: string | null; to: string | null } | null = null;
    if (body.version !== undefined) {
      const next = optText(body.version, 'version', 100);
      if (next !== i.version) {
        changed = { from: i.version, to: next };
        i.previousVersion = i.version;
        i.version = next;
        i.lastChangeAt = new Date();
      }
    }
    i.updatedAt = new Date();
    await this.bom.save(i);
    if (changed && changed.from) {
      await emitModelEvent(i.modelId, 'VENDOR_CHANGE', { ref: `${i.component} ${changed.from} → ${changed.to ?? 'none'}`, component: i.component, ...changed });
    }
    if (req && changed) req.auditSummary = { bom_version_change: { model_id: i.modelId, component: i.component, ...changed } };
    return { ...this.bomView(i), review_triggered: Boolean(changed?.from) };
  }

  async removeItem(user: CurrentUser, itemId: string) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit the AI bill of materials');
    const i = await this.itemFor(user, itemId);
    await this.bom.delete({ id: i.id });
    return { removed: true, item_id: itemId };
  }

  /** Organisation summary for the console: vendors by result, components by licence class, models missing a BOM. */
  async summary(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const models = await orgModels(this.models, this.projects, orgId);
    const items = await this.bom.find({ where: { orgId } });
    const byLicence: Record<string, number> = {};
    for (const i of items) byLicence[i.licenceClass] = (byLicence[i.licenceClass] ?? 0) + 1;
    const withBom = new Set(items.map((i) => i.modelId));
    const vendors = await this.vendors.find({ where: { orgId } });
    const latest = await this.latestAssessments(vendors.map((v) => v.id));
    const byResult: Record<string, number> = { SATISFACTORY: 0, CONDITIONAL: 0, UNSATISFACTORY: 0, NOT_ASSESSED: 0 };
    for (const v of vendors.filter((x) => x.status !== 'EXITED')) byResult[latest.get(v.id)?.result ?? 'NOT_ASSESSED']++;
    return {
      org_id: orgId, vendors: vendors.length, by_result: byResult, components: items.length, by_licence: byLicence,
      models_without_bom: models.filter((m) => !withBom.has(m.id)).map((m) => ({ model_id: m.id, name: m.name })),
      reviews_overdue: vendors.filter((v) => v.status !== 'EXITED' && v.nextReviewAt && v.nextReviewAt.getTime() < Date.now()).map((v) => ({ vendor_id: v.id, name: v.name, next_review_at: v.nextReviewAt })),
    };
  }

  /** Daily: notify each organisation of vendors whose due-diligence review date has passed. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async reviewReminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('vendors')) return 0;
    const due = await this.vendors.find({ where: { status: In(['ACTIVE', 'UNDER_REVIEW']), nextReviewAt: LessThan(now) } });
    const byOrg = new Map<string, VendorEntity[]>();
    for (const v of due) byOrg.set(v.orgId, [...(byOrg.get(v.orgId) ?? []), v]);
    for (const [orgId, vs] of byOrg) {
      await this.notifier.notify('vendor_review_due', { tenant_id: orgId, vendors: vs.map((v) => ({ vendor_id: v.id, name: v.name, next_review_at: v.nextReviewAt })) });
    }
    if (byOrg.size) this.logger.log(`Vendor review reminders: ${due.length} vendor(s) in ${byOrg.size} org(s)`);
    return due.length;
  }
}
