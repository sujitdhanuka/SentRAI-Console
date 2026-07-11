import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { RiskLevel } from '../common/enums';

export class ScanDto {
  @IsOptional() @IsString() directory?: string | null;
  @IsOptional() @IsString() project_id?: string | null;
}

export class ImportDto {
  @IsOptional() @IsString() directory?: string | null;
  @IsOptional() @IsString() project_id?: string | null;
  @IsArray() file_paths!: string[];
  @IsOptional() @IsString() owner_team: string = 'UNASSIGNED — pending review';
  @IsOptional() @IsString() board_policy_ref: string = '';
  @IsOptional() @IsBoolean() overwrite: boolean = false;
}

export class RemoteScanDto {
  @IsString() provider!: string;
  @IsOptional() @IsString() owner?: string | null;
  @IsOptional() @IsString() repo?: string | null;
  @IsOptional() @IsString() project_id?: string | null;
  @IsOptional() @IsString() branch: string = 'main';
  @IsOptional() @IsString() token?: string | null;
  @IsOptional() @IsString() host: string = 'gitlab.com';
}

export class InfraScanDto {
  @IsString() provider!: string;
  @IsOptional() @IsString() namespace: string = 'default';
  @IsOptional() @IsString() endpoint_url?: string | null;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseResponse {
  current_path: string;
  parent_path: string | null;
  directories: DirectoryEntry[];
}

export interface ImportedModel {
  model_id: string;
  name: string;
  source_ref: string;
  risk_level: RiskLevel;
  remaining_gaps: string[];
}
