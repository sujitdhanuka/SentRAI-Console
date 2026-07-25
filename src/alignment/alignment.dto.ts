import { IsIn, IsInt, IsEnum, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { ModelLifecycleStage, RiskLevel } from '../common/enums';

/** Only live stages can be the target of a board-approval request. */
export class ApprovalRequestDto {
  @IsString() model_id!: string;
  @IsEnum(ModelLifecycleStage) target_stage!: ModelLifecycleStage;
  @IsOptional() @IsInt() @Min(1) @Max(5) required_approvals?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ApprovalDecisionDto {
  @IsIn(['APPROVE', 'REJECT'], { message: 'decision must be APPROVE or REJECT' })
  decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class OpenCampaignDto {
  @IsString() @MaxLength(200) title!: string;
  @IsInt() @Min(1) @Max(365) cadence_days!: number;
  /** Include only models at or above this tier; omit for all live models. */
  @IsOptional() @IsEnum(RiskLevel) risk_filter?: RiskLevel;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AttestDto {
  @IsIn(['ATTEST', 'FLAG'], { message: 'decision must be ATTEST or FLAG' })
  decision!: 'ATTEST' | 'FLAG';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
