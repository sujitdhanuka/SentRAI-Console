import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IncidentCategory, IncidentSeverity, IncidentStatus, RiskLevel } from '../common/enums';

export class AffectedConsumerDto {
  @IsNumber() count!: number;
  @IsOptional() @IsString() demographic_segment?: string | null;
  @IsString() harm_type!: string;
  @IsOptional() @IsBoolean() compensation_provided: boolean = false;
  @IsOptional() @IsNumber() compensation_amount_inr?: number | null;
}

export class IncidentReportDto {
  @IsString() model_id!: string;
  @IsString() model_name!: string;
  @IsString() re_name!: string;
  @IsString() functional_area!: string;
  @IsEnum(IncidentCategory) incident_category!: IncidentCategory;
  @IsEnum(IncidentSeverity) severity!: IncidentSeverity;
  @IsString() @MinLength(50) description!: string;
  @IsString() observed_at!: string;
  @IsString() detected_at!: string;
  @IsOptional() @ValidateNested() @Type(() => AffectedConsumerDto) affected_consumers?: AffectedConsumerDto | null;
  @IsEnum(RiskLevel) model_risk_level!: RiskLevel;
  @IsOptional() @IsBoolean() autonomous_system_involved: boolean = false;
  @IsString() @MinLength(20) immediate_action_taken!: string;
  @IsOptional() @IsBoolean() system_suspended: boolean = false;
  @IsOptional() @IsBoolean() fallback_activated: boolean = false;
  @IsOptional() @IsBoolean() repeat_incident: boolean = false;
  @IsOptional() @IsArray() prior_incident_refs: string[] = [];
}

export class IncidentStatusUpdateDto {
  @IsEnum(IncidentStatus) status!: IncidentStatus;
  @IsOptional() @IsString() notes: string = '';
  @IsOptional() @IsBoolean() regulator_notified?: boolean | null;
  @IsOptional() @IsBoolean() board_informed?: boolean | null;
}

export interface IncidentResponse {
  incident_id: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reporting_deadline: Date;
  hours_until_deadline: number;
  is_overdue: boolean;
  created_at: Date;
}

export interface SectoralRiskSummary {
  total_incidents: number;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
  overdue_count: number;
  circuit_breakers_active: number;
  repeat_incident_rate: number;
}
