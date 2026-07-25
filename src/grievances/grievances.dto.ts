import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const GRIEVANCE_CATEGORIES = ['unfair_outcome', 'privacy', 'inaccuracy', 'no_explanation', 'discrimination', 'other'] as const;
export const GRIEVANCE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const GRIEVANCE_STATUSES = ['RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'REJECTED', 'CLOSED'] as const;

export class FileGrievanceDto {
  @IsString() model_id!: string;
  @IsString() @MinLength(4) @MaxLength(200) subject!: string;
  @IsString() @MinLength(10) @MaxLength(4000) description!: string;
  @IsOptional() @IsIn(GRIEVANCE_CATEGORIES as unknown as string[]) category?: string;
  @IsOptional() @IsIn(GRIEVANCE_SEVERITIES as unknown as string[]) severity?: string;
  @IsOptional() @IsIn(['web', 'email', 'regulator', 'phone']) channel?: string;
  @IsOptional() @IsString() @MaxLength(255) complainant?: string;
}

/** Public consumer submission (by model UUID) — minimal fields, no auth. */
export class PublicGrievanceDto {
  @IsString() @MinLength(4) @MaxLength(200) subject!: string;
  @IsString() @MinLength(10) @MaxLength(4000) description!: string;
  @IsOptional() @IsIn(GRIEVANCE_CATEGORIES as unknown as string[]) category?: string;
  @IsOptional() @IsString() @MaxLength(255) complainant?: string;
}

export class GrievanceStatusDto {
  @IsIn(GRIEVANCE_STATUSES as unknown as string[]) status!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
