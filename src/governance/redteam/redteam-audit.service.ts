/**
 * Red-team and audit rules (E2.8, RBI FREE-AI Rec 20, NIST MEASURE 2.6,
 * ISO 42001 9.2): a risk escalation seen by a CI scan makes red teaming due
 * for the model, a HIGH or CRITICAL system can be required to be red teamed
 * before it goes live, deployed HIGH and CRITICAL systems are audited at the
 * pack interval (auditIntervalDays.HIGH), and the governance framework is
 * reviewed on its own cycle (frameworkReviewMonths). Each rule adds a
 * deploy-gate finding and the facts the CTL-RT-02 and framework-review
 * controls read.
 */
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AuditType, ModelLifecycleStage, RiskLevel } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import { AIAuditTrailEntity, AIModelEntity, AimsRecordEntity, OrganizationEntity, ProjectEntity } from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts, addOrgFacts, emitModelEvent, governanceHooks } from '../hooks';
import { phase2Param } from '../packs/parameter-resolver';
import { PacksService } from '../packs/packs.service';
import { addMonths, DAY_MS, MAINTAINERS, orgFor, orgModels, orgParams, reqText, requireRole } from '../phase2-util';
import { gateTierOf, GovernanceSettingsDoc } from '../settings/settings.model';
import { GovernanceSettingsService } from '../settings/settings.service';
import { RisksService } from '../risks/risks.service';

const isHigh = (r: string) => r === RiskLevel.HIGH || r === RiskLevel.CRITICAL;
const LIVE: string[] = [ModelLifecycleStage.DEPLOYED, ModelLifecycleStage.MONITORING];
/** Platform audit interval for HIGH systems when no pack sets one (matches PLATFORM_DEFAULTS). */
const DEFAULT_AUDIT_DAYS = 365;

