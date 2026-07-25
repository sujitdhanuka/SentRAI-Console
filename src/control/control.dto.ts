import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Suspending a model (kill switch) requires a reason for the audit trail. */
export class SuspendDto {
  @IsString() @MinLength(4) @MaxLength(500) reason!: string;
}

export class ResumeDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
