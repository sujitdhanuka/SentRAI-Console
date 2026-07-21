import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const ADAPTERS = ['openai-compat', 'anthropic'] as const;

export class CreateProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsIn(ADAPTERS as unknown as string[])
  adapter!: string;

  /** http(s) only — the service re-validates; Ollama legitimately uses http://localhost. */
  @IsString()
  @Matches(/^https?:\/\//i, { message: 'base_url must start with http:// or https://' })
  @MaxLength(500)
  base_url!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  /** Write-only. Omit for keyless endpoints (e.g. local Ollama). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  api_key?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** ADMIN (no tenant of their own) must name the target organization. */
  @IsOptional()
  @IsString()
  organization_id?: string;
}

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsIn(ADAPTERS as unknown as string[])
  adapter?: string;

  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//i, { message: 'base_url must start with http:// or https://' })
  @MaxLength(500)
  base_url?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model?: string;

  /** Write-only. Non-empty string replaces the key; empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  api_key?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** What the API returns. The key never appears — only its mask. */
export interface ProviderResponse {
  provider_id: string;
  organization_id: string;
  label: string;
  adapter: string;
  base_url: string;
  model: string;
  api_key_masked: string | null;
  has_api_key: boolean;
  enabled: boolean;
  /** True when the base URL points at localhost/a private range — data stays on-box. */
  local_endpoint: boolean;
  last_test_status: string | null;
  last_test_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface TestResult {
  provider_id: string;
  status: 'ok' | 'failed';
  latency_ms: number;
  detail: string;
}
