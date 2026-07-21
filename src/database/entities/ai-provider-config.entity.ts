import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A per-organization AI provider configuration (BYO-LLM).
 *
 * One row = one usable model endpoint: an adapter (protocol), a base URL, a
 * model name, and an encrypted API key. Two adapters cover the market:
 *  - 'openai-compat' — OpenAI, Gemini (OpenAI endpoint), Ollama, OpenRouter,
 *    Together.ai, Hugging Face router, Groq, Mistral, any vLLM/TGI.
 *  - 'anthropic'     — Claude direct or Bedrock-style proxies.
 *
 * `apiKeyEncrypted` holds AES-256-GCM ciphertext (see src/ai/key-crypto.ts);
 * the plaintext is never persisted and never returned by any API.
 */
@Entity({ name: 'ai_provider_configs' })
export class AiProviderConfigEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  /** Owning organization. Configs are tenant-scoped; there is no global row. */
  @Index()
  @Column('varchar', { length: 36 })
  tenantId!: string;

  /** Operator-facing name, e.g. "Ollama (on-prem)" or "OpenRouter — Kimi". */
  @Column('varchar', { length: 120 })
  label!: string;

  /** Protocol adapter: 'openai-compat' | 'anthropic'. */
  @Column('varchar', { length: 30 })
  adapter!: string;

  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 */
  @Column('varchar', { length: 500 })
  baseUrl!: string;

  /** Model identifier sent to the provider, e.g. 'gpt-4o-mini', 'llama3.1'. */
  @Column('varchar', { length: 200 })
  model!: string;

  /** Versioned AES-256-GCM ciphertext; null for keyless endpoints (Ollama). */
  @Column('text', { nullable: true })
  apiKeyEncrypted!: string | null;

  /** Masked display form ('sk-…x4Q2') — the ONLY key shape the API returns. */
  @Column('varchar', { length: 40, nullable: true })
  apiKeyMasked!: string | null;

  /** Disabled configs are kept (with their key) but never selected for calls. */
  @Column('boolean', { default: true })
  enabled!: boolean;

  /** Reserved for Phase 2+: pin this config to a use case ('model_summary', …).
   *  Null = the org's general default. */
  @Column('varchar', { length: 50, nullable: true })
  defaultForUseCase!: string | null;

  /** The inventory model auto-registered for this endpoint (self-governance):
   *  the LLM an org uses for governance drafting is itself an AI system in use,
   *  so it appears in the org's own model inventory. */
  @Column('varchar', { length: 36, nullable: true })
  linkedModelId!: string | null;

  /** Result of the last connection test, for the settings UI. */
  @Column('varchar', { length: 20, nullable: true })
  lastTestStatus!: string | null; // 'ok' | 'failed'

  @Column('datetime', { nullable: true })
  lastTestAt!: Date | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
