import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIAuditTrailEntity, AIModelEntity } from '../database/entities';
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
  ) {}

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

  recordExplainability(dto: ExplainabilityDto) {
    const topFeature = Object.keys(dto.top_features).length
      ? Object.entries(dto.top_features).sort((a, b) => b[1] - a[1])[0][0]
      : null;
    this.logger.log(
      `explainability_recorded decision_ref=${dto.decision_ref} outcome=${dto.decision_outcome} ` +
        `top_feature=${topFeature} contestable=${dto.is_contestable}`,
    );
    return {
      decision_ref: dto.decision_ref,
      outcome: dto.decision_outcome,
      confidence: dto.confidence_score,
      is_contestable: dto.is_contestable,
      generated_at: new Date().toISOString(),
    };
  }
}
