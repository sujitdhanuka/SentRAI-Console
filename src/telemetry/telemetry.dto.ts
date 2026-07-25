import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export const ACTION_EVENT_TYPES = ['tool_call', 'decision', 'handoff', 'output', 'error'] as const;
export const ACTION_OUTCOMES = ['success', 'blocked', 'error', 'unauthorized_tool'] as const;

/**
 * One runtime action a deployed agent reports (Pillar 3 — Visibility). Tagged
 * with the model's registry id (the SENTRAI_MODEL_ID stamped into the build).
 */
export class ActionEventDto {
  @IsString() sentrai_model_id!: string;
  @IsIn(ACTION_EVENT_TYPES as unknown as string[]) type!: string;
  /** For tool_call events: the tool/capability id invoked. */
  @IsOptional() @IsString() @MaxLength(160) tool?: string;
  @IsOptional() @IsString() @MaxLength(64) session_id?: string;
  @IsOptional() @IsIn(ACTION_OUTCOMES as unknown as string[]) outcome?: string;
  @IsOptional() @IsObject() detail?: Record<string, any>;
  @IsOptional() @IsString() occurred_at?: string;
}

export class IngestEventsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ActionEventDto)
  events!: ActionEventDto[];
}