/** Latest red-team date: the model's lastRedTeamDate or a red_team evidence artifact, whichever is newer. */
export function lastRedTeam(m: Pick<AIModelEntity, 'lastRedTeamDate' | 'evidenceArtifacts'>): Date | null {
  const dates = [m.lastRedTeamDate ? new Date(m.lastRedTeamDate) : null, ...(m.evidenceArtifacts ?? []).filter((a: any) => a?.type === 'red_team' && a.added_at).map((a: any) => new Date(a.added_at))]
    .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

/** Red-team state: due after an escalation until a later exercise; due before go-live for HIGH when the rule is on. */
export function redTeamState(
  m: Pick<AIModelEntity, 'lastRedTeamDate' | 'evidenceArtifacts' | 'redTeamRequiredAt' | 'redTeamRequiredReason' | 'riskLevel'>,
  preDeployRequired: boolean,
) {
  const last = lastRedTeam(m);
  if (m.redTeamRequiredAt) {
    const since = new Date(m.redTeamRequiredAt);
    return { requiredSince: since, reason: m.redTeamRequiredReason ?? 'risk escalation', satisfied: !!last && last.getTime() >= since.getTime(), lastRedTeam: last, preDeploy: false };
  }
  if (preDeployRequired && isHigh(m.riskLevel)) return { requiredSince: null, reason: 'pre-deployment red team for a high-risk system', satisfied: !!last, lastRedTeam: last, preDeploy: true };
  return { requiredSince: null, reason: null, satisfied: true, lastRedTeam: last, preDeploy: false };
}

/** When the next audit of a live HIGH / CRITICAL model is due, or null when the rule does not apply. */
export function auditDue(
  m: Pick<AIModelEntity, 'riskLevel' | 'lifecycleStage' | 'nextAuditDue' | 'deploymentDate' | 'registeredAt'>,
  lastAudit: { createdAt: Date; nextAuditDue: Date | null } | null,
  intervalDays: number,
): Date | null {
  if (!isHigh(m.riskLevel) || !LIVE.includes(m.lifecycleStage)) return null;
  // The configured interval is a ceiling: an earlier explicit date (model or audit record) wins, a later one does not.
  const anchor = lastAudit?.createdAt ?? m.deploymentDate ?? m.registeredAt;
  const candidates: number[] = [];
  if (anchor) candidates.push(new Date(anchor).getTime() + intervalDays * DAY_MS);
  if (m.nextAuditDue) candidates.push(new Date(m.nextAuditDue).getTime());
  if (lastAudit?.nextAuditDue) candidates.push(new Date(lastAudit.nextAuditDue).getTime());
  return candidates.length ? new Date(Math.min(...candidates)) : null;
}

@Injectable()
export class RedTeamAuditService implements OnModuleInit {
  private readonly logger = new Logger(RedTeamAuditService.name);

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIAuditTrailEntity) private readonly audits: Repository<AIAuditTrailEntity>,
    @InjectRepository(AimsRecordEntity) private readonly aims: Repository<AimsRecordEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    private readonly risks: RisksService,
    private readonly packs: PacksService,
    private readonly settings: GovernanceSettingsService,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private on(): boolean {
    return this.flags.isEnabled('redTeamAuditRules');
  }

  onModuleInit(): void {
    governanceHooks.onRiskEscalation = async (modelId, detail) => {
      if (!this.on()) return;
      await this.markRequired(modelId, `risk escalation ${detail.from} → ${detail.to} (${detail.source})`.slice(0, 500), true, `risk escalation ${detail.from} → ${detail.to}`);
    };
    // A risk escalation reported through the model-event hook counts the same way.
    this.risks.onEvent(async (modelId, event, detail) => {
      if (!this.on() || event !== 'RISK_ESCALATION' || detail?.source === 'redteam-rule') return;
      await this.markRequired(modelId, String(detail?.ref ?? 'risk escalation').slice(0, 500), false);
    });
    addModelFacts(async (modelId, orgId) => {
      if (!this.on()) return undefined;
      const m = await this.models.findOne({ where: { id: modelId } });
      if (!m) return undefined;
      const s = redTeamState(m, await this.preDeploy(orgId));
      return { redTeam: { requiredSince: s.requiredSince, reason: s.reason, satisfied: s.satisfied } };
    });
    addOrgFacts(async (orgId) => (this.on() ? { frameworkReview: await this.frameworkReview(orgId) } : undefined));
    this.risks.addGateContributor(async (model, orgId, settings) => {
      if (!this.on()) return [];
      const out: Array<{ code: 'red_team_required' | 'audit_overdue'; message: string }> = [];
      const params = await orgParams(this.packs, orgId);
      const rt = redTeamState(model, params['redTeamPreDeployRequired.HIGH'] === true);
      if (!rt.satisfied) {
        out.push({
          code: 'red_team_required',
          message: rt.requiredSince
            ? `Red teaming is due after a risk escalation on ${rt.requiredSince.toISOString().slice(0, 10)} (${rt.reason})`
            : 'A high-risk system needs a red-team exercise before it goes live',
        });
      }
      const tp = await this.thirdPartyRequired(model, orgId, settings);
      const due = await this.auditDueFor(model, params, tp);
      if (due && due.getTime() < Date.now()) {
        out.push({ code: 'audit_overdue', message: `The periodic ${tp ? 'third-party ' : ''}audit for this ${model.riskLevel} system was due on ${due.toISOString().slice(0, 10)}` });
      }
      return out;
    });
  }

  private async preDeploy(orgId: string | null): Promise<boolean> {
    return (await orgParams(this.packs, orgId))['redTeamPreDeployRequired.HIGH'] === true;
  }

  /**
   * When the organisation's appetite requires a THIRD_PARTY audit for the tier (the RBI FREE-AI pack
   * floors HIGH at THIRD_PARTY), only a third-party or supervisory audit restarts the audit interval.
   * Same rule and audit types as the Phase 1 third_party_audit_required gate.
   */
  private async thirdPartyRequired(model: AIModelEntity, orgId: string | null, settings?: GovernanceSettingsDoc): Promise<boolean> {
    if (!isHigh(model.riskLevel) || !orgId) return false;
    const s = settings ?? (await this.settings.inForce(orgId)).settings;
    return s.appetite?.requiredAuditType?.[gateTierOf(model.riskLevel)] === 'THIRD_PARTY';
  }

  private async auditDueFor(model: AIModelEntity, params: Record<string, any>, thirdParty = false): Promise<Date | null> {
    const interval = Number(params['auditIntervalDays.HIGH']) > 0 ? Number(params['auditIntervalDays.HIGH']) : DEFAULT_AUDIT_DAYS;
    const where: Record<string, any> = { modelId: model.id };
    if (thirdParty) where.auditType = In([AuditType.THIRD_PARTY, AuditType.SUPERVISORY]);
    const last = await this.audits.findOne({ where, order: { createdAt: 'DESC' } });
    // The model's own next-audit date says nothing about the audit's type, so a third-party requirement runs from the last third-party audit.
    return auditDue(thirdParty ? { ...model, nextAuditDue: null } : model, last, interval);
  }

  private async markRequired(modelId: string, reason: string, emit = true, key?: string): Promise<void> {
    const m = await this.models.findOne({ where: { id: modelId } });
    if (!m) return;
    // An open requirement keeps its original date until a red team satisfies it.
    if (m.redTeamRequiredAt && !redTeamState(m, false).satisfied) return;
    // The same escalation seen again on every later scan (the tier was not re-triaged) does not re-arm a satisfied requirement.
    if (key && m.redTeamRequiredAt && m.redTeamRequiredReason?.startsWith(key)) return;
    m.redTeamRequiredAt = new Date();
    m.redTeamRequiredReason = reason;
    await this.models.save(m);
    if (emit) await emitModelEvent(modelId, 'RISK_ESCALATION', { ref: reason, source: 'redteam-rule' });
  }

  /* ---------------------------------------------------------------- views */

  async modelStatus(user: CurrentUser, modelId: string) {
    assertFlag(this.flags, 'redTeamAuditRules');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const params = await orgParams(this.packs, orgId);
    const rt = redTeamState(model, params['redTeamPreDeployRequired.HIGH'] === true);
    const tp = await this.thirdPartyRequired(model, orgId);
    const due = await this.auditDueFor(model, params, tp);
    return {
      model_id: modelId, risk_level: model.riskLevel, lifecycle_stage: model.lifecycleStage,
      red_team: { required_since: rt.requiredSince, reason: rt.reason, satisfied: rt.satisfied, last_red_team: rt.lastRedTeam, pre_deploy_rule: params['redTeamPreDeployRequired.HIGH'] === true },
      audit: { next_due: due, overdue: !!due && due.getTime() < Date.now(), interval_days: Number(params['auditIntervalDays.HIGH']) || DEFAULT_AUDIT_DAYS, third_party_required: tp },
    };
  }

  /** Records a red-team exercise date on the model (the report itself is attached as red_team evidence). */
  async recordRedTeam(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    assertFlag(this.flags, 'redTeamAuditRules');
    requireRole(user, MAINTAINERS, 'record red-team exercises');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    const at = body.performed_at ? new Date(String(body.performed_at)) : new Date();
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000) throw new BadRequestException('performed_at must be a past date');
    const summary = reqText(body.summary, 'summary', 10, 2000);
    // For HIGH and CRITICAL systems the record clears a blocking gate, so it must point at the report.
    const ref = typeof body.ref === 'string' && body.ref.trim() ? body.ref.trim().slice(0, 500) : null;
    if (isHigh(model.riskLevel) && (!ref || ref.length < 5)) throw new BadRequestException('A red team on a HIGH or CRITICAL system needs ref: the report, ticket or evidence reference');
    model.lastRedTeamDate = at;
    model.evidenceArtifacts = [...(model.evidenceArtifacts ?? []), { type: 'red_team', ref: ref ?? `sentrai:red-team:${modelId}:${at.toISOString()}`, added_at: at.toISOString(), description: summary, recorded_by: user.email } as any];
    model.updatedAt = new Date();
    await this.models.save(model);
    if (req) req.auditSummary = { red_team_recorded: { model_id: modelId, performed_at: at, by: user.email } };
    return this.modelStatus(user, modelId);
  }

  async frameworkReview(orgId: string, now = new Date()) {
    const params = await orgParams(this.packs, orgId, now);
    const intervalMonths = phase2Param(params, 'frameworkReviewMonths');
    const rows = await this.aims.find({ where: { orgId, type: In(['POLICY', 'MGMT_REVIEW']), status: 'APPROVED' } });
    const last = rows.map((r) => r.approvedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const nextDueAt = last ? addMonths(last, intervalMonths) : null;
    return { lastReviewAt: last, intervalMonths, nextDueAt, overdue: !last || nextDueAt!.getTime() < now.getTime() };
  }

  /** Organisation view: models with red teaming due, audits overdue, and the framework review. */
  async overview(user: CurrentUser, q: { org_id?: string }) {
    assertFlag(this.flags, 'redTeamAuditRules');
    const orgId = orgFor(user, q.org_id);
    const params = await orgParams(this.packs, orgId);
    const pre = params['redTeamPreDeployRequired.HIGH'] === true;
    const rows: any[] = [];
    for (const m of await orgModels(this.models, this.projects, orgId)) {
      const rt = redTeamState(m, pre);
      const tp = await this.thirdPartyRequired(m, orgId);
      const due = await this.auditDueFor(m, params, tp);
      if (rt.satisfied && !(due && due.getTime() < Date.now()) && !rt.requiredSince) continue;
      rows.push({
        model_id: m.id, name: m.name, risk_level: m.riskLevel, lifecycle_stage: m.lifecycleStage,
        red_team_due: !rt.satisfied, red_team_required_since: rt.requiredSince, red_team_reason: rt.reason, last_red_team: rt.lastRedTeam,
        audit_due: due, audit_overdue: !!due && due.getTime() < Date.now(), third_party_audit_required: tp,
      });
    }
    const fr = await this.frameworkReview(orgId);
    return {
      org_id: orgId, pre_deploy_rule: pre, audit_interval_days: Number(params['auditIntervalDays.HIGH']) || DEFAULT_AUDIT_DAYS,
      models: rows,
      framework_review: { last_review_at: fr.lastReviewAt, interval_months: fr.intervalMonths, next_due_at: fr.nextDueAt, overdue: fr.overdue },
    };
  }

  /** Weekly: framework reviews due within 30 days or overdue, and audits overdue, per organisation. */
  @Cron(CronExpression.EVERY_WEEK)
  async reminders(now = new Date()): Promise<number> {
    if (!this.on()) return 0;
    let sent = 0;
    for (const org of await this.orgs.find()) {
      try {
        // Only organisations that keep AIMS records are reminded; the rest have no framework to review here.
        if (!(await this.aims.count({ where: { orgId: org.id } }))) continue;
        const fr = await this.frameworkReview(org.id, now);
        if (fr.overdue || (fr.nextDueAt && fr.nextDueAt.getTime() - now.getTime() < 30 * DAY_MS)) {
          await this.notifier.notify('framework_review_due', { tenant_id: org.id, last_review_at: fr.lastReviewAt, next_due_at: fr.nextDueAt, overdue: fr.overdue });
          sent++;
        }
      } catch (e) {
        this.logger.warn(`Framework review reminder skipped for org ${org.id}: ${String(e).slice(0, 200)}`);
      }
    }
    return sent;
  }
}
