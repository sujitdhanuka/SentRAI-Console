import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment } from '../common/enums';

export class ModelRegisterDto {
  @IsString() name!: string;
  @IsEnum(ModelType) model_type!: ModelType;
  @IsString() functional_area!: string;
  @IsString() use_case_description!: string;
  @IsOptional() @IsArray() target_customer_segments: string[] = [];
  @IsOptional() @IsString() owner_team: string = 'UNASSIGNED';
  @IsOptional() @IsString() developed_by: string = 'unknown';
  @IsOptional() deployment_date?: string | null;
  @IsOptional() @IsArray() dependencies: any[] = [];
  @IsOptional() @IsArray() performance_benchmarks: any[] = [];
  @IsOptional() @IsArray() @IsEnum(SutraAlignment, { each: true }) sutras_alignment: SutraAlignment[] = [];
  @IsOptional() @IsBoolean() human_oversight_required: boolean = true;
  @IsOptional() @IsString() autonomous_scope?: string | null;
  @IsOptional() @IsString() board_policy_ref: string = '';
  @IsOptional() last_red_team_date?: string | null;
  @IsOptional() next_audit_due?: string | null;
  @IsOptional() @IsString() source_ref?: string | null;
  @IsOptional() @IsString() project_id?: string | null;
}

export class LifecycleUpdateDto {
  @IsEnum(ModelLifecycleStage) stage!: ModelLifecycleStage;
  @IsString() actor!: string;
  @IsOptional() @IsString() notes: string = '';
}

export class GrievanceUpdateDto {
  @IsOptional() @IsInt() count_delta: number = 1;
  @IsString() resolution_notes!: string;
}

export class GovernanceUpdateDto {
  @IsOptional() @IsString() owner_team?: string | null;
  @IsOptional() @IsString() board_policy_ref?: string | null;
  @IsOptional() @IsBoolean() human_oversight_required?: boolean | null;
  @IsOptional() @IsString() autonomous_scope?: string | null;
  @IsOptional() @IsArray() @IsEnum(SutraAlignment, { each: true }) sutras_alignment?: SutraAlignment[] | null;
  @IsOptional() last_red_team_date?: string | null;
  @IsOptional() @IsString() use_case_description?: string | null;
  /** A human-edited risk rationale (flips its provenance to 'human'). */
  @IsOptional() @IsString() risk_rationale?: string | null;
  @IsOptional() @IsString() actor: string = 'dashboard_user';
}

export class RescanDto {
  @IsOptional() @IsString() project_id?: string | null;
}

/** An evidence artifact attached to a model (bias-test report, red-team report, ...). */
export class EvidenceDto {
  @IsString() type!: string; // 'bias_test' | 'red_team' | 'model_card' | 'dpia' | ...
  @IsString() ref!: string; // URL or document reference
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() actor: string = 'dashboard_user';
}

export interface RescanResultRow {
  model_id: string;
  name: string;
  old_risk: RiskLevel;
  new_risk: RiskLevel;
  risk_changed: boolean;
  source_found: boolean | null; // null = model has no linked source file
}

export interface RescanSummary {
  rescanned: number;
  risk_changed: number;
  source_missing: number;
  models: RescanResultRow[];
}

export interface ModelResponse {
  model_id: string;
  name: string;
  risk_level: RiskLevel;
  triaged_risk_level: RiskLevel;
  lifecycle_stage: ModelLifecycleStage;
  human_oversight_required: boolean;
  source_ref: string | null;
  project_id: string | null;
  registered_at: Date;
  compliance_pass: boolean;
  open_gap_count: number;
  use_case_description: string | null;
  owner_team: string | null;
  board_policy_ref: string | null;
  autonomous_scope: string | null;
  last_red_team_date: Date | null;
  sutras_alignment: string[];
  /** Hardcoded secrets found in the model's source at scan time (values masked). */
  security_findings: Array<{ type: string; masked_value: string; line: number }>;
  /** Provenance of use_case_description: 'static' | 'heuristic' | 'ai' | 'human'. */
  description_source: string;
  /** Model that produced an AI description, e.g. 'claude-sonnet-5' (else null). */
  description_model: string | null;
  /** Static-analysis signal categories detected at import (evidence). */
  detection_signals: string[];
  /** Auditor-facing risk justification + its provenance (null until drafted). */
  risk_rationale: string | null;
  risk_rationale_source: string | null;
  risk_rationale_model: string | null;
  /** Set when the org crossed its plan's soft model limit (registration never blocks). */
  plan_warning?: string | null;
}

export interface SummarizeResponse {
  model_id: string;
  summary: string;
  description_source: string;
  description_model: string | null;
  /** True when a real AI provider produced it; false for the local heuristic. */
  ai_enabled: boolean;
  provider: string;
}
