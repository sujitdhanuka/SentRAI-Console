/**
 * TEVV and decommissioning (E3.4, NIST MEASURE 1.2 / 2.1 / 2.3 / 2.5 / 2.13,
 * GOVERN 1.7, RBI Rec 16, ISO A.6.2.4, US M21-12): a test-set register with
 * acceptance criteria and segment results, validation-report evidence,
 * periodic metric-effectiveness reviews, and a retirement workflow with
 * approval by someone other than the requester, a checklist and a ledger record.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Cron } from '@nestjs/schedule';

import { ModelLifecycleStage } from '../../common/enums';
import { NotifierService } from '../../common/notifier.service';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AIIncidentEntity,
  AIModelEntity,
  ControlledDocumentEntity,
  DatasetEntity,
  ModelDatasetEntity,
  ModelDeployerEntity,
  ModelLedgerEventEntity,
  ModelRetirementEntity,
  ProjectEntity,
  TestSetEntity,
  TevvRunEntity,
} from '../../database/entities';
import { InventoryService } from '../../inventory/inventory.service';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts, governanceHooks } from '../hooks';
import { MAINTAINERS, OFFICERS, oneOf, optDate, optText, orgFor, scopedOrgModels, reqText, requireRole, isFuture } from '../phase2-util';
import { checklistOpen, ChecklistItem, evaluateRun, newChecklist, parseCriteria, parseResults, RETIREMENT_ITEMS, reviewDue, TEST_PURPOSES } from './tevv.model';

const OPEN_INCIDENT = ['REPORTED', 'UNDER_INVESTIGATION', 'REMEDIATION_IN_PROGRESS'];

@Injectable()
export class TevvService implements OnModuleInit {
  constructor(
    @InjectRepository(TestSetEntity) private readonly sets: Repository<TestSetEntity>,
    @InjectRepository(TevvRunEntity) private readonly runs: Repository<TevvRunEntity>,
    @InjectRepository(ModelRetirementEntity) private readonly retirements: Repository<ModelRetirementEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(DatasetEntity) private readonly datasets: Repository<DatasetEntity>,
    @InjectRepository(ModelDatasetEntity) private readonly modelDatasets: Repository<ModelDatasetEntity>,
    @InjectRepository(ModelDeployerEntity) private readonly deployers: Repository<ModelDeployerEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(ControlledDocumentEntity) private readonly docs: Repository<ControlledDocumentEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly inventory: InventoryService,
    private readonly flags: FeatureFlagsService,
    private readonly notifier: NotifierService,
  ) {}

  /** Weekly (Monday 7 AM): active test sets whose metric-effectiveness review is overdue, one notice per organisation. */
  @Cron('0 7 * * 1')
  async reviewReminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('tevv')) return 0;
    const overdue = (await this.sets.find({ where: { active: true } })).filter((s) => reviewDue(s.lastReviewedAt, s.createdAt, s.reviewIntervalMonths).getTime() < now.getTime());
    const byOrg = new Map<string, TestSetEntity[]>();
    for (const s of overdue) byOrg.set(s.orgId, [...(byOrg.get(s.orgId) ?? []), s]);
    for (const [orgId, sets] of byOrg) {
      try {
        await this.notifier.notify('tevv_metric_review_due', { tenant_id: orgId, test_sets: sets.map((s) => ({ test_set_id: s.id, model_id: s.modelId, name: s.name })) });
      } catch {
        /* a failed notice never stops the others */
      }
    }
    return overdue.length;
  }

  onModuleInit(): void {
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('tevv')) return undefined;
      return { tevv: await this.facts(modelId) };
    });
    governanceHooks.retirementCheck = async (modelId) => {
      if (!this.flags.isEnabled('tevv')) return null;
      // Completion sets the stage itself, so every direct move is refused (an old completed retirement of a
      // model that was later reactivated does not count).
      void modelId;
      return 'Retire the model through the approved retirement workflow (Governance › TEVV & retirement)';
    };
  }

  private assert(): void {
    assertFlag(this.flags, 'tevv');
  }

  /* ------------------------------------------------------------ facts */

  async facts(modelId: string, now = new Date()) {
    const sets = await this.sets.find({ where: { modelId, active: true } });
    const latest = await this.latestRuns(sets.map((s) => s.id));
    return {
      testSets: sets.length,
      withCriteria: sets.filter((s) => (s.criteria ?? []).length > 0).length,
      neverRun: sets.filter((s) => !latest.has(s.id)).length,
      latestFailing: sets.filter((s) => latest.get(s.id) && !latest.get(s.id)!.passed).length,
      reviewOverdue: sets.filter((s) => reviewDue(s.lastReviewedAt, s.createdAt, s.reviewIntervalMonths).getTime() < now.getTime()).length,
    };
  }

  private async latestRuns(setIds: string[]): Promise<Map<string, TevvRunEntity>> {
    const out = new Map<string, TevvRunEntity>();
    if (!setIds.length) return out;
    const rows = await this.runs.find({ where: { testSetId: In(setIds) }, order: { runAt: 'DESC', createdAt: 'DESC' } });
    for (const r of rows) if (!out.has(r.testSetId)) out.set(r.testSetId, r);
    return out;
  }

  /* ------------------------------------------------------------ test sets */

  private setView(s: TestSetEntity, latest?: TevvRunEntity | null, now = new Date()) {
    const due = reviewDue(s.lastReviewedAt, s.createdAt, s.reviewIntervalMonths);
    return {
      test_set_id: s.id, model_id: s.modelId, dataset_id: s.datasetId, name: s.name, purpose: s.purpose, description: s.description,
      criteria: s.criteria ?? [], review_interval_months: s.reviewIntervalMonths, last_reviewed_at: s.lastReviewedAt, last_reviewed_by: s.lastReviewedBy,
      last_review_note: s.lastReviewNote, review_due_at: due, review_overdue: due.getTime() < now.getTime(), active: s.active,
      latest_run: latest ? this.runView(latest) : null, created_by: s.createdBy, created_at: s.createdAt,
    };
  }

  private runView(r: TevvRunEntity) {
    return {
      run_id: r.id, test_set_id: r.testSetId, run_at: r.runAt, model_version: r.modelVersion, results: r.results, passed: r.passed,
      failures: r.failures ?? [], report_ref: r.reportRef, report_doc_id: r.reportDocId, recorded_by: r.recordedBy,
    };
  }

  private bad<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private async parseDataset(orgId: string, v: unknown): Promise<string | null> {
    if (v === undefined || v === null || v === '') return null;
    const d = await this.datasets.findOne({ where: { id: String(v) } });
    if (!d || d.orgId !== orgId) throw new BadRequestException('dataset_id must be a dataset of this organization');
    return d.id;
  }

  private parseInterval(v: unknown): number {
    if (v === undefined || v === null || v === '') return 12;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 36) throw new BadRequestException('review_interval_months must be a whole number from 1 to 36');
    return n;
  }

  async listForModel(user: CurrentUser, modelId: string) {
    this.assert();
    await modelForUser(this.models, this.projects, user, modelId);
    const sets = await this.sets.find({ where: { modelId }, order: { createdAt: 'ASC' } });
    const latest = await this.latestRuns(sets.map((s) => s.id));
    return { model_id: modelId, purposes: TEST_PURPOSES, test_sets: sets.map((s) => this.setView(s, latest.get(s.id))), facts: await this.facts(modelId) };
  }

  async overview(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const models = await scopedOrgModels(this.models, this.projects, orgId);
    const out: Array<Record<string, any>> = [];
    for (const m of models) out.push({ model_id: m.id, name: m.name, risk_level: m.riskLevel, lifecycle_stage: m.lifecycleStage, ...(await this.facts(m.id)) });
    const retirements = await this.retirements.find({ where: { orgId }, order: { requestedAt: 'DESC' }, take: 200 });
    return { org_id: orgId, models: out, retirements: retirements.map((r) => this.retirementView(r)) };
  }

  async createSet(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'register test sets');
    const { orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    if ((await this.sets.count({ where: { modelId } })) >= 100) throw new BadRequestException('At most 100 test sets per model');
    const now = new Date();
    const s = await this.sets.save(this.sets.create({
      id: uuidv4(), orgId, modelId, datasetId: await this.parseDataset(orgId, body.dataset_id), name: reqText(body.name, 'name', 3, 200),
      purpose: oneOf(body.purpose, TEST_PURPOSES, 'purpose', 'ACCEPTANCE'), description: optText(body.description, 'description', 4000),
      criteria: this.bad(() => parseCriteria(body.criteria)), reviewIntervalMonths: this.parseInterval(body.review_interval_months),
      lastReviewedAt: null, lastReviewedBy: null, lastReviewNote: null, active: true, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { test_set_created: { test_set_id: s.id, model_id: modelId, criteria: s.criteria.length } };
    return this.setView(s, null);
  }

  private async setInOrg(user: CurrentUser, id: string): Promise<TestSetEntity> {
    const s = await this.sets.findOne({ where: { id } });
    if (!s || s.orgId !== orgFor(user, s.orgId)) throw new NotFoundException('Test set not found');
    return s;
  }

  async updateSet(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'change test sets');
    const s = await this.setInOrg(user, id);
    if (body.name !== undefined) s.name = reqText(body.name, 'name', 3, 200);
    if (body.description !== undefined) s.description = optText(body.description, 'description', 4000);
    if (body.purpose !== undefined) s.purpose = oneOf(body.purpose, TEST_PURPOSES, 'purpose');
    if (body.dataset_id !== undefined) s.datasetId = await this.parseDataset(s.orgId, body.dataset_id);
    if (body.review_interval_months !== undefined) s.reviewIntervalMonths = this.parseInterval(body.review_interval_months);
    if (body.active !== undefined) {
      // Retiring a test set is an officer decision: it removes it from the TEVV control.
      if (body.active === false) requireRole(user, OFFICERS, 'retire test sets');
      s.active = body.active === true;
    }
    if (body.criteria !== undefined) {
      // Changing what "acceptable" means is recorded and needs a reason, like a metric review.
      const reason = reqText(body.reason, 'reason', 10, 1000);
      s.criteria = this.bad(() => parseCriteria(body.criteria));
      s.lastReviewNote = `Criteria changed: ${reason}`;
      s.lastReviewedBy = user.email;
      s.lastReviewedAt = new Date();
    }
    s.updatedAt = new Date();
    await this.sets.save(s);
    if (req) req.auditSummary = { test_set_updated: { test_set_id: s.id, criteria_changed: body.criteria !== undefined, active: s.active } };
    return this.setView(s, (await this.latestRuns([s.id])).get(s.id));
  }

  async recordRun(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record test results');
    const s = await this.setInOrg(user, id);
    if (!s.active) throw new BadRequestException('This test set is retired');
    const results = this.bad(() => parseResults(body.results));
    const runAt = optDate(body.run_at, 'run_at') ?? new Date();
    if (isFuture(runAt, body.run_at)) throw new BadRequestException('run_at cannot be in the future');
    let docId: string | null = null;
    if (body.report_doc_id) {
      const d = await this.docs.findOne({ where: { id: String(body.report_doc_id) } });
      if (!d || d.orgId !== s.orgId) throw new BadRequestException('report_doc_id must be a controlled document of this organization');
      docId = d.id;
    }
    const reportRef = optText(body.report_ref, 'report_ref', 500);
    const { passed, failures } = evaluateRun(s.criteria ?? [], results);
    const r = await this.runs.save(this.runs.create({
      id: uuidv4(), orgId: s.orgId, testSetId: s.id, modelId: s.modelId, runAt, modelVersion: optText(body.model_version, 'model_version', 100),
      results, passed, failures, reportRef, reportDocId: docId, recordedBy: user.email, createdAt: new Date(),
    }));
    // The validation report becomes a typed evidence artifact on the model (one artifact serves every pack).
    if (reportRef || docId) {
      await this.inventory.addEvidence(s.modelId, {
        type: 'validation_report', ref: reportRef ?? `document:${docId}`, description: `${s.name}: ${passed ? 'passed' : `${failures.length} criteria missed`}`,
        ...(docId ? { document_id: docId } : {}),
      }, user.email);
    }
    if (req) req.auditSummary = { tevv_run_recorded: { test_set_id: s.id, passed, failures: failures.length } };
    return this.runView(r);
  }

  async runsFor(user: CurrentUser, id: string) {
    this.assert();
    const s = await this.setInOrg(user, id);
    const rows = await this.runs.find({ where: { testSetId: s.id }, order: { runAt: 'DESC' }, take: 100 });
    return { test_set_id: s.id, runs: rows.map((r) => this.runView(r)) };
  }

  /** Periodic review of whether the metrics and thresholds still measure what matters (MEASURE 2.13). */
  async review(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'review metrics');
    const s = await this.setInOrg(user, id);
    if (typeof body.effective !== 'boolean') throw new BadRequestException('effective must be true or false');
    const note = reqText(body.note, 'note', 10, 2000);
    s.lastReviewedAt = new Date();
    s.lastReviewedBy = user.email;
    s.lastReviewNote = `${body.effective ? 'Metrics effective' : 'Metrics need change'}: ${note}`;
    s.updatedAt = new Date();
    await this.sets.save(s);
    if (req) req.auditSummary = { tevv_metric_review: { test_set_id: s.id, effective: body.effective } };
    return this.setView(s, (await this.latestRuns([s.id])).get(s.id));
  }

  /* ------------------------------------------------------------ retirement */

  private retirementView(r: ModelRetirementEntity) {
    return {
      retirement_id: r.id, model_id: r.modelId, status: r.status, reason: r.reason, replacement_model_id: r.replacementModelId, planned_for: r.plannedFor,
      checklist: r.checklist ?? [], open_items: checklistOpen(r.checklist ?? []), requested_by: r.requestedBy, requested_at: r.requestedAt,
      decided_by: r.decidedBy, decided_at: r.decidedAt, decision_note: r.decisionNote, completed_by: r.completedBy, completed_at: r.completedAt,
    };
  }

  private async loadRetirement(user: CurrentUser, id: string): Promise<ModelRetirementEntity> {
    const r = await this.retirements.findOne({ where: { id } });
    if (!r || r.orgId !== orgFor(user, r.orgId)) throw new NotFoundException('Retirement not found');
    return r;
  }

  async retirementFor(user: CurrentUser, modelId: string) {
    this.assert();
    await modelForUser(this.models, this.projects, user, modelId);
    const rows = await this.retirements.find({ where: { modelId }, order: { requestedAt: 'DESC' } });
    return { model_id: modelId, items: RETIREMENT_ITEMS, retirements: rows.map((r) => this.retirementView(r)) };
  }

  /** What the checklist needs to cover, pre-filled from the registers. */
  private async checklistDetail(modelId: string, replacement: AIModelEntity | null) {
    const links = await this.modelDatasets.find({ where: { modelId } });
    const ds = links.length ? await this.datasets.find({ where: { id: In(links.map((l) => l.datasetId)) } }) : [];
    const deps = await this.deployers.find({ where: { modelId, active: true } });
    const openInc = await this.incidents.count({ where: { modelId, status: In(OPEN_INCIDENT) } });
    return {
      DATA_RETENTION: ds.length ? ds.map((d) => `${d.name}: retain until ${d.retentionUntil ? d.retentionUntil.toISOString().slice(0, 10) : 'not set'}`).join('; ') : 'No registered datasets.',
      DEPENDANTS: `${deps.length} active deployer(s)${deps.length ? `: ${deps.map((d) => d.name).join(', ')}` : ''}; ${openInc} open incident(s).`,
      REPLACEMENT: replacement ? `Replaced by ${replacement.name}.` : 'No replacement named.',
    };
  }

  async requestRetirement(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'request a retirement');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    if (model.lifecycleStage === ModelLifecycleStage.DECOMMISSIONED) throw new BadRequestException('The model is already decommissioned');
    if (await this.retirements.findOne({ where: { modelId, status: In(['REQUESTED', 'APPROVED']) } })) throw new BadRequestException('A retirement is already open for this model');
    let replacement: AIModelEntity | null = null;
    if (body.replacement_model_id) {
      replacement = (await modelForUser(this.models, this.projects, user, String(body.replacement_model_id))).model;
      if (replacement.id === modelId) throw new BadRequestException('A model cannot replace itself');
    }
    const r = await this.retirements.save(this.retirements.create({
      id: uuidv4(), orgId, modelId, status: 'REQUESTED', reason: reqText(body.reason, 'reason', 10, 2000), replacementModelId: replacement?.id ?? null,
      plannedFor: optDate(body.planned_for, 'planned_for'), checklist: newChecklist(await this.checklistDetail(modelId, replacement)),
      requestedBy: user.email, requestedAt: new Date(), decidedBy: null, decidedAt: null, decisionNote: null, completedBy: null, completedAt: null,
    }));
    // Two requests at the same moment: the earlier one stands and this one is withdrawn.
    const open = await this.retirements.find({ where: { modelId, status: In(['REQUESTED', 'APPROVED']) }, order: { requestedAt: 'ASC', id: 'ASC' } });
    if (open.length > 1 && open[0].id !== r.id) {
      await this.retirements.delete({ id: r.id });
      throw new BadRequestException('A retirement is already open for this model');
    }
    if (req) req.auditSummary = { retirement_requested: { retirement_id: r.id, model_id: modelId } };
    return this.retirementView(r);
  }

  /** An officer other than the requester approves or rejects. */
  async decide(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'approve retirements');
    const r = await this.loadRetirement(user, id);
    if (r.status !== 'REQUESTED') throw new BadRequestException('Only a requested retirement can be decided');
    if (r.requestedBy.toLowerCase() === user.email.toLowerCase()) throw new ForbiddenException('The requester cannot approve their own retirement request');
    r.status = oneOf(body.decision, ['APPROVED', 'REJECTED'] as const, 'decision');
    r.decidedBy = user.email;
    r.decidedAt = new Date();
    r.decisionNote = reqText(body.note, 'note', 5, 2000);
    await this.retirements.save(r);
    if (req) req.auditSummary = { retirement_decided: { retirement_id: r.id, decision: r.status } };
    return this.retirementView(r);
  }

  async checklistItem(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'work the retirement checklist');
    const r = await this.loadRetirement(user, id);
    if (r.status !== 'APPROVED') throw new BadRequestException('Work the checklist after the retirement is approved');
    const key = oneOf(body.key, RETIREMENT_ITEMS.map((i) => i.key), 'key');
    if (typeof body.done !== 'boolean') throw new BadRequestException('done must be true or false');
    const note = optText(body.note, 'note', 2000);
    if (body.done && (!note || note.length < 5)) throw new BadRequestException('Say how the item was done (note)');
    r.checklist = (r.checklist ?? []).map((i: ChecklistItem) => (i.key === key ? { ...i, done: body.done, note, by: user.email, at: new Date().toISOString() } : i));
    await this.retirements.save(r);
    if (req) req.auditSummary = { retirement_checklist: { retirement_id: r.id, key, done: body.done } };
    return this.retirementView(r);
  }

  /** Completion: every item done; the model becomes DECOMMISSIONED with a ledger record of the checklist. */
  async complete(user: CurrentUser, id: string, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'complete retirements');
    const r = await this.loadRetirement(user, id);
    if (r.status !== 'APPROVED') throw new BadRequestException('Only an approved retirement can be completed');
    const open = checklistOpen(r.checklist ?? []);
    if (open.length) throw new BadRequestException({ message: 'Finish the checklist first', open_items: open });
    const m = await this.models.findOne({ where: { id: r.modelId } });
    if (!m) throw new NotFoundException('Model not found');
    const now = new Date();
    r.status = 'COMPLETED';
    r.completedBy = user.email;
    r.completedAt = now;
    await this.retirements.save(r);
    const prev = m.lifecycleStage;
    m.lifecycleStage = ModelLifecycleStage.DECOMMISSIONED;
    m.updatedAt = now;
    await this.models.save(m);
    const checklistHash = createHash('sha256').update(JSON.stringify(r.checklist)).digest('hex');
    await this.ledger.save(this.ledger.create({
      id: uuidv4(), modelId: m.id, eventType: 'MODEL_RETIRED',
      eventData: { from: prev, retirement_id: r.id, approved_by: r.decidedBy, replacement_model_id: r.replacementModelId, checklist_hash: checklistHash },
      actor: user.email, occurredAt: now,
    }));
    if (req) req.auditSummary = { retirement_completed: { retirement_id: r.id, model_id: m.id, checklist_hash: checklistHash } };
    return this.retirementView(r);
  }

  async cancel(user: CurrentUser, id: string, req?: any) {
    this.assert();
    const r = await this.loadRetirement(user, id);
    if (!['REQUESTED', 'APPROVED'].includes(r.status)) throw new BadRequestException('Only an open retirement can be cancelled');
    if (!OFFICERS.includes(user.role) && r.requestedBy.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException('Only the requester or an officer can cancel');
    r.status = 'CANCELLED';
    r.decidedBy = r.decidedBy ?? user.email;
    r.decidedAt = r.decidedAt ?? new Date();
    await this.retirements.save(r);
    if (req) req.auditSummary = { retirement_cancelled: { retirement_id: r.id } };
    return this.retirementView(r);
  }
}
