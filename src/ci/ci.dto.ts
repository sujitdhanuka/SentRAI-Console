import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

/** One source file in a CI scan payload (path relative to repo root + its content). */
export class CiFileDto {
  @IsString()
  path!: string;

  @IsString()
  content!: string;
}

/** Stateless CI scan request — a repository snapshot + the commit context. */
export class CiScanDto {
  @IsString()
  @MinLength(1)
  commit_sha!: string;

  @IsOptional()
  @IsString()
  pr_number?: string | null;

  @IsOptional()
  @IsString()
  pipeline_run_id?: string | null;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CiFileDto)
  files!: CiFileDto[];
}

/** Admin request to mint a long-lived CI service token for a project. */
export class CiTokenDto {
  @IsString()
  @MinLength(1)
  project_id!: string;

  @IsOptional()
  @IsString()
  label?: string;
}
