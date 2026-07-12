import { IsArray, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { DriftStatus } from '../common/enums';

/** A window of inference scores pushed by a serving system for drift evaluation. */
export class ScoreIngestDto {
  @IsIn(['reference', 'live']) kind!: 'reference' | 'live';
  @IsArray() @IsNumber({}, { each: true }) scores!: number[];
  @IsOptional() @IsNumber() accuracy?: number | null;
}

export class DriftEvaluationDto {
  @IsString() model_id!: string;
  @IsArray() @IsNumber({}, { each: true }) training_scores!: number[];
  @IsArray() @IsNumber({}, { each: true }) live_scores!: number[];
  @IsNumber() baseline_accuracy!: number;
  @IsNumber() current_accuracy!: number;
}

export class BcpActivateDto {
  @IsString() reason!: string;
  @IsOptional() @IsString() rules_engine_ref?: string | null;
  @IsString() actor!: string;
}

export interface DriftReportResponse {
  model_id: string;
  computed_at: Date;
  psi_score: number;
  wasserstein_distance: number;
  accuracy_delta: number;
  status: DriftStatus;
  circuit_breaker_active: boolean;
  human_review_ticket: string | null;
  remediation_action: string | null;
  summary: string;
}
