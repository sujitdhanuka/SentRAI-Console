import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  AIAuditTrailEntity,
  AIModelEntity,
  AuditEventEntity,
  ExplainabilityRecordEntity,
} from '../database/entities';
import { RiskLevel } from '../common/enums';
import { generateAuditTrailPayload } from '../domain/audit';
import { AuditChecklistDto, AuditFindingDto, AuditResponse, ExplainabilityDto } from './audit.dto';

const NEXT_AUDIT_INTERVAL_DAYS: Record<string, number> = {
  [RiskLevel.HIGH]: 180,
  [RiskLevel.MEDIUM]: 365,
  [RiskLevel.LOW]: 730,
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AIAuditTrailEntity) private readonly audits: Repository<AIAuditTrailEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ExplainabilityRecordEntity)
    private readonly explainability: Repository<ExplainabilityRecordEntity>,
    @InjectRepository(AuditEventEntity) private readonly events: Repository<AuditEventEntity>,
  ) {}

  /** Query the global audit-event stream (one row per mutating API action). */
  async listEvents(opts: { actor?: string; path?: string; limit?: number }) {
    const qb = this.events.createQueryBuilder('e').orderBy('e.occurredAt', 'DESC').take(opts.limit ?? 100);
    if (opts.actor) qb.andWhere('e.actor LIKE :actor', { actor: `%${opts.actor}%` });
    if (opts.path) qb.andWhere('e.path LIKE :path', { path: `%${opts.path}%` });
    const rows = await qb.getMany();
    return rows.map((r) => ({
      event_id: r.id,
      actor: r.actor,
      actor_role: r.actorRole,
      method: r.method,
      path: r.path,
      status_code: r.statusCode,
      outcome: r.outcome,
      payload_summary: r.payloadSummary,
      occurred_at: r.occurredAt.toISOString(),
    }));
  }

  async list(modelId: string): Promise<any[]> {
    const rows = await this.audits.find({ where: { modelId }, order: { createdAt: 'DESC' } });
    return rows.map((r) => ({
      audit_id: r.id,
      audit_type: r.auditType,
      auditor_ref: r.auditorRef,
      risk_level: r.riskLevel,
      overall_verdict: r.overallVerdict,
      explainability_score: r.explainabilityScore,
      sutras_compliance: r.sutrasCompliance,
      findings: r.findings,
      next_audit_due: r.nextAuditDue ? r.nextAuditDue.toISOString() : null,
      created_at: r.createdAt.toISOString(),
    }));
  }

  async initiate(modelId: string, dto: AuditChecklistDto): Promise<AuditResponse> {
    const model = await this.models.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Model not found');

    const now = new Date();
    const periodStart = new Date(now.getTime() - dto.audit_period_days * 86_400_000);

    const trail = generateAuditTrailPayload(
      uuidv4(),
      modelId,
      dto.audit_type,
      dto.auditor_ref,
      model.riskLevel as RiskLevel,
      periodStart,
      now,
      dto,
    );

    const days = NEXT_AUDIT_INTERVAL_DAYS[model.riskLevel] ?? 730;
    trail.nextAuditDue = new Date(now.getTime() + days * 86_400_000);

    const checklistDimensions = [
      trail.trainingDataBiasChecked,
      trail.dataConsentVerified,
      trail.dataSourcesDocumented,
      trail.sensitiveAttributesExcluded,
      trail.modelArchitectureReviewed,
      trail.decisionLogicDocumented,
      trail.adversarialRobustnessTested,
      trail.performanceBenchmarksMet,
      trail.bcpVerified,
      trail.humanOverrideTested,
    ];
    const sutrasPassed = Object.values(trail.sutrasCompliance).every(Boolean);
    trail.overallVerdict = checklistDimensions.some(Boolean) && sutrasPassed ? 'COMPLIANT' : 'CONDITIONAL';

    await this.audits.save(this.audits.create({
      id: trail.auditId,
      modelId: trail.modelId,
      auditType: trail.auditType,
      auditorRef: trail.auditorRef,
      riskLevel: trail.riskLevel,
      auditPeriodStart: trail.auditPeriodStart,
      auditPeriodEnd: trail.auditPeriodEnd,
      inputDataAudit: {
        bias_checked: trail.trainingDataBiasChecked,
        consent_verified: trail.dataConsentVerified,
        sources_documented: trail.dataSourcesDocumented,
        sensitive_excluded: trail.sensitiveAttributesExcluded,
      },
      modelAlgoAudit: {
        architecture_reviewed: trail.modelArchitectureReviewed,
        logic_documented: trail.decisionLogicDocumented,
        adversarial_tested: trail.adversarialRobustnessTested,
        benchmarks_met: trail.performanceBenchmarksMet,
      },
      outputBehaviourAudit: {
        bcp_verified: trail.bcpVerified,
        human_override_tested: trail.humanOverrideTested,
      },
      fairnessMetrics: trail.fairnessMetrics,
      explainabilityScore: trail.explainabilityScore,
      sutrasCompliance: trail.sutrasCompliance,
      findings: [],
      overallVerdict: trail.overallVerdict,
      nextAuditDue: trail.nextAuditDue,
      createdAt: trail.createdAt,
    }));

    model.nextAuditDue = trail.nextAuditDue;
    model.updatedAt = now;
    await this.models.save(model);

    return {
      audit_id: trail.auditId,
      model_id: trail.modelId,
      overall_verdict: trail.overallVerdict,
      sutras_compliance: trail.sutrasCompliance,
      explainability_score: trail.explainabilityScore,
      next_audit_due: trail.nextAuditDue,
      created_at: trail.createdAt,
    };
  }

  async addFinding(modelId: string, auditId: string, dto: AuditFindingDto) {
    const audit = await this.audits.findOne({ where: { id: auditId } });
    if (!audit || audit.modelId !== modelId) throw new NotFoundException('Audit not found');

    const finding = {
      finding_id: uuidv4(),
      category: dto.category,
      severity: dto.severity,
      description: dto.description,
      sutra_violated: dto.sutra_violated ?? null,
      remediation_required: dto.remediation_required ?? true,
      remediation_deadline: dto.remediation_deadline_days
        ? new Date(Date.now() + dto.remediation_deadline_days * 86_400_000).toISOString()
        : null,
      remediation_status: 'OPEN',
    };

    const findings = [...(audit.findings ?? []), finding];
    audit.findings = findings;

    const hasCritical = findings.some((f) => f.severity === 'critical');
    const hasMajor = findings.some((f) => f.severity === 'major');
    if (hasCritical) audit.overallVerdict = 'NON_COMPLIANT';
    else if (hasMajor) audit.overallVerdict = 'CONDITIONAL';

    await this.audits.save(audit);
    return { audit_id: auditId, finding_id: finding.finding_id, verdict: audit.overallVerdict };
  }

  async recordExplainability(dto: ExplainabilityDto) {
    const now = new Date();
    const row = await this.explainability.save(this.explainability.create({
      id: uuidv4(),
      decisionRef: dto.decision_ref,
      decisionOutcome: dto.decision_outcome,
      confidenceScore: dto.confidence_score,
      topFeatures: dto.top_features,
      explanationMethod: dto.explanation_method ?? 'SHAP',
      humanReadableSummary: dto.human_readable_summary,
      isContestable: dto.is_contestable ?? true,
      createdAt: now,
    }));
    this.logger.log(`explainability_recorded id=${row.id} decision_ref=${dto.decision_ref}`);
    return {
      record_id: row.id,
      decision_ref: dto.decision_ref,
      outcome: dto.decision_outcome,
      confidence: dto.confidence_score,
      is_contestable: row.isContestable,
      generated_at: now.toISOString(),
    };
  }

  /** List persisted explainability records, newest first (REC 24 evidence). */
  async listExplainability(decisionRef?: string, limit = 50) {
    const rows = await this.explainability.find({
      where: decisionRef ? { decisionRef } : {},
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      record_id: r.id,
      decision_ref: r.decisionRef,
      outcome: r.decisionOutcome,
      confidence: r.confidenceScore,
      top_features: r.topFeatures,
      explanation_method: r.explanationMethod,
      human_readable_summary: r.humanReadableSummary,
      is_contestable: r.isContestable,
      created_at: r.createdAt.toISOString(),
    }));
  }
}
