import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description: string = '';

  /**
   * A directory on the server's filesystem (self-hosted installs). Optional:
   * omit it and upload a codebase ZIP instead — the project then scans its
   * private workspace directory.
   */
  @IsOptional()
  @IsString()
  root_directory: string = '';
}

export class GithubImportDto {
  @IsString()
  @MinLength(1)
  owner!: string;

  @IsString()
  @MinLength(1)
  repo!: string;

  @IsOptional()
  @IsString()
  branch?: string | null;

  @IsOptional()
  @IsString()
  token?: string | null;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  root_directory?: string | null;
}

export interface ProjectResponse {
  project_id: string;
  name: string;
  description: string;
  root_directory: string;
  last_scanned_at: Date | null;
  created_at: Date;
  model_count: number;
  compliant_count: number;
  open_gap_count: number;
  tenant_name: string | null;
  has_scan_result: boolean;
  models_discovered: number | null;
  /** 'zip' | 'folder' | 'github:owner/repo@branch' — how the codebase was loaded. */
  codebase_source: string | null;
}
