import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export const ACTION_EVENT_TYPES = ['tool_call', 'llm_call', 'decision', 'handoff', 'output', 'error'] as const;
export const ACTION_OUTCOMES = ['success', 'blocked', 'error', 'unauthorized_tool', 'unconfirmed_model'] as const;

/**
 * One runtime action a deployed agent reports (Pillar 3 — Visibility). Tagged
 * with the model's registry id (the SENTRAI_MODEL_ID stamped into the build).
 */
export class ActionEventDto {
  @IsString() sentrai_model_id!: string;
  @IsIn(ACTION_EVENT_TYPES as unknown as string[]) type!: string;
  /** For tool_call events: the tool/capability id invoked. */
  @IsOptional() @IsString() @MaxLength(160) tool?: string;
  /** For llm_call events: the provider or gateway called (OpenRouter, OpenAI, …). */
  @IsOptional() @IsString() @MaxLength(80) provider?: string;
  /** For llm_call events: the model the app requested. */
  @IsOptional() @IsString() @MaxLength(160) model?: string;
  /** For llm_call events: the model that answered (a gateway may route or fall back). */
  @IsOptional() @IsString() @MaxLength(160) response_model?: string;
  /** For llm_call events: what the call was for ('summary', 'chat', …). */
  @IsOptional() @IsString() @MaxLength(80) task?: string;
  @IsOptional() @IsString() @MaxLength(64) session_id?: string;
  @IsOptional() @IsIn(ACTION_OUTCOMES as unknown as string[]) outcome?: string;
  @IsOptional() @IsObject() detail?: Record<string, any>;
  @IsOptional() @IsString() occurred_at?: string;
}

export class IngestEventsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ActionEventDto)
  events!: ActionEventDto[];
}

export class ConfirmedLlmModelDto {
  @IsString() @MaxLength(80) task!: string;
  @IsOptional() @IsString() @MaxLength(80) provider?: string;
  @IsString() @MaxLength(160) model!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** The per-task list of LLM models an owner confirms for an inventory record. */
export class ConfirmLlmModelsDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ConfirmedLlmModelDto)
  entries!: ConfirmedLlmModelDto[];
}
