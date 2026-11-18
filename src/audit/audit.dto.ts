import { IsBoolean, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuditType, SutraAlignment } from '../common/enums';

export class AuditChecklistDto {
  @IsString() auditor_ref!: string;
  @IsEnum(AuditType) audit_type!: AuditType;
  @IsOptional() @IsInt() audit_period_days: number = 180;
  // Dimension 1 — Data
  @IsOptional() @IsBoolean() training_data_bias_checked: boolean = false;
  @IsOptional() @IsBoolean() data_consent_verified: boolean = false;
  @IsOptional() @IsBoolean() data_sources_documented: boolean = false;
  @IsOptional() @IsBoolean() sensitive_attributes_excluded: boolean = false;
  // Dimension 2 — Model
  @IsOptional() @IsBoolean() model_architecture_reviewed: boolean = false;
  @IsOptional() @IsBoolean() decision_logic_documented: boolean = false;
  @IsOptional() @IsBoolean() adversarial_robustness_tested: boolean = false;
  @IsOptional() @IsBoolean() performance_benchmarks_met: boolean = false;
  // Dimension 3 — Output
  @IsOptional() @IsObject() fairness_metrics: Record<string, number> = {};
  @IsOptional() @IsNumber() explainability_score: number = 0.0;
  @IsOptional() @IsBoolean() bcp_verified: boolean = false;
  @IsOptional() @IsBoolean() human_override_tested: boolean = false;
  // 7 Sutras
  @IsOptional() @IsBoolean() trust_verified: boolean = false;
  @IsOptional() @IsBoolean() human_oversight_verified: boolean = false;
  @IsOptional() @IsBoolean() innovation_not_stifled: boolean = true;
  @IsOptional() @IsBoolean() fairness_metrics_passed: boolean = false;
  @IsOptional() @IsBoolean() accountability_chain_documented: boolean = false;
  @IsOptional() @IsBoolean() explainability_verified: boolean = false;
}

export class AuditFindingDto {
  @IsString() category!: string;
  @IsString() severity!: string; // "critical" | "major" | "minor" | "observation"
  @IsString() description!: string;
  @IsOptional() @IsEnum(SutraAlignment) sutra_violated?: SutraAlignment | null;
  @IsOptional() @IsBoolean() remediation_required: boolean = true;
  @IsOptional() @IsInt() remediation_deadline_days?: number | null;
}

export class ExplainabilityDto {
  @IsString() decision_ref!: string;
  /** Optional: the model that made the decision. Adverse-action notices (governance E2.2) only use explanations tied to their model. */
  @IsOptional() @IsString() model_id?: string;
  @IsObject() top_features!: Record<string, number>;
  @IsString() decision_outcome!: string;
  @IsNumber() @Min(0) @Max(1) confidence_score!: number;
  @IsOptional() @IsString() explanation_method: string = 'SHAP';
  @IsString() human_readable_summary!: string;
  @IsOptional() @IsBoolean() is_contestable: boolean = true;
}

export interface AuditResponse {
  audit_id: string;
  model_id: string;
  overall_verdict: string;
  sutras_compliance: Record<string, boolean>;
  explainability_score: number;
  next_audit_due: Date | null;
  created_at: Date;
}
