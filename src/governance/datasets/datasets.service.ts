/**
 * Data register (E2.7, EU AI Act Art. 10, ISO 42001 A.7, RBI FREE-AI data
 * governance, NIST MAP 4): datasets with source, acquisition, lawful basis,
 * consent reference, quality checks, provenance and preparation; links to the
 * models that train, test or retrieve from them; a retention schedule; and
 * deletion orders traced to every model that used the data, so an erasure
 * request or regulator order reaches the models it affects.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import { AIModelEntity, DatasetEntity, ModelDatasetEntity, ProjectEntity, UserEntity } from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts, emitModelEvent } from '../hooks';
import { DAY_MS, MAINTAINERS, OFFICERS, oneOf, optDate, optText, orgFor, orgMember, reqText, requireRole } from '../phase2-util';

export const DATASET_PURPOSES = ['TRAINING', 'VALIDATION', 'TEST', 'FINE_TUNING', 'RETRIEVAL', 'INFERENCE', 'MONITORING'] as const;
export const ACQUISITION = ['COLLECTED', 'PURCHASED', 'LICENSED', 'PUBLIC', 'SYNTHETIC', 'DERIVED', 'SCRAPED'] as const;
export const LAWFUL_BASES = ['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTERESTS', 'PUBLIC_TASK', 'LEGITIMATE_INTERESTS', 'LEGITIMATE_USE', 'NOT_PERSONAL'] as const;
export const DELETION_STATUSES = ['NONE', 'ORDERED', 'DELETED'] as const;
export const ORDER_KINDS = ['ERASURE_REQUEST', 'REGULATOR_ORDER', 'RETENTION_EXPIRY', 'CONSENT_WITHDRAWN', 'CONTRACT_END', 'OTHER'] as const;

interface DeletionOrder {
  id: string;
  kind: string;
  reference: string | null;
  reason: string;
  scope: string | null;
  orderedBy: string;
  orderedAt: string;
  dueAt: string | null;
  models: Array<{ model_id: string; name: string; purpose: string; action: string | null; done: boolean }>;
  completedAt: string | null;
  completedBy: string | null;
  evidence: string | null;
}

@Injectable()
export class DatasetsService implements OnModuleInit {
  private readonly logger = new Logger(DatasetsService.name);

  constructor(
    @InjectRepository(DatasetEntity) private readonly datasets: Repository<DatasetEntity>,
    @InjectRepository(ModelDatasetEntity) private readonly links: Repository<ModelDatasetEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('dataRegister')) return undefined;
      return { datasets: await this.modelFacts(modelId) };
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'dataRegister');
  }

  /* ---------------------------------------------------------------- facts */

  async modelFacts(modelId: string, now = new Date()) {
    const links = await this.links.find({ where: { modelId } });
    const ds = links.length ? await this.datasets.find({ where: { id: In([...new Set(links.map((l) => l.datasetId))]) } }) : [];
    return {
      linked: ds.length,
      missingLawfulBasis: ds.filter((d) => d.personalData && !d.lawfulBasis).length,
      missingProvenance: ds.filter((d) => !d.provenance || !d.source).length,
      // An open deletion order, or retention passed without deletion.
      pendingDeletion: ds.filter((d) => d.deletionStatus === 'ORDERED' || (d.deletionStatus !== 'DELETED' && d.retentionUntil && d.retentionUntil.getTime() < now.getTime())).length,
      personalData: ds.filter((d) => d.personalData).length,
      sensitiveData: ds.filter((d) => d.sensitiveData).length,
    };
  }

  /* -------------------------------------------------------------- datasets */

  private async inOrg(user: CurrentUser, id: string): Promise<DatasetEntity> {
    const d = await this.datasets.findOne({ where: { id } });
    if (!d || d.orgId !== orgFor(user, d.orgId)) throw new NotFoundException('Dataset not found');
    return d;
  }

  private parseChecks(v: unknown): Array<{ check: string; result: string; at: string | null }> | null {
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v)) throw new BadRequestException('quality_checks must be a list of { check, result, at }');
    return v.slice(0, 100).map((c: any) => ({ check: String(c?.check ?? '').slice(0, 200), result: String(c?.result ?? '').slice(0, 500), at: c?.at ? String(c.at).slice(0, 40) : null })).filter((c) => c.check);
  }

  private view(d: DatasetEntity, models?: Array<{ model_id: string; name: string; purpose: string }>) {
    const now = Date.now();
    return {
      dataset_id: d.id, org_id: d.orgId, name: d.name, description: d.description, source: d.source, acquisition: d.acquisition,
      lawful_basis: d.lawfulBasis, consent_ref: d.consentRef, personal_data: d.personalData, sensitive_data: d.sensitiveData,
      quality_checks: d.qualityChecks ?? [], provenance: d.provenance, preparation: d.preparation, access_controls: d.accessControls,
      retention_until: d.retentionUntil, retention_passed: !!d.retentionUntil && d.retentionUntil.getTime() < now && d.deletionStatus !== 'DELETED',
      deletion_status: d.deletionStatus, deletion_orders: d.deletionOrders ?? [], owner_user_id: d.ownerUserId,
      gaps: [
        ...(d.personalData && !d.lawfulBasis ? ['lawful basis'] : []),
        ...(!d.provenance || !d.source ? ['provenance'] : []),
        ...(d.personalData && d.lawfulBasis === 'CONSENT' && !d.consentRef ? ['consent reference'] : []),
        ...(!(d.qualityChecks ?? []).length ? ['quality checks'] : []),
      ],
      models,
      created_by: d.createdBy, created_at: d.createdAt, updated_at: d.updatedAt,
    };
  }

  private async apply(d: DatasetEntity, body: Record<string, any>) {
    if (body.name !== undefined) d.name = reqText(body.name, 'name', 2, 200);
    if (body.description !== undefined) d.description = optText(body.description, 'description', 4000);
    if (body.source !== undefined) d.source = optText(body.source, 'source', 500);
    if (body.acquisition !== undefined) d.acquisition = body.acquisition ? oneOf(body.acquisition, ACQUISITION, 'acquisition') : null;
    if (body.lawful_basis !== undefined) d.lawfulBasis = body.lawful_basis ? oneOf(body.lawful_basis, LAWFUL_BASES, 'lawful_basis') : null;
    if (body.consent_ref !== undefined) d.consentRef = optText(body.consent_ref, 'consent_ref', 500);
    if (body.personal_data !== undefined) d.personalData = body.personal_data === true;
    if (body.sensitive_data !== undefined) d.sensitiveData = body.sensitive_data === true;
    if (d.sensitiveData) d.personalData = true;
    if (body.quality_checks !== undefined) d.qualityChecks = this.parseChecks(body.quality_checks);
    if (body.provenance !== undefined) d.provenance = optText(body.provenance, 'provenance', 4000);
    if (body.preparation !== undefined) d.preparation = optText(body.preparation, 'preparation', 4000);
    if (body.access_controls !== undefined) d.accessControls = optText(body.access_controls, 'access_controls', 2000);
    if (body.retention_until !== undefined) d.retentionUntil = optDate(body.retention_until, 'retention_until');
    if (body.owner_user_id !== undefined) d.ownerUserId = body.owner_user_id ? (await orgMember(this.users, d.orgId, body.owner_user_id, 'owner_user_id')).id : null;
    if (d.lawfulBasis === 'NOT_PERSONAL' && d.personalData) throw new BadRequestException('A dataset with personal data needs a lawful basis other than NOT_PERSONAL');
  }

  async list(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const rows = await this.datasets.find({ where: { orgId }, order: { name: 'ASC' } });
    const links = rows.length ? await this.links.find({ where: { datasetId: In(rows.map((r) => r.id)) } }) : [];
    const names = await this.modelNames(links.map((l) => l.modelId));
    return {
      org_id: orgId,
      datasets: rows.map((d) => this.view(d, links.filter((l) => l.datasetId === d.id).map((l) => ({ model_id: l.modelId, name: names.get(l.modelId) ?? l.modelId, purpose: l.purpose })))),
      options: { purposes: DATASET_PURPOSES, acquisition: ACQUISITION, lawful_bases: LAWFUL_BASES, order_kinds: ORDER_KINDS },
    };
  }

  private async modelNames(ids: string[]): Promise<Map<string, string>> {
    const u = [...new Set(ids)];
    return new Map((u.length ? await this.models.find({ where: { id: In(u) }, select: ['id', 'name'] }) : []).map((m) => [m.id, m.name]));
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    const d = await this.inOrg(user, id);
    const links = await this.links.find({ where: { datasetId: id } });
    const names = await this.modelNames(links.map((l) => l.modelId));
    return this.view(d, links.map((l) => ({ model_id: l.modelId, name: names.get(l.modelId) ?? l.modelId, purpose: l.purpose })));
  }

  async create(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'register datasets');
    const orgId = orgFor(user, body.org_id);
    const now = new Date();
    const d = this.datasets.create({
      id: uuidv4(), orgId, name: reqText(body.name, 'name', 2, 200), description: null, source: null, acquisition: null, lawfulBasis: null, consentRef: null,
      personalData: false, sensitiveData: false, qualityChecks: null, provenance: null, preparation: null, accessControls: null, retentionUntil: null,
      deletionStatus: 'NONE', deletionOrders: null, ownerUserId: null, createdBy: user.email, createdAt: now, updatedAt: now,
    });
    await this.apply(d, { ...body, name: undefined });
    if (await this.datasets.findOne({ where: { orgId, name: d.name } })) throw new BadRequestException('A dataset with that name is already registered');
    await this.datasets.save(d);
    if (req) req.auditSummary = { dataset_registered: { dataset_id: d.id, name: d.name, personal_data: d.personalData } };
    return this.view(d, []);
  }

  async update(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'edit datasets');
    const d = await this.inOrg(user, id);
    if (d.deletionStatus === 'DELETED') throw new BadRequestException('A deleted dataset is a record only; register a new dataset');
    const before = { lawful_basis: d.lawfulBasis, retention_until: d.retentionUntil, personal_data: d.personalData };
    await this.apply(d, body);
    d.updatedAt = new Date();
    await this.datasets.save(d);
    if (req) req.auditSummary = { dataset_updated: { dataset_id: id, before, after: { lawful_basis: d.lawfulBasis, retention_until: d.retentionUntil, personal_data: d.personalData } } };
    return this.get(user, id);
  }

  /* ------------------------------------------------------------ model links */

  async modelDatasets(user: CurrentUser, modelId: string) {
    this.assert();
    await modelForUser(this.models, this.projects, user, modelId);
    const links = await this.links.find({ where: { modelId } });
    const ds = links.length ? await this.datasets.find({ where: { id: In(links.map((l) => l.datasetId)) } }) : [];
    const byId = new Map(ds.map((d) => [d.id, d]));
    return {
      model_id: modelId,
      datasets: links.filter((l) => byId.has(l.datasetId)).map((l) => ({ ...this.view(byId.get(l.datasetId)!), purpose: l.purpose, linked_by: l.linkedBy, linked_at: l.linkedAt })),
      facts: await this.modelFacts(modelId),
    };
  }

  async link(user: CurrentUser, modelId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'link datasets');
    const { orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const d = await this.datasets.findOne({ where: { id: String(body.dataset_id ?? '') } });
    if (!d || d.orgId !== orgId) throw new BadRequestException('dataset_id must be a dataset of the model’s organization');
    if (d.deletionStatus === 'DELETED') throw new BadRequestException('That dataset has been deleted');
    const purpose = oneOf(body.purpose, DATASET_PURPOSES, 'purpose', 'TRAINING');
    const existing = await this.links.findOne({ where: { modelId, datasetId: d.id, purpose } });
    if (existing) return { linked: true, model_id: modelId, dataset_id: d.id, purpose };
    await this.links.save(this.links.create({ id: uuidv4(), orgId: d.orgId, modelId, datasetId: d.id, purpose, linkedBy: user.email, linkedAt: new Date() }));
    return { linked: true, model_id: modelId, dataset_id: d.id, purpose };
  }

  async unlink(user: CurrentUser, modelId: string, datasetId: string) {
    this.assert();
    requireRole(user, MAINTAINERS, 'unlink datasets');
    await modelForUser(this.models, this.projects, user, modelId);
    const r = await this.links.delete({ modelId, datasetId });
    return { removed: r.affected ?? 0 };
  }

  /* ------------------------------------------------------------ deletion */

  /** Records a deletion order and traces it to every model that used the dataset; each model's risks come up for review. */
  async orderDeletion(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'record deletion orders');
    const d = await this.inOrg(user, id);
    if (d.deletionStatus === 'DELETED') throw new BadRequestException('The dataset is already deleted');
    const links = await this.links.find({ where: { datasetId: id } });
    const names = await this.modelNames(links.map((l) => l.modelId));
    const order: DeletionOrder = {
      id: uuidv4(), kind: oneOf(body.kind, ORDER_KINDS, 'kind', 'OTHER'), reference: optText(body.reference, 'reference', 200),
      reason: reqText(body.reason, 'reason', 10, 2000), scope: optText(body.scope, 'scope (records affected, if not the whole dataset)', 2000),
      orderedBy: user.email, orderedAt: new Date().toISOString(), dueAt: optDate(body.due_at, 'due_at')?.toISOString() ?? null,
      // Training data cannot be removed from a trained model by deleting the file: each model needs its own action (retrain, unlearn, or a documented decision).
      models: links.map((l) => ({ model_id: l.modelId, name: names.get(l.modelId) ?? l.modelId, purpose: l.purpose, action: null, done: false })),
      completedAt: null, completedBy: null, evidence: null,
    };
    d.deletionOrders = [...(d.deletionOrders ?? []), order];
    d.deletionStatus = 'ORDERED';
    d.updatedAt = new Date();
    await this.datasets.save(d);
    for (const m of new Set(links.map((l) => l.modelId))) await emitModelEvent(m, 'DATA_DELETION_ORDER', { ref: `${d.name}${order.reference ? ` ${order.reference}` : ''}`, dataset_id: id, order_id: order.id });
    if (req) req.auditSummary = { dataset_deletion_ordered: { dataset_id: id, order_id: order.id, kind: order.kind, reference: order.reference, models: order.models.length } };
    return this.get(user, id);
  }

  /** Records what was done for one model under an order (retrained, unlearned, decided no action, with reasons). */
  async modelAction(user: CurrentUser, id: string, orderId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record deletion actions');
    const d = await this.inOrg(user, id);
    const orders = (d.deletionOrders ?? []) as DeletionOrder[];
    const o = orders.find((x) => x.id === orderId);
    if (!o) throw new NotFoundException('Deletion order not found');
    if (o.completedAt) throw new BadRequestException('The order is complete');
    const m = o.models.find((x) => x.model_id === body.model_id);
    if (!m) throw new BadRequestException('model_id is not one of the models this order reaches');
    m.action = reqText(body.action, 'action (what was done for this model)', 10, 2000);
    m.done = true;
    d.deletionOrders = [...orders];
    d.updatedAt = new Date();
    await this.datasets.save(d);
    return this.get(user, id);
  }

  /** Closes an order once every model it reaches has an action; the dataset becomes DELETED when no order stays open and the order covered the whole dataset. */
  async completeOrder(user: CurrentUser, id: string, orderId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'complete deletion orders');
    const d = await this.inOrg(user, id);
    const orders = (d.deletionOrders ?? []) as DeletionOrder[];
    const o = orders.find((x) => x.id === orderId);
    if (!o) throw new NotFoundException('Deletion order not found');
    if (o.completedAt) throw new BadRequestException('The order is already complete');
    const open = o.models.filter((m) => !m.done);
    if (open.length) throw new BadRequestException(`Record the action for every model first: ${open.map((m) => m.name).join(', ')}`);
    o.evidence = reqText(body.evidence, 'evidence (deletion certificate, ticket or log reference)', 5, 2000);
    o.completedAt = new Date().toISOString();
    o.completedBy = user.email;
    const stillOpen = orders.some((x) => !x.completedAt);
    const whole = orders.some((x) => x.completedAt && !x.scope);
    d.deletionStatus = stillOpen ? 'ORDERED' : whole ? 'DELETED' : 'NONE';
    d.deletionOrders = [...orders];
    d.updatedAt = new Date();
    await this.datasets.save(d);
    if (req) req.auditSummary = { dataset_deletion_completed: { dataset_id: id, order_id: orderId, evidence: o.evidence, dataset_status: d.deletionStatus } };
    return this.get(user, id);
  }

  /* --------------------------------------------------- retention and lineage */

  async retention(user: CurrentUser, q: { org_id?: string; days?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const horizon = Date.now() + Math.min(Math.max(Number(q.days) || 90, 1), 3650) * DAY_MS;
    const rows = await this.datasets.find({ where: { orgId, deletionStatus: Not('DELETED') }, order: { retentionUntil: 'ASC' } });
    return {
      org_id: orgId,
      due: rows.filter((d) => d.retentionUntil && d.retentionUntil.getTime() <= horizon).map((d) => ({ dataset_id: d.id, name: d.name, retention_until: d.retentionUntil, passed: d.retentionUntil!.getTime() < Date.now(), deletion_status: d.deletionStatus })),
      no_retention: rows.filter((d) => !d.retentionUntil).map((d) => ({ dataset_id: d.id, name: d.name, personal_data: d.personalData })),
    };
  }

  /** Dataset → model lineage graph for the organisation. */
  async lineage(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const ds = await this.datasets.find({ where: { orgId } });
    const links = ds.length ? await this.links.find({ where: { datasetId: In(ds.map((d) => d.id)) } }) : [];
    const names = await this.modelNames(links.map((l) => l.modelId));
    return {
      org_id: orgId,
      nodes: [
        ...ds.map((d) => ({ id: d.id, type: 'dataset', label: d.name, personal_data: d.personalData, deletion_status: d.deletionStatus })),
        ...[...names].map(([id, name]) => ({ id, type: 'model', label: name })),
      ],
      edges: links.map((l) => ({ from: l.datasetId, to: l.modelId, purpose: l.purpose })),
    };
  }

  /** Daily: datasets whose retention date has passed without deletion. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async retentionReminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('dataRegister')) return 0;
    const due = await this.datasets.find({ where: { deletionStatus: Not('DELETED'), retentionUntil: LessThan(now) } });
    const byOrg = new Map<string, DatasetEntity[]>();
    for (const d of due) byOrg.set(d.orgId, [...(byOrg.get(d.orgId) ?? []), d]);
    for (const [orgId, ds] of byOrg) await this.notifier.notify('dataset_retention_passed', { tenant_id: orgId, datasets: ds.map((d) => ({ dataset_id: d.id, name: d.name, retention_until: d.retentionUntil })) });
    if (due.length) this.logger.log(`Dataset retention reminders: ${due.length}`);
    return due.length;
  }
}
