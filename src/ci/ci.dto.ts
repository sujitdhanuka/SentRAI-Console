import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
  @MaxLength(100)
  commit_sha!: string;

  @IsOptional()
  @IsString()
  pr_number?: string | null;

  @IsOptional()
  @IsString()
  pipeline_run_id?: string | null;

  /** This run is a push to the repository's default branch, i.e. the code has landed. */
  @IsOptional()
  @IsBoolean()
  default_branch_push?: boolean;

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
  @MaxLength(120)
  label?: string;
}

/** Auditor sign-off to override a failed gate. Justification is mandatory and
 *  becomes part of the permanent record — hence a real minimum length. */
export class CiOverrideDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}
