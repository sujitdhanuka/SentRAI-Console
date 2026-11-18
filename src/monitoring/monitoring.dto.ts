import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

export const BCP_DRILL_RESULTS = ['PASSED', 'PASSED_WITH_FINDINGS', 'FAILED'] as const;

/** Record a business-continuity drill for a model (E0.4, RBI Rec 21). */
export class BcpDrillDto {
  @IsString() @MinLength(3) @MaxLength(500) scenario!: string;
  @IsIn(BCP_DRILL_RESULTS as unknown as string[]) result!: (typeof BCP_DRILL_RESULTS)[number];
  @IsOptional() @IsString() @MaxLength(5000) findings?: string | null;
  /** When the drill took place; defaults to now. Cannot be in the future. */
  @IsOptional() @IsDateString() conducted_at?: string;
}
