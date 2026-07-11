import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description: string = '';

  @IsString()
  root_directory!: string;
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
}
